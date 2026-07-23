'use strict';
/* Claude Terminal Hub — 폴더 선택 → 세션 목록(재개) → split/도킹 뷰 */

const Terminal = window.Terminal;
const FitAddon = (window.FitAddon && window.FitAddon.FitAddon) || window.FitAddon;
const Split = window.Split;

const stage = document.getElementById('stage');
const emptyMsg = document.getElementById('empty');
const overlay = document.getElementById('overlay');
const folderModal = document.getElementById('folderModal');
const sessionModal = document.getElementById('sessionModal');
const statusEl = document.getElementById('status');

/* ---------- 레이아웃 모델 ----------
 * columns: [{ el, panes:[pane], split }]
 * pane:    { el, term, ws, cfg, fit(), dispose(), connect() }
 * 최상위 columns 는 가로 Split, 각 column 의 panes 는 세로 Split.
 * 재배치(드래그 도킹)는 살아있는 pane.el(터미널 포함)을 DOM 이동만 하여 세션을 보존한다. */
let columns = [];
let columnSplit = null;
let activePane = null;

/* ---------- 계정 프로필 / 탭 ---------- */
function loadProfiles() { try { return JSON.parse(localStorage.getItem('cth_profiles')) || null; } catch { return null; } }
let profiles = loadProfiles() || [{ id: 'default', name: '기본' }];
if (!profiles.find((p) => p.id === 'default')) profiles.unshift({ id: 'default', name: '기본' });
function saveProfiles() { localStorage.setItem('cth_profiles', JSON.stringify(profiles)); }
let activeProfileId = localStorage.getItem('cth_active_profile') || 'default';
if (!profiles.find((p) => p.id === activeProfileId)) activeProfileId = 'default';
const profileWorkspaces = {}; // id -> { columns, activePane }
const accountCache = {}; // id -> 계정 라벨 (탭 호버 툴팁)
function fetchAccount(id) {
  accountCache[id] = '계정 확인 중…';
  fetch(`/api/account?profile=${encodeURIComponent(id)}`).then((r) => r.json()).then((a) => {
    accountCache[id] = a.loggedIn ? `계정: ${a.email}` : '로그인 안 됨 — 첫 세션에서 /login 하세요';
    renderTabs();
  }).catch(() => { accountCache[id] = '계정 정보 없음'; renderTabs(); });
}
const wsStash = document.createElement('div');
wsStash.style.display = 'none';
document.body.appendChild(wsStash);
const profileQ = () => `profile=${encodeURIComponent(activeProfileId)}`;

function paneCountOf(id) {
  const cols = id === activeProfileId ? columns : ((profileWorkspaces[id] && profileWorkspaces[id].columns) || []);
  return cols.reduce((a, c) => a + c.panes.length, 0);
}

function switchProfile(id) {
  if (id === activeProfileId) { renderTabs(); return; }
  // 현재 워크스페이스 저장 + DOM 을 스태시로 분리 (패널/세션 유지)
  profileWorkspaces[activeProfileId] = { columns, activePane };
  columns.forEach((c) => wsStash.appendChild(c.el));
  if (columnSplit) { try { columnSplit.destroy(); } catch {} columnSplit = null; }
  // 대상 워크스페이스 로드
  activeProfileId = id;
  localStorage.setItem('cth_active_profile', id);
  delete accountCache[id]; // 전환 시 계정 정보 재조회 (로그인 변경 반영)
  const w = profileWorkspaces[id] || { columns: [], activePane: null };
  columns = w.columns;
  activePane = w.activePane || null;
  columns.forEach((c) => stage.appendChild(c.el));
  rebuildAll();
  renderTabs();
  updateStatus();
  const si = document.getElementById('lnbSearch');
  if (si) { si.value = ''; document.getElementById('lnbSearchClear').style.display = 'none'; }
  loadRecent();
}

function renderTabs() {
  const list = document.getElementById('tabList');
  if (!list) return;
  list.innerHTML = '';
  profiles.forEach((p) => {
    const t = document.createElement('div');
    t.className = 'tab' + (p.id === activeProfileId ? ' active' : '');
    const n = paneCountOf(p.id);
    t.innerHTML = `<span class="tname">${escapeHtml(p.name)}</span>` +
      (n ? `<span class="cnt">${n}</span>` : '') +
      (p.id !== 'default' ? `<button class="tclose" title="프로필 삭제">✕</button>` : '');
    if (!(p.id in accountCache)) fetchAccount(p.id);
    const acct = accountCache[p.id] || '계정 확인 중…';
    t.title = acct + (p.id !== 'default' ? '\n더블클릭 = 이름 변경' : '');
    t.addEventListener('click', () => switchProfile(p.id));
    if (p.id !== 'default') {
      t.addEventListener('dblclick', (e) => { e.stopPropagation(); renameProfile(p.id); });
    }
    const cb = t.querySelector('.tclose');
    if (cb) cb.addEventListener('click', (e) => { e.stopPropagation(); deleteProfile(p.id); });
    list.appendChild(t);
  });
}

async function addProfile() {
  const name = await uiPrompt('새 계정(프로필) 추가', '', '예: 회사, 개인 — 첫 세션에서 /login 으로 그 계정에 로그인하세요.');
  if (!name || !name.trim()) return;
  const id = 'p_' + Math.abs(Date.now()).toString(36);
  profiles.push({ id, name: name.trim() });
  saveProfiles();
  switchProfile(id);
}

async function renameProfile(id) {
  if (id === 'default') return; // 기본 프로필은 이름 고정
  const p = profiles.find((x) => x.id === id);
  if (!p) return;
  const v = await uiPrompt('프로필 이름 변경', p.name);
  if (v === null || !v.trim()) return;
  p.name = v.trim();
  saveProfiles();
  renderTabs();
}

async function deleteProfile(id) {
  if (paneCountOf(id) > 0) { await uiConfirm('이 프로필에 열린 세션이 있습니다. 먼저 닫아주세요.', '삭제 불가'); return; }
  if (!(await uiConfirm('계정 로그인 폴더(~/.claude-hub-profiles)는 남습니다.', '이 프로필 탭을 삭제할까요?'))) return;
  profiles = profiles.filter((p) => p.id !== id);
  delete profileWorkspaces[id];
  saveProfiles();
  if (activeProfileId === id) { activeProfileId = 'default'; switchProfile('default'); }
  else renderTabs();
}

/* ---------- 인페이지 프롬프트/확인 모달 (네이티브 prompt/confirm 대체) ---------- */
function uiPrompt(title, value, msg) {
  return new Promise((resolve) => {
    const ov = document.getElementById('promptOverlay');
    document.getElementById('pmTitle').textContent = title || '';
    const mEl = document.getElementById('pmMsg'); mEl.textContent = msg || ''; mEl.style.display = msg ? 'block' : 'none';
    const inp = document.getElementById('pmInput'); inp.style.display = 'block'; inp.value = value || '';
    const ok = document.getElementById('pmOk'); const cancel = document.getElementById('pmCancel');
    ov.classList.add('open');
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
    const done = (val) => { ov.classList.remove('open'); ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); inp.removeEventListener('keydown', onKey); resolve(val); };
    const onOk = () => done(inp.value);
    const onCancel = () => done(null);
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); done(inp.value); } else if (e.key === 'Escape') { e.preventDefault(); done(null); } };
    ok.addEventListener('click', onOk); cancel.addEventListener('click', onCancel); inp.addEventListener('keydown', onKey);
  });
}
function uiConfirm(msg, title) {
  return new Promise((resolve) => {
    const ov = document.getElementById('promptOverlay');
    document.getElementById('pmTitle').textContent = title || '확인';
    const mEl = document.getElementById('pmMsg'); mEl.textContent = msg || ''; mEl.style.display = msg ? 'block' : 'none';
    const inp = document.getElementById('pmInput'); inp.style.display = 'none';
    const ok = document.getElementById('pmOk'); const cancel = document.getElementById('pmCancel');
    ov.classList.add('open');
    setTimeout(() => ok.focus(), 30);
    const done = (val) => { ov.classList.remove('open'); ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); document.removeEventListener('keydown', onKey); resolve(val); };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
    ok.addEventListener('click', onOk); cancel.addEventListener('click', onCancel); document.addEventListener('keydown', onKey);
  });
}

/* ---------- 테마 (라이트/다크) ---------- */
function applyTheme(t) {
  document.body.classList.toggle('light', t === 'light');
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = t === 'light' ? '☀️' : '🌙';
  localStorage.setItem('cth_theme', t);
  setTimeout(() => { try { fitAll(); } catch {} }, 60);
}

function updateStatus() {
  const n = columns.reduce((a, c) => a + c.panes.length, 0);
  statusEl.textContent = `세션 ${n}`;
  emptyMsg.style.display = n === 0 ? 'flex' : 'none';
  renderTabs();
}

function fitAll() { columns.forEach((c) => c.panes.forEach((p) => p.fit())); }
function findColumnOf(pane) { return columns.find((c) => c.panes.includes(pane)) || null; }

// 모델 순서 기준으로 DOM 순서를 맞추고 split.js 를 재생성한다.
function rebuildAll() {
  columns.forEach((c) => { if (c.split) { try { c.split.destroy(); } catch {} c.split = null; } });
  if (columnSplit) { try { columnSplit.destroy(); } catch {} columnSplit = null; }
  columns.forEach((col) => {
    stage.appendChild(col.el);
    col.panes.forEach((p) => col.el.appendChild(p.el));
  });
  if (columns.length >= 2) {
    columnSplit = Split(columns.map((c) => c.el), {
      direction: 'horizontal', gutterSize: 6, minSize: 220, snapOffset: 0, onDrag: fitAll, onDragEnd: fitAll,
    });
  } else if (columns.length === 1) {
    columns[0].el.style.width = '100%';
  }
  columns.forEach((col) => {
    if (col.panes.length >= 2) {
      col.split = Split(col.panes.map((p) => p.el), {
        direction: 'vertical', gutterSize: 6, minSize: 120, snapOffset: 0, onDrag: fitAll, onDragEnd: fitAll,
      });
    } else if (col.panes.length === 1) {
      col.panes[0].el.style.height = '100%';
    }
  });
  requestAnimationFrame(() => { fitAll(); requestAnimationFrame(fitAll); });
}

function newColumn(atIndex) {
  const el = document.createElement('div');
  el.className = 'column';
  const col = { el, panes: [], split: null };
  if (typeof atIndex === 'number') columns.splice(atIndex, 0, col);
  else columns.push(col);
  stage.appendChild(el);
  return col;
}

function setActive(pane) {
  if (activePane && activePane.el) activePane.el.classList.remove('active');
  activePane = pane;
  if (pane && pane.el) { pane.el.classList.add('active'); if (pane.term) { try { pane.term.focus(); } catch {} } }
}

/* ---------- 패널(세션) 생성 ---------- */
function addPane(cfg, placement) {
  emptyMsg.style.display = 'none';
  if (!cfg.profile) cfg.profile = activeProfileId; // 현재 계정 프로필에 소속

  let col;
  if (placement === 'row' && activePane && findColumnOf(activePane)) col = findColumnOf(activePane);
  else col = newColumn();

  const pane = document.createElement('div');
  pane.className = 'pane';
  const shortCwd = cfg.cwd.split(/[\\/]/).filter(Boolean).pop() || cfg.cwd;
  const title = getName(cfg.resumeId) || cfg.title || (cfg.resumeId ? '재개한 세션' : (cfg.command && cfg.command !== 'claude' ? cfg.command : 'claude 새 대화'));
  pane.innerHTML = `
    <div class="bar">
      <span class="dot"></span>
      <span class="label" title="${escapeHtml(cfg.cwd)}\n더블클릭 = 이름 변경">
        <span class="ttl">${escapeHtml(title)}</span><span class="cwd">📁 ${escapeHtml(shortCwd)}</span>
      </span>
      <button class="prename" title="세션 이름 변경">✎</button>
      <button class="auto" title="새 메시지 자동 새로고침 (유휴 시 자동 반영)">자동</button>
      <button class="reload" title="새로고침 (세션 다시 불러오기)">⟳</button>
      <button class="split" title="아래로 분할">▤</button>
      <button class="x" title="세션 종료">✕</button>
    </div>
    <div class="term"></div>`;
  col.el.appendChild(pane);

  const termEl = pane.querySelector('.term');
  termEl.style.position = 'relative';
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: 'Consolas, "Cascadia Mono", monospace',
    fontSize: 13,
    theme: { background: '#12151f', foreground: '#d7dbe6' },
    scrollback: 8000,
    allowProposedApi: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(termEl);

  // 복사/붙여넣기 + 제어키 처리
  const pasteFromClipboard = () => {
    navigator.clipboard.readText().then((t) => {
      if (t && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: t }));
    }).catch(() => {});
  };
  const copySelection = () => {
    const s = term.getSelection();
    if (s) navigator.clipboard.writeText(s).catch(() => {});
    return !!s;
  };
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      // 붙여넣기: Ctrl+V / Ctrl+Shift+V
      if (k === 'v') { e.preventDefault(); pasteFromClipboard(); return false; }
      // 복사: Ctrl+Shift+C 는 항상, Ctrl+C 는 선택영역이 있을 때만(없으면 인터럽트 \x03 전달)
      if (k === 'c') {
        if (e.shiftKey) { e.preventDefault(); copySelection(); return false; }
        if (copySelection()) { e.preventDefault(); return false; }
        return true;
      }
      // 나머지 제어키: 브라우저 기본동작만 막고 pty 로 전달
      if (!e.shiftKey && ['u', 'w', 'a', 'e', 'k', 'r', 'l', 'd'].includes(k)) { try { e.preventDefault(); } catch {} }
    }
    return true;
  });
  // 우클릭 붙여넣기
  termEl.addEventListener('contextmenu', (e) => { e.preventDefault(); pasteFromClipboard(); });

  let disposed = false;
  let reloading = false;
  let autoReload = false;
  let lastActivityAt = Date.now();
  let ws = null;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';

  // 세션 파일이 외부에서 커졌을 때 (새 메시지). 최근 내 입력이면 내 세션 자체 쓰기일 수 있어 무시.
  function onExternalChange() {
    if (Date.now() - lastActivityAt < 5000) return;
    if (autoReload) { reload(); return; }
    pane.classList.add('has-changes');
  }

  function showBanner(msg) {
    hideBanner();
    const b = document.createElement('div');
    b.className = 'disc-banner';
    b.innerHTML = `<span>${escapeHtml(msg)}</span> <button>재연결</button>`;
    b.querySelector('button').onclick = () => { hideBanner(); connect(true); };
    termEl.appendChild(b);
  }
  function hideBanner() { const b = termEl.querySelector('.disc-banner'); if (b) b.remove(); }

  function connect(isReconnect) {
    ws = new WebSocket(`${proto}://${location.host}/pty`);
    ws.binaryType = 'arraybuffer';
    paneObj.ws = ws;
    ws.onopen = () => {
      hideBanner();
      if (isReconnect) term.write('\r\n\x1b[90m[재연결됨]\x1b[0m\r\n');
      paneObj.fit();
      ws.send(JSON.stringify({
        type: 'init', cwd: cfg.cwd, runClaude: cfg.runClaude, command: cfg.command,
        resumeId: cfg.resumeId, profile: cfg.profile, cols: term.cols || 80, rows: term.rows || 24,
      }));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string' && ev.data.startsWith('{')) {
        try {
          const m = JSON.parse(ev.data);
          if (m.type === 'ready') {
            pane.classList.remove('exited'); pane.classList.add('running');
            // claude 등 TUI 기동 후 한 번 더 크기 동기화 (입력줄 정렬)
            setTimeout(() => paneObj.fit(), 800);
            return;
          }
          if (m.type === 'exit') {
            pane.classList.remove('running'); pane.classList.add('exited');
            term.write(`\r\n\x1b[90m[프로세스 종료됨 (code ${m.code})]\x1b[0m\r\n`); return;
          }
          if (m.type === 'error') { term.write(`\r\n\x1b[31m${m.message}\x1b[0m\r\n`); return; }
          if (m.type === 'changed') { onExternalChange(); return; }
        } catch { /* 실제 출력 → write */ }
      }
      term.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data));
    };
    ws.onclose = () => {
      pane.classList.remove('running');
      if (reloading) { reloading = false; return; } // 새로고침으로 인한 의도된 종료
      if (!disposed) showBanner('⚠ 연결이 끊겼습니다 (서버 재시작 등). 입력이 전달되지 않습니다.');
    };
  }

  // 세션 새로고침: 현재 프로세스를 끝내고 같은 세션을 다시 불러온다 (최신 메시지 반영)
  function reload() {
    reloading = true;
    pane.classList.remove('has-changes');
    lastActivityAt = Date.now();
    try { if (ws) ws.close(); } catch {}
    term.reset();
    term.write('\r\n\x1b[90m[세션 새로고침 중…]\x1b[0m\r\n');
    connect(true);
  }

  const ro = new ResizeObserver(() => paneObj.fit());

  const paneObj = {
    el: pane, term, ws: null, cfg,
    fit() {
      if (!termEl.clientWidth || !termEl.clientHeight) return;
      try { fit.fit(); } catch {}
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    },
    connect,
    dispose() {
      disposed = true;
      try { ro.disconnect(); } catch {}
      try { if (ws) ws.close(); } catch {}
      try { term.dispose(); } catch {}
      const c = findColumnOf(paneObj);
      if (c) {
        const ci = c.panes.indexOf(paneObj);
        if (ci >= 0) c.panes.splice(ci, 1);
        if (c.panes.length === 0) {
          const idx = columns.indexOf(c);
          if (idx >= 0) columns.splice(idx, 1);
          c.el.remove();
        }
      }
      pane.remove();
      rebuildAll();
      if (activePane === paneObj) setActive(columns[0] ? columns[0].panes[0] : null);
      updateStatus();
    },
  };
  col.panes.push(paneObj);

  term.onData((d) => {
    lastActivityAt = Date.now();
    pane.classList.remove('has-changes'); // 내가 입력 중 → 알림 해제
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: d }));
    else showBanner('⚠ 연결이 끊겨 입력이 전달되지 않습니다.');
  });
  termEl.addEventListener('mousedown', () => setActive(paneObj));
  if (term.textarea) term.textarea.addEventListener('focus', () => setActive(paneObj));

  pane.querySelector('.x').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (await uiConfirm('이 세션을 종료할까요?', '세션 종료')) paneObj.dispose();
  });
  pane.querySelector('.split').addEventListener('click', (e) => {
    e.stopPropagation();
    setActive(paneObj);
    addPane({ cwd: cfg.cwd, runClaude: true, command: 'claude', title: 'claude 새 대화' }, 'row');
  });
  pane.querySelector('.reload').addEventListener('click', (e) => {
    e.stopPropagation();
    setActive(paneObj);
    reload();
  });
  const autoBtn = pane.querySelector('.auto');
  const reloadBtn = pane.querySelector('.reload');
  // 재개 세션만 새 메시지 감지 대상 → 자동 토글 노출
  if (!cfg.resumeId) autoBtn.style.display = 'none';
  autoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    autoReload = !autoReload;
    autoBtn.classList.toggle('on', autoReload);
    autoBtn.textContent = autoReload ? '자동 ●' : '자동';
    autoBtn.title = autoReload ? '자동 새로고침: 켜짐 (유휴 시 새 메시지 자동 반영)' : '자동 새로고침: 꺼짐 (새 메시지 오면 ⟳ 가 깜빡임)';
    if (autoReload) pane.classList.remove('has-changes');
  });
  // 이름 변경 — 제목 더블클릭 또는 ✎ 버튼
  async function renamePane() {
    const ttlEl = pane.querySelector('.ttl');
    const v = await uiPrompt('세션 이름 변경', ttlEl.textContent);
    if (v === null) return;
    const name = v.trim() || cfg.title || 'claude 새 대화';
    ttlEl.textContent = name;
    cfg.title = name;
    if (cfg.resumeId) { setName(cfg.resumeId, v.trim()); refreshLnb(); }
  }
  pane.querySelector('.label').addEventListener('dblclick', (e) => { e.stopPropagation(); renamePane(); });
  pane.querySelector('.prename').addEventListener('click', (e) => { e.stopPropagation(); setActive(paneObj); renamePane(); });

  enablePaneDrag(paneObj, pane.querySelector('.bar'));

  ro.observe(termEl);
  connect(false);
  rebuildAll();
  setActive(paneObj);
  updateStatus();
}

/* ---------- 웹 미리보기 패널 (iframe) ---------- */
function normalizeUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) {
    // 로컬/IP/포트지정은 http, 그 외 공개 도메인은 https 기본
    const head = u.split('/')[0];
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?|\d{1,3}(\.\d{1,3}){3})(:\d+)?$/i.test(head) || /:\d+$/.test(head);
    u = (isLocal ? 'http://' : 'https://') + u;
  }
  return u;
}

function addPreviewPane(url, placement) {
  url = normalizeUrl(url); // 빈 값이면 '' (빈 패널로 열림)
  emptyMsg.style.display = 'none';

  let col;
  if (placement === 'row' && activePane && findColumnOf(activePane)) col = findColumnOf(activePane);
  else col = newColumn();

  const pane = document.createElement('div');
  pane.className = 'pane running';
  let host = '웹 미리보기'; try { if (url) host = new URL(url).host; } catch {}
  pane.innerHTML = `
    <div class="bar">
      <span class="dot"></span>
      <span class="label" title="${escapeHtml(url)}"><span class="ttl">🌐 ${escapeHtml(host)}</span></span>
      <button class="reload" title="새로고침">⟳</button>
      <button class="ext" title="외부 브라우저로 열기">↗</button>
      <button class="x" title="닫기">✕</button>
    </div>
    <div class="preview">
      <div class="urlbar">
        <input type="text" spellcheck="false" placeholder="주소 입력 후 Enter (예: http://localhost:3000)" value="${escapeHtml(url)}" />
        <button class="go">이동</button>
      </div>
      <iframe referrerpolicy="no-referrer"></iframe>
    </div>`;
  col.el.appendChild(pane);

  const iframe = pane.querySelector('iframe');
  const input = pane.querySelector('.urlbar input');
  if (url) iframe.src = url; // 빈 값이면 빈 iframe

  const paneObj = {
    el: pane, cfg: { preview: true, url },
    fit() { /* iframe 은 flex 로 자동 채움 */ },
    dispose() {
      const c = findColumnOf(paneObj);
      if (c) {
        const ci = c.panes.indexOf(paneObj);
        if (ci >= 0) c.panes.splice(ci, 1);
        if (c.panes.length === 0) { const idx = columns.indexOf(c); if (idx >= 0) columns.splice(idx, 1); c.el.remove(); }
      }
      pane.remove();
      rebuildAll();
      if (activePane === paneObj) setActive(columns[0] ? columns[0].panes[0] : null);
      updateStatus();
    },
  };
  col.panes.push(paneObj);

  function navigate(u) {
    u = normalizeUrl(u);
    if (!u) return;
    paneObj.cfg.url = u;
    input.value = u;
    iframe.src = u;
    try { pane.querySelector('.ttl').textContent = '🌐 ' + new URL(u).host; } catch {}
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(e.target.value); });
  pane.querySelector('.go').addEventListener('click', (e) => { e.stopPropagation(); navigate(input.value); });
  pane.querySelector('.reload').addEventListener('click', (e) => { e.stopPropagation(); iframe.src = iframe.src; });
  pane.querySelector('.ext').addEventListener('click', (e) => { e.stopPropagation(); window.open(paneObj.cfg.url, '_blank'); });
  pane.querySelector('.x').addEventListener('click', (e) => { e.stopPropagation(); paneObj.dispose(); });
  pane.querySelector('.preview .urlbar').addEventListener('mousedown', () => setActive(paneObj));

  enablePaneDrag(paneObj, pane.querySelector('.bar'));
  rebuildAll();
  setActive(paneObj);
  updateStatus();
  if (!url) setTimeout(() => input.focus(), 80); // 빈 패널이면 주소창에 바로 입력
}

document.getElementById('addWeb').addEventListener('click', () => {
  addPreviewPane('', 'column'); // URL 은 패널 주소창에서 입력
});

/* ---------- 드래그 도킹 ---------- */
const dropIndicator = document.getElementById('dropIndicator');
let drag = null;

function enablePaneDrag(paneObj, bar) {
  bar.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    setActive(paneObj);
    const startX = e.clientX, startY = e.clientY;
    drag = { pane: paneObj, bar, started: false, target: null, zone: null };

    const onMove = (ev) => {
      if (!drag) return;
      if (!drag.started) {
        if (Math.abs(ev.clientX - startX) < 5 && Math.abs(ev.clientY - startY) < 5) return;
        drag.started = true;
        bar.classList.add('grabbing');
        paneObj.el.classList.add('dragging');
        document.body.classList.add('dragging-pane');
        document.body.style.userSelect = 'none';
      }
      const targetEl = paneUnderPoint(ev.clientX, ev.clientY, paneObj.el);
      if (!targetEl) { dropIndicator.style.display = 'none'; drag.target = null; return; }
      const tPane = columns.flatMap((c) => c.panes).find((p) => p.el === targetEl);
      const zone = computeZone(targetEl, ev.clientX, ev.clientY);
      drag.target = tPane; drag.zone = zone;
      showDropIndicator(targetEl, zone);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      bar.classList.remove('grabbing');
      paneObj.el.classList.remove('dragging');
      document.body.classList.remove('dragging-pane');
      document.body.style.userSelect = '';
      dropIndicator.style.display = 'none';
      if (drag && drag.started && drag.target && drag.target !== paneObj) dockPane(paneObj, drag.target, drag.zone);
      drag = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function paneUnderPoint(x, y, exceptEl) {
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    const pane = el.closest && el.closest('.pane');
    if (pane && pane !== exceptEl) return pane;
  }
  return null;
}
function computeZone(el, x, y) {
  const r = el.getBoundingClientRect();
  const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
  if (fx < 0.25) return 'left';
  if (fx > 0.75) return 'right';
  if (fy < 0.5) return 'top';
  return 'bottom';
}
function showDropIndicator(el, zone) {
  const r = el.getBoundingClientRect();
  let { left, top, width, height } = r;
  if (zone === 'left') width = r.width / 2;
  else if (zone === 'right') { left = r.left + r.width / 2; width = r.width / 2; }
  else if (zone === 'top') height = r.height / 2;
  else if (zone === 'bottom') { top = r.top + r.height / 2; height = r.height / 2; }
  Object.assign(dropIndicator.style, { display: 'block', left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
  dropIndicator.querySelector('.dz').textContent = { left: '◧ 왼쪽', right: '오른쪽 ▶', top: '▲ 위', bottom: '▼ 아래' }[zone] || '';
}
function dockPane(src, target, zone) {
  const srcCol = findColumnOf(src);
  const tgtCol = findColumnOf(target);
  if (!srcCol || !tgtCol) return;
  srcCol.panes.splice(srcCol.panes.indexOf(src), 1);
  if (zone === 'left' || zone === 'right') {
    const tgtIdx = columns.indexOf(tgtCol);
    const at = zone === 'left' ? tgtIdx : tgtIdx + 1;
    newColumn(at).panes.push(src);
  } else {
    const ti = tgtCol.panes.indexOf(target);
    tgtCol.panes.splice(zone === 'top' ? ti : ti + 1, 0, src);
  }
  if (srcCol.panes.length === 0) { columns.splice(columns.indexOf(srcCol), 1); srcCol.el.remove(); }
  rebuildAll();
  setActive(src);
  updateStatus();
}

/* ---------- 모달 흐름 ---------- */
let currentPath = '';
function openOverlay(which) {
  folderModal.style.display = which === 'folder' ? 'flex' : 'none';
  sessionModal.style.display = which === 'session' ? 'flex' : 'none';
  overlay.classList.add('open');
}
function closeOverlay() { overlay.classList.remove('open'); }

async function startNewSession() {
  const defs = await fetch('/api/defaults').then((r) => r.json()).catch(() => ({}));
  const last = localStorage.getItem('cth_last_path');
  await loadDrives();
  await browseTo(last || defs.cwd || defs.home || '');
  openOverlay('folder');
}
window.startNewSession = startNewSession;
document.getElementById('add').addEventListener('click', startNewSession);

async function loadDrives() {
  const box = document.getElementById('drives');
  const { drives } = await fetch('/api/fs/drives').then((r) => r.json()).catch(() => ({ drives: [] }));
  box.innerHTML = '';
  (drives || []).forEach((d) => {
    const b = document.createElement('button');
    b.textContent = d;
    b.onclick = () => browseTo(d);
    box.appendChild(b);
  });
}

async function browseTo(p) {
  const res = await fetch(`/api/fs/list?path=${encodeURIComponent(p)}&${profileQ()}`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  const list = document.getElementById('fslist');
  const note = document.getElementById('fsnote');
  if (res.error) { note.textContent = '⚠ ' + res.error; return; }
  currentPath = res.path;
  document.getElementById('curPath').value = res.path;
  note.textContent = res.hasSessions ? '✓ 이 폴더에 Claude 세션 기록이 있습니다.' : '이 폴더에 저장된 Claude 세션이 없습니다 (새 대화만 가능).';
  list.innerHTML = '';
  if (res.parent) {
    const up = document.createElement('div');
    up.className = 'fsitem up';
    up.innerHTML = '<span class="ico">↑</span> .. (상위 폴더)';
    up.onclick = () => browseTo(res.parent);
    list.appendChild(up);
  }
  if (res.dirs.length === 0) {
    const e = document.createElement('div'); e.className = 'fsnote'; e.textContent = '하위 폴더 없음';
    list.appendChild(e);
  }
  res.dirs.forEach((name) => {
    const it = document.createElement('div');
    it.className = 'fsitem';
    it.innerHTML = `<span class="ico">📁</span> ${escapeHtml(name)}`;
    it.onclick = () => browseTo(joinPath(res.path, name));
    list.appendChild(it);
  });
}

// 경로 "선택 확정" → 검증 후 세션 목록으로 (별도 이동 불필요)
async function choosePath(p) {
  p = (p || '').trim();
  if (!p) return;
  const res = await fetch(`/api/fs/list?path=${encodeURIComponent(p)}&${profileQ()}`).then((r) => r.json()).catch(() => ({ error: '경로 조회 실패' }));
  if (res.error) { document.getElementById('fsnote').textContent = '⚠ ' + res.error; return; }
  localStorage.setItem('cth_last_path', res.path);
  openSessionPicker(res.path);
}

document.getElementById('goPath').addEventListener('click', () => browseTo(document.getElementById('curPath').value.trim()));
document.getElementById('curPath').addEventListener('keydown', (e) => { if (e.key === 'Enter') choosePath(e.target.value); });
document.getElementById('pickHere').addEventListener('click', () => choosePath(document.getElementById('curPath').value));
document.getElementById('changeFolder').addEventListener('click', () => openOverlay('folder'));

document.getElementById('osPick').addEventListener('click', async () => {
  const btn = document.getElementById('osPick');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '선택기 여는 중…';
  const cur = document.getElementById('curPath').value.trim();
  try {
    const res = await fetch(`/api/fs/pick?path=${encodeURIComponent(cur)}`).then((r) => r.json());
    if (res.error) { document.getElementById('fsnote').textContent = '⚠ ' + res.error; return; }
    if (res.canceled || !res.path) return;
    document.getElementById('curPath').value = res.path;
    choosePath(res.path);
  } catch (e) {
    document.getElementById('fsnote').textContent = '⚠ OS 선택기 호출 실패: ' + e.message;
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
});

async function openSessionPicker(p) {
  document.getElementById('sesCwd').textContent = p;
  document.getElementById('seslist').innerHTML = '<div class="sesempty">불러오는 중…</div>';
  openOverlay('session');
  const res = await fetch(`/api/sessions?path=${encodeURIComponent(p)}&${profileQ()}`).then((r) => r.json()).catch(() => ({ sessions: [] }));
  const list = document.getElementById('seslist');
  document.getElementById('sesCount').textContent = res.total ? `(${res.sessions.length}/${res.total})` : '(0)';
  list.innerHTML = '';
  if (!res.sessions || res.sessions.length === 0) {
    list.innerHTML = '<div class="sesempty">저장된 세션이 없습니다. 위의 <b>새 대화 시작</b>으로 시작하세요.</div>';
    return;
  }
  res.sessions.forEach((s) => {
    const it = document.createElement('div');
    it.className = 'sesitem';
    it.innerHTML = `
      <span class="ico">💬</span>
      <div class="meta">
        <div class="title">${escapeHtml(s.title)}</div>
        <div class="sub">${relTime(s.mtime)} · ${s.sizeKB}KB · ${s.id.slice(0, 8)}</div>
      </div>`;
    it.onclick = () => { closeOverlay(); addPane({ cwd: p, resumeId: s.id, title: s.title }, getPlacement()); };
    list.appendChild(it);
  });
}

function getPlacement() {
  const r = document.querySelector('input[name="placement"]:checked');
  return r ? r.value : 'column';
}

document.getElementById('newChat').addEventListener('click', () => {
  const p = document.getElementById('sesCwd').textContent;
  closeOverlay(); addPane({ cwd: p, runClaude: true, command: 'claude', title: 'claude 새 대화' }, getPlacement());
});
document.getElementById('customCmd').addEventListener('click', async () => {
  const p = document.getElementById('sesCwd').textContent;
  const cmd = await uiPrompt('명령 직접 입력', 'claude --continue', '빈칸이면 셸만 열립니다.');
  if (cmd === null) return;
  closeOverlay();
  addPane({ cwd: p, runClaude: !!cmd.trim(), command: cmd.trim() || 'claude', title: cmd.trim() || '셸' }, getPlacement());
});

// backdrop 클릭으로는 닫지 않음 — 실수 방지. ✕/취소/닫기/Esc 로만.
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeOverlay));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeOverlay(); });

/* ---------- 유틸 ---------- */
function joinPath(base, name) {
  const sep = base.includes('/') && !base.includes('\\') ? '/' : '\\';
  return base.endsWith(sep) ? base + name : base + sep + name;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function relTime(ms) {
  if (!ms) return '?';
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return '방금';
  if (d < 3600) return `${Math.floor(d / 60)}분 전`;
  if (d < 86400) return `${Math.floor(d / 3600)}시간 전`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)}일 전`;
  return new Date(ms).toLocaleDateString('ko-KR');
}

/* ---------- 세션 커스텀 이름 (localStorage, resumeId 기준) ---------- */
function getNames() { try { return JSON.parse(localStorage.getItem('cth_names')) || {}; } catch { return {}; } }
function getName(id) { return id ? (getNames()[id] || null) : null; }
function setName(id, name) {
  if (!id) return;
  const m = getNames();
  if (name && name.trim()) m[id] = name.trim(); else delete m[id];
  localStorage.setItem('cth_names', JSON.stringify(m));
}

/* ---------- LNB (최근 세션 + 전체 검색) ---------- */
function renderSessionList(sessions, emptyMsg) {
  const box = document.getElementById('recentList');
  box.innerHTML = '';
  if (!sessions || sessions.length === 0) {
    box.innerHTML = `<div class="recent-empty">${escapeHtml(emptyMsg || '결과가 없습니다.')}</div>`;
    return;
  }
  sessions.forEach((s) => {
    const folder = s.cwd.split(/[\\/]/).filter(Boolean).pop() || s.cwd;
    const name = getName(s.id) || s.title;
    const it = document.createElement('div');
    it.className = 'recent-item';
    it.title = `${name}\n${s.cwd}\n클릭 = 새 패널로 열기 / ✎ = 이름 변경`;
    it.innerHTML = `
      <button class="rename" title="이름 변경">✎</button>
      <div class="rt">💬 ${escapeHtml(name)}</div>
      <div class="rf">📁 ${escapeHtml(folder)}</div>
      <div class="rs">${relTime(s.mtime)}</div>`;
    it.querySelector('.rename').onclick = async (e) => {
      e.stopPropagation();
      const v = await uiPrompt('세션 이름 변경', getName(s.id) || s.title, '비우면 기본 이름으로 되돌립니다.');
      if (v === null) return;
      setName(s.id, v);
      applyNameToOpenPanes(s.id);
      refreshLnb();
    };
    it.onclick = () => addPane({ cwd: s.cwd, resumeId: s.id, title: getName(s.id) || s.title }, 'column');
    box.appendChild(it);
  });
}

async function loadRecent() {
  document.getElementById('lnbTitle').textContent = '최근 세션';
  document.getElementById('recentList').innerHTML = '<div class="recent-empty">불러오는 중…</div>';
  const res = await fetch(`/api/recent?limit=15&${profileQ()}`).then((r) => r.json()).catch(() => ({ sessions: [] }));
  renderSessionList(res.sessions, '최근 세션이 없습니다.');
}

async function searchSessions(q) {
  document.getElementById('lnbTitle').textContent = '검색 중…';
  document.getElementById('recentList').innerHTML = '<div class="recent-empty">검색 중…</div>';
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=60&${profileQ()}`).then((r) => r.json()).catch(() => ({ sessions: [] }));
  document.getElementById('lnbTitle').textContent = `검색 결과 (${res.sessions.length})`;
  renderSessionList(res.sessions, `"${q}" 와 일치하는 세션이 없습니다.`);
}

function refreshLnb() {
  const q = document.getElementById('lnbSearch').value.trim();
  if (q) searchSessions(q); else loadRecent();
}

// 열려있는 패널 중 해당 세션 제목을 커스텀 이름으로 갱신
function applyNameToOpenPanes(id) {
  const nm = getName(id);
  columns.forEach((c) => c.panes.forEach((p) => {
    if (p.cfg.resumeId === id) {
      const ttl = p.el.querySelector('.ttl');
      if (ttl) ttl.textContent = nm || p.cfg.title || '재개한 세션';
    }
  }));
}

let searchTimer;
document.getElementById('lnbSearch').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  document.getElementById('lnbSearchClear').style.display = q ? 'block' : 'none';
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { if (q) searchSessions(q); else loadRecent(); }, 250);
});
document.getElementById('lnbSearchClear').addEventListener('click', () => {
  const inp = document.getElementById('lnbSearch');
  inp.value = ''; inp.focus();
  document.getElementById('lnbSearchClear').style.display = 'none';
  loadRecent();
});

function setLnb(collapsed) {
  document.body.classList.toggle('lnb-collapsed', collapsed);
  localStorage.setItem('cth_lnb_collapsed', collapsed ? '1' : '0');
  setTimeout(fitAll, 180);
}
document.getElementById('lnbToggle').addEventListener('click', () => {
  setLnb(!document.body.classList.contains('lnb-collapsed'));
});
document.getElementById('lnbRefresh').addEventListener('click', refreshLnb);
document.getElementById('addProfile').addEventListener('click', addProfile);
document.getElementById('themeToggle').addEventListener('click', () => applyTheme(document.body.classList.contains('light') ? 'dark' : 'light'));
applyTheme(localStorage.getItem('cth_theme') || 'dark');

let rt;
window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(fitAll, 120); });

setLnb(localStorage.getItem('cth_lnb_collapsed') === '1');
renderTabs();
loadRecent();
updateStatus();
// 로드 시 모달을 자동으로 열지 않는다 — 모달이 LNB(최근 세션) 클릭을 가리기 때문.
// 사용자가 좌측 최근 세션을 클릭하거나 "＋ 새 세션"을 눌러 시작한다.

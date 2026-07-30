'use strict';
/* Claude Terminal Hub — 폴더 선택 → 세션 목록(재개) → split/도킹 뷰 */

/* ---------- SVG 아이콘 (이모지 대체, currentColor) ---------- */
function ic(inner) {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
const ICON = {
  plus: ic('<path d="M12 5v14M5 12h14"/>'),
  globe: ic('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/>'),
  moon: ic('<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>'),
  sun: ic('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>'),
  menu: ic('<path d="M3 6h18M3 12h18M3 18h18"/>'),
  x: ic('<path d="M6 6l12 12M18 6L6 18"/>'),
  refresh: ic('<path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5"/>'),
  split: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18"/>'),
  chat: ic('<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  folder: ic('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  file: ic('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>'),
  eye: ic('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'),
  external: ic('<path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>'),
  back: ic('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
  search: ic('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  warn: ic('<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
  palette: ic('<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.7 1.1-1.6-.3-.6-.1-1.4.6-1.7.5-.2 1-.2 1.5-.2 2 0 3.8-1.7 3.8-4.5C19 6.9 15.9 3 12 3z"/><circle cx="7.5" cy="11.5" r="1.2"/><circle cx="10.5" cy="7.5" r="1.2"/><circle cx="15" cy="8" r="1.2"/>'),
  droplet: ic('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
};
function hydrateIcons(root) {
  (root || document).querySelectorAll('[data-icon]').forEach((el) => {
    if (!el.dataset.done) { el.innerHTML = ICON[el.dataset.icon] || ''; el.dataset.done = '1'; }
  });
}

const Terminal = window.Terminal;
const FitAddon = (window.FitAddon && window.FitAddon.FitAddon) || window.FitAddon;
const CanvasAddon = (window.CanvasAddon && window.CanvasAddon.CanvasAddon) || window.CanvasAddon;
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

const TERM_THEMES = {
  dark: { background: '#12151f', foreground: '#d7dbe6', black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510', blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5', brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#e5e5e5' },
  dracula: { background: '#282a36', foreground: '#f8f8f2', black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2', brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff' },
  solarized: { background: '#002b36', foreground: '#93a1a1', black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5', brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3' },
  nord: { background: '#2e3440', foreground: '#d8dee9', black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0', brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4' },
  onedark: { background: '#282c34', foreground: '#abb2bf', black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf', brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#d19a66', brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff' },
  gruvbox: { background: '#282828', foreground: '#ebdbb2', black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984', brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2' },
  monokai: { background: '#272822', foreground: '#f8f8f2', black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75', blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2', brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e', brightYellow: '#f4bf75', brightBlue: '#66d9ef', brightMagenta: '#ae81ff', brightCyan: '#a1efe4', brightWhite: '#f9f8f5' },
  tokyonight: { background: '#1a1b26', foreground: '#c0caf5', black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6', brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68', brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5' },
  catppuccin: { background: '#1e1e2e', foreground: '#cdd6f4', black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de', brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1', brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#f5c2e7', brightCyan: '#94e2d5', brightWhite: '#a6adc8' },
  githubdark: { background: '#0d1117', foreground: '#c9d1d9', black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4', brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc' },
};
function currentTermTheme() { return TERM_THEMES[document.body.dataset.theme] || TERM_THEMES.dark; }
let activePane = null;

/* ---------- 새 메시지 알림 (OS 알림 / 브라우저 알림) ---------- */
function ensureNotifyPermission() {
  if (window.claudeHub && window.claudeHub.isApp) return; // Electron: 메인 프로세스가 OS 알림 담당
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  Notification.requestPermission().catch(() => {});
}
// 작업 완료 알림 — 터미널 벨(\x07)에서만 발생. Claude 는 턴 완료/입력 대기 시 벨을 울린다.
// (벨을 안 울리는 환경이면 알림은 그냥 발생하지 않음). 디바운스는 세션(패널)별로 호출부에서 처리.
function notifyDone(cfg) {
  const title = (cfg.title || 'Claude').trim();
  const shortCwd = cfg.cwd ? (cfg.cwd.split(/[\\/]/).filter(Boolean).pop() || cfg.cwd) : '';
  const body = `작업 완료 — ${title}${shortCwd ? ' · ' + shortCwd : ''}`;
  // 세션별 구분을 위해 tag 사용(Electron/브라우저 모두) — 같은 세션 알림은 갱신, 다른 세션은 별도로 쌓임
  const tag = 'cth-' + (cfg.resumeId || title || Math.random().toString(36).slice(2));
  if (window.claudeHub && window.claudeHub.notify) { window.claudeHub.notify({ title: '작업 완료', body, tag }); return; }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification('작업 완료', { body, tag }); } catch {}
}

/* ---------- 터미널 글자 크기 조절 ---------- */
const FONT_MIN = 9, FONT_MAX = 28;
let termFontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, parseInt(localStorage.getItem('cth_font_size'), 10) || 13));
function applyFontSize(px) {
  termFontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, px));
  localStorage.setItem('cth_font_size', String(termFontSize));
  const label = document.getElementById('fontSizeLabel');
  if (label) label.textContent = termFontSize;
  columns.forEach((c) => c.panes.forEach((p) => { if (p.term) { try { p.term.options.fontSize = termFontSize; } catch {} } }));
  setTimeout(() => { try { fitAll(); } catch {} }, 30);
}

/* ---------- 터미널 글꼴(폰트) 선택 ---------- */
const FONT_FAMILIES = [
  { label: 'Cascadia Code', css: "'Cascadia Code','Cascadia Mono',Consolas,monospace" },
  { label: 'Cascadia Mono', css: "'Cascadia Mono',Consolas,monospace" },
  { label: 'JetBrains Mono', css: "'JetBrains Mono',Consolas,monospace" },
  { label: 'Fira Code', css: "'Fira Code',Consolas,monospace" },
  { label: 'D2Coding', css: "'D2Coding',Consolas,monospace" },
  { label: 'Consolas', css: "Consolas,'Courier New',monospace" },
];
let termFontFamily = localStorage.getItem('cth_font_family') || FONT_FAMILIES[0].css;
function applyFontFamily(css) {
  termFontFamily = css;
  localStorage.setItem('cth_font_family', css);
  columns.forEach((c) => c.panes.forEach((p) => { if (p.term) { try { p.term.options.fontFamily = css; } catch {} } }));
  setTimeout(() => { try { fitAll(); } catch {} }, 30);
}

/* ---------- 계정 프로필 / 탭 ---------- */
let profiles = [{ id: 'default', name: '기본' }]; // 서버 /api/state 에서 로드됨
function saveProfiles() {
  fetch('/api/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profiles }) }).catch(() => {});
}
let activeProfileId = localStorage.getItem('cth_active_profile') || 'default';
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
// LNB(최근/검색)에서 "모든 계정" 보기 토글 — 켜면 모든 프로필 세션을 함께 나열
let lnbAllProfiles = localStorage.getItem('cth_lnb_all_profiles') === '1';
const lnbProfileQ = () => (lnbAllProfiles ? 'profile=__all__' : profileQ());
function profileName(id) { const p = profiles.find((x) => x.id === id); return p ? p.name : (id || '기본'); }

// 세션 열기: 다른 계정 소속이면 그 계정 탭으로 전환 후 열기(원 계정으로 이어가기 = 방식 A)
function openSession(s, placement) {
  if (s.profile && s.profile !== activeProfileId && profiles.find((p) => p.id === s.profile)) switchProfile(s.profile);
  addPane({ cwd: s.cwd, resumeId: s.id, title: s.title, profile: s.profile || activeProfileId }, placement || 'column');
}

// 다른 계정 대화를 현재 활성 계정으로 복사해서 이어가기(방식 B). 원본은 그대로 유지.
async function continueHere(s) {
  const target = activeProfileId;
  const r = await fetch('/api/session/copy', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: s.id, cwd: s.cwd, fromProfile: s.profile || 'default', toProfile: target }),
  }).then((x) => x.json()).catch(() => ({ error: '요청 실패' }));
  if (!r || r.error) { await uiConfirm((r && r.error) || '복사에 실패했습니다.', '이어가기 실패'); return; }
  addPane({ cwd: s.cwd, resumeId: s.id, title: s.title, profile: target }, 'column');
}

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
      (p.id !== 'default' ? `<button class="tclose" title="프로필 삭제">${ICON.x}</button>` : '');
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

/* ---------- 테마 (색상 팔레트) ---------- */
function closePopovers() { document.querySelectorAll('.popover').forEach((p) => p.classList.remove('open')); }
function setupPopover(btnId, popId) {
  const btn = document.getElementById(btnId);
  const pop = document.getElementById(popId);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = !pop.classList.contains('open');
    closePopovers();
    if (willOpen) pop.classList.add('open');
  });
  pop.addEventListener('click', (e) => e.stopPropagation());
}
document.addEventListener('click', closePopovers);

function applyTheme(t) {
  if (!TERM_THEMES[t]) t = 'dark';
  document.body.dataset.theme = t;
  localStorage.setItem('cth_theme', t);
  document.querySelectorAll('#themePopover .popover-item').forEach((el) => el.classList.toggle('active', el.dataset.theme === t));
  const termTheme = currentTermTheme();
  columns.forEach((c) => c.panes.forEach((p) => { if (p.term) { try { p.term.options.theme = termTheme; } catch {} } }));
  setTimeout(() => { try { fitAll(); } catch {} }, 60);
}

const ACCENTS = { blue: '#4c8bf5', purple: '#bd93f9', green: '#3fb950', red: '#e5484d', orange: '#f0a020', pink: '#ff79c6', cyan: '#22d3ee' };
const ACCENT_LABELS = { blue: '파랑', purple: '보라', green: '초록', red: '빨강', orange: '주황', pink: '핑크', cyan: '시안' };
function applyAccent(key) {
  if (!ACCENTS[key]) key = null;
  if (key) {
    document.body.style.setProperty('--active', ACCENTS[key]);
    document.body.style.setProperty('--accent', ACCENTS[key]);
    localStorage.setItem('cth_accent', key);
  } else {
    document.body.style.removeProperty('--active');
    document.body.style.removeProperty('--accent');
    localStorage.removeItem('cth_accent');
  }
  document.querySelectorAll('#accentPopover .popover-item').forEach((b) => b.classList.toggle('active', b.dataset.accent === key));
}
function buildAccentPicker() {
  const el = document.getElementById('accentPopover');
  if (!el) return;
  const items = Object.entries(ACCENTS).map(([k, hex]) => `<div class="popover-item" data-accent="${k}"><span class="swatch" style="background:${hex}"></span>${ACCENT_LABELS[k]}</div>`).join('');
  el.innerHTML = `<div class="popover-item" data-accent="">테마 기본값</div>${items}`;
  el.querySelectorAll('.popover-item').forEach((b) => b.addEventListener('click', () => { applyAccent(b.dataset.accent); closePopovers(); }));
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
  if (pane && pane.el) { pane.el.classList.add('active'); pane.el.classList.remove('done'); if (pane.term) { try { pane.term.focus(); } catch {} } }
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
  const title = cfg.title || (cfg.resumeId ? '재개한 세션' : (cfg.command && cfg.command !== 'claude' ? cfg.command : 'claude 새 대화'));
  pane.innerHTML = `
    <div class="bar">
      <span class="dot"></span>
      <span class="label" title="${escapeHtml(cfg.cwd)}">
        <span class="ttl">${escapeHtml(title)}</span><span class="cwd">${ICON.folder}<span>${escapeHtml(shortCwd)}</span></span>
      </span>
      <button class="artifact" title="Claude 아티팩트 미리보기" style="display:none"></button>
      <button class="auto" title="새 메시지 자동 새로고침 (유휴 시 자동 반영)">자동</button>
      <button class="reload" title="새로고침 (세션 다시 불러오기)">${ICON.refresh}</button>
      <button class="split" title="아래로 분할">${ICON.split}</button>
      <button class="x" title="세션 종료">${ICON.x}</button>
    </div>
    <div class="term"></div>`;
  col.el.appendChild(pane);

  const termEl = pane.querySelector('.term');
  termEl.style.position = 'relative';
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: termFontFamily,
    fontSize: termFontSize,
    theme: currentTermTheme(),
    scrollback: 8000,
    allowProposedApi: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(termEl);
  if (CanvasAddon) { try { term.loadAddon(new CanvasAddon()); } catch {} }
  // 작업 완료 알림: Claude 가 턴 완료 시 울리는 터미널 벨에서만 (세션별 1.5s 디바운스)
  // + 앱을 보고 있어도 어느 세션이 끝났는지 보이도록 패널에 완료 표시(활성 패널 제외)
  let lastBellAt = 0;
  try {
    term.onBell(() => {
      if (!pane.classList.contains('active')) pane.classList.add('done');
      const now = Date.now(); if (now - lastBellAt < 1500) return; lastBellAt = now; notifyDone(cfg);
    });
  } catch {}

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
  let lastArtifact = null;
  let ws = null;
  let reconnectTries = 0;
  let reconnectTimer = null;
  const RECONNECT_MAX = 6;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';

  // 세션 파일이 외부에서 커졌을 때 (새 메시지). 최근 내 입력이면 내 세션 자체 쓰기일 수 있어 무시.
  function onExternalChange() {
    if (Date.now() - lastActivityAt < 5000) return;
    if (autoReload) { reload(); return; }
    pane.classList.add('has-changes');
    // 알림은 여기서 보내지 않음 — 작업 완료(터미널 벨)에서만 notifyDone 발생
  }

  function showBanner(msg, btnLabel) {
    hideBanner();
    const b = document.createElement('div');
    b.className = 'disc-banner';
    b.innerHTML = `<span class="i">${ICON.warn}</span><span>${escapeHtml(msg)}</span>` + (btnLabel ? ` <button>${escapeHtml(btnLabel)}</button>` : '');
    const btn = b.querySelector('button');
    if (btn) btn.onclick = () => { reconnectTries = 0; if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } hideBanner(); connect(true); };
    termEl.appendChild(b);
  }
  function hideBanner() { const b = termEl.querySelector('.disc-banner'); if (b) b.remove(); }

  // 끊김 시 자동 백오프 재연결 (서버가 다시 뜨면 자동 복구). 서버 pty 는 ws close 시 종료되므로 중복 세션 없음.
  function scheduleReconnect() {
    if (disposed || reconnectTimer) return;
    if (reconnectTries >= RECONNECT_MAX) {
      showBanner('연결 끊김 — 자동 재연결 실패(서버 꺼짐?). 수동으로 재시도하세요.', '재연결');
      return;
    }
    reconnectTries++;
    const delay = Math.min(8000, 1000 * Math.pow(2, Math.min(reconnectTries - 1, 3)));
    showBanner(`연결 끊김 — ${Math.round(delay / 1000)}초 후 재연결 시도 (${reconnectTries}/${RECONNECT_MAX})`, '지금 재시도');
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(true); }, delay);
  }

  function connect(isReconnect) {
    ws = new WebSocket(`${proto}://${location.host}/pty`);
    ws.binaryType = 'arraybuffer';
    paneObj.ws = ws;
    ws.onopen = () => {
      hideBanner();
      reconnectTries = 0;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
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
          if (m.type === 'artifact') { onArtifact(m.path); return; }
        } catch { /* 실제 출력 → write */ }
      }
      term.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data));
    };
    ws.onclose = () => {
      pane.classList.remove('running');
      if (reloading) { reloading = false; return; } // 새로고침으로 인한 의도된 종료
      if (!disposed) scheduleReconnect(); // 자동 백오프 재연결 (서버 복구 시 자동)
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
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
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
    pane.classList.remove('has-changes', 'done'); // 내가 입력 중 → 알림/완료표시 해제
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: d }));
    else showBanner('연결이 끊겨 입력이 전달되지 않습니다.');
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
    autoBtn.title = autoReload ? '자동 새로고침: 켜짐 (유휴 시 새 메시지 자동 반영)' : '자동 새로고침: 꺼짐 (새 메시지 오면 새로고침 버튼이 깜빡임)';
    if (autoReload) pane.classList.remove('has-changes');
  });

  // Claude 아티팩트(만든/본 파일) 감지 → 칩 표시, 클릭 시 옆에 미리보기
  const artifactBtn = pane.querySelector('.artifact');
  artifactBtn.addEventListener('click', (e) => { e.stopPropagation(); if (lastArtifact) addFilePreview(lastArtifact, 'column'); });
  function onArtifact(p) {
    lastArtifact = p;
    const base = p.split(/[\\/]/).filter(Boolean).pop() || p;
    artifactBtn.innerHTML = `${ICON.eye}<span class="alabel">${escapeHtml(base)}</span>`;
    artifactBtn.title = `미리보기: ${p}`;
    artifactBtn.style.display = '';
  }

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
  // 이미 서버 파일 서빙 경로면 그대로 (재-normalize 시 이중 변환 방지)
  if (/^\/api\/file\?/.test(u)) return u;
  // 로컬 파일 경로 → 서버(/api/file)가 올바른 Content-Type 으로 서빙 → 브라우저·앱 모두 렌더.
  //  (iframe 은 http 문서에서 file:// 을 차단하므로 file:// 대신 서버 서빙 경로를 쓴다)
  //   - Windows 절대경로:  C:\...  또는 C:/...
  //   - UNC:               \\host\share
  //   - POSIX 절대경로:     /Users/... , /home/...
  //   - 홈 상대경로:        ~/...
  if (/^[a-zA-Z]:[\\/]/.test(u) || /^\\\\/.test(u) || /^~\//.test(u) || /^\//.test(u)) {
    return '/api/file?path=' + encodeURIComponent(u);
  }
  // file: 스킴도 서버 서빙으로 재라우팅
  const m = u.match(/^file:\/{2,}(.*)$/i);
  if (m) {
    let p = decodeURIComponent(m[1]);
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1); // /C:/... → C:/...
    return '/api/file?path=' + encodeURIComponent(p);
  }
  // 그 외 스킴(data:, about:, blob:, http(s): 등)은 그대로 둔다
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  // 스킴 없는 호스트: 로컬/IP/포트지정은 http, 그 외 공개 도메인은 https 기본
  const head = u.split('/')[0];
  const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?|\d{1,3}(\.\d{1,3}){3})(:\d+)?$/i.test(head) || /:\d+$/.test(head);
  return (isLocal ? 'http://' : 'https://') + u;
}

function addPreviewPane(url, placement, label) {
  const isFile = !!label; // 파일 미리보기: label(파일명) 지정, url 은 이미 완성된 /api/file 경로
  if (!isFile) url = normalizeUrl(url); // 빈 값이면 '' (빈 패널로 열림)
  emptyMsg.style.display = 'none';

  let col;
  if (placement === 'row' && activePane && findColumnOf(activePane)) col = findColumnOf(activePane);
  else col = newColumn();

  const pane = document.createElement('div');
  pane.className = 'pane running';
  let host = label || '웹 미리보기'; if (!isFile && url) { try { host = new URL(url).host; } catch {} }
  pane.innerHTML = `
    <div class="bar">
      <span class="dot"></span>
      <span class="label" title="${escapeHtml(isFile ? label : url)}"><span class="ttl">${isFile ? ICON.file : ICON.globe}<span>${escapeHtml(host)}</span></span></span>
      <button class="reload" title="새로고침">${ICON.refresh}</button>
      <button class="ext" title="외부 브라우저로 열기">${ICON.external}</button>
      <button class="x" title="닫기">${ICON.x}</button>
    </div>
    <div class="preview">
      <div class="urlbar">
        <input type="text" spellcheck="false" placeholder="URL 또는 파일 경로 입력 후 Enter (예: localhost:3000, C:\\file.pdf, /Users/me/img.png)" value="${escapeHtml(url)}" />
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
    try {
      const fm = u.match(/^\/api\/file\?path=(.+)$/);
      if (fm) {
        const p = decodeURIComponent(fm[1]);
        const base = p.split(/[\\/]/).filter(Boolean).pop() || p;
        pane.querySelector('.label').title = p;
        pane.querySelector('.ttl').innerHTML = `${ICON.file}<span>${escapeHtml(base)}</span>`;
      } else {
        pane.querySelector('.label').title = u;
        pane.querySelector('.ttl').innerHTML = `${ICON.globe}<span>${escapeHtml(new URL(u).host)}</span>`;
      }
    } catch {}
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

// 로컬 파일 미리보기 패널 (Claude 산출물/이미지/HTML/MD)
function addFilePreview(absPath, placement) {
  if (!absPath) return;
  const base = absPath.split(/[\\/]/).filter(Boolean).pop() || absPath;
  addPreviewPane('/api/file?path=' + encodeURIComponent(absPath), placement || 'column', base);
}

document.getElementById('addFile').addEventListener('click', async () => {
  if (window.claudeHub && window.claudeHub.pickFile) {
    const p = await window.claudeHub.pickFile();
    if (p) addFilePreview(p, 'column');
  } else {
    const p = await uiPrompt('미리보기할 파일의 전체 경로', '', '예: C:\\Users\\me\\report.html');
    if (p && p.trim()) addFilePreview(p.trim(), 'column');
  }
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
  dropIndicator.querySelector('.dz').textContent = { left: '왼쪽', right: '오른쪽', top: '위', bottom: '아래' }[zone] || '';
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
  document.getElementById('curPath').value = localStorage.getItem('cth_last_path') || defs.cwd || defs.home || '';
  document.getElementById('fsnote').textContent = '';
  openOverlay('folder');
  loadRecentPaths();
}
window.startNewSession = startNewSession;
document.getElementById('add').addEventListener('click', startNewSession);

// 최근 작업 경로 추천 목록
async function loadRecentPaths() {
  const box = document.getElementById('recentPaths');
  box.innerHTML = '<div class="fsnote">불러오는 중…</div>';
  const res = await fetch(`/api/recent-paths?limit=25&${profileQ()}`).then((r) => r.json()).catch(() => ({ paths: [] }));
  box.innerHTML = '';
  if (!res.paths || res.paths.length === 0) {
    box.innerHTML = '<div class="fsnote">최근 작업 경로가 없습니다. 위에 경로를 직접 입력하거나 폴더 선택기를 쓰세요.</div>';
    return;
  }
  res.paths.forEach((p) => {
    const folder = p.path.split(/[\\/]/).filter(Boolean).pop() || p.path;
    const it = document.createElement('div');
    it.className = 'fsitem';
    it.title = p.path;
    it.innerHTML = `
      <span class="ico">${ICON.folder}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        <b>${escapeHtml(folder)}</b> <span style="color:var(--muted);font-size:11px">${escapeHtml(p.path)}</span>
      </span>
      <span style="color:var(--muted);font-size:11px;flex:none">${relTime(p.mtime)}</span>`;
    it.onclick = () => { document.getElementById('curPath').value = p.path; choosePath(p.path); };
    box.appendChild(it);
  });
}

// 경로 "선택 확정" → 검증 후 세션 목록으로
async function choosePath(p) {
  p = (p || '').trim();
  if (!p) return;
  const res = await fetch(`/api/fs/list?path=${encodeURIComponent(p)}&${profileQ()}`).then((r) => r.json()).catch(() => ({ error: '경로 조회 실패' }));
  if (res.error) { document.getElementById('fsnote').textContent = res.error; return; }
  localStorage.setItem('cth_last_path', res.path);
  openSessionPicker(res.path);
}

document.getElementById('curPath').addEventListener('keydown', (e) => { if (e.key === 'Enter') choosePath(e.target.value); });
document.getElementById('pickHere').addEventListener('click', () => choosePath(document.getElementById('curPath').value));
document.getElementById('changeFolder').addEventListener('click', () => { openOverlay('folder'); loadRecentPaths(); });

document.getElementById('osPick').addEventListener('click', async () => {
  const btn = document.getElementById('osPick');
  const orig = btn.textContent;
  const note = document.getElementById('fsnote');
  const cur = document.getElementById('curPath').value.trim();
  btn.disabled = true; btn.textContent = '선택기 여는 중…';
  try {
    // Electron 앱: 네이티브 다이얼로그(절대경로, 항상 최상단)
    if (window.claudeHub && window.claudeHub.pickFolder) {
      const picked = await window.claudeHub.pickFolder(cur);
      if (picked) { document.getElementById('curPath').value = picked; choosePath(picked); }
      return;
    }
    // 브라우저 모드: 서버측 다이얼로그 폴백
    const res = await fetch(`/api/fs/pick?path=${encodeURIComponent(cur)}`).then((r) => r.json());
    if (res.error) { note.textContent = res.error; return; }
    if (res.canceled || !res.path) return;
    document.getElementById('curPath').value = res.path;
    choosePath(res.path);
  } catch (e) {
    note.textContent = '폴더 선택 실패: ' + e.message;
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
      <span class="ico">${ICON.chat}</span>
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
    const other = s.profile && s.profile !== activeProfileId; // 다른 계정 소속 세션
    const it = document.createElement('div');
    it.className = 'recent-item';
    it.title = `${s.title}\n${s.cwd}` + (other ? `\n계정: ${profileName(s.profile)}` : '') + `\n클릭 = 열기`;
    it.innerHTML = `
      <div class="rt">${ICON.chat}<span>${escapeHtml(s.title)}</span></div>
      <div class="rf">${ICON.folder}<span>${escapeHtml(folder)}</span></div>
      <div class="rs">${relTime(s.mtime)}${other ? ` · <span class="rprof">${escapeHtml(profileName(s.profile))}</span>` : ''}</div>
      ${other ? `<button class="rcont" title="이 대화를 현재 계정(${escapeHtml(profileName(activeProfileId))})으로 복사해 이어가기">${escapeHtml(profileName(activeProfileId))} 계정으로 이어가기</button>` : ''}`;
    it.onclick = () => openSession(s);
    const cont = it.querySelector('.rcont');
    if (cont) cont.addEventListener('click', (e) => { e.stopPropagation(); continueHere(s); });
    box.appendChild(it);
  });
}

async function loadRecent() {
  document.getElementById('lnbTitle').textContent = lnbAllProfiles ? '최근 세션 · 모든 계정' : '최근 세션';
  document.getElementById('recentList').innerHTML = '<div class="recent-empty">불러오는 중…</div>';
  const res = await fetch(`/api/recent?limit=${lnbAllProfiles ? 40 : 15}&${lnbProfileQ()}`).then((r) => r.json()).catch(() => ({ sessions: [] }));
  renderSessionList(res.sessions, lnbAllProfiles ? '세션이 없습니다.' : '최근 세션이 없습니다.');
}

async function searchSessions(q) {
  document.getElementById('lnbTitle').textContent = '검색 중…';
  document.getElementById('recentList').innerHTML = '<div class="recent-empty">검색 중…</div>';
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=60&${lnbProfileQ()}`).then((r) => r.json()).catch(() => ({ sessions: [] }));
  document.getElementById('lnbTitle').textContent = `검색 결과 (${res.sessions.length})`;
  renderSessionList(res.sessions, `"${q}" 와 일치하는 세션이 없습니다.`);
}

function refreshLnb() {
  const q = document.getElementById('lnbSearch').value.trim();
  if (q) searchSessions(q); else loadRecent();
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
function setLnbAll(on) {
  lnbAllProfiles = on;
  localStorage.setItem('cth_lnb_all_profiles', on ? '1' : '0');
  const b = document.getElementById('lnbAllToggle');
  if (b) b.classList.toggle('on', on);
  refreshLnb();
}
document.getElementById('lnbAllToggle').addEventListener('click', () => setLnbAll(!lnbAllProfiles));
document.getElementById('lnbAllToggle').classList.toggle('on', lnbAllProfiles);
document.getElementById('addProfile').addEventListener('click', addProfile);
document.querySelectorAll('#themePopover .popover-item').forEach((el) => {
  el.addEventListener('click', () => { applyTheme(el.dataset.theme); closePopovers(); });
});
setupPopover('themeBtn', 'themePopover');
setupPopover('accentBtn', 'accentPopover');
applyTheme(localStorage.getItem('cth_theme') || 'dark');
buildAccentPicker();
applyAccent(localStorage.getItem('cth_accent') || null);

document.getElementById('fontDown').addEventListener('click', () => applyFontSize(termFontSize - 1));
document.getElementById('fontUp').addEventListener('click', () => applyFontSize(termFontSize + 1));
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.key === '=' || e.key === '+') { e.preventDefault(); applyFontSize(termFontSize + 1); }
  else if (e.key === '-' || e.key === '_') { e.preventDefault(); applyFontSize(termFontSize - 1); }
  else if (e.key === '0') { e.preventDefault(); applyFontSize(13); }
});
applyFontSize(termFontSize);

// 글꼴 선택 채우기 + 배선
(function initFontFamily() {
  const sel = document.getElementById('fontFamily');
  if (!sel) return;
  sel.innerHTML = FONT_FAMILIES.map((f) => `<option value="${f.css.replace(/"/g, '&quot;')}">${f.label}</option>`).join('');
  if (!FONT_FAMILIES.some((f) => f.css === termFontFamily)) {
    // 저장값이 목록에 없으면 첫 항목으로 정규화
    termFontFamily = FONT_FAMILIES[0].css;
  }
  sel.value = termFontFamily;
  sel.addEventListener('change', () => applyFontFamily(sel.value));
})();

ensureNotifyPermission();

let rt;
window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(fitAll, 120); });

hydrateIcons();
setLnb(localStorage.getItem('cth_lnb_collapsed') === '1');
updateStatus();

fetch('/health').then((r) => r.json()).then((d) => {
  const brand = document.querySelector('.brand');
  if (brand && d.version) brand.title = `v${d.version}`;
}).catch(() => {});

// 서버 전역 상태(프로필) 로드
async function initState() {
  try {
    const s = await fetch('/api/state').then((r) => r.json());
    if (Array.isArray(s.profiles) && s.profiles.length) profiles = s.profiles;
  } catch {}
  if (!profiles.find((p) => p.id === 'default')) profiles.unshift({ id: 'default', name: '기본' });
  if (!profiles.find((p) => p.id === activeProfileId)) activeProfileId = 'default';
  renderTabs();
  loadRecent();
}
initState();
// 로드 시 모달을 자동으로 열지 않는다 — 모달이 LNB(최근 세션) 클릭을 가리기 때문.
// 사용자가 좌측 최근 세션을 클릭하거나 "＋ 새 세션"을 눌러 시작한다.

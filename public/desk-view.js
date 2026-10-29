'use strict';
/**
 * 데스크톱 뷰 — 허브(터미널 분할) 대신 Claude Code 데스크톱 앱처럼 보는 화면. 헤더 버튼으로 켜고 끈다.
 *
 * - 한 번에 세션 하나: 활성 패널만 화면을 채우고, 나머지는 왼쪽 «열린 세션» 목록(프로젝트별)에서 고른다.
 * - 터미널 대신 대화: 메시지는 말풍선, Claude 답변은 마크다운(public/md-lite.js), 도구 호출은 한 줄 카드,
 *   도구 결과는 접힌 상자. 터미널이 필요하면 입력창 아래 «터미널» 로 편다.
 * - Claude 가 선택지를 물으면 입력창 위에 카드로 보여주고 거기서 고른다(PromptAnswer — 펫과 같은 경로).
 * - 일하는 중이면 «작업 중…» 을 띄운다(상태줄 «esc to interrupt»).
 *
 * app.js 의 전역(columns · activePane · setActive · revealPane · allWorkspacePanes · workspaceEntriesOf ·
 * workspaceKeyOfPane · projectCwd · activeProfileId · currentWsKey · minimized · fitAll · refreshAllChats ·
 * escapeHtml · ICON)을 쓴다 — app.js · prompt-answer.js 다음에 로드한다.
 */
(function initDeskView() {
  const KEY = 'cth_view';
  const TICK_MS = 600;
  const RESULT_MAX = 4000;
  const PA = window.PromptAnswer;
  const PK = window.ProjectKey;
  const MD = window.MdLite;
  const btn = document.getElementById('deskBtn');
  const lnb = document.getElementById('lnb');
  const on = () => document.body.classList.contains('desk-view');

  /* ---------- 대화 그리기 (app.js renderChat 이 부른다) ---------- */
  const md = (t) => (MD ? MD.render(t) : `<p>${escapeHtml(t)}</p>`);
  function toolHtml(t) {
    return `<div class="dk-tool${t.isTask ? ' task' : ''}">${t.isTask ? ICON.task : ICON.tool}`
      + `<span class="dk-tn">${escapeHtml(t.name)}</span>`
      + (t.preview ? `<span class="dk-tp">${escapeHtml(t.preview)}</span>` : '') + '</div>';
  }
  function html(items) {
    return items.map((it) => {
      if (it.role === 'user') {
        return `<div class="dk-user${it.pending ? ' pending' : ''}"><div class="dk-ububble">${escapeHtml(it.text || '')}</div></div>`;
      }
      if (it.role === 'tool_result') {
        const text = String(it.text || '');
        const id = escapeHtml(`${it.ts || ''}:${text.length}`);
        const first = text.split('\n').find((l) => l.trim()) || '(빈 결과)';
        return `<details class="dk-res" data-i="${id}"><summary>${escapeHtml(first.slice(0, 120))}</summary>`
          + `<pre>${escapeHtml(text.slice(0, RESULT_MAX))}${text.length > RESULT_MAX ? '\n…' : ''}</pre></details>`;
      }
      const txt = it.text ? `<div class="dk-ai">${md(it.text)}</div>` : '';
      return txt + (it.tools || []).map(toolHtml).join('');
    }).join('');
  }
  window.DeskRender = { html };

  /* ---------- 질문 카드 · 작업 중 표시 (입력창 위) ---------- */
  function liveBox(p) {
    let box = p.el.querySelector('.dk-live');
    if (!box) {
      box = document.createElement('div');
      box.className = 'dk-live';
      const ta = p.el.querySelector('.compose textarea');
      if (ta) ta.parentNode.insertBefore(box, ta);
    }
    return box;
  }
  function setMsg(box, text, kind) {
    const m = box.querySelector('.dk-msg');
    if (m) { m.textContent = text; m.className = 'dk-msg' + (kind ? ' ' + kind : ''); }
  }
  async function answer(p, box, sig, action) {
    setMsg(box, '보내는 중…');
    box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const r = await PA.answer(p, sig, action);
    setMsg(box, r.ok ? '보냈어요' : r.message, r.ok ? 'ok' : 'err');
    box.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }
  function renderAsk(p, box, prompt, sig) {
    box.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'dk-ask';
    const parts = [];
    if (prompt.body) parts.push(`<div class="dk-askbody">${escapeHtml(prompt.body)}</div>`);
    parts.push(`<div class="dk-q">${escapeHtml(prompt.question || '선택해 주세요')}</div><div class="dk-opts"></div>`);
    parts.push('<div class="dk-askfoot"><span class="dk-msg"></span><button class="cbtn" data-cancel>Esc 취소</button></div>');
    card.innerHTML = parts.join('');
    const opts = card.querySelector('.dk-opts');
    for (const o of prompt.options) {
      const b = document.createElement('button');
      b.className = 'dk-opt' + (o.selected ? ' cur' : '');
      b.innerHTML = `<span class="n">${o.number}</span><span class="l">${escapeHtml(o.isText ? '직접 입력…' : o.label)}`
        + `${o.desc ? `<small>${escapeHtml(o.desc)}</small>` : ''}</span>`;
      b.addEventListener('click', () => {
        if (!o.isText) { answer(p, box, sig, { type: 'select', number: o.number }); return; }
        const row = document.createElement('div');
        row.className = 'dk-typing';
        row.innerHTML = '<input type="text" spellcheck="false" placeholder="답을 입력하고 Enter"><button class="cbtn send">보내기</button>';
        const inp = row.querySelector('input');
        const go = () => { if (inp.value.trim()) answer(p, box, sig, { type: 'text', number: o.number, text: inp.value }); };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
        row.querySelector('button').addEventListener('click', go);
        b.replaceWith(row);
        inp.focus();
      });
      opts.appendChild(b);
    }
    card.querySelector('[data-cancel]').addEventListener('click', () => answer(p, box, sig, { type: 'cancel' }));
    box.appendChild(card);
  }
  function updateLive(p) {
    if (!p || !p.term || !PA) return;
    const box = liveBox(p);
    const prompt = PA.promptOf(p);
    const sig = prompt ? 'ask:' + PA.signature(prompt) : (PA.isWorking(p) ? 'working' : '');
    if (box.dataset.sig === sig) return;   // 같은 상태면 다시 그리지 않는다(입력 중인 칸 보존)
    box.dataset.sig = sig;
    if (prompt) renderAsk(p, box, prompt, sig.slice(4));
    else box.innerHTML = sig === 'working' ? '<div class="dk-working"><i></i><i></i><i></i><span>작업 중…</span></div>' : '';
  }

  /* ---------- 왼쪽 «열린 세션» (프로젝트별) ---------- */
  const sideBox = document.createElement('div');
  sideBox.id = 'deskSessions';
  if (lnb) lnb.insertBefore(sideBox, lnb.children[1] || null);

  function paneState(p) {
    if (!p.term || !PA) return '';
    if (PA.promptOf(p)) return 'ask';
    if (PA.isWorking(p)) return 'working';
    if (p._doneAt) return 'done';
    return '';
  }
  function groups() {
    const map = new Map();
    const add = (projectId, cwd, p) => {
      if (!map.has(projectId)) map.set(projectId, { projectId, cwd, panes: [] });
      map.get(projectId).panes.push(p);
    };
    for (const [k, w] of workspaceEntriesOf(activeProfileId)) {
      const { project } = PK.parseWorkspaceKey(k);
      w.columns.forEach((c) => c.panes.forEach((p) => add(project, projectCwd[k] || project, p)));
    }
    // 계정은 패널마다 다를 뿐 화면은 하나 — 최소화된 패널도 계정과 상관없이 모은다
    minimized.forEach((p) => {
      if (p.cfg) add(PK.projectId(p.cfg.cwd), p.cfg.cwd, p);
    });
    return [...map.values()];
  }
  function paneLabel(p) {
    const c = p.cfg || {};
    if (c.viewer) return '세션 뷰어';
    if (c.preview) return c.url ? String(c.url).replace(/^\/api\/file\?path=/, '') : '웹 미리보기';
    return c.title || 'claude';
  }
  const STATE_LABEL = { ask: '질문 대기', working: '작업 중', done: '완료' };
  let sideHtml = '';
  const sidePanes = [];
  function renderSide() {
    sidePanes.length = 0;
    const out = ['<div class="dk-side-head">열린 세션</div>'];
    const gs = groups();
    if (!gs.length) out.push('<div class="recent-empty">열린 세션이 없습니다.</div>');
    for (const g of gs) {
      out.push(`<div class="dk-proj" title="${escapeHtml(g.cwd || '')}"><span class="pdot" style="--hue:${PK.projectHue(g.projectId)}"></span>`
        + `${escapeHtml(g.projectId ? PK.projectName(g.cwd) : '기타')}</div>`);
      for (const p of g.panes) {
        const i = sidePanes.push(p) - 1;
        const st = paneState(p);
        out.push(`<div class="dk-sess${p === activePane ? ' active' : ''}${p.minimized ? ' min' : ''}" data-i="${i}">`
          + `<span class="dk-st ${st}" title="${STATE_LABEL[st] || ''}"></span><span class="dk-sn">${escapeHtml(paneLabel(p))}</span></div>`);
      }
    }
    const next = out.join('');
    if (next !== sideHtml) { sideHtml = next; sideBox.innerHTML = next; }
  }
  sideBox.addEventListener('click', (e) => {
    const row = e.target.closest('.dk-sess');
    if (!row) return;
    const p = sidePanes[Number(row.dataset.i)];
    if (p) { revealPane(p); focusCompose(p); }
  });

  function focusCompose(p) {
    const ta = p && p.el && p.el.querySelector('.compose textarea');
    if (ta) setTimeout(() => ta.focus(), 30);
  }

  /* ---------- 켜기 / 끄기 ---------- */
  let shownPane = null;
  function ensureActive() {
    if (activePane && columns.some((c) => c.panes.includes(activePane))) return;
    const first = columns.find((c) => c.panes.length);
    if (first) setActive(first.panes[0], false);
  }
  function tick() {
    if (!on()) return;
    ensureActive();
    if (activePane !== shownPane) {
      shownPane = activePane;
      if (shownPane && shownPane._refreshLog) shownPane._refreshLog();
    }
    updateLive(activePane);
    renderSide();
  }
  function setDesk(v) {
    document.body.classList.toggle('desk-view', !!v);
    try { localStorage.setItem(KEY, v ? 'desk' : 'hub'); } catch { /* 저장 불가 환경 */ }
    if (btn) {
      btn.classList.toggle('on', !!v);
      btn.title = v ? '허브 뷰(터미널 분할)로 돌아가기' : '데스크톱 뷰 — Claude 데스크톱 앱처럼 대화 화면으로 보기';
    }
    shownPane = null;
    if (v) { tick(); focusCompose(activePane); }
    refreshAllChats();
    setTimeout(() => { try { fitAll(); } catch { /* 레이아웃 전 */ } }, 80);
  }
  if (btn) btn.addEventListener('click', () => setDesk(!on()));
  setInterval(tick, TICK_MS);
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* 저장 불가 환경 */ }
  setDesk(saved === 'desk');
})();

'use strict';
/**
 * 작업 현황 HUD 그리기 — 허브 안(사이드바 위, public/hud.js)과 바탕화면 창(public/hud.html)이 같이 쓴다.
 *
 * 한 줄 = 프로젝트(탭) 하나. 작업 중인 프로젝트만 ▾ 로 안의 세션 목록을 펼친다(들여쓰기).
 * 표시는 두 가지만: 작업 중(금빛 테두리 · 도는 아이콘 · 몇 분째) / 질문 대기(보라 물음표).
 * 쉬는 중 · 완료는 아무 표시 없이 조금 흐리게.
 *
 * 세션 항목(pet-bridge.js): { key, title, project, projectKey, hue, character, profile, state: work|ask|done|idle, since, tool, target }
 */
(function (root) {
  const RANK = { work: 0, ask: 1, rest: 2 };
  const SESSION_RANK = { work: 0, ask: 1, done: 2, idle: 3 };

  function clock(ms) {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const two = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
  }

  /** 세션 → 프로젝트 묶음. 작업 중 → 질문 → 나머지, 같은 상태면 오래 일한 순. */
  function groupProjects(items) {
    const map = new Map();
    for (const it of items || []) {
      const k = it.projectKey || it.project || it.key;
      if (!map.has(k)) {
        map.set(k, {
          key: k, hue: it.hue, project: it.project || '',
          name: it.character || it.project || it.title,
          sub: it.character ? (it.project || '') : (it.profile || ''),
          sessions: [],
        });
      }
      map.get(k).sessions.push(it);
    }
    const out = [];
    for (const p of map.values()) {
      const working = p.sessions.filter((s) => s.state === 'work');
      const state = working.length ? 'work' : (p.sessions.some((s) => s.state === 'ask') ? 'ask' : 'rest');
      const since = working.length ? Math.min(...working.map((s) => s.since || Date.now())) : 0;
      p.sessions.sort((a, b) => (SESSION_RANK[a.state] - SESSION_RANK[b.state]) || ((a.since || 0) - (b.since || 0)));
      out.push({ ...p, state, since, workingCount: working.length });
    }
    return out.sort((a, b) => (RANK[a.state] - RANK[b.state]) || ((a.since || 0) - (b.since || 0)));
  }

  function summary(items) {
    const projects = groupProjects(items);
    const wp = projects.filter((p) => p.state === 'work').length;
    const ws = (items || []).filter((s) => s.state === 'work').length;
    const asking = projects.filter((p) => p.state === 'ask').length;
    if (!wp) return asking ? `질문 ${asking}곳 기다리는 중` : '모두 쉬는 중';
    return `프로젝트 ${wp}곳 · 세션 ${ws}개 작업 중`;
  }

  // ---- DOM ----
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  // 정해진 모양의 아이콘만 쓴다(사용자 문자열은 넣지 않는다)
  const ICONS = {
    ask: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.4-2.7 4" stroke="#14101c" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="12" cy="17.6" r="1.35" fill="#14101c"/></svg>',
    spin: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="3.5"/><path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>',
    fold: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  function icon(name, cls, label) {
    const s = el('span', cls);
    s.innerHTML = ICONS[name];
    if (label) { s.setAttribute('role', 'img'); s.setAttribute('aria-label', label); }
    return s;
  }

  /**
   * @param box 그릴 자리(.hud-list)
   * @param opts { isFolded(projectKey), onToggle(projectKey), onPickSession(sessionKey), onPickProject(project) }
   */
  function renderList(box, items, opts = {}, now = Date.now()) {
    box.textContent = '';
    const projects = groupProjects(items);
    if (!projects.length) { box.append(el('div', 'hud-empty', '열린 Claude 세션이 없어요')); return; }
    for (const p of projects) {
      const wrap = el('div', `hud-proj is-${p.state}`);
      wrap.style.setProperty('--hue', String(p.hue == null ? 210 : p.hue));
      const row = el('div', 'hud-pm');

      const av = el('span', 'hud-av');
      av.append(el('span', 'hud-face', (p.name || '?').slice(0, 1)));
      if (p.state === 'ask') av.append(icon('ask', 'hud-qi', '질문 대기'));
      row.append(av);

      const open = el('button', 'hud-pname');
      open.type = 'button';
      open.title = `${p.project}\n눌러서 이 프로젝트 탭 열기`;
      open.append(el('b', null, p.name));
      if (p.sub) open.append(el('span', null, p.sub));
      if (opts.onPickProject) open.addEventListener('click', () => opts.onPickProject(p));
      row.append(open);

      const folded = p.state === 'work' && opts.isFolded ? !!opts.isFolded(p.key) : false;
      if (p.state === 'work') {
        row.append(el('span', 'hud-timer', clock(now - p.since)));
        const fold = el('button', 'hud-fold' + (folded ? ' folded' : ''));
        fold.type = 'button';
        fold.innerHTML = ICONS.fold;
        const label = folded ? '세션 목록 펼치기' : '세션 목록 접기';
        fold.title = label; fold.setAttribute('aria-label', label);
        fold.addEventListener('pointerdown', (e) => e.stopPropagation());
        if (opts.onToggle) fold.addEventListener('click', () => opts.onToggle(p.key));
        row.append(fold);
      }
      wrap.append(row);

      if (p.state === 'work' && !folded) {
        const list = el('div', 'hud-sess');
        for (const s of p.sessions) {
          const b = el('button', `hud-s is-${s.state}`);
          b.type = 'button';
          b.title = `${s.title}\n눌러서 이 세션 열기`;
          const ic = el('span', 'hud-sic');
          if (s.state === 'work') ic.append(icon('spin', 'hud-spin', '작업 중'));
          else if (s.state === 'ask') ic.append(icon('ask', 'hud-qi-s', '질문 대기'));
          // 제목 아래 줄에 지금 쓰는 도구 — 좁은 사이드바에서도 잘리지 않게 두 줄로
          const text = el('span', 'hud-stext');
          text.append(el('span', 'hud-stitle', s.title));
          const tool = s.state === 'work' && s.tool ? `${s.tool}${s.target ? ' · ' + s.target : ''}` : '';
          if (tool) text.append(el('span', 'hud-stool', tool));
          b.append(ic, text);
          if (s.state === 'work') b.append(el('span', 'hud-stimer', clock(now - (s.since || now))));
          if (opts.onPickSession) b.addEventListener('click', () => opts.onPickSession(s.key));
          list.append(b);
        }
        wrap.append(list);
      }
      box.append(wrap);
    }
  }

  const api = { renderList, summary, groupProjects, clock };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HudView = api;
})(typeof window !== 'undefined' ? window : globalThis);

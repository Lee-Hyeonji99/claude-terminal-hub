'use strict';
/**
 * 작업실 — 누가 어디에 있을지 정한다(그리기는 public/room.js). 기준 무대 1120×640.
 *   작업 중 프로젝트 → 책상(최대 3)에서 타자, 그 서브에이전트는 책상 옆 꼬마(최대 4)
 *   질문·권한 대기 세션 → 내 자리 앞 줄(오래 기다린 순, 최대 4) · 맨 앞 서류는 내 책상 위에 펼침
 *   쉬는 프로젝트 → 소파(최대 3) · 끝난 세션 → 결재함
 * 입력은 HUD 항목(public/pet-bridge.js) — LLM 없이 화면·기록 파일에서 읽은 값뿐.
 */
(function (root) {
  const HV = typeof module === 'object' && module.exports ? require('./hud-view.js') : root.HudView;

  const DESKS = [{ x: 60 }, { x: 290 }, { x: 520 }];
  const DESK_Y = 290;
  const MAX_MINIONS = 4;
  const QUEUE = [
    { x: 770, y: 452, size: 104 }, { x: 652, y: 482, size: 88 },
    { x: 548, y: 506, size: 76 }, { x: 456, y: 524, size: 66 },
  ];
  const SOFA = [{ x: 676 }, { x: 738 }, { x: 800 }];

  const workSince = (sessions) => Math.min(...sessions.map((x) => x.since || Infinity));

  function desksOf(projects) {
    const working = projects.filter((p) => p.state === 'work');
    const desks = working.slice(0, DESKS.length).map((p, i) => {
      const lead = p.sessions.find((x) => x.state === 'work') || p.sessions[0];
      const subs = p.sessions.flatMap((x) => x.subagents || []);
      const ordered = [...subs.filter((a) => a.state === 'work'), ...subs.filter((a) => a.state !== 'work')];
      return {
        projectKey: p.key, projectId: p.projectId, theme: p.theme, hue: p.hue, name: p.name, sub: p.sub,
        x: DESKS[i].x, y: DESK_Y,
        sessionKey: lead.key, title: lead.title, tool: HV.sessionToolText(lead), since: p.since,
        minions: ordered.slice(0, MAX_MINIONS).map((a, j) => ({ ...a, x: DESKS[i].x + j * 56, y: 420 + (j % 2) * 56 })),
        extraMinions: Math.max(0, ordered.length - MAX_MINIONS),
      };
    });
    return { desks, extraWork: Math.max(0, working.length - DESKS.length) };
  }

  function queueOf(projects) {
    const asking = projects.flatMap((p) => p.sessions.filter((x) => x.state === 'ask').map((x) => ({ x, p })))
      .sort((a, b) => (a.x.since || 0) - (b.x.since || 0));
    const queue = asking.slice(0, QUEUE.length).map(({ x, p }, i) => ({
      key: x.key, projectKey: p.key, projectId: p.projectId, theme: p.theme, hue: p.hue, name: p.name,
      since: x.since || 0,
      kind: (x.question && x.question.kind) || 'question',
      text: (x.question && x.question.text) || x.title,
      options: (x.question && x.question.options) || [],
      ...QUEUE[i],
    }));
    return { queue, extraAsk: Math.max(0, asking.length - QUEUE.length) };
  }

  function layoutRoom(items, now = Date.now()) {
    const list = items || [];
    const projects = HV.groupProjects(list);
    const { desks, extraWork } = desksOf(projects);
    const { queue, extraAsk } = queueOf(projects);
    const resting = projects.filter((p) => p.state === 'rest');
    const sofa = resting.slice(0, SOFA.length).map((p, i) => ({
      projectKey: p.key, projectId: p.projectId, theme: p.theme, hue: p.hue, name: p.name,
      sessionKey: p.sessions[0].key, count: p.sessions.length, x: SOFA[i].x, y: 214,
    }));
    const done = list.filter((x) => x.state === 'done').sort((a, b) => (a.doneAt || 0) - (b.doneAt || 0));
    const subs = desks.reduce((n, d) => n + d.minions.filter((a) => a.state === 'work').length, 0);
    return {
      now, desks, extraWork, queue, extraAsk,
      paper: queue[0] ? { key: queue[0].key, name: queue[0].name, kind: queue[0].kind, text: queue[0].text, options: queue[0].options } : null,
      sofa, extraRest: Math.max(0, resting.length - SOFA.length),
      inbox: { count: done.length, firstKey: done[0] ? done[0].key : '' },
      stats: { work: projects.filter((p) => p.state === 'work').length, ask: queue.length + extraAsk, rest: resting.length, subs, done: done.length },
    };
  }

  /* ---- 창밖 하늘 — 하루를 구간으로 나누고 사이는 분 단위로 섞는다 ---- */
  const SKY = [
    [0, '#0b1230', '#1a2350', '한밤'], [300, '#1c2150', '#4a3f78', '새벽'], [360, '#f08a5d', '#fbd38d', '해 뜰 녘'],
    [480, '#7ab8ec', '#cfe6f7', '아침'], [720, '#5aa9ee', '#b9dcf6', '한낮'], [900, '#79b3e3', '#f3dcb4', '오후'],
    [1050, '#e9a35b', '#f7d08a', '노을 전'], [1110, '#a5577a', '#f08a5d', '노을'], [1170, '#3a3470', '#8a5a7f', '해 질 녘'],
    [1260, '#141a40', '#2a2f5e', '저녁'], [1440, '#0b1230', '#1a2350', '한밤'],
  ];
  const SUNRISE = 350, SUNSET = 1140;
  const hex = (h) => [1, 3, 5].map((j) => parseInt(h.slice(j, j + 2), 16));
  const mix = (a, b, t) => { const p = hex(a), q = hex(b); return `rgb(${p.map((v, j) => Math.round(v + (q[j] - v) * t)).join(',')})`; };

  /** @param minute 0..1439 (하루 중 분) */
  function skyAt(minute) {
    const m = ((Math.round(minute) % 1440) + 1440) % 1440;
    let i = 0;
    while (i < SKY.length - 2 && SKY[i + 1][0] <= m) i++;
    const a = SKY[i], b = SKY[i + 1], t = (m - a[0]) / (b[0] - a[0]);
    const isDay = m >= SUNRISE && m <= SUNSET;
    const dT = (m - SUNRISE) / (SUNSET - SUNRISE);
    const nT = (m > SUNSET ? m - SUNSET : m + 1440 - SUNSET) / (1440 - SUNSET + SUNRISE);
    const starAlpha = m < 300 ? 1 : m < 380 ? (380 - m) / 80 : m > 1170 ? Math.min(1, (m - 1170) / 90) : 0;
    const warm = m > 1000 && m < 1200 ? 0.18 : m > 330 && m < 420 ? 0.14 : 0;
    return {
      minute: m, phase: a[3], isDay,
      top: mix(a[1], b[1], t), bottom: mix(a[2], b[2], t),
      sun: { x: 6 + dT * 150, y: 100 - Math.sin(Math.max(0, Math.min(1, dT)) * Math.PI) * 90 },
      sunLow: m < 430 || m > 1050,
      moon: { x: 10 + nT * 150, y: 96 - Math.sin(nT * Math.PI) * 80 },
      starAlpha,
      cloudAlpha: 0.95 * (1 - starAlpha),
      lampOn: m > 1110 || m < 390,
      tint: starAlpha ? `rgba(12,16,44,${(starAlpha * 0.42).toFixed(2)})` : `rgba(255,140,60,${warm})`,
    };
  }

  /** 서브에이전트마다 꼬마 팩 하나 — 같은 id 는 늘 같은 팩 */
  function minionPick(packs, id) {
    if (!packs || !packs.length) return null;
    let h = 0;
    for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return packs[h % packs.length];
  }

  const api = { layoutRoom, skyAt, minionPick };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoomView = api;
})(typeof window !== 'undefined' ? window : globalThis);

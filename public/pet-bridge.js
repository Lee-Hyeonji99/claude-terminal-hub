'use strict';
/**
 * 알림 모으기 — 패널마다 «Claude 질문» 과 «작업 완료» 를 찾아
 *   1) 프로젝트(작업 경로)별로 묶어 펫에 넘기고 (데스크톱 앱: 프로젝트마다 펫 하나)
 *   2) 기다리는 알림 개수를 작업표시줄 아이콘 배지로 (브라우저는 탭 제목 앞 숫자) 보여준다.
 * 펫에서 고른 답은 PromptAnswer 로 그 패널에 키로 쳐 준다.
 *
 * app.js 의 전역(allWorkspacePanes · revealPane · markPaneDone · clearPaneDone · profiles)을 쓴다 —
 * app.js · prompt-answer.js 다음에 로드한다.
 *
 * 작업 완료는 두 경로로 잡는다: 터미널 벨(app.js) + 상태줄 «esc to interrupt» 가 떠 있다가
 * 사라지는 전환(여기). 벨을 안 울리는 환경에서도 완료를 놓치지 않기 위해서다.
 */
(function initPetBridge() {
  const hub = window.claudeHub;
  const PA = window.PromptAnswer;
  const PK = window.ProjectKey;
  if (!PA || !PK) return;
  const hasPet = !!(hub && hub.petState);

  const SCAN_MS = 700;
  const IDLE_TICKS_FOR_DONE = 2;   // 멈춘 상태가 이만큼 이어져야 완료로 본다(상태줄 깜빡임 무시)
  const BASE_TITLE = document.title;

  function termPanes() {
    return allWorkspacePanes().filter((p) => p && p.term && p.cfg && !p.cfg.viewer && !p.cfg.preview);
  }
  function profileName(id) {
    const f = (typeof profiles !== 'undefined' ? profiles : []).find((x) => x.id === id);
    return f && f.id !== 'default' ? f.name : '';
  }

  // 일하는 중 → 멈춤 전환 감지 (패널 객체에 상태를 둔다)
  function trackWorking(p, working, asking) {
    if (working) { p._wasWorking = true; p._idleTicks = 0; return; }
    if (!p._wasWorking) return;
    if (asking) { p._wasWorking = false; return; } // 질문 대기는 완료가 아니라 질문 알림으로 간다
    p._idleTicks = (p._idleTicks || 0) + 1;
    if (p._idleTicks >= IDLE_TICKS_FOR_DONE) { p._wasWorking = false; p._idleTicks = 0; markPaneDone(p); }
  }

  /* ---------- HUD — 세션마다 상태 · 그 상태가 된 때 · 마지막 작업 때 · 지금 도구 ---------- */
  // 상태가 바뀐 때를 패널 객체에 남긴다(_hudState/_hudSince). 일하는 동안은 마지막 작업 때를 계속 갱신.
  // 작업실 질문 서류 — 권한 승인(도장 서류)인지 일반 질문인지, 질문과 선택지 몇 개
  const PERMISSION_RE = /do you want to (proceed|make|create|run|allow|edit|write|delete|fetch)|don't ask again|허용/i;
  function questionOf(prompt) {
    if (!prompt) return null;
    const labels = (prompt.options || []).map((o) => (o.isText ? '직접 입력' : o.label));
    const permission = PERMISSION_RE.test(prompt.question || '') || labels.some((l) => PERMISSION_RE.test(l));
    return {
      kind: permission ? 'permission' : 'question',
      text: String(prompt.question || prompt.body || '').slice(0, 140),
      options: labels.slice(0, 4).map((l) => String(l).slice(0, 40)),
    };
  }

  function hudItemOf(p, state, proj, prompt) {
    const now = Date.now();
    if (p._hudState !== state) { p._hudState = state; p._hudSince = now; }
    if (state === 'work') p._lastWorkAt = now;
    const act = p._activity || null;
    const lastWorkAt = Math.max(p._lastWorkAt || 0, (act && act.at) || 0) || null;
    const charTheme = (typeof CHAR_MAP === 'function' && CHAR_MAP()[proj.theme]) || null;
    return {
      key: p.cfg.key, title: p.cfg.title || 'claude', project: proj.name, hue: proj.hue,
      // 화면이 계정과 상관없이 프로젝트 탭 하나라 묶음 키의 계정 자리도 고정 — 안 그러면 계정마다 따로 나온다
      projectKey: PK.workspaceKey('default', projectOfCwd(p.cfg.cwd)),
      projectId: proj.id, theme: proj.theme,   // HUD 캐릭터 — 그 프로젝트 펫과 같은 캐릭터(pet-avatar.js)
      character: charTheme ? charTheme.name : '', profile: profileName(p.cfg.profile),
      state, since: p._hudSince, lastWorkAt,
      tool: state === 'work' && act ? act.tool : '', target: state === 'work' && act ? act.target : '',
      subagents: p._subagents || [],   // 서버가 subagents 폴더에서 읽어 준다(lib/subagents.js)
      question: state === 'ask' ? questionOf(prompt) : null,   // 작업실 질문 줄
      doneAt: p._doneAt || 0,                                   // 작업실 결재함
    };
  }

  function collect() {
    const projects = new Map();
    const hud = [];
    let pending = 0;
    for (const p of termPanes()) {
      const prompt = PA.promptOf(p);
      // 화면이 «esc to interrupt» 를 보이거나, 서브에이전트가 아직 돌고 있으면 일하는 중
      const subsBusy = !!(window.HudView && window.HudView.hasRunningSubagents(p._subagents));
      const working = !prompt && (PA.isWorking(p) || subsBusy);
      trackWorking(p, working, !!prompt);
      const id = PK.projectId(p.cfg.cwd);
      if (!projects.has(id)) {
        const theme = themeOfWorkspace(PK.workspaceKey('default', projectOfCwd(p.cfg.cwd)));
        projects.set(id, { id, name: PK.projectName(p.cfg.cwd) || '기타', cwd: p.cfg.cwd || '', hue: PK.projectHue(id), theme, working: 0, questions: [], done: [], sessions: [] });
      }
      const proj = projects.get(id);
      if (working) proj.working++;   // 펫 팩이면 걷는 동작으로 보여준다
      const base = { key: p.cfg.key, title: p.cfg.title || 'claude', profile: profileName(p.cfg.profile) };
      // 펫을 누르면 뜨는 세션 목록 — 고르면 허브에서 그 세션으로 간다
      const state = prompt ? 'ask' : working ? 'work' : p._doneAt ? 'done' : 'idle';
      proj.sessions.push({ ...base, state });
      hud.push(hudItemOf(p, state, proj, prompt));
      if (prompt) {
        proj.questions.push({ ...base, sig: PA.signature(prompt), cwd: proj.name, prompt });
        pending++;
      } else if (p._doneAt) {
        proj.done.push({ ...base, at: p._doneAt });
        pending++;
      }
    }
    return { projects: [...projects.values()], pending, hud };
  }

  /* ---------- 작업표시줄 배지 ---------- */
  function badgeDataUrl(n) {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#e5484d';
    g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    const label = n > 99 ? '99+' : String(n);
    g.font = `bold ${label.length > 2 ? 12 : label.length > 1 ? 16 : 20}px "Segoe UI",sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, 16, 17);
    return c.toDataURL('image/png');
  }
  let lastBadge = -1;
  function updateBadge(n) {
    if (n === lastBadge) return;
    lastBadge = n;
    document.title = n ? `(${n}) ${BASE_TITLE}` : BASE_TITLE;
    if (hub && hub.setBadge) hub.setBadge({ count: n, dataUrl: n ? badgeDataUrl(n) : null });
  }

  let lastJson = '';
  let lastHudJson = '';
  function scan() {
    const { projects, pending, hud: hudItems } = collect();
    updateBadge(pending);
    // HUD: 허브 안(public/hud.js)은 이벤트로, 바탕화면 HUD 는 바뀔 때만 main 으로
    window.dispatchEvent(new CustomEvent('cth-status', { detail: hudItems }));
    const hudJson = JSON.stringify(hudItems);
    if (hub && hub.hudState && hudJson !== lastHudJson) { lastHudJson = hudJson; hub.hudState(hudItems); }
    if (!hasPet) return;
    const json = JSON.stringify(projects);
    if (json !== lastJson) { lastJson = json; hub.petState({ projects }); }
  }
  setInterval(scan, SCAN_MS);

  if (!hasPet) return;

  hub.onPetAnswer(async (msg) => {
    const { key, sig, action } = msg || {};
    const reply = (ok, message) => hub.petResult({ key, sig, ok, message: message || '' });
    const p = termPanes().find((x) => x.cfg.key === key);
    if (!p || !action) return reply(false, '세션을 찾을 수 없습니다');
    if (action.type === 'focus') { revealPane(p); clearPaneDone(p); return reply(true); }
    if (action.type === 'dismiss') { clearPaneDone(p); setTimeout(scan, 50); return reply(true); }
    const r = await PA.answer(p, sig, action);
    reply(r.ok, r.message);
    setTimeout(scan, 300); // 카드를 빨리 걷어 낸다
  });

  // 헤더 버튼 — 펫 꺼내기/숨기기
  const btn = document.getElementById('petBtn');
  if (btn) {
    btn.style.display = '';
    const mark = (v) => btn.classList.toggle('on', !!v);
    btn.addEventListener('click', (e) => { e.stopPropagation(); hub.petToggle(); });
    if (hub.onPetVisible) hub.onPetVisible(mark);
    if (hub.petVisible) hub.petVisible().then(mark).catch(() => {});
  }
})();

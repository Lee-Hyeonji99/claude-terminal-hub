'use strict';
/**
 * 작업 현황 HUD — 허브 안(사이드바 맨 위)과 바탕화면(Electron 창) 켜기/끄기.
 * 데이터는 public/pet-bridge.js 가 0.7초마다 'cth-status' 이벤트로 준다(바탕화면 HUD 에는 main 을 거쳐 간다).
 * 그리기는 public/hud-view.js. app.js 의 전역(setupPopover · allWorkspacePanes · revealPane)을 쓴다.
 */
(function initHud() {
  const HV = window.HudView;
  const side = document.getElementById('hudSide');
  if (!HV || !side) return;
  const hub = window.claudeHub;
  const KEY_IN = 'cth_hud_in';              // 허브 안 HUD 켬(기본 켬)
  const KEY_FOLDED = 'cth_hud_folded';      // 세션 목록을 접어 둔 프로젝트 { projectKey: true }
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 불가 */ } };
  const inOn = () => get(KEY_IN) !== '0';
  let folded = {};
  try { folded = JSON.parse(get(KEY_FOLDED) || '{}') || {}; } catch { folded = {}; }

  let items = [];
  side.innerHTML = '<div class="hud-list"></div>';
  const list = side.querySelector('.hud-list');

  const paneByKey = (key) => allWorkspacePanes().find((x) => x.cfg && x.cfg.key === key);
  const opts = {
    isFolded: (k) => !!folded[k],
    onToggle: (k) => {
      const { [k]: was, ...rest } = folded;
      folded = was ? rest : { ...rest, [k]: true };
      set(KEY_FOLDED, JSON.stringify(folded));
      draw();
    },
    onPickSession: (key) => { const p = paneByKey(key); if (p) revealPane(p); },
    onPickProject: (proj) => {
      const first = proj.sessions.find((s) => s.state === 'work') || proj.sessions[0];
      const p = first && paneByKey(first.key);
      if (p) revealPane(p);
    },
  };

  // 사이드바를 접으면 그리지 않고 숨긴다(접히는 애니메이션이 HUD 갱신에 막히지 않게)
  const sideOpen = () => !document.body.classList.contains('lnb-collapsed');
  function draw() {
    const visible = inOn() && items.length > 0 && sideOpen();
    side.hidden = !visible;
    if (!visible) return;
    HV.renderList(list, items, opts);
  }
  window.addEventListener('cth-status', (e) => { items = Array.isArray(e.detail) ? e.detail : []; draw(); });
  setInterval(() => { if (!side.hidden) draw(); }, 1000);   // 작업 시간(mm:ss)을 1초마다

  // ---- 켜기/끄기 (헤더 HUD 버튼 팝오버) ----
  const inRow = document.getElementById('hudInRow');
  const deskRow = document.getElementById('hudDeskRow');
  const deskSep = document.getElementById('hudDeskSep');
  const mark = (row, on) => row && row.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'on') === !!on));
  mark(inRow, inOn());
  if (inRow) inRow.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    set(KEY_IN, b.dataset.v === 'on' ? '1' : '0');
    mark(inRow, inOn());
    draw();
  });

  const hasDesk = !!(hub && hub.hudSetVisible);
  if (deskRow) deskRow.hidden = !hasDesk;
  if (deskSep) deskSep.hidden = !hasDesk;
  if (hasDesk) {
    if (hub.hudVisible) hub.hudVisible().then((v) => mark(deskRow, v)).catch(() => {});
    if (hub.onHudVisible) hub.onHudVisible((v) => mark(deskRow, v));
    deskRow.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) hub.hudSetVisible(b.dataset.v === 'on'); });
  }
  // 캐릭터 이미지 목록 — 펫 설정이나 캐릭터 테마가 바뀌면 다시 읽는다
  const Avatar = window.PetAvatar;
  if (Avatar) {
    Avatar.loadFiles().then(draw).catch(() => {});
    window.addEventListener('storage', (e) => { if (!e.key || /^cth_(theme|proj_themes|pet_)/.test(e.key)) Avatar.loadFiles().then(draw).catch(() => {}); });
  }
  const lnbToggle = document.getElementById('lnbToggle');
  if (lnbToggle) lnbToggle.addEventListener('click', draw);
  if (document.getElementById('hudBtn')) setupPopover('hudBtn', 'hudPopover');
  draw();
})();

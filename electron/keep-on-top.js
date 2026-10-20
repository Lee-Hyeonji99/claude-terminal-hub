'use strict';
/**
 * «항상 위» 창(펫 · 바탕화면 HUD)을 계속 맨 위에 둔다.
 * Windows 는 다른 프로그램도 항상 위(topmost)를 쓰면 나중에 올라온 쪽이 위로 가고,
 * 전체 화면 앱이나 디스플레이 변경 뒤에 topmost 가 풀리기도 한다 — 그래서 가끔 창에 가려졌다.
 *  - 가장 높은 단계('screen-saver')로 올린다.
 *  - topmost 가 풀리면(always-on-top-changed) 바로 다시 건다.
 *  - 몇 초마다 보이는 창을 다시 맨 위로(moveTop 은 포커스를 뺏지 않는다).
 *    opts.canMove() 가 false 면 순서는 건드리지 않는다(펫 카드가 펼쳐져 있을 때 등).
 */
const LEVEL = 'screen-saver';
const REASSERT_MS = 3000;

function keepOnTop(win, opts = {}) {
  const every = opts.everyMs || REASSERT_MS;
  const canMove = opts.canMove || (() => true);
  let active = true;
  const alive = () => active && win && !win.isDestroyed();
  const raise = () => {
    if (!alive() || !win.isVisible()) return;
    try {
      if (!win.isAlwaysOnTop()) win.setAlwaysOnTop(true, LEVEL);
      if (canMove()) win.moveTop();
    } catch { /* 닫히는 중 */ }
  };
  try { win.setAlwaysOnTop(true, LEVEL); } catch { /* 닫히는 중 */ }
  win.on('always-on-top-changed', (_e, on) => { if (!on && alive()) { try { win.setAlwaysOnTop(true, LEVEL); } catch {} } });
  win.on('show', raise);
  const iv = setInterval(raise, every);
  // 그만두기 — 항상 위를 끌 수 있는 창(작업실)용
  raise.stop = () => { active = false; clearInterval(iv); };
  win.on('closed', raise.stop);
  return raise;
}

module.exports = { keepOnTop, LEVEL };

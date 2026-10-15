'use strict';
/**
 * 허브 창을 확실히 맨 앞으로 — Windows 는 focus() 만으로는 작업표시줄만 깜빡이고 안 올라올 때가 있어
 * 잠깐 항상 위로 올렸다 내린다. 펫(electron/pet.js)과 HUD(electron/hud.js)가 같이 쓴다.
 */
function bringToFront(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.setAlwaysOnTop(true);
  win.moveTop();
  win.focus();
  win.webContents.focus();
  setTimeout(() => { if (!win.isDestroyed()) win.setAlwaysOnTop(false); }, 150);
}

module.exports = { bringToFront };

'use strict';
/**
 * 작업실 창 — 펫들이 일하는 방(public/room.html). 데이터는 HUD 와 같은 'hud:state' 를 받아 그대로 넘긴다.
 *  - 테두리 없는 창, 아무 데나 끌어서 옮기고 가장자리로 크기 조절(비율 1120:640 고정).
 *  - «항상 위» 는 고를 수 있다(기본 끔 — 게임 창처럼 다른 창 뒤로 갈 수 있게).
 *  - 캐릭터를 누르면 허브 창을 앞으로 올리고 그 세션을 연다(HUD 와 같은 경로).
 * 켜짐 · 자리 · 크기 · 항상 위는 userData/room.json 에 기억한다(기본 꺼짐).
 */
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { bringToFront } = require('./focus-main');
const { keepOnTop } = require('./keep-on-top');

const RATIO = 1120 / 640;
const MIN_W = 448, DEFAULT_W = 672;
const statePath = () => path.join(app.getPath('userData'), 'room.json');
function loadState() { try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')) || {}; } catch { return {}; } }
function saveState(st) { try { fs.writeFileSync(statePath(), JSON.stringify(st)); } catch { /* 자리 기억 실패는 무시 */ } }

function initRoom({ url, mainWin }) {
  const st = { visible: false, bounds: null, onTop: false, ...loadState() };
  let win = null;
  let items = [];
  let saveTimer = null;
  let onTop = null;   // keepOnTop 이 돌려준 것(끌 때 stop)

  // 저장된 자리가 지금 화면들 안이면 그 자리, 아니면 주 모니터 오른쪽 아래
  function startBounds() {
    const area = screen.getPrimaryDisplay().workArea;
    const width = DEFAULT_W, height = Math.round(DEFAULT_W / RATIO);
    const fallback = { x: area.x + area.width - width - 24, y: area.y + area.height - height - 24, width, height };
    const b = st.bounds;
    if (!b) return fallback;
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x >= a.x - b.width + 80 && b.x <= a.x + a.width - 80 && b.y >= a.y - 10 && b.y <= a.y + a.height - 60;
    });
    return onScreen ? b : fallback;
  }

  function applyTop() {
    if (!win || win.isDestroyed()) return;
    if (onTop) { onTop.stop(); onTop = null; }
    if (st.onTop) onTop = keepOnTop(win);
    else win.setAlwaysOnTop(false);
  }

  function create() {
    win = new BrowserWindow({
      ...startBounds(), minWidth: MIN_W, minHeight: Math.round(MIN_W / RATIO),
      frame: false, resizable: true, maximizable: false, fullscreenable: false,
      backgroundColor: '#1c2130', show: false, title: 'Claude 작업실',
      webPreferences: { contextIsolation: true, spellcheck: false, preload: path.join(__dirname, 'room-preload.js') },
    });
    win.setAspectRatio(RATIO);
    applyTop();
    win.loadURL(`${url}/room.html`);
    win.webContents.on('will-navigate', (e, to) => { if (!to.startsWith(url)) e.preventDefault(); });
    win.webContents.on('did-finish-load', () => {
      try {
        win.webContents.send('room:settings', { onTop: st.onTop });
        win.webContents.send('hud:state', items);
      } catch {}
    });
    win.once('ready-to-show', () => win.showInactive());
    const remember = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { if (win && !win.isDestroyed()) { st.bounds = win.getBounds(); saveState(st); } }, 400);
    };
    win.on('moved', remember);
    win.on('resized', remember);
    win.on('closed', () => {
      win = null;
      onTop = null;
      if (st.visible) { st.visible = false; saveState(st); notifyMain(); }   // 작업표시줄에서 닫아도 꺼짐으로
    });
  }

  function notifyMain() {
    if (mainWin && !mainWin.isDestroyed()) { try { mainWin.webContents.send('room:visible', st.visible); } catch {} }
  }
  function setVisible(v) {
    st.visible = !!v;
    saveState(st);
    if (st.visible && !win) create();
    else if (!st.visible && win) { const w = win; win = null; w.close(); }
    notifyMain();
  }

  // ---- 허브 → 작업실 (HUD 와 같은 데이터) ----
  ipcMain.on('hud:state', (_e, list) => {
    items = Array.isArray(list) ? list : [];
    if (win && !win.isDestroyed()) { try { win.webContents.send('hud:state', items); } catch {} }
  });
  ipcMain.on('room:set-visible', (_e, v) => setVisible(v));
  ipcMain.handle('room:visible', () => st.visible);

  // ---- 작업실 → main / 허브 ----
  const fromRoom = (e) => !!(win && !win.isDestroyed() && e.sender === win.webContents);
  ipcMain.on('room:focus', (e, key) => {
    if (!fromRoom(e) || !key) return;
    bringToFront(mainWin);
    if (mainWin && !mainWin.isDestroyed()) {
      try { mainWin.webContents.send('pet:answer', { key: String(key), sig: '', action: { type: 'focus' } }); } catch {}
    }
  });
  ipcMain.on('room:set-top', (e, v) => {
    if (!fromRoom(e)) return;
    st.onTop = !!v;
    saveState(st);
    applyTop();
  });
  ipcMain.on('room:hide', (e) => { if (fromRoom(e)) setVisible(false); });

  if (st.visible) create();
}

module.exports = { initRoom };

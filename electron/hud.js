'use strict';
/**
 * 바탕화면 작업 현황 HUD — 항상 위에 떠 있는 작은 창 하나(public/hud.html).
 * 데이터는 허브 창(public/pet-bridge.js)이 'hud:state' 로 보내고, 여기는 창 관리와 전달만 한다.
 *  - 처음 자리는 주 모니터 왼쪽 위. 끌어서 옮기고(펫처럼 OS 커서 위치로), 꾹 누르면 이동 잠금.
 *  - 크기는 비율(scale)로 — 렌더러가 내용을 확대/축소하고 그 크기를 알려 주면 창을 맞춘다.
 *  - 줄을 누르면 허브 창을 앞으로 올리고 그 세션을 연다(펫 «보기» 와 같은 경로).
 * 켜짐·자리·비율·잠금은 userData/hud.json 에 기억한다(기본 꺼짐).
 */
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { bringToFront } = require('./focus-main');
const { keepOnTop } = require('./keep-on-top');

const MARGIN = 16;
const MIN = { w: 120, h: 40 }, MAX = { w: 900, h: 1100 };
const statePath = () => path.join(app.getPath('userData'), 'hud.json');
function loadState() { try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')) || {}; } catch { return {}; } }
function saveState(st) { try { fs.writeFileSync(statePath(), JSON.stringify(st)); } catch { /* 자리 기억 실패는 무시 */ } }
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function initHud({ url, mainWin }) {
  const st = { visible: false, x: null, y: null, scale: 1, locked: false, ...loadState() };
  let win = null;
  let items = [];
  let drag = null;

  // 저장된 자리가 지금 화면들 안이면 그 자리, 아니면 주 모니터 왼쪽 위
  function startPos() {
    const area = screen.getPrimaryDisplay().workArea;
    const fallback = { x: area.x + MARGIN, y: area.y + MARGIN };
    if (st.x == null || st.y == null) return fallback;
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return st.x >= a.x - 200 && st.x <= a.x + a.width - 60 && st.y >= a.y - 10 && st.y <= a.y + a.height - 40;
    });
    return onScreen ? { x: st.x, y: st.y } : fallback;
  }

  function create() {
    win = new BrowserWindow({
      ...startPos(), width: 380, height: 120,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true, show: false, title: 'Claude 작업 현황',
      webPreferences: { contextIsolation: true, spellcheck: false, preload: path.join(__dirname, 'hud-preload.js') },
    });
    keepOnTop(win);   // 다른 창 · 다른 앱의 항상-위 창에 가려지지 않게
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
    win.loadURL(`${url}/hud.html`);
    win.webContents.on('will-navigate', (e, to) => { if (!to.startsWith(url)) e.preventDefault(); });
    win.webContents.on('did-finish-load', () => {
      try {
        win.webContents.send('hud:settings', { scale: st.scale, locked: st.locked });
        win.webContents.send('hud:state', items);
      } catch {}
    });
    win.once('ready-to-show', () => win.showInactive());   // 하던 작업의 포커스를 뺏지 않는다
    win.on('closed', () => { win = null; drag = null; });
  }

  function notifyMain() {
    if (mainWin && !mainWin.isDestroyed()) { try { mainWin.webContents.send('hud:visible', st.visible); } catch {} }
  }
  function setVisible(v) {
    st.visible = !!v;
    saveState(st);
    if (st.visible && !win) create();
    else if (!st.visible && win) { win.close(); win = null; }
    notifyMain();
  }

  // ---- 허브 → HUD ----
  ipcMain.on('hud:state', (_e, list) => {
    items = Array.isArray(list) ? list : [];
    if (win && !win.isDestroyed()) { try { win.webContents.send('hud:state', items); } catch {} }
  });
  ipcMain.on('hud:set-visible', (_e, v) => setVisible(v));
  ipcMain.handle('hud:visible', () => st.visible);

  // ---- HUD → main / 허브 ----
  const fromHud = (e) => !!(win && !win.isDestroyed() && e.sender === win.webContents);
  ipcMain.on('hud:focus', (e, key) => {
    if (!fromHud(e) || !key) return;
    bringToFront(mainWin);
    if (mainWin && !mainWin.isDestroyed()) {
      try { mainWin.webContents.send('pet:answer', { key: String(key), sig: '', action: { type: 'focus' } }); } catch {}
    }
  });
  ipcMain.on('hud:resize', (e, size) => {
    if (!fromHud(e) || !size) return;
    const w = clamp(Math.ceil(Number(size.w) || 0), MIN.w, MAX.w);
    const h = clamp(Math.ceil(Number(size.h) || 0), MIN.h, MAX.h);
    const b = win.getBounds();
    // 크기 조절 불가 창은 setSize 가로가 무시될 때가 있어 setBounds 로 맞춘다
    if (b.width !== w || b.height !== h) win.setBounds({ x: b.x, y: b.y, width: w, height: h });
  });
  ipcMain.on('hud:drag-start', (e) => {
    if (!fromHud(e) || st.locked) return;
    const [x, y] = win.getPosition();
    drag = { cursor: screen.getCursorScreenPoint(), x, y };
  });
  ipcMain.on('hud:drag', (e) => {
    if (!fromHud(e) || !drag) return;
    const c = screen.getCursorScreenPoint();
    win.setPosition(Math.round(drag.x + c.x - drag.cursor.x), Math.round(drag.y + c.y - drag.cursor.y));
  });
  ipcMain.on('hud:drag-end', (e) => {
    if (!fromHud(e) || !drag) return;
    drag = null;
    const [x, y] = win.getPosition();
    st.x = x; st.y = y;
    saveState(st);
  });
  ipcMain.on('hud:set-lock', (e, v) => { if (fromHud(e)) { st.locked = !!v; saveState(st); } });
  ipcMain.on('hud:set-scale', (e, k) => {
    if (!fromHud(e)) return;
    const n = Number(k);
    if (Number.isFinite(n)) { st.scale = clamp(n, 0.6, 1.6); saveState(st); }
  });
  ipcMain.on('hud:hide', (e) => { if (fromHud(e)) setVisible(false); });

  if (st.visible) create();
}

module.exports = { initHud };

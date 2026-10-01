'use strict';
/**
 * 펫 — 바탕화면 맨 앞에 떠 있는 작은 창. 허브 패널에 Claude 질문이 뜨면 카드로 보여주고
 * 거기서 고르거나 글을 써 보낼 수 있다.
 *
 * - 질문을 찾는 건 허브 창(public/pet-bridge.js)이다. 패널 화면을 직접 갖고 있어서 셸 종류
 *   (PowerShell / tmux)와 상관없이 읽힌다. 이 파일은 창 관리와 두 창 사이 전달만 한다.
 * - 창 크기는 펫 화면이 알려준다(접힘 = 캐릭터만, 펼침 = 카드까지). 오른쪽 아래 모서리를
 *   기준점으로 고정해 카드가 펼쳐져도 캐릭터가 제자리에 있게 한다.
 * - 투명 창의 빈 곳도 클릭을 먹으므로 창 자체를 내용 크기에 맞춘다(클릭 통과 처리 불필요).
 */
const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

const COLLAPSED = { width: 104, height: 104 };
const MAX = { width: 420, height: 640 };
const SHORTCUT = 'CommandOrControl+Alt+P';
const statePath = () => path.join(app.getPath('userData'), 'pet.json');

function loadState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')) || {}; } catch { return {}; }
}
function saveState(st) {
  try { fs.writeFileSync(statePath(), JSON.stringify(st)); } catch { /* 위치 기억 실패는 무시 */ }
}

function initPet({ url, mainWin }) {
  const st = { visible: true, ...loadState() };
  let win = null;
  let size = { ...COLLAPSED };
  let lastList = [];
  let drag = null;

  // 기준점(캐릭터의 오른쪽 아래). 처음이면 주 모니터 작업영역 오른쪽 아래.
  function anchor() {
    if (st.anchor && Number.isFinite(st.anchor.right) && Number.isFinite(st.anchor.bottom)) return st.anchor;
    const wa = screen.getPrimaryDisplay().workArea;
    return { right: wa.x + wa.width - 24, bottom: wa.y + wa.height - 24 };
  }
  // 펼친 카드가 화면 밖으로 나가지 않게 — 기준점은 그대로 두고 창만 안으로 민다.
  function boundsFor(w, h) {
    const a = anchor();
    const b = { x: Math.round(a.right - w), y: Math.round(a.bottom - h), width: w, height: h };
    const wa = screen.getDisplayNearestPoint({ x: a.right - 1, y: a.bottom - 1 }).workArea;
    b.x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - w);
    b.y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - h);
    return b;
  }
  function notifyMain(channel, payload) {
    if (mainWin && !mainWin.isDestroyed()) { try { mainWin.webContents.send(channel, payload); } catch {} }
  }

  function create() {
    win = new BrowserWindow({
      ...boundsFor(size.width, size.height),
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true, show: false, title: 'Claude Pet',
      webPreferences: { contextIsolation: true, spellcheck: false, preload: path.join(__dirname, 'pet-preload.js') },
    });
    // 'screen-saver' 단계라야 다른 앱의 항상-위 창보다도 앞에 선다.
    win.setAlwaysOnTop(true, 'screen-saver');
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
    win.loadURL(`${url}/pet.html`);
    // 펫이 뜰 때 하던 작업의 포커스를 뺏지 않는다.
    win.once('ready-to-show', () => { if (st.visible) win.showInactive(); });
    win.webContents.on('did-finish-load', () => win.webContents.send('pet:state', lastList));
    win.on('closed', () => { win = null; });
  }

  function setVisible(v) {
    st.visible = !!v;
    saveState(st);
    if (st.visible) { if (!win) create(); else win.showInactive(); }
    else if (win) win.hide();
    notifyMain('pet:visible', st.visible);
  }

  // ---- 허브 창 → 펫 ----
  ipcMain.on('pet:state', (_e, list) => {
    lastList = Array.isArray(list) ? list : [];
    if (win && !win.isDestroyed()) win.webContents.send('pet:state', lastList);
  });
  ipcMain.on('pet:result', (_e, r) => { if (win && !win.isDestroyed()) win.webContents.send('pet:result', r); });
  ipcMain.on('pet:toggle', () => setVisible(!st.visible));
  ipcMain.handle('pet:visible', () => st.visible);

  // ---- 펫 → 허브 창 ----
  ipcMain.on('pet:answer', (_e, payload) => {
    if (payload && payload.action && payload.action.type === 'focus' && mainWin && !mainWin.isDestroyed()) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show(); mainWin.focus();
    }
    notifyMain('pet:answer', payload);
  });
  ipcMain.on('pet:hide', () => setVisible(false));
  ipcMain.on('pet:resize', (_e, s) => {
    if (!win || !s) return;
    size = {
      width: Math.max(COLLAPSED.width, Math.min(MAX.width, Math.ceil(s.width))),
      height: Math.max(COLLAPSED.height, Math.min(MAX.height, Math.ceil(s.height))),
    };
    win.setBounds(boundsFor(size.width, size.height));
  });
  // 드래그 — 렌더러 좌표 대신 OS 커서 위치를 쓴다(배율이 다른 모니터 사이에서도 맞는다).
  ipcMain.on('pet:drag-start', () => {
    if (!win) return;
    drag = { cursor: screen.getCursorScreenPoint(), anchor: { ...anchor() } };
  });
  ipcMain.on('pet:drag', () => {
    if (!win || !drag) return;
    const c = screen.getCursorScreenPoint();
    st.anchor = { right: drag.anchor.right + (c.x - drag.cursor.x), bottom: drag.anchor.bottom + (c.y - drag.cursor.y) };
    win.setBounds(boundsFor(size.width, size.height));
  });
  ipcMain.on('pet:drag-end', () => {
    if (!drag) return;
    drag = null;
    // 놓인 자리가 화면 밖으로 걸쳐 있으면 실제 창 위치로 기준점을 맞춘다.
    if (win) { const b = win.getBounds(); st.anchor = { right: b.x + b.width, bottom: b.y + b.height }; }
    saveState(st);
  });

  try { globalShortcut.register(SHORTCUT, () => setVisible(!st.visible)); } catch { /* 다른 앱이 쓰고 있으면 버튼으로만 */ }
  app.on('will-quit', () => { try { globalShortcut.unregister(SHORTCUT); } catch {} });

  // 허브 창을 닫으면 펫도 닫아야 앱이 끝난다(window-all-closed).
  mainWin.on('closed', () => { if (win && !win.isDestroyed()) win.destroy(); });

  if (st.visible) create();
  return { toggle: () => setVisible(!st.visible) };
}

module.exports = { initPet, PET_SHORTCUT: SHORTCUT };

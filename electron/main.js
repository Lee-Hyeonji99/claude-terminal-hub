'use strict';
/**
 * Claude Terminal Hub — Electron 앱 창 래퍼.
 *
 * 브라우저 탭과 달리 앱 창에서는 기본 메뉴(Close Window = Ctrl+W accelerator)를 제거해
 * Ctrl+W 가 창을 닫지 않고 터미널(pty)로 그대로 전달되게 한다.
 * 또한 실수로 전체 세션을 날리는 새로고침(F5 / Ctrl+R)을 차단한다.
 */
const { app, BrowserWindow, Menu, shell, ipcMain, dialog, nativeImage, Notification } = require('electron');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

// 작업표시줄(Windows)/Dock(macOS)/Alt-Tab이 패키징 안 된 electron 자체 정체성("Electron")으로
// 뜨는 걸 막기 위해 앱 고유 이름/AppUserModelID를 지정
app.setName('Claude Terminal Hub');
if (process.platform === 'win32') app.setAppUserModelId('com.claude-terminal-hub.app');

// 플랫폼별 아이콘: Windows 는 .ico, 그 외(macOS/Linux)는 .png
const ICON_PATH = path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png');

// macOS Dock 아이콘: 개발 실행(electron 바이너리 그대로)일 때 Dock 이 "Electron" 아이콘으로
// 뜨는 걸 막고 앱 아이콘으로 교체. (BrowserWindow.icon 은 macOS 에서 무시됨)
if (process.platform === 'darwin' && app.dock) {
  try {
    const img = nativeImage.createFromPath(ICON_PATH);
    if (!img.isEmpty()) app.dock.setIcon(img);
  } catch { /* 아이콘 없거나 로드 실패 시 무시 */ }
}

const PORT = Number(process.env.CLAUDE_HUB_PORT || 4778);
const URL = `http://localhost:${PORT}`;
const ROOT = path.join(__dirname, '..');

function ping() {
  return new Promise((resolve) => {
    const req = http.get(`${URL}/health`, { timeout: 1500 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(res.statusCode === 200 && d.includes('claude-terminal-hub')));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

const SERVER_LOG_PATH = path.join(app.getPath('userData'), 'server.log');

let serverProc = null;
async function ensureServer() {
  if (await ping()) return true; // 이미 떠 있으면 재사용
  const fs = require('fs');
  const logFd = fs.openSync(SERVER_LOG_PATH, 'w');
  let exited = false;
  // Electron 바이너리를 순수 node 로 실행(ELECTRON_RUN_AS_NODE)해 서버 기동 → 별도 node 설치 불필요
  serverProc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CLAUDE_HUB_PORT: String(PORT) },
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  serverProc.on('exit', (code, signal) => {
    exited = true;
    try { fs.writeSync(logFd, `\n[electron] server.js 프로세스 종료 (code=${code} signal=${signal})\n`); } catch { /* ignore */ }
    try { fs.closeSync(logFd); } catch { /* already closed */ }
  });
  serverProc.on('error', (err) => {
    exited = true;
    try { fs.writeSync(logFd, `\n[electron] server.js 프로세스 spawn 실패: ${err && err.stack ? err.stack : err}\n`); } catch { /* ignore */ }
    try { fs.closeSync(logFd); } catch { /* already closed */ }
  });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 300));
    if (await ping()) return true;
    // server.js 프로세스가 이미 죽었으면(네이티브 모듈 로드 실패 등) 남은 재시도를 기다리지 않고 바로 실패 처리
    if (exited) break;
  }
  return false;
}

function readServerLogTail() {
  try {
    const fs = require('fs');
    const text = fs.readFileSync(SERVER_LOG_PATH, 'utf8');
    return text.slice(-4000) || '(로그 비어있음 — 서버가 아예 시작되지 않았거나 아직 로그를 못 씀)';
  } catch (e) {
    return '(로그 파일을 읽을 수 없음: ' + e.message + ')';
  }
}

function createWindow(ready) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#0c0e14',
    title: 'Claude Terminal Hub',
    icon: ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, spellcheck: false, preload: path.join(__dirname, 'preload.js') },
  });

  if (ready) {
    win.loadURL(URL);
  } else {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<body style="background:#0c0e14;color:#8a91a5;font-family:Segoe UI;display:flex;flex-direction:column;gap:10px;align-items:center;padding:40px 24px;margin:0;box-sizing:border-box;min-height:100vh">
      <div style="text-align:center">서버를 시작하지 못했습니다. 포트 ${PORT} 확인 후 다시 실행하세요.</div>
      <div style="font-size:12px;opacity:.7">로그 파일: ${esc(SERVER_LOG_PATH)}</div>
      <pre style="width:100%;max-width:900px;flex:1;overflow:auto;background:#000;color:#c9d1d9;padding:12px;border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-all">${esc(readServerLogTail())}</pre>
    </body>`;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  }

  // 외부 링크는 시스템 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  // 새로고침 정책: Ctrl+Shift+R = 명시적 앱 새로고침(업데이트 반영). F5/Ctrl+R = 차단(세션 보존, Ctrl+R은 터미널로).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = (input.key || '').toLowerCase();
    const ctrl = input.control || input.meta;
    if (ctrl && input.shift && k === 'r') { e.preventDefault(); win.webContents.reloadIgnoringCache(); return; }
    if (k === 'f5' || (ctrl && k === 'r')) e.preventDefault();
  });

  return win;
}

// 네이티브 폴더 선택 다이얼로그 (절대경로 반환, 앱 창 소유 모달 → 항상 최상단)
ipcMain.handle('pick-folder', async (_e, initial) => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const opts = { title: '작업 폴더 선택', properties: ['openDirectory', 'createDirectory'] };
  if (initial) opts.defaultPath = initial;
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return (r.canceled || !r.filePaths[0]) ? null : r.filePaths[0];
});

// 네이티브 파일 선택 (미리보기용, 절대경로 반환)
ipcMain.handle('pick-file', async () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const opts = {
    title: '미리보기할 파일 선택',
    properties: ['openFile'],
    filters: [
      { name: '미리보기 가능', extensions: ['html', 'htm', 'md', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf', 'json', 'css', 'js'] },
      { name: '모든 파일', extensions: ['*'] },
    ],
  };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return (r.canceled || !r.filePaths[0]) ? null : r.filePaths[0];
});

// 새 메시지 알림: 창이 포커스 상태면 인앱 펄스(reload 버튼)로 충분하므로 생략하고,
// 백그라운드일 때만 OS 알림 + 작업표시줄 아이콘 깜빡임(flashFrame)으로 존재를 알린다.
ipcMain.on('cth-notify', (e, payload) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isFocused()) return;
  if (Notification.isSupported()) {
    const n = new Notification({
      title: (payload && payload.title) || 'Claude Terminal Hub',
      body: (payload && payload.body) || '새 메시지가 도착했습니다.',
      icon: ICON_PATH,
    });
    n.on('click', () => { win.show(); win.focus(); });
    n.show();
  }
  win.flashFrame(true);
  win.once('focus', () => win.flashFrame(false));
});

// 자동 업데이트: GitHub Release 에 올라간 최신 버전을 백그라운드로 받아뒀다가,
// 사용자 확인 후(또는 다음 종료 시 자동으로) 설치한다. 개발 실행(패키징 안 됨)일 땐 업데이트 서버가 없어 스킵.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// 렌더러(헤더의 버전 팝오버)로 진행 상황을 그대로 흘려보낸다.
let updateWin = null;
function sendUpdateStatus(payload) {
  if (updateWin && !updateWin.isDestroyed()) {
    try { updateWin.webContents.send('cth-update-status', payload); } catch {}
  }
}
ipcMain.handle('update-check', async () => {
  if (!app.isPackaged) { sendUpdateStatus({ state: 'dev' }); return { state: 'dev' }; }
  sendUpdateStatus({ state: 'checking' });
  try {
    await autoUpdater.checkForUpdates();
    return { state: 'checking' };
  } catch (e) {
    const message = (e && e.message) ? e.message : String(e);
    sendUpdateStatus({ state: 'error', message });
    return { state: 'error', message };
  }
});
ipcMain.handle('update-install', () => { autoUpdater.quitAndInstall(); });

function initAutoUpdate(win) {
  updateWin = win;
  if (!app.isPackaged) return;
  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => sendUpdateStatus({ state: 'none' }));
  autoUpdater.on('update-available', (info) => sendUpdateStatus({ state: 'available', version: info && info.version }));
  autoUpdater.on('download-progress', (p) => sendUpdateStatus({ state: 'progress', percent: p && p.percent }));
  autoUpdater.on('update-downloaded', async (info) => {
    sendUpdateStatus({ state: 'downloaded', version: info && info.version });
    const r = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Claude Terminal Hub 업데이트',
      message: '새 버전을 다운로드했습니다. 지금 재시작해서 설치할까요?',
      buttons: ['지금 재시작', '나중에 (다음 종료 시 자동 설치)'],
      defaultId: 0,
      cancelId: 1,
    });
    if (r.response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (err) => {
    const message = (err && err.message) ? err.message : String(err);
    console.error('[auto-update] 확인/다운로드 실패:', message);
    sendUpdateStatus({ state: 'error', message });
  });
  autoUpdater.checkForUpdates().catch(() => {});
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); // Ctrl+W/T/N 등 기본 accelerator 제거 → 키가 터미널로 전달
  const ok = await ensureServer();
  const win = createWindow(ok);
  initAutoUpdate(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(true);
  });
});

// 창을 모두 닫으면 앱 종료. 서버(serverProc)는 남겨 브라우저/다음 실행이 재사용하도록 유지.
app.on('window-all-closed', () => { app.quit(); });

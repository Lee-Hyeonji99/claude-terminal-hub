'use strict';
/**
 * Claude Terminal Hub — Electron 앱 창 래퍼.
 *
 * 브라우저 탭과 달리 앱 창에서는 기본 메뉴(Close Window = Ctrl+W accelerator)를 제거해
 * Ctrl+W 가 창을 닫지 않고 터미널(pty)로 그대로 전달되게 한다.
 * 또한 실수로 전체 세션을 날리는 새로고침(F5 / Ctrl+R)을 차단한다.
 */
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

// Windows 작업표시줄/Alt-Tab이 패키징 안 된 electron.exe 자체 정체성("Electron")으로
// 뜨는 걸 막기 위해 앱 고유 이름/AppUserModelID를 지정
app.setName('Claude Terminal Hub');
if (process.platform === 'win32') app.setAppUserModelId('com.claude-terminal-hub.app');

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

let serverProc = null;
async function ensureServer() {
  if (await ping()) return true; // 이미 떠 있으면 재사용
  // Electron 바이너리를 순수 node 로 실행(ELECTRON_RUN_AS_NODE)해 서버 기동 → 별도 node 설치 불필요
  serverProc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CLAUDE_HUB_PORT: String(PORT) },
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 300));
    if (await ping()) return true;
  }
  return false;
}

function createWindow(ready) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#0c0e14',
    title: 'Claude Terminal Hub',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, spellcheck: false, preload: path.join(__dirname, 'preload.js') },
  });

  if (ready) win.loadURL(URL);
  else win.loadURL('data:text/html,<body style="background:%230c0e14;color:%238a91a5;font-family:Segoe UI;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">서버를 시작하지 못했습니다. 포트 ' + PORT + ' 확인 후 다시 실행하세요.</body>');

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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); // Ctrl+W/T/N 등 기본 accelerator 제거 → 키가 터미널로 전달
  const ok = await ensureServer();
  createWindow(ok);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(true);
  });
});

// 창을 모두 닫으면 앱 종료. 서버(serverProc)는 남겨 브라우저/다음 실행이 재사용하도록 유지.
app.on('window-all-closed', () => { app.quit(); });

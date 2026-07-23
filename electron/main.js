'use strict';
/**
 * Claude Terminal Hub — Electron 앱 창 래퍼.
 *
 * 브라우저 탭과 달리 앱 창에서는 기본 메뉴(Close Window = Ctrl+W accelerator)를 제거해
 * Ctrl+W 가 창을 닫지 않고 터미널(pty)로 그대로 전달되게 한다.
 * 또한 실수로 전체 세션을 날리는 새로고침(F5 / Ctrl+R)을 차단한다.
 */
const { app, BrowserWindow, Menu, shell } = require('electron');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

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
    webPreferences: { contextIsolation: true, spellcheck: false },
  });

  if (ready) win.loadURL(URL);
  else win.loadURL('data:text/html,<body style="background:%230c0e14;color:%238a91a5;font-family:Segoe UI;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">서버를 시작하지 못했습니다. 포트 ' + PORT + ' 확인 후 다시 실행하세요.</body>');

  // 외부 링크는 시스템 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  // 실수 새로고침 차단(세션 보존). Ctrl+W 는 건드리지 않음 → 메뉴 없음이라 창 안 닫고 터미널로 전달.
  win.webContents.on('before-input-event', (e, input) => {
    const k = (input.key || '').toLowerCase();
    const ctrl = input.control || input.meta;
    if (k === 'f5' || (ctrl && k === 'r')) e.preventDefault();
  });

  return win;
}

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

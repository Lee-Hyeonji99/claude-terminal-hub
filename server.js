'use strict';

/**
 * Claude Terminal Hub — 여러 PTY 세션을 브라우저 split 뷰로 노출하는 로컬 서버.
 *
 * - 폴더 선택기: 서버(=로컬 머신)의 실제 파일시스템을 탐색해 절대경로를 고른다.
 * - 세션 목록: 선택한 경로의 Claude Code 세션(~/.claude/projects/<encoded>/*.jsonl)을
 *   나열해 `claude --resume <id>` 로 이어서 진행할 수 있게 한다.
 * - 각 세션은 진짜 PTY(Windows=ConPTY)로 실행되어 xterm.js 가 그대로 렌더링한다.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { execFile } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

const PORT = Number(process.env.CLAUDE_HUB_PORT || 4778);
const IS_WIN = process.platform === 'win32';
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const PROFILES_ROOT = path.join(os.homedir(), '.claude-hub-profiles');

// 프로필(계정)별 CLAUDE_CONFIG_DIR. 'default'/빈값이면 기본 ~/.claude 사용(null 반환).
function configDirFor(profileId) {
  if (!profileId || profileId === 'default') return null;
  const safe = String(profileId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(PROFILES_ROOT, safe);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}
// 프로필별 projects 디렉터리 (세션 기록 위치)
function projectsDirFor(profileId) {
  const cfg = configDirFor(profileId);
  return cfg ? path.join(cfg, 'projects') : PROJECTS_DIR;
}
// 프로필별 .claude.json (계정 정보 위치)
function accountFileFor(profileId) {
  const cfg = configDirFor(profileId);
  return cfg ? path.join(cfg, '.claude.json') : path.join(os.homedir(), '.claude.json');
}

const app = express();

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'), // 항상 최신 프론트 로드
}));
app.use('/vendor/xterm', express.static(path.join(__dirname, 'node_modules/@xterm/xterm')));
app.use('/vendor/addon-fit', express.static(path.join(__dirname, 'node_modules/@xterm/addon-fit')));
app.use('/vendor/split', express.static(path.join(__dirname, 'node_modules/split.js/dist')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, name: 'claude-terminal-hub', pid: process.pid, platform: process.platform });
});

app.get('/api/defaults', (_req, res) => {
  res.json({ home: os.homedir(), cwd: process.cwd(), sep: path.sep });
});

// 프로필(계정) 로그인 정보 — .claude.json 의 oauthAccount
app.get('/api/account', (req, res) => {
  try {
    const j = JSON.parse(fs.readFileSync(accountFileFor(req.query.profile), 'utf8'));
    const a = j.oauthAccount;
    if (a && a.emailAddress) {
      return res.json({ loggedIn: true, email: a.emailAddress, org: a.organizationUuid || null });
    }
  } catch { /* 파일 없음/미로그인 */ }
  res.json({ loggedIn: false });
});

// ---- 파일시스템 탐색 (폴더 선택기용) ----
app.get('/api/fs/drives', (_req, res) => {
  if (!IS_WIN) return res.json({ drives: ['/'] });
  const drives = [];
  for (let c = 'A'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    const root = String.fromCharCode(c) + ':\\';
    try {
      fs.accessSync(root);
      drives.push(root);
    } catch { /* 없는 드라이브 */ }
  }
  res.json({ drives });
});

// OS 네이티브 폴더 선택 대화상자 (Windows). 서버가 사용자 데스크톱에 다이얼로그를 띄운다.
app.get('/api/fs/pick', (req, res) => {
  if (!IS_WIN) return res.status(400).json({ error: 'OS 폴더 선택기는 Windows 에서만 지원됩니다.' });
  const initial = (req.query.path || '').toString().replace(/'/g, "''"); // PS 문자열 이스케이프
  const script = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.Show() | Out-Null
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = 'Claude Terminal Hub - 작업 폴더 선택'
$dlg.ShowNewFolderButton = $true
try { if ('${initial}' -ne '') { $dlg.SelectedPath = '${initial}' } } catch {}
$result = $dlg.ShowDialog($owner)
$owner.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dlg.SelectedPath) }
`;
  execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { timeout: 180000, windowsHide: true },
    (err, stdout) => {
      if (err && err.killed) return res.json({ canceled: true, path: '' });
      const picked = (stdout || '').trim();
      res.json({ path: picked, canceled: !picked });
    });
});

app.get('/api/fs/list', (req, res) => {
  let target = (req.query.path || '').toString().trim();
  if (!target) target = os.homedir();
  try {
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) return res.status(400).json({ error: '디렉터리가 아닙니다.' });
  } catch (e) {
    return res.status(400).json({ error: `경로 접근 불가: ${e.code || e.message}` });
  }
  let dirs = [];
  try {
    dirs = fs.readdirSync(target, { withFileTypes: true })
      .filter((d) => {
        if (!d.isDirectory()) return false;
        if (d.name.startsWith('$')) return false; // 시스템 폴더 숨김
        return true;
      })
      .map((d) => d.name)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  } catch (e) {
    return res.status(403).json({ error: `읽기 불가: ${e.code || e.message}` });
  }
  const parent = path.dirname(target);
  res.json({
    path: target,
    parent: parent === target ? null : parent,
    dirs,
    hasSessions: fs.existsSync(path.join(projectsDirFor(req.query.profile), encodeProjectPath(target))),
  });
});

// ---- 세션 목록 (특정 경로의 Claude Code 대화) ----
function encodeProjectPath(p) {
  return p.replace(/[^a-zA-Z0-9]/g, '-');
}

function readSessionMeta(file) {
  // 파일 앞부분만 스트리밍으로 읽어 제목/요약을 추출 (대용량 대비 early-exit)
  return new Promise((resolve) => {
    const meta = { title: null, summary: null, cwd: null };
    let lines = 0;
    let stream;
    try {
      stream = fs.createReadStream(file, { encoding: 'utf8' });
    } catch {
      return resolve(meta);
    }
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      lines++;
      if (!line) return;
      let obj;
      try { obj = JSON.parse(line); } catch { return; }
      if (obj.cwd && !meta.cwd) meta.cwd = String(obj.cwd);
      if (obj.type === 'summary' && obj.summary && !meta.summary) {
        meta.summary = String(obj.summary).slice(0, 120);
      }
      if (obj.type === 'user' && !meta.title) {
        const c = obj.message && obj.message.content;
        let text = '';
        if (typeof c === 'string') text = c;
        else if (Array.isArray(c)) text = c.map((x) => (x && x.text) || '').join(' ');
        text = text.replace(/\s+/g, ' ').trim();
        if (text && !text.startsWith('<')) meta.title = text.slice(0, 120);
      }
      if (meta.cwd && (meta.title || meta.summary) && lines > 3) { rl.close(); }
      if (lines > 200) rl.close();
    });
    rl.on('close', () => resolve(meta));
    rl.on('error', () => resolve(meta));
  });
}

// 메타 캐시 (경로+mtime) — /api/recent, /api/search 공용
const metaCache = new Map();
async function getMeta(full, mtime) {
  const c = metaCache.get(full);
  if (c && c.mtime === mtime) return c.meta;
  const meta = await readSessionMeta(full);
  metaCache.set(full, { mtime, meta });
  return meta;
}

// 모든 프로젝트의 세션 파일 목록(stat 포함). 프로필별 projects 디렉터리 대상.
function listAllSessions(projectsDir) {
  const base = projectsDir || PROJECTS_DIR;
  let projectDirs;
  try {
    projectDirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch { return []; }
  const all = [];
  for (const pd of projectDirs) {
    const dir = path.join(base, pd.name);
    let files;
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        const s = fs.statSync(full);
        all.push({ id: f.replace(/\.jsonl$/, ''), full, mtime: s.mtimeMs, sizeKB: Math.round(s.size / 1024) });
      } catch { /* skip */ }
    }
  }
  return all;
}

// ---- 최근 세션 (모든 프로젝트 통합, LNB 추천용) ----
app.get('/api/recent', async (req, res) => {
  const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const all = listAllSessions(projectsDirFor(req.query.profile)).sort((a, b) => b.mtime - a.mtime);
  const top = all.slice(0, limit);
  const sessions = await Promise.all(top.map(async (s) => {
    const meta = await getMeta(s.full, s.mtime);
    return { id: s.id, title: meta.summary || meta.title || '(제목 없음)', cwd: meta.cwd || '', mtime: s.mtime, sizeKB: s.sizeKB };
  }));
  res.json({ total: all.length, sessions: sessions.filter((s) => s.cwd) });
});

// ---- 세션 검색 (모든 프로젝트, 제목/경로) ----
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim().toLowerCase();
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  if (!q) return res.json({ sessions: [], total: 0 });
  const all = listAllSessions(projectsDirFor(req.query.profile)).sort((a, b) => b.mtime - a.mtime);
  const out = [];
  for (const s of all) {
    const meta = await getMeta(s.full, s.mtime);
    const title = meta.summary || meta.title || '';
    const cwd = meta.cwd || '';
    if (!cwd) continue;
    if (title.toLowerCase().includes(q) || cwd.toLowerCase().includes(q)) {
      out.push({ id: s.id, title: title || '(제목 없음)', cwd, mtime: s.mtime, sizeKB: s.sizeKB });
      if (out.length >= limit) break;
    }
  }
  res.json({ sessions: out, total: out.length, scanned: all.length });
});

app.get('/api/sessions', async (req, res) => {
  const target = (req.query.path || '').toString().trim();
  if (!target) return res.status(400).json({ error: 'path 필요' });
  const dir = path.join(projectsDirFor(req.query.profile), encodeProjectPath(target));
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return res.json({ path: target, encoded: encodeProjectPath(target), sessions: [] });
  }
  const withStat = files.map((f) => {
    const full = path.join(dir, f);
    let mtime = 0, size = 0;
    try { const s = fs.statSync(full); mtime = s.mtimeMs; size = s.size; } catch {}
    return { id: f.replace(/\.jsonl$/, ''), full, mtime, size };
  }).sort((a, b) => b.mtime - a.mtime);

  const top = withStat.slice(0, 40); // 최신 40개만 메타 파싱
  const sessions = await Promise.all(top.map(async (s) => {
    const meta = await readSessionMeta(s.full);
    return {
      id: s.id,
      title: meta.summary || meta.title || '(제목 없음)',
      mtime: s.mtime,
      sizeKB: Math.round(s.size / 1024),
    };
  }));
  res.json({ path: target, encoded: encodeProjectPath(target), total: withStat.length, sessions });
});

// ---- 사용량 (/status 스크레이프, 요청 시 1회) ----
function stripAnsi(s) {
  let c = s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b[\]P][\s\S]*?(\x07|\x1b\\)/g, '');
  return c.split('').filter((ch) => ch === '\n' || ch >= ' ').join('');
}
function extractUsageLines(clean) {
  const seen = new Set();
  const out = [];
  for (let line of clean.split('\n')) {
    line = line.replace(/[│╭╮╰╯─�||]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line || line.length < 3) continue;
    if (/(%|reset|limit|usage|remaining|session|hour|week|month|사용|남은|초기화|시간당|주간|월간|한도)/i.test(line)) {
      if (!seen.has(line)) { seen.add(line); out.push(line); }
    }
  }
  return out.slice(0, 25);
}

// (사용량 /status 스크레이프 기능은 신뢰도 문제로 제거됨 — 사용자 요청)

// ---- PTY WebSocket ----
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/pty' });

// 허브가 claude 세션 안에서 실행되더라도 spawn 되는 claude 가 '중첩 자식 세션'으로
// 오작동하지 않도록 CLAUDE_CODE_* 마커를 제거한 깨끗한 env 를 만든다.
function cleanEnv(profileId) {
  const env = { ...process.env, TERM: 'xterm-256color' };
  for (const k of Object.keys(env)) {
    if (/^CLAUDE_CODE/i.test(k) || k === 'CLAUDECODE') delete env[k];
  }
  const cfgDir = configDirFor(profileId);
  if (cfgDir) env.CLAUDE_CONFIG_DIR = cfgDir; // 프로필(계정)별 로그인/설정 분리
  return env;
}

function spawnShell(cwd, cols, rows, profileId) {
  const shell = IS_WIN ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
  const args = IS_WIN ? ['-NoLogo', '-NoExit'] : [];
  const env = cleanEnv(profileId);
  return pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: Math.max(20, cols | 0) || 80,
    rows: Math.max(5, rows | 0) || 24,
    cwd: cwd && cwd.trim() ? cwd : os.homedir(),
    env,
    // ConPTY 사용(TUI/claude 렌더·리사이즈 정확). 과거 'AttachConsole failed' 크래시는
    // process.on('uncaughtException') 가드로 서버 전체가 죽지 않도록 흡수한다.
    useConpty: IS_WIN ? true : undefined,
  });
}

wss.on('connection', (ws) => {
  let term = null;
  let watchedFile = null;
  const safeSend = (obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };

  // 세션 jsonl 파일이 커지면(새 메시지 append) 클라이언트에 알림
  function watchSession(cwd, resumeId, profileId) {
    if (!resumeId) return;
    const jf = path.join(projectsDirFor(profileId), encodeProjectPath(cwd || os.homedir()), resumeId + '.jsonl');
    if (!fs.existsSync(jf)) return;
    watchedFile = jf;
    let lastSize = 0;
    try { lastSize = fs.statSync(jf).size; } catch {}
    fs.watchFile(jf, { interval: 1500 }, (curr) => {
      if (curr.size > lastSize) { lastSize = curr.size; safeSend({ type: 'changed' }); }
      else lastSize = curr.size;
    });
  }
  function unwatch() { if (watchedFile) { try { fs.unwatchFile(watchedFile); } catch {} watchedFile = null; } }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'init') {
      if (term) return;
      const cwd = (msg.cwd || '').trim();
      try {
        term = spawnShell(cwd, msg.cols, msg.rows, msg.profile); // 크기 + 프로필(계정) 반영
      } catch (err) {
        safeSend({ type: 'error', message: `PTY 생성 실패: ${err.message}` });
        return;
      }
      term.onData((data) => { if (ws.readyState === ws.OPEN) ws.send(data); });
      term.onExit(({ exitCode }) => safeSend({ type: 'exit', code: exitCode }));
      safeSend({ type: 'ready', pid: term.pid, cwd: cwd || os.homedir() });

      // 실행 명령 결정: resume > runClaude(claude) > (없음, 셸만)
      let cmd = null;
      if (msg.resumeId) cmd = `claude --resume ${msg.resumeId}`;
      else if (msg.runClaude) cmd = (msg.command && msg.command.trim()) || 'claude';
      if (cmd) setTimeout(() => { if (term) term.write(`${cmd}\r`); }, 400);
      watchSession(cwd, msg.resumeId, msg.profile);
      return;
    }

    if (!term) return;
    if (msg.type === 'input') term.write(msg.data);
    else if (msg.type === 'resize') {
      const cols = Math.max(2, msg.cols | 0);
      const rows = Math.max(1, msg.rows | 0);
      try { term.resize(cols, rows); } catch {}
    }
  });

  ws.on('close', () => {
    unwatch();
    if (term) { try { term.kill(); } catch {} term = null; }
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`포트 ${PORT} 사용 중 — 이미 실행 중입니다. http://localhost:${PORT} 를 열어주세요.`);
    process.exit(2);
  }
  console.error('서버 오류:', err);
  process.exit(1);
});

// 크래시 가드: 개별 PTY/네이티브 오류가 서버 전체(=모든 패널)를 내리지 않도록 로그만 남긴다.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] 무시하고 계속:', err && err.message ? err.message : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] 무시하고 계속:', reason);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Claude Terminal Hub → http://localhost:${PORT}  (pid ${process.pid})`);
});

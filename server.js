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
app.use(express.json({ limit: '256kb' }));

// ---- 전역 상태(세션 이름/프로필) — 앱 전용 폴더에 저장(브라우저·계정 무관) ----
const HUB_DATA_DIR = path.join(os.homedir(), '.claude-terminal-hub');
const STATE_FILE = path.join(HUB_DATA_DIR, 'state.json');
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function writeState(s) {
  try {
    fs.mkdirSync(HUB_DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch (e) { console.error('state 저장 실패:', e.message); }
}

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'), // 항상 최신 프론트 로드
}));
app.use('/vendor/xterm', express.static(path.join(__dirname, 'node_modules/@xterm/xterm')));
app.use('/vendor/addon-fit', express.static(path.join(__dirname, 'node_modules/@xterm/addon-fit')));
app.use('/vendor/addon-canvas', express.static(path.join(__dirname, 'node_modules/@xterm/addon-canvas')));
app.use('/vendor/split', express.static(path.join(__dirname, 'node_modules/split.js/dist')));

const { version: APP_VERSION } = require('./package.json');
app.get('/health', (_req, res) => {
  res.json({ ok: true, name: 'claude-terminal-hub', version: APP_VERSION, pid: process.pid, platform: process.platform });
});

app.get('/api/defaults', (_req, res) => {
  res.json({ home: os.homedir(), cwd: process.cwd(), sep: path.sep });
});

// 전역 상태 조회/저장 (세션 커스텀 이름 + 프로필)
app.get('/api/state', (_req, res) => {
  const s = readState();
  res.json({ names: s.names || {}, profiles: (s.profiles && s.profiles.length) ? s.profiles : [{ id: 'default', name: '기본' }] });
});
app.post('/api/name', (req, res) => {
  const { id, name } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id 필요' });
  const s = readState(); s.names = s.names || {};
  if (name && String(name).trim()) s.names[id] = String(name).trim(); else delete s.names[id];
  writeState(s);
  res.json({ ok: true });
});
app.post('/api/profiles', (req, res) => {
  const { profiles } = req.body || {};
  if (!Array.isArray(profiles)) return res.status(400).json({ error: 'profiles 배열 필요' });
  const s = readState(); s.profiles = profiles; writeState(s);
  res.json({ ok: true });
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
  // TopMost 이면서 실제로 포커스를 가진 owner 폼을 owner 로 넘겨 다이얼로그를 최상단으로.
  const script = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null
[System.Windows.Forms.Application]::EnableVisualStyles()
$owner = New-Object System.Windows.Forms.Form
$owner.Text = 'Claude Terminal Hub'
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = 'FixedToolWindow'
$owner.Width = 1; $owner.Height = 1
$owner.StartPosition = 'CenterScreen'
$owner.Add_Shown({ $owner.Activate(); $owner.BringToFront() })
$owner.Show() | Out-Null
[System.Windows.Forms.Application]::DoEvents()
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = 'Claude Terminal Hub - 작업 폴더 선택'
$dlg.ShowNewFolderButton = $true
try { if ('${initial}' -ne '') { $dlg.SelectedPath = '${initial}' } } catch {}
$result = $dlg.ShowDialog($owner)
$owner.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dlg.SelectedPath) }
`;
  execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { timeout: 300000, windowsHide: true },
    (err, stdout) => {
      if (err && err.killed) return res.json({ canceled: true, path: '' });
      if (err && !stdout) return res.json({ error: '선택기 실행 실패: ' + (err.message || 'unknown') });
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

// 파일 끝부분(N바이트)에서 마지막 custom-title / ai-title 를 찾는다 (제목은 세션 진행 중 갱신되어 끝에 최신값).
function readTitlesFromTail(file, size) {
  const meta = { customTitle: null, aiTitle: null };
  try {
    const bytes = Math.min(size, 96 * 1024);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    fs.readSync(fd, buf, 0, bytes, Math.max(0, size - bytes));
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (const line of lines) {
      if (!line) continue;
      let obj; try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type === 'custom-title' && obj.customTitle) meta.customTitle = String(obj.customTitle).slice(0, 120);
      else if (obj.type === 'ai-title' && obj.aiTitle) meta.aiTitle = String(obj.aiTitle).slice(0, 120);
    }
  } catch { /* skip */ }
  return meta;
}

function readSessionMeta(file) {
  // 앞부분: cwd + 첫 user 메시지, 뒷부분: 최신 custom-title(/rename) / ai-title
  return new Promise((resolve) => {
    const meta = { title: null, summary: null, cwd: null, customTitle: null, aiTitle: null };
    let stat; try { stat = fs.statSync(file); } catch { return resolve(meta); }
    Object.assign(meta, readTitlesFromTail(file, stat.size));

    let lines = 0, stream;
    try { stream = fs.createReadStream(file, { encoding: 'utf8' }); } catch { return resolve(meta); }
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      lines++;
      if (!line) return;
      let obj; try { obj = JSON.parse(line); } catch { return; }
      if (obj.cwd && !meta.cwd) meta.cwd = String(obj.cwd);
      if (obj.type === 'summary' && obj.summary && !meta.summary) meta.summary = String(obj.summary).slice(0, 120);
      if (obj.type === 'user' && !meta.title) {
        const c = obj.message && obj.message.content;
        let text = '';
        if (typeof c === 'string') text = c;
        else if (Array.isArray(c)) text = c.map((x) => (x && x.text) || '').join(' ');
        text = text.replace(/\s+/g, ' ').trim();
        if (text && !text.startsWith('<')) meta.title = text.slice(0, 120);
      }
      if (meta.cwd && (meta.title || meta.summary) && lines > 3) rl.close();
      if (lines > 200) rl.close();
    });
    rl.on('close', () => resolve(meta));
    rl.on('error', () => resolve(meta));
  });
}

// 세션의 최선 제목: /rename(custom) > ai-title > summary > 첫 메시지
function bestTitle(meta) {
  return meta.customTitle || meta.aiTitle || meta.summary || meta.title || '(제목 없음)';
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
    return { id: s.id, title: bestTitle(meta), cwd: meta.cwd || '', mtime: s.mtime, sizeKB: s.sizeKB };
  }));
  res.json({ total: all.length, sessions: sessions.filter((s) => s.cwd) });
});

// ---- 최근 작업 경로 (distinct cwd, 폴더 선택 추천용) ----
app.get('/api/recent-paths', async (req, res) => {
  const limit = Math.min(40, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const all = listAllSessions(projectsDirFor(req.query.profile)).sort((a, b) => b.mtime - a.mtime);
  const seen = new Set();
  const out = [];
  for (const s of all) {
    const meta = await getMeta(s.full, s.mtime);
    const cwd = meta.cwd;
    if (!cwd || seen.has(cwd)) continue;
    if (!fs.existsSync(cwd)) continue; // 사라진 폴더는 제외
    seen.add(cwd);
    out.push({ path: cwd, mtime: s.mtime });
    if (out.length >= limit) break;
  }
  res.json({ paths: out });
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
    const title = (meta.customTitle || meta.aiTitle || meta.summary || meta.title || '');
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
      title: bestTitle(meta),
      mtime: s.mtime,
      sizeKB: Math.round(s.size / 1024),
    };
  }));
  res.json({ path: target, encoded: encodeProjectPath(target), total: withStat.length, sessions });
});

// ---- 로컬 파일 미리보기 서빙 + 아티팩트 판별 ----
const PREVIEW_EXT = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.pdf': 'application/pdf',
};
function isPreviewable(p) { return Object.prototype.hasOwnProperty.call(PREVIEW_EXT, path.extname(String(p)).toLowerCase()); }

app.get('/api/file', (req, res) => {
  const p = (req.query.path || '').toString();
  if (!p) return res.status(400).send('path 필요');
  let st; try { st = fs.statSync(p); } catch { return res.status(404).send('파일 없음'); }
  if (!st.isFile()) return res.status(400).send('파일 아님');
  res.setHeader('Content-Type', PREVIEW_EXT[path.extname(p).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(p).on('error', () => { try { res.end(); } catch {} }).pipe(res);
});

// 세션 jsonl delta 에서 Claude 가 만든/본 미리보기 가능 파일(아티팩트) 추출
function extractArtifacts(text) {
  const out = []; const seen = new Set();
  for (const line of text.split('\n')) {
    if (!line || line.indexOf('tool_use') < 0) continue;
    let obj; try { obj = JSON.parse(line); } catch { continue; }
    const content = obj.message && obj.message.content;
    if (!Array.isArray(content)) continue;
    for (const it of content) {
      if (it.type !== 'tool_use' || !it.input) continue;
      const fp = it.input.file_path || it.input.path || it.input.notebook_path;
      if (!fp || !isPreviewable(fp) || seen.has(fp)) continue;
      seen.add(fp);
      out.push({ path: String(fp), tool: it.name || '' });
    }
  }
  return out;
}

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
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '1' };
  delete env.NO_COLOR; // 허브 프로세스 자체가 NO_COLOR 환경(예: 에이전트 셸)에서 떠도 자식 셸 색은 항상 켠다
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
  const safeSend = (obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };

  // 세션 jsonl 감시: resume 세션은 새 메시지 알림('changed'), 모든 세션은 아티팩트('artifact') 추출
  const watch = { file: null, pos: 0, isResume: false, discoverIv: null };
  function beginWatch(jsonl, isResume) {
    watch.file = jsonl; watch.isResume = isResume;
    try { watch.pos = fs.statSync(jsonl).size; } catch { watch.pos = 0; }
    fs.watchFile(jsonl, { interval: 1200 }, (curr) => {
      if (curr.size <= watch.pos) { watch.pos = curr.size; return; }
      let delta = '';
      try {
        const fd = fs.openSync(jsonl, 'r');
        const len = curr.size - watch.pos;
        const b = Buffer.alloc(len);
        fs.readSync(fd, b, 0, len, watch.pos);
        fs.closeSync(fd);
        delta = b.toString('utf8');
      } catch { watch.pos = curr.size; return; }
      watch.pos = curr.size;
      if (watch.isResume) safeSend({ type: 'changed' });
      for (const a of extractArtifacts(delta)) safeSend({ type: 'artifact', path: a.path, tool: a.tool });
    });
  }
  function watchSession(cwd, resumeId, profileId) {
    const dir = path.join(projectsDirFor(profileId), encodeProjectPath(cwd || os.homedir()));
    if (resumeId) {
      const jf = path.join(dir, resumeId + '.jsonl');
      if (fs.existsSync(jf)) beginWatch(jf, true);
      return;
    }
    // 새 대화: 곧 생성될 최신 jsonl 을 탐색해 감시 시작
    const startT = Date.now();
    let tries = 0;
    watch.discoverIv = setInterval(() => {
      tries++;
      let newest = null, newestM = 0;
      try {
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith('.jsonl')) continue;
          const s = fs.statSync(path.join(dir, f));
          if (s.mtimeMs > newestM) { newestM = s.mtimeMs; newest = path.join(dir, f); }
        }
      } catch {}
      if (newest && newestM >= startT - 3000) { clearInterval(watch.discoverIv); watch.discoverIv = null; beginWatch(newest, false); }
      else if (tries > 15) { clearInterval(watch.discoverIv); watch.discoverIv = null; }
    }, 800);
  }
  function unwatch() {
    if (watch.file) { try { fs.unwatchFile(watch.file); } catch {} watch.file = null; }
    if (watch.discoverIv) { clearInterval(watch.discoverIv); watch.discoverIv = null; }
  }

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

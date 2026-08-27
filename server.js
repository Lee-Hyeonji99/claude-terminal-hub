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
let pty;
try {
  pty = require('node-pty');
} catch (e) {
  console.error('[fatal] node-pty 로드 실패:', e && e.message ? e.message : e);
  console.error('[fatal] Windows 라면 "Microsoft Visual C++ Redistributable"(x64) 설치 여부를 확인하세요: https://aka.ms/vs/17/release/vc_redist.x64.exe');
  process.exit(1);
}

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

// 모든 프로필 id (state.json 의 profiles + 항상 'default')
function allProfileIds() {
  const s = readState();
  const ids = ['default'];
  if (Array.isArray(s.profiles)) for (const p of s.profiles) if (p && p.id && !ids.includes(p.id)) ids.push(p.id);
  return ids;
}
// profile 파라미터 해석: '__all__' 이면 모든 프로필, 아니면 단일 → [{id, dir}]
function resolveProfileScope(profileParam) {
  if (profileParam === '__all__') return allProfileIds().map((id) => ({ id, dir: projectsDirFor(id) }));
  return [{ id: profileParam || 'default', dir: projectsDirFor(profileParam) }];
}
// 여러 프로필의 세션을 profile 태그와 함께 수집(최신순)
function listSessionsScoped(profileParam) {
  const all = [];
  for (const sc of resolveProfileScope(profileParam)) {
    for (const s of listAllSessions(sc.dir)) { s.profile = sc.id; all.push(s); }
  }
  return all.sort((a, b) => b.mtime - a.mtime);
}

const app = express();
app.use(express.json({ limit: '12mb' })); // 테마 이미지 업로드(dataUrl) 때문에 여유있게

// ---- 전역 상태(세션 이름/프로필) — 앱 전용 폴더에 저장(브라우저·계정 무관) ----
const HUB_DATA_DIR = path.join(os.homedir(), '.claude-terminal-hub');
const STATE_FILE = path.join(HUB_DATA_DIR, 'state.json');
// 캐릭터 테마 이미지 폴더 — 저장소/설치파일에 포함하지 않고 사용자 PC 에만 둔다.
const THEME_ASSETS_DIR = path.join(HUB_DATA_DIR, 'theme-assets');
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
// 캐릭터 테마 이미지 (사용자 로컬 폴더). 없으면 404 → 프론트가 알아서 아이콘을 숨긴다.
app.use('/theme-assets', express.static(THEME_ASSETS_DIR, {
  etag: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

const ASSET_EXT_RE = /\.(png|webp|jpe?g|gif|svg)$/i;

// 폴더에 어떤 이미지가 있는지 — 프론트가 테마별로 쓸 파일을 고른다.
app.get('/api/theme-assets', (_req, res) => {
  let files = [];
  try { files = fs.readdirSync(THEME_ASSETS_DIR).filter((f) => ASSET_EXT_RE.test(f)); } catch {}
  res.json({ dir: THEME_ASSETS_DIR, files });
});

// 앱에서 드래그&드롭 / 파일 선택으로 넣은 이미지를 저장.
// body = { name: 'hachiware-icon.png', dataUrl: 'data:image/png;base64,...' }
app.post('/api/theme-assets', (req, res) => {
  const { name, dataUrl } = req.body || {};
  const safe = String(name || '').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe || !ASSET_EXT_RE.test(safe)) return res.status(400).json({ error: '파일명이 올바르지 않습니다 (png/webp/jpg/gif/svg)' });
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return res.status(400).json({ error: '이미지 데이터가 올바르지 않습니다' });
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: '이미지가 너무 큽니다 (8MB 제한)' });
  try {
    fs.mkdirSync(THEME_ASSETS_DIR, { recursive: true });
    fs.writeFileSync(path.join(THEME_ASSETS_DIR, safe), buf);
    res.json({ ok: true, file: safe });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

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

// 파일 끝부분(N바이트)에서 마지막 custom-title / ai-title / 마지막 user 입력 시각을 찾는다
// (제목·마지막 입력은 세션 진행 중 갱신되어 끝에 최신값 위치).
function readTitlesFromTail(file, size) {
  const meta = { customTitle: null, aiTitle: null, lastInputAt: null };
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
      if (obj.type === 'user' && obj.timestamp) meta.lastInputAt = obj.timestamp; // 끝까지 덮어써 마지막 값 유지
    }
  } catch { /* skip */ }
  return meta;
}

function readSessionMeta(file) {
  // 앞부분: cwd + 첫 user 메시지/시각, 뒷부분: 최신 custom-title(/rename) / ai-title / 마지막 입력 시각
  return new Promise((resolve) => {
    const meta = { title: null, summary: null, cwd: null, customTitle: null, aiTitle: null, firstInputAt: null, lastInputAt: null };
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
      if (obj.type === 'user') {
        if (!meta.firstInputAt && obj.timestamp) meta.firstInputAt = obj.timestamp;
        if (!meta.title) {
          const c = obj.message && obj.message.content;
          let text = '';
          if (typeof c === 'string') text = c;
          else if (Array.isArray(c)) text = c.map((x) => (x && x.text) || '').join(' ');
          text = text.replace(/\s+/g, ' ').trim();
          if (text && !text.startsWith('<')) meta.title = text.slice(0, 120);
        }
      }
      if (meta.cwd && meta.firstInputAt && (meta.title || meta.summary) && lines > 3) rl.close();
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
  const isAll = req.query.all === '1';
  const limit = Math.min(isAll ? 500 : 30, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const all = listSessionsScoped(req.query.profile);
  const top = all.slice(0, limit);
  const sessions = await Promise.all(top.map(async (s) => {
    const meta = await getMeta(s.full, s.mtime);
    return {
      id: s.id, title: bestTitle(meta), cwd: meta.cwd || '', mtime: s.mtime, sizeKB: s.sizeKB, profile: s.profile,
      firstInputAt: meta.firstInputAt || null, lastInputAt: meta.lastInputAt || null,
    };
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
  const all = listSessionsScoped(req.query.profile);
  const out = [];
  for (const s of all) {
    const meta = await getMeta(s.full, s.mtime);
    const title = (meta.customTitle || meta.aiTitle || meta.summary || meta.title || '');
    const cwd = meta.cwd || '';
    if (!cwd) continue;
    if (title.toLowerCase().includes(q) || cwd.toLowerCase().includes(q)) {
      out.push({ id: s.id, title: title || '(제목 없음)', cwd, mtime: s.mtime, sizeKB: s.sizeKB, profile: s.profile });
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

// ---- 세션 트랜스크립트를 다른 프로필로 복사 (계정 간 이어가기) ----
// 대화 .jsonl 은 재생 파일이라 대상 프로필로 복사만 하면 해당 계정으로 resume 가능.
// 원본 유지 정책: 원본은 남기고, 대상에 이미 같은 id 가 있으면 덮어쓰지 않는다.
app.post('/api/session/copy', (req, res) => {
  const b = req.body || {};
  const id = (b.id || '').toString();
  const cwd = (b.cwd || '').toString();
  const fromProfile = (b.fromProfile || 'default').toString();
  const toProfile = (b.toProfile || 'default').toString();
  if (!id || !cwd) return res.status(400).json({ error: 'id, cwd 필요' });
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) return res.status(400).json({ error: '잘못된 세션 id' });
  const enc = encodeProjectPath(cwd);
  const src = path.join(projectsDirFor(fromProfile), enc, id + '.jsonl');
  const dstDir = path.join(projectsDirFor(toProfile), enc);
  const dst = path.join(dstDir, id + '.jsonl');
  if (!fs.existsSync(src)) return res.status(404).json({ error: '원본 세션을 찾을 수 없습니다.' });
  if (path.resolve(src) === path.resolve(dst)) return res.json({ ok: true, already: true, id, cwd, profile: toProfile });
  try {
    fs.mkdirSync(dstDir, { recursive: true });
    const exists = fs.existsSync(dst);
    if (!exists) fs.copyFileSync(src, dst); // 원본 유지: 이미 있으면 그대로 이어감
    res.json({ ok: true, copied: !exists, already: exists, id, cwd, profile: toProfile });
  } catch (e) {
    res.status(500).json({ error: '복사 실패: ' + (e.message || 'unknown') });
  }
});

// ---- 로컬 파일 미리보기 서빙 + 아티팩트 판별 ----
// 일반 브라우저처럼 폭넓은 형식을 인라인 렌더. 아티팩트 칩(자동 미리보기)은 아래 ARTIFACT_EXT 만 대상.
const PREVIEW_EXT = {
  // 문서/마크업
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.xhtml': 'application/xhtml+xml',
  '.pdf': 'application/pdf', '.svg': 'image/svg+xml',
  // 이미지
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif', '.apng': 'image/apng',
  // 오디오/비디오 (브라우저 내장 플레이어)
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.oga': 'audio/ogg',
  // 텍스트/코드 (text/plain 으로 브라우저에 그대로 표시)
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8', '.tsx': 'text/plain; charset=utf-8', '.jsx': 'text/plain; charset=utf-8',
  '.xml': 'text/xml; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.tsv': 'text/plain; charset=utf-8',
  '.yml': 'text/plain; charset=utf-8', '.yaml': 'text/plain; charset=utf-8', '.toml': 'text/plain; charset=utf-8',
  '.ini': 'text/plain; charset=utf-8', '.sh': 'text/plain; charset=utf-8', '.py': 'text/plain; charset=utf-8',
  '.rb': 'text/plain; charset=utf-8', '.go': 'text/plain; charset=utf-8', '.rs': 'text/plain; charset=utf-8',
  '.java': 'text/plain; charset=utf-8', '.c': 'text/plain; charset=utf-8', '.h': 'text/plain; charset=utf-8',
  '.cpp': 'text/plain; charset=utf-8', '.sql': 'text/plain; charset=utf-8', '.conf': 'text/plain; charset=utf-8',
};
// 아티팩트 자동 미리보기(칩) 대상 — Claude 산출물로 열어볼 만한 형식만
const ARTIFACT_EXT = new Set(['.html', '.htm', '.md', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf', '.json', '.css', '.js']);
function isPreviewable(p) { return ARTIFACT_EXT.has(path.extname(String(p)).toLowerCase()); }

// 확장자 매핑에 없으면 앞부분을 읽어 텍스트인지 판별 → 텍스트면 그대로 표시, 아니면 다운로드
function sniffContentType(p) {
  const ext = path.extname(p).toLowerCase();
  if (PREVIEW_EXT[ext]) return PREVIEW_EXT[ext];
  try {
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    const slice = buf.subarray(0, n);
    // NUL 바이트가 있으면 바이너리로 간주
    if (slice.includes(0)) return 'application/octet-stream';
    return 'text/plain; charset=utf-8';
  } catch { return 'application/octet-stream'; }
}

app.get('/api/file', (req, res) => {
  const p = (req.query.path || '').toString();
  if (!p) return res.status(400).send('path 필요');
  let st; try { st = fs.statSync(p); } catch { return res.status(404).send('파일 없음'); }
  if (!st.isFile()) return res.status(400).send('파일 아님');
  const ct = sniffContentType(p);
  res.setHeader('Content-Type', ct);
  // 브라우저 탭처럼 렌더러가 처리(다운로드 강제 X). 렌더 못하는 형식만 저장 대화상자로.
  res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(path.basename(p)) + '"');
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

// ---- 세션 뷰어: jsonl 트랜스크립트 파싱 ----
function toolPreview(name, input) {
  if (!input || typeof input !== 'object') return '';
  if (name === 'Task') return (input.subagent_type ? `[${input.subagent_type}] ` : '') + (input.description || input.prompt || '').toString().slice(0, 160);
  if (input.file_path) return String(input.file_path);
  if (input.path) return String(input.path);
  if (input.command) return String(input.command).slice(0, 160);
  if (input.pattern) return String(input.pattern).slice(0, 160);
  if (input.url) return String(input.url);
  const k = Object.keys(input)[0];
  return k ? `${k}: ${String(input[k]).slice(0, 120)}` : '';
}
function parseTranscript(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/);
  const items = [];
  for (const ln of lines) {
    if (!ln) continue;
    let o; try { o = JSON.parse(ln); } catch { continue; }
    const t = o.type;
    if (t !== 'user' && t !== 'assistant') continue;
    const msg = o.message || {};
    const role = msg.role || t;
    let content = msg.content;
    if (typeof content === 'string') content = [{ type: 'text', text: content }];
    if (!Array.isArray(content)) continue;
    const texts = [], tools = [], results = [];
    for (const b of content) {
      if (typeof b === 'string') { texts.push(b); continue; }
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text' && b.text) texts.push(b.text);
      else if (b.type === 'tool_use') tools.push({ name: b.name || 'tool', preview: toolPreview(b.name, b.input), isTask: b.name === 'Task' });
      else if (b.type === 'tool_result') {
        let rc = b.content;
        if (Array.isArray(rc)) rc = rc.map((x) => (x && x.type === 'text' ? x.text : (typeof x === 'string' ? x : ''))).join('\n');
        results.push(String(rc == null ? '' : rc).slice(0, 3000));
      }
    }
    const text = texts.join('\n').trim();
    if (role === 'user' && !text && results.length) {
      for (const r of results) items.push({ role: 'tool_result', text: r });
      continue;
    }
    if (!text && !tools.length) continue;
    items.push({ role, text, tools });
  }
  return items.slice(-500); // 상한 (오래된 것부터 잘라 최근 500개)
}
app.get('/api/transcript', (req, res) => {
  const key = String(req.query.key || '');
  const s = ptyStore.get(key);
  if (!s || !s.watch || !s.watch.file || !fs.existsSync(s.watch.file)) return res.json({ ready: false, items: [] });
  try { res.json({ ready: true, items: parseTranscript(s.watch.file) }); }
  catch (e) { res.json({ ready: false, items: [], error: String((e && e.message) || e) }); }
});

// 세션 전체에서 Claude 가 만들고/고친 파일(아티팩트) 목록 — 마지막 것만이 아니라 전부
app.get('/api/artifacts', (req, res) => {
  const key = String(req.query.key || '');
  const s = ptyStore.get(key);
  if (!s || !s.watch || !s.watch.file || !fs.existsSync(s.watch.file)) return res.json({ ready: false, files: [] });
  try {
    const text = fs.readFileSync(s.watch.file, 'utf8');
    res.json({ ready: true, files: extractArtifacts(text).reverse() }); // 최근에 손댄 파일이 위로
  } catch (e) {
    res.json({ ready: false, files: [], error: String((e && e.message) || e) });
  }
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

// 영속 PTY 세션 저장소 (key -> session). ws 가 끊겨도 pty 는 유지 → 재연결 시 재부착(reattach).
// 실제 종료는 클라이언트가 패널 X 로 보내는 {type:'kill'} 또는 프로세스 자체 exit 시에만.
const ptyStore = new Map();
const MAX_BUF = 256 * 1024; // 재부착 시 재생할 최근 출력 버퍼 상한
function broadcast(session, str) {
  for (const c of session.subs) { if (c.readyState === c.OPEN) { try { c.send(str); } catch {} } }
}
function broadcastJson(session, obj) { broadcast(session, JSON.stringify(obj)); }
function stopWatch(session) {
  const w = session.watch;
  if (w.file) { try { fs.unwatchFile(w.file); } catch {} w.file = null; }
  if (w.discoverIv) { clearInterval(w.discoverIv); w.discoverIv = null; }
}
function beginWatch(session, jsonl, isResume) {
  const w = session.watch;
  w.file = jsonl; w.isResume = isResume;
  try { w.pos = fs.statSync(jsonl).size; } catch { w.pos = 0; }
  fs.watchFile(jsonl, { interval: 1200 }, (curr) => {
    if (curr.size <= w.pos) { w.pos = curr.size; return; }
    let delta = '';
    try {
      const fd = fs.openSync(jsonl, 'r');
      const len = curr.size - w.pos;
      const b = Buffer.alloc(len);
      fs.readSync(fd, b, 0, len, w.pos);
      fs.closeSync(fd);
      delta = b.toString('utf8');
    } catch { w.pos = curr.size; return; }
    w.pos = curr.size;
    if (w.isResume) broadcastJson(session, { type: 'changed' });
    for (const a of extractArtifacts(delta)) broadcastJson(session, { type: 'artifact', path: a.path, tool: a.tool });
  });
}
function startWatch(session) {
  const dir = path.join(projectsDirFor(session.profile), encodeProjectPath(session.cwd || os.homedir()));
  if (session.resumeId) {
    const jf = path.join(dir, session.resumeId + '.jsonl');
    if (fs.existsSync(jf)) beginWatch(session, jf, true);
    return;
  }
  const startT = Date.now();
  let tries = 0;
  session.watch.discoverIv = setInterval(() => {
    tries++;
    let newest = null, newestM = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        const st = fs.statSync(path.join(dir, f));
        if (st.mtimeMs > newestM) { newestM = st.mtimeMs; newest = path.join(dir, f); }
      }
    } catch {}
    if (newest && newestM >= startT - 3000) { clearInterval(session.watch.discoverIv); session.watch.discoverIv = null; beginWatch(session, newest, false); }
    else if (tries > 15) { clearInterval(session.watch.discoverIv); session.watch.discoverIv = null; }
  }, 800);
}
function killSession(key) {
  const s = ptyStore.get(key);
  if (!s) return;
  stopWatch(s);
  try { s.term.kill(); } catch {}
  ptyStore.delete(key);
}

wss.on('connection', (ws) => {
  let boundKey = null;
  const safeSend = (obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; }); // 프로토콜 레벨 keepalive (죽은 소켓 정리용)

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'ping') { ws.isAlive = true; safeSend({ type: 'pong' }); return; } // 앱 레벨 하트비트 (좀비 소켓 감지)

    if (msg.type === 'init') {
      const key = String(msg.key || ('auto_' + Date.now() + '_' + Math.random().toString(36).slice(2)));
      const cols = Math.max(2, msg.cols | 0) || 80;
      const rows = Math.max(1, msg.rows | 0) || 24;
      const existing = ptyStore.get(key);
      if (existing && !existing.exited) {
        // 재부착: 살아있는 세션에 다시 붙는다 (claude 그대로 유지, 재시작 아님)
        boundKey = key;
        existing.subs.add(ws);
        safeSend({ type: 'ready', pid: existing.term.pid, cwd: existing.cwd, reattached: true });
        if (existing.buf) { try { ws.send(existing.buf); } catch {} } // 최근 화면 재생 → 재부착 클라이언트 상태 복원
        try { existing.term.resize(cols, rows); } catch {}
        return;
      }
      // 신규 세션 생성
      const cwd = (msg.cwd || '').trim();
      let term;
      try { term = spawnShell(cwd, cols, rows, msg.profile); }
      catch (err) { safeSend({ type: 'error', message: `PTY 생성 실패: ${err.message}` }); return; }
      const session = {
        key, term, cwd: cwd || os.homedir(), profile: msg.profile, resumeId: msg.resumeId,
        buf: '', subs: new Set([ws]), exited: false, watch: { file: null, pos: 0, isResume: false, discoverIv: null },
      };
      ptyStore.set(key, session);
      boundKey = key;
      term.onData((data) => {
        session.buf += data;
        if (session.buf.length > MAX_BUF) session.buf = session.buf.slice(-MAX_BUF);
        broadcast(session, data);
      });
      term.onExit(({ exitCode }) => { session.exited = true; broadcastJson(session, { type: 'exit', code: exitCode }); stopWatch(session); ptyStore.delete(key); });
      safeSend({ type: 'ready', pid: term.pid, cwd: session.cwd });
      let cmd = null;
      if (msg.resumeId) cmd = `claude --resume ${msg.resumeId}`;
      else if (msg.runClaude) cmd = (msg.command && msg.command.trim()) || 'claude';
      if (cmd) setTimeout(() => { try { term.write(`${cmd}\r`); } catch {} }, 400);
      startWatch(session);
      return;
    }

    const s = boundKey ? ptyStore.get(boundKey) : null;
    if (!s || s.exited) return;
    if (msg.type === 'input') { try { s.term.write(msg.data); } catch {} }
    else if (msg.type === 'resize') { try { s.term.resize(Math.max(2, msg.cols | 0) || 80, Math.max(1, msg.rows | 0) || 24); } catch {} }
    else if (msg.type === 'kill') { killSession(boundKey); } // 사용자가 패널 종료 → 실제 pty 종료
  });

  // ws 가 끊겨도 pty 는 죽이지 않는다 (재부착 대비). 구독만 해제.
  ws.on('close', () => {
    if (boundKey) { const s = ptyStore.get(boundKey); if (s) s.subs.delete(ws); }
  });
});

// 프로토콜 ping 으로 좀비 소켓 감지 → 정리(구독 해제). pty 자체는 유지(재부착 대비).
const wssHeartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) { try { ws.terminate(); } catch {} return; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, 15000);
wss.on('close', () => clearInterval(wssHeartbeat));

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

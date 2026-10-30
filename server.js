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
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const petPack = require('./lib/pet-pack');
const pastedImages = require('./lib/pasted-images');
const claudeRegistry = require('./lib/claude-registry');
const activity = require('./lib/activity');
const subagents = require('./lib/subagents');
const sharedConfig = require('./lib/shared-config');
const usageLimit = require('./lib/usage-limit');
const mcpConfig = require('./lib/mcp-config');
const { planOf } = require('./lib/account-plan');
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
// 메인 계정 폴더 — 설정·에이전트·스킬·대화 기록은 모든 계정이 이것 하나를 같이 쓴다(lib/shared-config.js).
const MAIN_CONFIG_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(MAIN_CONFIG_DIR, 'projects');
const PROFILES_ROOT = path.join(os.homedir(), '.claude-hub-profiles');

// 프로필(계정)별 CLAUDE_CONFIG_DIR. 'default'/빈값이면 기본 ~/.claude 사용(null 반환).
// 계정 폴더에 남는 것은 로그인(.credentials.json · .claude.json)과 실행 중 세션 등록부(sessions/)뿐이다.
function configDirFor(profileId) {
  if (!profileId || profileId === 'default') return null;
  const safe = String(profileId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(PROFILES_ROOT, safe);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}
// 대화 기록은 계정과 무관하게 한 곳 — 어느 계정으로 --resume 해도 같은 파일에 이어 쌓인다
function projectsDirFor() {
  return PROJECTS_DIR;
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
// 모든 세션(최신순). profile 은 «마지막으로 이 대화를 돌린 계정» — 허브에서 연 적 없으면 null.
function listSessionsScoped() {
  const last = readState().sessionAccounts || {};
  return listAllSessions(PROJECTS_DIR)
    .map((s) => ({ ...s, profile: last[s.id] || null }))
    .sort((a, b) => b.mtime - a.mtime);
}
// 대화를 어느 계정으로 돌렸는지 남긴다(세션 목록의 계정 칩). 오래된 것부터 잘라 상한을 둔다.
const SESSION_ACCOUNTS_MAX = 2000;
function rememberSessionAccount(id, profile) {
  if (!id) return;
  const s = readState();
  const map = s.sessionAccounts || {};
  const p = profile || 'default';
  if (map[id] === p) return;
  delete map[id];
  map[id] = p;
  const keys = Object.keys(map);
  for (const k of keys.slice(0, Math.max(0, keys.length - SESSION_ACCOUNTS_MAX))) delete map[k];
  s.sessionAccounts = map;
  writeState(s);
}

// ---- 계정 폴더를 공유 구조로 맞추기 (lib/shared-config.js) ----
// 계정 폴더 안의 projects·agents·skills… 를 메인으로 가는 연결로 바꾸고, 이미 쌓인 내용은 메인으로 합친다.
// 그 계정의 claude 가 돌고 있으면 파일을 옮기는 도중에 쓰일 수 있으므로 건너뛰고 다음 기회에 한다.
const MERGE_BACKUP_DIR = path.join(os.homedir(), '.claude-terminal-hub', 'merge-backup');
let pendingMergeReport = null; // 첫 화면에서 한 번 알린다(/api/state)
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
// 등록부의 pid 가 아직 claude 인가. 강제 종료된 claude 는 등록부 파일을 못 지우고, Windows 는 pid 를 금방 다시 쓴다 —
// 살아 있기만 하면 엉뚱한 프로세스를 claude 로 볼 수 있어 실행 파일 이름까지 확인한다.
function isClaudeProcess(pid) {
  if (!pidAlive(pid)) return false;
  try {
    const out = IS_WIN
      ? execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { timeout: 4000, windowsHide: true, encoding: 'utf8' })
      : execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { timeout: 4000, encoding: 'utf8' });
    return /claude|node|bun/i.test(out);
  } catch { return false; }
}
function liveClaudeIn(sessionsDir) {
  return claudeRegistry.readEntries(sessionsDir).filter((e) => isClaudeProcess(e.pid));
}
const SHARED_BASE_DIR = path.join(os.homedir(), '.claude-terminal-hub', 'shared-base'); // 계정에 복사한 파일의 마지막 사본
function addMergeReport(r) {
  if (!r.moved && !r.conflicts.length) return;
  const prev = pendingMergeReport || { moved: 0, conflicts: [], backups: [] };
  pendingMergeReport = {
    moved: prev.moved + r.moved,
    conflicts: [...prev.conflicts, ...r.conflicts],
    backups: r.backup && !prev.backups.includes(r.backup) ? [...prev.backups, r.backup] : prev.backups,
  };
}
// 패널을 열 때마다 부른다 — 이미 맞춘 것은 건너뛰고 메인에 새로 생긴 스킬 항목만 잇는다.
// 대화 폴더(projects)가 메인으로 이어져 있으면 true. 나머지 폴더 실패는 경고만 하고 패널은 연다.
const sharedWarned = new Set();
function ensureShared(profileId) {
  const dir = configDirFor(profileId);
  if (!dir) return true;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const r = sharedConfig.linkProfile(dir, MAIN_CONFIG_DIR, {
    backupDir: path.join(MERGE_BACKUP_DIR, `${path.basename(dir)}-${stamp}`),
    baseDir: path.join(SHARED_BASE_DIR, path.basename(dir)),
    // 계정 쪽 실제 폴더를 옮겨야 할 때만 확인한다 — 그 계정 claude 가 돌고 있으면 쓰는 중인 파일을 옮기게 된다
    canMove: () => !liveClaudeIn(path.join(dir, 'sessions')).length,
  });
  addMergeReport(r);
  const warn = [...r.errors, ...r.pending.map((p) => `${p}: 그 계정 claude 가 돌고 있어 다음에 맞춤`), ...r.kept.map((k) => `${k}: 계정에서 바꾼 파일이라 메인 것으로 덮지 않음`)];
  const sig = profileId + warn.join('|');
  if (warn.length && !sharedWarned.has(sig)) { sharedWarned.add(sig); console.warn(`[공유] ${profileId}:`, warn.join(' / ')); }
  return r.projectsReady;
}

// 계정 목록에서 뺀 계정 폴더 — 그 대화가 세션 목록에서 사라지지 않게 메인으로 한 번 복사해 온다.
// 폴더를 허브 밖 도구가 따로 쓸 수 있어 옮기거나 연결하지 않는다. 한 번 가져온 폴더는 다시 보지 않는다.
const ORPHAN_IMPORT_FILE = path.join(os.homedir(), '.claude-terminal-hub', 'imported-profile-dirs.json');
function importOrphanProfiles() {
  let done = {};
  try { done = JSON.parse(fs.readFileSync(ORPHAN_IMPORT_FILE, 'utf8')) || {}; } catch { /* 처음 */ }
  const known = new Set(allProfileIds().map((id) => path.basename(configDirFor(id) || '')));
  let names = [];
  try { names = fs.readdirSync(PROFILES_ROOT); } catch { return; }
  for (const name of names) {
    const dir = path.join(PROFILES_ROOT, name);
    if (known.has(name) || done[name]) continue;
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      if (liveClaudeIn(path.join(dir, 'sessions')).length) continue; // 돌고 있으면 다음에
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backup = path.join(MERGE_BACKUP_DIR, `${name}-unlisted-${stamp}`, 'projects');
      const r = sharedConfig.importProjects(path.join(dir, 'projects'), PROJECTS_DIR, backup);
      addMergeReport({ ...r, backup: r.conflicts.length ? path.dirname(backup) : null });
      done[name] = new Date().toISOString();
    } catch (e) { console.error(`[공유] 목록 밖 계정 폴더 ${name} 가져오기 실패:`, e.message); }
  }
  try { fs.writeFileSync(ORPHAN_IMPORT_FILE, JSON.stringify(done, null, 2)); } catch { /* 다음에 다시 */ }
}

// 계정 쪽 claude 에 메인 settings·MCP 를 같이 넘기는 플래그. settings.json · .claude.json 은
// 파일이라 폴더 연결로 공유되지 않는다(.claude.json 은 로그인 정보와 한 파일이라 연결하면 안 된다).
// MCP 는 사용자 범위 + 그 작업 경로의 프로젝트 범위를 작업 경로별 파일로 넘긴다(lib/mcp-config.js).
const SHARED_MCP_DIR = path.join(os.homedir(), '.claude-terminal-hub', 'shared-mcp');
try { fs.unlinkSync(path.join(os.homedir(), '.claude-terminal-hub', 'shared-mcp.json')); } catch { /* v1.27 의 한 파일짜리 — 없으면 그만 */ }
function quoteArg(s) {
  return IS_WIN ? `'${String(s).replace(/'/g, "''")}'` : `'${String(s).replace(/'/g, `'\\''`)}'`;
}
function sharedClaudeFlags(profileId, cwd) {
  if (!configDirFor(profileId)) return '';
  const flags = [];
  const settings = path.join(MAIN_CONFIG_DIR, 'settings.json');
  if (fs.existsSync(settings)) flags.push('--settings', quoteArg(settings));
  try {
    const mcpFile = mcpConfig.writeMcpConfig(path.join(os.homedir(), '.claude.json'), cwd, SHARED_MCP_DIR);
    if (mcpFile) flags.push('--mcp-config', quoteArg(mcpFile));
  } catch (e) { console.error('[공유] MCP 설정 파일 저장 실패:', e.message); }
  return flags.join(' ');
}
function withSharedFlags(cmd, profileId, cwd) {
  const flags = sharedClaudeFlags(profileId, cwd);
  return flags ? cmd.replace(/^claude(?=\s|$)/, `claude ${flags}`) : cmd;
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

// ---- 터미널 셸 설정 ----
// Windows: 'powershell' 만   macOS/Linux: 'powershell'(=$SHELL, 기본) | 'tmux'
// Windows 의 tmux 는 v1.18.0 에서 MSYS2 것을, v1.27.0 에서 WSL 것까지 뺐다 — 예전 설정은 PowerShell 로 연다.
const SHELL_KINDS = IS_WIN ? ['powershell'] : ['powershell', 'tmux'];
function readShellSettings() {
  const st = readState().settings || {};
  return { shell: SHELL_KINDS.includes(st.shell) ? st.shell : 'powershell' };
}
// 패널 key -> tmux 세션 이름. 같은 key 로 다시 열면 -A 가 그 세션에 재부착한다.
function tmuxSessionName(key) {
  return 'hub-' + String(key || 'main').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 48);
}
// 이미 살아 있는 tmux 세션인가. 허브를 재시작하면 ptyStore 는 비어 있어도
// tmux 세션은 남아 있다 — 그 경우 claude 를 다시 타이핑하면 안 되므로 미리 확인한다.
function tmuxHasSession(name) {
  try {
    execFileSync('tmux', ['has-session', '-t', name], { timeout: 4000, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

// ---- 요청 출처 검사 ----
// 서버는 127.0.0.1 에만 열리지만, 브라우저로 연 아무 웹페이지나 localhost 로 요청을 보낼 수 있다.
// 허브 화면(같은 출처)과 Origin 을 안 붙이는 도구(curl·Electron 내부 요청)만 받는다.
const ALLOWED_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
function originAllowed(origin) {
  return !origin || ALLOWED_ORIGINS.has(String(origin));
}
app.use((req, res, next) => {
  if (originAllowed(req.headers.origin)) return next();
  res.status(403).json({ error: '허용되지 않은 출처' });
});

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

// ---- 입력창에 붙여넣은 이미지 — 파일로 저장하고 경로를 돌려준다(Claude 가 경로로 읽는다) ----
const PASTED_DIR = path.join(HUB_DATA_DIR, 'pasted');
app.post('/api/paste-image', (req, res) => {
  try {
    res.json({ ok: true, path: pastedImages.savePasted(PASTED_DIR, (req.body || {}).dataUrl) });
  } catch (e) {
    res.status(400).json({ error: String((e && e.message) || e) });
  }
});

// ---- 펫 팩 — 모두 사용자 PC 에만 둔다(저작권: 저장소·설치파일에 넣지 않는다) ----
//   pet-packs/<id>/      : 펫 설정에서 «팩 폴더 가져오기» 로 복사해 온 팩
//   theme-packs/<테마키>/ : 캐릭터 테마 전용 펫 — 폴더째 넣어 두면 그 테마에서 자동으로 쓴다. 없으면 기본 펫.
const PET_PACKS_DIR = path.join(HUB_DATA_DIR, 'pet-packs');
const THEME_PACKS_DIR = path.join(HUB_DATA_DIR, 'theme-packs');
app.use('/pet-packs', express.static(PET_PACKS_DIR, {
  etag: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));
app.use('/theme-packs', express.static(THEME_PACKS_DIR, {
  etag: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));
app.get('/api/pet-packs', (_req, res) => {
  res.json({ dir: PET_PACKS_DIR, themeDir: THEME_PACKS_DIR, packs: petPack.listAvailablePacks(PET_PACKS_DIR, THEME_PACKS_DIR) });
});
// body = { path: '<manifest.json 이 든 팩 폴더 절대경로>' } — 펫에 폴더를 끌어다 놓거나 골랐을 때
app.post('/api/pet-packs/import', (req, res) => {
  const src = String((req.body && req.body.path) || '').trim();
  if (!src || !path.isAbsolute(src)) return res.status(400).json({ error: '팩 폴더의 전체 경로가 필요합니다' });
  try {
    res.json({ ok: true, pack: petPack.importPack(src, PET_PACKS_DIR) });
  } catch (e) {
    res.status(400).json({ error: String((e && e.message) || e) });
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
  res.json({
    names: s.names || {},
    profiles: (s.profiles && s.profiles.length) ? s.profiles : [{ id: 'default', name: '기본' }],
    settings: { ...readShellSettings(), platform: process.platform },
    merge: takeMergeReport(),
  });
});
// 계정 폴더를 합친 결과 — 한 번만 알린다
function takeMergeReport() {
  const r = pendingMergeReport;
  pendingMergeReport = null;
  return r;
}
// 터미널 셸 설정 저장 — 다음에 여는 세션부터 적용된다(이미 떠 있는 세션은 그대로).
app.post('/api/settings', (req, res) => {
  const { shell } = req.body || {};
  if (shell && !SHELL_KINDS.includes(shell)) {
    return res.status(400).json({ error: 'shell 은 ' + SHELL_KINDS.join(' / ') + ' 중 하나여야 합니다' });
  }
  const s = readState(); s.settings = s.settings || {};
  if (shell) s.settings.shell = shell;
  delete s.settings.wslDistro;
  writeState(s);
  res.json({ ok: true, settings: readShellSettings() });
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

// 프로필(계정) 로그인 정보 — .claude.json 의 oauthAccount + 플랜(토큰은 넘기지 않는다)
function readJsonOrNull(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
app.get('/api/account', (req, res) => {
  const j = readJsonOrNull(accountFileFor(req.query.profile));
  const a = j && j.oauthAccount;
  if (!a || !a.emailAddress) return res.json({ loggedIn: false });
  const credentials = readJsonOrNull(path.join(configDirFor(req.query.profile) || MAIN_CONFIG_DIR, '.credentials.json'));
  res.json({ loggedIn: true, email: a.emailAddress, org: a.organizationUuid || null, plan: planOf(credentials, a) });
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
    hasSessions: fs.existsSync(path.join(projectsDirFor(), encodeProjectPath(target))),
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
    // rl.close() 는 readline 만 닫고 아래 파일 스트림은 열린 채 둔다 — 직접 닫지 않으면
    // 호출마다 파일 핸들이 하나씩 남아 결국 EMFILE 로 새 PTY 조차 못 연다.
    const done = () => { stream.destroy(); resolve(meta); };
    rl.on('close', done);
    rl.on('error', done);
    stream.on('error', done);
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
  const all = listSessionsScoped();
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
  const all = listAllSessions(projectsDirFor()).sort((a, b) => b.mtime - a.mtime);
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
  const all = listSessionsScoped();
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

// ---- 업데이트 팝오버용: 버전별 주요 변경 2~3줄 ----
// 릴리즈 본문은 CI 가 "Automated build" 로만 채우므로 CHANGELOG.md 가 원천이다.
// 새 버전의 내용은 아직 설치본에 없으니 공개 저장소의 main 을 먼저 보고, 안 되면 설치본에 든 것을 쓴다.
const CHANGELOG_URL = 'https://raw.githubusercontent.com/Lee-Hyeonji99/claude-terminal-hub/main/CHANGELOG.md';
const CHANGELOG_KIND = { Added: '추가', Fixed: '수정', Changed: '변경', Removed: '제거', Notes: '참고' };
let changelogCache = { at: 0, text: null };
async function loadChangelog() {
  if (changelogCache.text && Date.now() - changelogCache.at < 10 * 60 * 1000) return changelogCache.text;
  try {
    const r = await fetch(CHANGELOG_URL, { signal: AbortSignal.timeout(4000) });
    if (r.ok) { changelogCache = { at: Date.now(), text: await r.text() }; return changelogCache.text; }
  } catch { /* 오프라인 → 설치본 */ }
  try { return fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8'); } catch { return ''; }
}
function changelogHighlights(md, version, limit) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return [];
  const out = [];
  let kind = '';
  for (let i = start + 1; i < lines.length && !lines[i].startsWith('## ') && out.length < limit; i++) {
    const h = /^### (\w+)/.exec(lines[i]);
    if (h) { kind = CHANGELOG_KIND[h[1]] || h[1]; continue; }
    const m = /^- (.+)$/.exec(lines[i]); // 들여쓴 하위 항목은 건너뛴다 — 맨 위 줄만 요약으로 쓴다
    if (!m) continue;
    const bold = /\*\*(.+?)\*\*/.exec(m[1]);
    let text = (bold ? bold[1] : m[1]).replace(/`/g, '').replace(/\[(.+?)\]\(.+?\)/g, '$1').replace(/[:：]\s*$/, '').trim();
    if (text.length > 80) text = text.slice(0, 79) + '…';
    out.push({ kind, text });
  }
  return out;
}
app.get('/api/changelog', async (req, res) => {
  const version = (req.query.version || '').toString().replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) return res.status(400).json({ error: 'version(x.y.z) 필요' });
  const items = changelogHighlights(await loadChangelog(), version, 3);
  res.json({ version, items });
});

app.get('/api/sessions', async (req, res) => {
  const target = (req.query.path || '').toString().trim();
  if (!target) return res.status(400).json({ error: 'path 필요' });
  const dir = path.join(projectsDirFor(), encodeProjectPath(target));
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
    const meta = await getMeta(s.full, s.mtime);
    return {
      id: s.id,
      title: bestTitle(meta),
      mtime: s.mtime,
      sizeKB: Math.round(s.size / 1024),
    };
  }));
  res.json({ path: target, encoded: encodeProjectPath(target), total: withStat.length, sessions });
});

// Claude 세션 ID 는 UUID 다. 셸에 그대로 치는 값이라 형식이 맞는 것만 받는다.
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function sessionFile(cwd, id) {
  return path.join(projectsDirFor(), encodeProjectPath(cwd || os.homedir()), id + '.jsonl');
}

// ---- 패널 제목 갱신용: 세션 하나의 지금 제목 ----
// 허브에서 붙인 이름 > /rename(custom-title) > ai-title > 첫 메시지. 대화가 아직 없으면 title=null.
app.get('/api/session-title', async (req, res) => {
  const id = (req.query.id || '').toString();
  const cwd = (req.query.cwd || '').toString().trim();
  if (!SESSION_ID_RE.test(id) || !cwd) return res.status(400).json({ error: 'id(UUID), cwd 필요' });
  const named = (readState().names || {})[id];
  if (named) return res.json({ id, title: named, exists: true });
  const file = sessionFile(cwd, id);
  let st; try { st = fs.statSync(file); } catch { return res.json({ id, title: null, exists: false }); }
  // 패널마다 5초 간격으로 불린다 — 파일이 그대로면 캐시로 답해 큰 대화 파일을 매번 다시 읽지 않는다.
  const meta = await getMeta(file, st.mtimeMs);
  res.json({ id, title: meta.customTitle || meta.aiTitle || meta.summary || meta.title || null, exists: true });
});

// ---- 로컬 파일 미리보기 서빙 ----
// 일반 브라우저처럼 폭넓은 형식을 인라인 렌더.
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
    const ts = o.timestamp || null;   // 메신저 뷰에서 시각 표시용
    if (role === 'user' && !text && results.length) {
      for (const r of results) items.push({ role: 'tool_result', text: r, ts });
      continue;
    }
    if (!text && !tools.length) continue;
    items.push({ role, text, tools, ts });
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
// 다른 웹페이지가 터미널에 붙지 못하게 — 허브 화면에서 온 연결만 받는다
const wss = new WebSocketServer({ server, path: '/pty', verifyClient: (info) => originAllowed(info.origin) });

// 허브가 claude 세션 안에서 실행되더라도 spawn 되는 claude 가 '중첩 자식 세션'으로
// 오작동하지 않도록 CLAUDE_CODE_* 마커를 제거한 깨끗한 env 를 만든다.
function cleanEnv(profileId) {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '1' };
  delete env.NO_COLOR; // 허브 프로세스 자체가 NO_COLOR 환경(예: 에이전트 셸)에서 떠도 자식 셸 색은 항상 켠다
  for (const k of Object.keys(env)) {
    if (/^CLAUDE_CODE/i.test(k) || k === 'CLAUDECODE') delete env[k];
  }
  // 허브를 띄운 셸의 계정 폴더 지정을 물려받지 않는다 — 기본 계정은 항상 ~/.claude
  delete env.CLAUDE_CONFIG_DIR;
  const cfgDir = configDirFor(profileId);
  if (cfgDir) env.CLAUDE_CONFIG_DIR = cfgDir; // 프로필(계정)별 로그인/설정 분리
  return env;
}

function spawnShell(cwd, cols, rows, profileId, key) {
  const env = cleanEnv(profileId);
  const workdir = cwd && cwd.trim() ? cwd : os.homedir();
  const { shell: pref } = readShellSettings();
  let shell, args, reattachedTmux = false;

  if (pref === 'tmux') {
    // macOS/Linux 의 시스템 tmux. -A: 같은 이름의 세션이 있으면 붙는다(허브 재시작 후에도 세션 생존).
    // -u: LANG 에서 UTF-8 을 못 보면 한글이 '_' 로 바뀌는 것을 막는다.
    const name = tmuxSessionName(key);
    reattachedTmux = tmuxHasSession(name); // 붙는 것인지 새로 만드는 것인지
    shell = 'tmux';
    args = ['-u', 'new-session', '-A', '-s', name, '-c', workdir];
  } else {
    shell = IS_WIN ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
    args = IS_WIN ? ['-NoLogo', '-NoExit'] : [];
  }

  const term = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: Math.max(20, cols | 0) || 80,
    rows: Math.max(5, rows | 0) || 24,
    cwd: workdir,
    env,
    // ConPTY 사용(TUI/claude 렌더·리사이즈 정확). 과거 'AttachConsole failed' 크래시는
    // process.on('uncaughtException') 가드로 서버 전체가 죽지 않도록 흡수한다.
    useConpty: IS_WIN ? true : undefined,
  });
  // 패널을 X 로 닫을 때 tmux 세션까지 정리하기 위해 이름을 들고 있는다(§killSession).
  if (pref === 'tmux') {
    term.tmuxName = tmuxSessionName(key);
    // 살아 있던 tmux 세션에 붙은 것이면 claude 가 이미 그 안에서 돌고 있다.
    // 여기서 또 'claude' 를 타이핑하면 실행 중인 TUI 에 글자가 박힌다.
    term.tmuxReattached = reattachedTmux;
  }
  return term;
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
  if (w.subIv) { clearInterval(w.subIv); w.subIv = null; }
  session.subagents = [];
}
// HUD 서브에이전트 — 세션 기록 옆 subagents 폴더를 주기적으로 훑어 바뀔 때만 보낸다
const SUBAGENT_POLL_MS = 1500;
function watchSubagents(session, jsonl) {
  const w = session.watch;
  if (w.subIv) clearInterval(w.subIv);
  const cache = new Map();   // 파일이 그대로면 다시 읽지 않는다
  let last = null;           // 처음 한 번은 꼭 보낸다(세션이 바뀌었거나 서버가 새로 떴을 때 옛 목록 지우기)
  w.subIv = setInterval(() => {
    try {
      const list = subagents.scanSubagents(jsonl, { cache });
      const json = JSON.stringify(list);
      if (json === last) return;
      last = json;
      session.subagents = list;
      broadcastJson(session, { type: 'subagents', list });
    } catch { /* 파일 하나가 깨져도 다음 주기에 다시 */ }
  }, SUBAGENT_POLL_MS);
}
function beginWatch(session, jsonl, isResume) {
  const w = session.watch;
  w.file = jsonl; w.isResume = isResume;
  watchSubagents(session, jsonl);
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
    // HUD «무슨 일 하는 중» — 마지막 도구 사용(또는 새 턴 시작)
    const act = activity.lastActivity(delta);
    if (act) { session.activity = { ...act, at: Date.now() }; broadcastJson(session, { type: 'activity', ...session.activity }); }
    // 한도로 멈춘 응답이 기록에 붙었다 — 화면 문구가 바뀌어도 이건 확실하다
    if (usageLimit.transcriptHitLimit(delta)) notifyUsageLimit(session);
  });
}
function startWatch(session) {
  const dir = path.join(projectsDirFor(), encodeProjectPath(session.cwd || os.homedir()));
  if (session.resumeId) {
    const jf = path.join(dir, session.resumeId + '.jsonl');
    // --session-id 로 연 세션은 첫 메시지 전엔 파일이 없다. watchFile 은 없는 파일도 생기면 잡는다.
    if (session.freshId) beginWatch(session, jf, false);
    else if (fs.existsSync(jf)) beginWatch(session, jf, true);
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
// 세션에서 칠 claude 명령. 새 대화도 ID 를 미리 정해(--session-id) 나중에 --resume 으로 이어갈 수 있게 한다.
// session.resumeId / session.freshId 를 채운다(감시 대상 파일을 정하는 데 쓴다).
const CLAUDE_SESSION_FLAG_RE = /\s(-r|--resume|-c|--continue|--session-id|-p|--print)(\s|=|$)/;
// 계정 쪽이면 메인 settings·MCP 플래그를 붙인다
function buildClaudeCommand(msg, session) {
  const cmd = buildBaseCommand(msg, session);
  return cmd ? withSharedFlags(cmd, session.profile, session.cwd) : cmd;
}
function buildBaseCommand(msg, session) {
  const id = msg.resumeId ? String(msg.resumeId) : '';
  if (id && SESSION_ID_RE.test(id)) {
    const exists = fs.existsSync(sessionFile(session.cwd, id));
    // 다른 곳에서 열려 있는 대화를 갈라서 연다 — 지금까지의 대화를 복사한 새 세션 ID 가 생긴다(등록부로 따라감)
    if (msg.fork && exists) { session.forkOf = id; return `claude --resume ${id} --fork-session`; }
    // 갈라 열려는데 아직 대화가 한 줄도 없다 — 복사할 게 없으니 새 ID 의 빈 대화로 연다(같은 ID 를 두 곳에서 쓰지 않게)
    if (msg.fork) { session.resumeId = crypto.randomUUID(); session.freshId = true; return `claude --session-id ${session.resumeId}`; }
    // 대화가 한 번도 오가지 않은 세션은 기록 파일이 없어 --resume 이 실패한다 — 같은 ID 로 새로 연다.
    if (exists) return `claude --resume ${id}`;
    session.freshId = true;
    return `claude --session-id ${id}`;
  }
  if (id) return `claude --resume ${id}`;
  if (!msg.runClaude) return null;
  const custom = (msg.command && msg.command.trim()) || 'claude';
  // 직접 입력한 명령이라도 claude 로 시작하고 세션을 직접 고르지 않았으면 ID 를 붙인다.
  if (!/^claude(\s|$)/.test(custom) || CLAUDE_SESSION_FLAG_RE.test(' ' + custom.slice(6))) return custom;
  session.resumeId = crypto.randomUUID();
  session.freshId = true;
  return `claude --session-id ${session.resumeId}` + custom.slice(6);
}

// ---- /clear 따라가기 — 패널의 claude 가 지금 쓰는 세션 ID (lib/claude-registry.js) ----
// /clear 하면 claude 가 새 세션 ID 로 바꾼다. 그걸 패널 레이아웃에 반영하지 않으면
// 허브를 다시 켤 때 옛 대화가 --resume 된다.
const TRACK_MS = 3000;
const TREE_MIN_MS = 10000;   // 프로세스 트리 조회(PowerShell)는 이보다 자주 하지 않는다
const TREE_MAX_TRIES = 6;    // 트리로 못 찾는 패널은 이만큼 해 보고 그만둔다(세션 ID 로는 계속 찾는다)
let lastTreeAt = 0;
let trackBusy = false;
const registryWatchers = new Map();
function sessionsDirFor(profile) {
  return path.join(configDirFor(profile) || path.join(os.homedir(), '.claude'), 'sessions');
}
// 실행 중 세션 목록은 계정끼리 공유한다(lib/shared-config.js) — 계정 폴더의 sessions 는 메인으로 가는 연결이라
// 같은 폴더를 여러 이름으로 부른다. 같은 목록을 두 번 읽지 않게 실제 경로로 맞춘다(아직 안 바뀐 계정은 제 폴더).
function realSessionsDir(profile) {
  const d = sessionsDirFor(profile);
  try { return fs.realpathSync(d); } catch { return d; }
}
function sessionsDirsOfAllAccounts() {
  return [...new Set(allProfileIds().map(realSessionsDir))];
}
function watchRegistry(dir) {
  if (registryWatchers.has(dir)) return;
  registryWatchers.set(dir, null);
  let t = null;
  try {
    const w = fs.watch(dir, () => { clearTimeout(t); t = setTimeout(trackSessions, 300); });
    w.on('error', () => { /* 폴더가 사라지면 주기 확인만 한다 */ });
    registryWatchers.set(dir, w);
  } catch { /* 아직 폴더가 없다 — 주기 확인으로 */ }
}
function switchSessionId(session, id) {
  session.resumeId = id;
  session.forkOf = null; // 갈라 연 대화가 새 ID 를 받았다 — 이제 원본과 별개
  rememberSessionAccount(id, session.profile);
  stopWatch(session);
  beginWatch(session, sessionFile(session.cwd, id), false);
  broadcastJson(session, { type: 'session', id, switched: true });
}
async function trackSessions() {
  if (trackBusy) return;
  trackBusy = true;
  try {
    const groups = new Map();
    for (const s of ptyStore.values()) {
      if (s.exited || !s.term || !s.claudeLaunched) continue;
      const dir = realSessionsDir(s.profile);
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir).push(s);
    }
    let tree = null;
    for (const [dir, list] of groups) {
      watchRegistry(dir);
      const entries = claudeRegistry.readEntries(dir);
      const view = () => list.map((s) => ({
        key: s.key, shellPid: s.term.pid, cwd: s.cwd, resumeId: s.resumeId || '',
        claudePid: s.claudePid || 0, noTree: (s.treeTries || 0) >= TREE_MAX_TRIES,
      }));
      let r = claudeRegistry.track(view(), entries, tree);
      if (r.needTree && !tree && Date.now() - lastTreeAt >= TREE_MIN_MS) {
        lastTreeAt = Date.now();
        tree = await claudeRegistry.processTree();
        if (tree) {
          r = claudeRegistry.track(view(), entries, tree);
          for (const s of list) if (!s.claudePid && !r.links.some((l) => l.key === s.key)) s.treeTries = (s.treeTries || 0) + 1;
        }
      }
      const byKey = new Map(list.map((s) => [s.key, s]));
      for (const l of r.links) { const s = byKey.get(l.key); if (s) s.claudePid = l.claudePid; }
      for (const c of r.changes) { const s = byKey.get(c.key); if (s && !s.exited) switchSessionId(s, c.sessionId); }
    }
  } catch { /* 다음 주기에 */ } finally {
    trackBusy = false;
  }
}
setInterval(trackSessions, TRACK_MS).unref();

// 세션이 끝났을 때(패널 X / 프로세스 exit) 붙잡고 있던 자원을 놓는다.
// 같은 key 로 새 세션이 이미 들어와 있으면 그건 건드리지 않는다.
function releaseSession(session) {
  // 방금 놓은 claude 는 강제 종료가 끝날 때까지 잠깐 살아 있다 — 같은 대화를 바로 다시 열 때(새로고침) 막지 않게 적어 둔다
  if (session.claudePid) retiredClaudePids.set(session.claudePid, Date.now());
  if (session.resumeId) retiredSessionIds.set(session.resumeId, Date.now());
  stopWatch(session);
  session.subs.clear();
  session.buf = '';
  if (ptyStore.get(session.key) === session) ptyStore.delete(session.key);
}

// Windows 에서 term.kill() 은 셸만 죽여 그 아래 claude·npx·MCP 서버가 고아로 남고,
// 그들이 ConPTY 파이프를 계속 쥐어 핸들이 쌓인다(EMFILE). 트리째 죽인 뒤 pty 를 닫는다.
function killPtyTree(term) {
  if (!IS_WIN || !term.pid) { try { term.kill(); } catch {} return; }
  execFile('taskkill', ['/T', '/F', '/PID', String(term.pid)], { timeout: 5000, windowsHide: true }, () => {
    try { term.kill(); } catch {}
  });
}

function killSession(key) {
  const s = ptyStore.get(key);
  if (!s) return;
  s.exited = true; // 계정 전환이 기다리는 중이면 이걸 보고 멈춘다
  const tmuxName = s.term && s.term.tmuxName;
  killPtyTree(s.term);
  // pty 를 죽여도 tmux 세션은 데몬에 남는다. 패널을 명시적으로 닫은 것이므로 세션도 정리한다.
  if (tmuxName) {
    try { execFile('tmux', ['kill-session', '-t', tmuxName], { timeout: 5000 }, () => {}); } catch {}
  }
  releaseSession(s);
}

// pty 출력·종료를 세션에 잇는다. 계정 전환으로 pty 를 갈아 끼우면 옛 pty 의 출력·종료는 무시한다(gen).
function attachTerm(session, term) {
  const gen = (session.gen || 0) + 1;
  session.gen = gen;
  session.term = term;
  session.limitTail = '';
  term.onData((data) => {
    if (session.gen !== gen) return;
    session.buf += data;
    if (session.buf.length > MAX_BUF) session.buf = session.buf.slice(-MAX_BUF);
    broadcast(session, data);
    watchUsageLimit(session, data);
  });
  term.onExit(({ exitCode }) => {
    if (session.gen !== gen) return;
    session.exited = true;
    broadcastJson(session, { type: 'exit', code: exitCode });
    releaseSession(session);
  });
}

// 사용 한도 — 패널에 «다른 계정으로 이어가기» 를 제안한다(같은 패널엔 1분에 한 번).
// 1순위는 대화 기록의 한도 응답(beginWatch 의 transcriptHitLimit — 오탐 없음). 화면 문구는 그 줄이 안 남는
// 「Usage limit reached · continuing automatically」 때문에 남기되 좁게 본다:
//   - claude 를 띄운 직후 · 패널 크기를 바꾼 직후 · 화면 전체를 다시 그리는 출력은 지난 대화(옛 한도 문구 포함)를
//     다시 그리는 것이라 보지 않는다
//   - 문구가 보여도 대화가 답을 기다린 채 멈춰 있을 때만 알린다 — 대화 중에 한도 문구를 말한 것과 구분
const LIMIT_NOTIFY_GAP_MS = 60000;
const LIMIT_LAUNCH_GRACE_MS = 15000;
const LIMIT_RESIZE_GRACE_MS = 4000;
function watchUsageLimit(session, data) {
  if (!session.claudeLaunched) return;
  const now = Date.now();
  if (now - (session.launchedAt || 0) < LIMIT_LAUNCH_GRACE_MS || now - (session.resizedAt || 0) < LIMIT_RESIZE_GRACE_MS
    || usageLimit.isRepaint(data)) { session.limitTail = ''; return; }
  const r = usageLimit.scan(session.limitTail, data);
  session.limitTail = r.tail;
  // 상태 줄은 다시 그릴 때마다 또 나온다 — 알린 지 얼마 안 됐으면 기록 파일을 읽지 않는다
  if (!r.hit || now - (session.limitAt || 0) < LIMIT_NOTIFY_GAP_MS) return;
  if (claudeBusy(session) === 'turn') notifyUsageLimit(session);
}
function notifyUsageLimit(session) {
  if (Date.now() - (session.limitAt || 0) < LIMIT_NOTIFY_GAP_MS) return;
  session.limitAt = Date.now();
  broadcastJson(session, { type: 'limit', profile: session.profile || 'default' });
}

// 셸에 claude 명령을 친다. tmux 는 내부 로그인 셸이 뜨는 시간이 더 필요하다(400ms 면 입력이 삼켜짐).
function launchClaude(session, msg) {
  const term = session.term;
  // 살아 있던 tmux 세션에 붙은 것이면 claude 가 이미 그 안에서 돌고 있다 — 다시 치지 않는다.
  const cmd = term.tmuxReattached ? null : buildClaudeCommand(msg, session);
  // claude 를 띄운(또는 살아 있는 tmux 안에서 돌던) 패널만 세션 ID 를 따라간다 — 맨 셸에서 직접 친 claude 는 제외
  session.claudeLaunched = !!(cmd ? /^claude(\s|$)/.test(cmd) : (term.tmuxReattached && (msg.resumeId || msg.runClaude)));
  if (session.claudeLaunched && session.resumeId && !session.forkOf) rememberSessionAccount(session.resumeId, session.profile);
  session.launchedAt = Date.now();
  const bootDelay = readShellSettings().shell === 'tmux' ? 1200 : 400;
  if (cmd) setTimeout(() => { try { if (session.term === term) term.write(`${cmd}\r`); } catch {} }, bootDelay);
}

// ---- 같은 대화 중복 열기 막기 ----
// 허브의 다른 패널이나 허브 밖 터미널에서 이미 돌고 있는 대화인지. 맞으면 어디인지 돌려준다.
// 방금 닫은 패널의 claude 는 강제 종료가 끝날 때까지 잠깐 살아 있다 — 그건 허브 것으로 친다.
const RETIRED_PID_MS = 15000;
const retiredClaudePids = new Map(); // pid -> 놓은 시각
const retiredSessionIds = new Map(); // 세션 ID -> 놓은 시각 (claude pid 를 아직 못 짝지었을 때)
function findSessionHolder(id, key) {
  if (!id || !SESSION_ID_RE.test(String(id))) return null;
  for (const s of ptyStore.values()) {
    if (s.key === key || s.exited || s.forkOf) continue;
    if (s.resumeId === id) return { where: 'hub', key: s.key, profile: s.profile || 'default' };
  }
  // tmux 는 허브를 껐다 켜도 claude 가 살아 있다 — 같은 패널로 다시 붙는 것이므로 막지 않는다
  if (readShellSettings().shell === 'tmux' && tmuxHasSession(tmuxSessionName(key))) return null;
  const now = Date.now();
  for (const m of [retiredClaudePids, retiredSessionIds]) for (const [k, at] of m) if (now - at > RETIRED_PID_MS) m.delete(k);
  if (retiredSessionIds.has(id)) return null;
  const hubPids = new Set([...ptyStore.values()].map((s) => s.claudePid).filter(Boolean));
  // 같은 대화 ID 인 것만 프로세스를 확인한다(확인 한 번에 수십 ms — 등록부 전체를 보면 패널 복원이 느려진다).
  // 공유 목록에는 계정 정보가 없어 어느 계정인지는 모른다 — 계정별 목록일 때만 알려 준다.
  for (const dir of sessionsDirsOfAllAccounts()) {
    const hit = claudeRegistry.readEntries(dir)
      .find((e) => e.sessionId === id && !hubPids.has(e.pid) && !retiredClaudePids.has(e.pid) && isClaudeProcess(e.pid));
    if (!hit) continue;
    const owners = allProfileIds().filter((p) => realSessionsDir(p) === dir);
    return { where: 'external', profile: owners.length === 1 ? owners[0] : null };
  }
  return null;
}

// ---- 패널의 계정 바꿔 이어가기 ----
// claude 를 스스로 종료하게 해(Ctrl+C — 입력창 비우기 → 종료) 대화 기록을 끝까지 쓰게 한 뒤, 같은 패널(key)에서 다른 계정으로 같은 대화를 다시 연다.
// 대화 기록은 계정끼리 같은 파일이라 복사하지 않는다.
const SWITCH_EXIT_WAIT_MS = 15000;
// claude 가 꺼질 때까지 기다린다. 끝나면 true, 시간 안에 안 꺼지면 false.
function waitClaudeExit(session, ms) {
  const t0 = Date.now();
  const dir = sessionsDirFor(session.profile);
  return new Promise((resolve) => {
    const iv = setInterval(() => {
      const pid = session.claudePid;
      // claude 는 정상 종료하면 등록부 파일을 지운다 — 250ms 마다 보므로 프로세스 이름 확인(tasklist)은 하지 않는다
      const gone = pid ? !pidAlive(pid) : !claudeRegistry.readEntries(dir).some((e) => e.sessionId === session.resumeId && pidAlive(e.pid));
      if (gone && Date.now() - t0 > 500) { clearInterval(iv); resolve(true); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); resolve(false); }
    }, 250);
  });
}
// 지금 claude 가 일하는 중인가 — 'subagents' | 'turn' | null. 이때 끄면 답변·서브에이전트·백그라운드 작업이 같이 끝난다.
// 대화 기록 끝부분을 읽는다 — 마지막 줄이 아주 길면(큰 도구 결과) 더 크게 읽는다
const TURN_TAIL_STEPS = [256 * 1024, 4 * 1024 * 1024];
function claudeBusy(session) {
  if ((session.subagents || []).some((a) => a.state !== 'done')) return 'subagents';
  // 감시 중인 파일은 /clear 직후나 새 대화를 찾는 중에 다른 대화일 수 있다 — 지금 세션 ID 의 파일을 먼저 본다
  const own = session.resumeId ? sessionFile(session.cwd, session.resumeId) : null;
  const f = own && fs.existsSync(own) ? own : (session.watch && session.watch.file);
  if (!f) return null;
  try {
    const size = fs.statSync(f).size;
    for (const step of TURN_TAIL_STEPS) {
      const len = Math.min(size, step);
      const fd = fs.openSync(f, 'r');
      const b = Buffer.alloc(len);
      try { fs.readSync(fd, b, 0, len, size - len); } finally { fs.closeSync(fd); }
      const busy = usageLimit.turnInProgress(b.toString('utf8'));
      if (busy !== null || len === size) return busy ? 'turn' : null;
    }
  } catch { /* 못 읽으면 모름 */ }
  return null;
}
// claude 를 스스로 끝내게 한다. Ctrl+C 는 입력창에 글이 있으면 비우고, 응답 중이면 멈추고, 빈 입력창에서 두 번이면 종료한다.
// `/exit` 를 치면 입력창에 남은 글과 붙어 질문으로 보내지거나 권한 확인 메뉴에서 Enter 로 «예» 가 골라질 수 있다.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function askClaudeToExit(term) {
  for (let i = 0; i < 3; i++) { try { term.write('\x03'); } catch {} await sleep(350); }
}
const BUSY_TEXT = {
  subagents: '서브에이전트가 일하는 중입니다',
  turn: 'claude 가 답변하는 중입니다',
};
// 실패하면 이유를 던진다 — 호출부가 패널에 오류로 알려 계정 칩의 «바꾸는 중» 을 푼다.
// force: 일하는 중이어도 멈추고 바꾼다(사용자가 안내 줄에서 고른 경우).
async function switchAccount(session, profile, force) {
  if (!allProfileIds().includes(profile)) throw new Error('없는 계정입니다');
  if (session.switching) throw new Error('이미 계정을 바꾸는 중입니다');
  if ((session.profile || 'default') === profile) throw new Error('이미 그 계정입니다');
  if (!session.claudeLaunched || !session.resumeId) throw new Error('claude 대화가 열린 패널만 계정을 바꿀 수 있습니다');
  if (session.forkOf) throw new Error('갈라 연 대화가 아직 새 ID 를 받지 못했습니다. 잠시 뒤 다시 해 주세요');
  // 대상 계정이 공유 대화 폴더를 못 보면 --resume 이 대화를 못 찾는다 — 지금 claude 를 끄기 전에 확인한다
  if (!ensureShared(profile)) throw new Error(`${profile} 계정 폴더를 공유 구조로 맞추지 못했습니다. 그 계정의 claude 가 허브 밖에서 돌고 있으면 끄고 다시 해 주세요`);
  const busy = claudeBusy(session);
  if (busy && !force) { broadcastJson(session, { type: 'switch-blocked', reason: busy, text: BUSY_TEXT[busy], to: profile }); return; }
  session.switching = true;
  try {
    const from = session.profile || 'default';
    const old = session.term;
    broadcastJson(session, { type: 'switching', from, to: profile });
    await askClaudeToExit(old);
    let exited = await waitClaudeExit(session, 5000);
    // 멈추는 데 시간이 걸리는 응답이면 한 번 더 — 그래도 안 꺼지면 아래에서 취소
    if (!exited && !session.exited) { await askClaudeToExit(old); exited = await waitClaudeExit(session, SWITCH_EXIT_WAIT_MS); }
    // 기다리는 사이 패널이 닫혔다 — 새 셸을 띄우면 아무도 못 보는 claude 가 남는다
    if (session.exited || ptyStore.get(session.key) !== session) return;
    // 안 꺼졌으면 강제로 죽이지 않는다 — 쓰던 기록이 잘린다. 전환을 취소하고 그대로 둔다.
    if (!exited) throw new Error('claude 가 종료되지 않아 계정 전환을 취소했습니다. 패널에서 claude 상태를 확인한 뒤 다시 해 주세요');
    stopWatch(session);
    session.gen++; // 옛 pty 의 남은 출력·종료는 무시
    killPtyTree(old);
    // 같은 이름의 tmux 세션이 남아 있으면 새 셸이 거기 붙어 claude 를 다시 치지 않는다
    if (old.tmuxName) { try { execFileSync('tmux', ['kill-session', '-t', old.tmuxName], { timeout: 5000, stdio: 'ignore' }); } catch {} }
    Object.assign(session, { profile, claudePid: 0, treeTries: 0, freshId: false, forkOf: null });
    let term;
    try { term = spawnShell(session.cwd, old.cols || 80, old.rows || 24, profile, session.key); }
    catch (e) {
      // 새 셸을 못 띄웠다 — 죽은 pty 에 패널이 붙어 있지 않게 끝난 세션으로 정리한다
      session.exited = true;
      broadcastJson(session, { type: 'error', message: `계정 전환 실패: 새 셸을 띄우지 못했습니다 (${e.message})` });
      broadcastJson(session, { type: 'exit', code: -1 });
      releaseSession(session);
      return;
    }
    attachTerm(session, term);
    launchClaude(session, { resumeId: session.resumeId });
    startWatch(session);
    broadcastJson(session, { type: 'account', profile, id: session.resumeId });
  } finally {
    session.switching = false;
  }
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
        // 끊겨 있는 동안 /clear 로 세션이 바뀌었을 수 있다 — 지금 ID 를 알려 레이아웃에 남긴다
        if (existing.resumeId) safeSend({ type: 'session', id: existing.resumeId });
        if (existing.activity) safeSend({ type: 'activity', ...existing.activity });
        safeSend({ type: 'subagents', list: existing.subagents || [] });
        if (existing.buf) { try { ws.send(existing.buf); } catch {} } // 최근 화면 재생 → 재부착 클라이언트 상태 복원
        existing.resizedAt = Date.now(); // 다시 붙으면 화면 전체를 다시 그린다 — 지난 대화 속 한도 문구에 걸리지 않게
        try { existing.term.resize(cols, rows); } catch {}
        return;
      }
      // 같은 대화가 이미 다른 곳에서 돌고 있으면 열지 않는다 — 두 곳에서 쓰면 기록이 뒤섞인다
      const holder = msg.fork ? null : findSessionHolder(msg.resumeId, key);
      if (holder) { safeSend({ type: 'busy', id: String(msg.resumeId), ...holder }); return; }
      // 신규 세션 생성 — 지워진 계정이면 기본 계정으로
      const cwd = (msg.cwd || '').trim();
      if (!allProfileIds().includes(msg.profile)) msg.profile = 'default';
      // 계정 폴더가 공유 대화 폴더를 못 보면 --resume 이 대화를 못 찾아 빈 셸만 남는다 — 열지 않고 알린다
      if (!ensureShared(msg.profile)) {
        safeSend({ type: 'error', message: `${msg.profile} 계정 폴더를 공유 구조로 맞추지 못했습니다. 그 계정의 claude 가 허브 밖에서 돌고 있으면 끄고 패널을 다시 열어 주세요.` });
        return;
      }
      let term;
      try { term = spawnShell(cwd, cols, rows, msg.profile, key); }
      catch (err) { safeSend({ type: 'error', message: `PTY 생성 실패: ${err.message}` }); return; }
      const session = {
        key, term: null, cwd: cwd || os.homedir(), profile: msg.profile, resumeId: msg.resumeId,
        buf: '', subs: new Set([ws]), exited: false, watch: { file: null, pos: 0, isResume: false, discoverIv: null, subIv: null },
      };
      ptyStore.set(key, session);
      boundKey = key;
      attachTerm(session, term);
      safeSend({ type: 'ready', pid: term.pid, cwd: session.cwd });
      launchClaude(session, msg);
      // 새 대화에 미리 정한 ID 를 클라이언트에 알려 레이아웃에 남긴다 → 허브를 다시 켜면 이 대화로 이어진다.
      // 빈 대화를 갈라 연 경우도 새 ID 다.
      if (session.freshId && session.resumeId !== msg.resumeId) safeSend({ type: 'session', id: session.resumeId });
      startWatch(session);
      return;
    }

    const s = boundKey ? ptyStore.get(boundKey) : null;
    if (!s || s.exited) return;
    if (msg.type === 'input') { try { s.term.write(msg.data); } catch {} }
    else if (msg.type === 'resize') { s.resizedAt = Date.now(); try { s.term.resize(Math.max(2, msg.cols | 0) || 80, Math.max(1, msg.rows | 0) || 24); } catch {} }
    else if (msg.type === 'kill') { killSession(boundKey); } // 사용자가 패널 종료 → 실제 pty 종료
    else if (msg.type === 'switchAccount') {
      switchAccount(s, String(msg.profile || ''), !!msg.force).catch((e) => broadcastJson(s, { type: 'error', message: `계정 전환 실패: ${e.message}` }));
    }
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

// 시작할 때 계정 폴더를 공유 구조로 맞춘다. tmux 세션이나 허브 밖 터미널의 claude 는 허브를 다시 켜도 살아 있을 수 있어,
// 그 계정에서 옮겨야 할 폴더는 건너뛰고 그 계정으로 패널을 열 때 다시 해 본다(이미 연결된 것은 상관없음).
for (const id of allProfileIds()) {
  try { ensureShared(id); } catch (e) { console.error(`[공유] ${id} 준비 실패:`, e.message); }
}
try { importOrphanProfiles(); } catch (e) { console.error('[공유] 목록 밖 계정 폴더 확인 실패:', e.message); }

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Claude Terminal Hub → http://localhost:${PORT}  (pid ${process.pid})`);
});

'use strict';
/**
 * 계정끼리 작업 환경 공유 — 로그인만 계정별, 나머지는 메인(~/.claude) 하나를 같이 쓴다.
 *
 * 계정 폴더(~/.claude-hub-profiles/<id>)는 CLAUDE_CONFIG_DIR 로 그대로 쓰되, 그 안의 공유 대상 폴더를
 * 메인 폴더로 가는 연결(Windows 는 junction — 관리자 권한 불필요, 그 밖은 symlink)로 바꾼다.
 * 대화 기록(projects)이 한 곳이라 어느 계정으로 --resume 해도 같은 파일에 이어 쌓인다.
 *
 * 연결 전에 계정 폴더에 이미 쌓인 내용은 메인으로 합친다. 아무것도 지우지 않는다:
 *   - 메인에 없는 것 → 옮긴다
 *   - 같은 내용이거나 한쪽이 다른 쪽의 앞부분(복사 후 한쪽에서만 이어 쓴 대화) → 긴 쪽을 남긴다
 *   - 양쪽이 갈라진 것 → 메인은 그대로, 계정 쪽은 백업 폴더에 남긴다(conflicts 로 보고)
 * 합치고 남은 계정 쪽 폴더는 통째로 백업 폴더로 옮긴 뒤 그 자리에 연결을 만든다.
 */
const fs = require('fs');
const path = require('path');

const SHARED_DIRS = ['projects', 'agents', 'skills', 'commands', 'rules', 'hooks', 'output-styles'];
const CLAUDE_MD_IMPORT = '@~/.claude/CLAUDE.md';

function isLink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}
function exists(p) {
  try { fs.lstatSync(p); return true; } catch { return false; }
}
function samePath(a, b) {
  const norm = (p) => {
    const r = path.resolve(String(p)).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}
function linkPointsTo(p, target) {
  try { return samePath(fs.realpathSync(p), fs.realpathSync(target)); } catch { return false; }
}

// 다른 드라이브면 rename 이 안 된다 — 복사 후 원본 삭제로 대신한다.
function moveSync(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try { fs.renameSync(src, dst); } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(src, dst, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}

// 파일 둘의 관계: 'same' | 'dst-longer' | 'src-longer' | 'diverged'
function compareFiles(src, dst) {
  const a = fs.readFileSync(src);
  const b = fs.readFileSync(dst);
  if (a.equals(b)) return 'same';
  if (b.length > a.length && b.subarray(0, a.length).equals(a)) return 'dst-longer';
  if (a.length > b.length && a.subarray(0, b.length).equals(b)) return 'src-longer';
  return 'diverged';
}

/**
 * src 의 내용을 dst 로 합친다. 옮기지 못한 것(갈라진 파일, 밀려난 짧은 사본)은 src 안에 남는다.
 * @returns {{ moved: number, conflicts: string[] }} conflicts 는 src 기준 상대 경로
 */
function mergeDir(src, dst, rel = '') {
  const report = { moved: 0, conflicts: [] };
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    const r = rel ? rel + '/' + name : name;
    const sst = fs.lstatSync(s);
    if (sst.isSymbolicLink()) continue; // 계정 쪽 연결은 따라가지 않는다
    if (!exists(d)) { moveSync(s, d); report.moved++; continue; }
    const dst2 = fs.statSync(d);
    if (sst.isDirectory() && dst2.isDirectory()) {
      const sub = mergeDir(s, d, r);
      report.moved += sub.moved;
      report.conflicts.push(...sub.conflicts);
      continue;
    }
    if (!sst.isFile() || !dst2.isFile()) { report.conflicts.push(r); continue; }
    const rel2 = compareFiles(s, d);
    if (rel2 === 'src-longer') {
      // 계정 쪽이 더 이어 쓴 대화 — 그쪽을 메인에 두고, 짧은 메인 사본을 src 에 남겨 백업으로 보낸다
      const tmp = s + '.hub-swap';
      moveSync(d, tmp);   // 메인이 다른 드라이브로 연결돼 있어도 되게 rename 대신 moveSync
      moveSync(s, d);
      moveSync(tmp, s);
      report.moved++;
    } else if (rel2 === 'diverged') {
      report.conflicts.push(r);
    }
    // same / dst-longer: 메인이 이미 다 갖고 있다 — 계정 쪽은 백업으로 간다
  }
  return report;
}

function makeDirLink(linkPath, target) {
  fs.mkdirSync(target, { recursive: true });
  fs.symlinkSync(target, linkPath, 'junction'); // 'junction' 은 Windows 에서만 쓰이고 그 밖은 일반 symlink
}

/**
 * 계정 폴더 하나를 공유 구조로 맞춘다. 여러 번 불러도 된다(이미 연결된 것은 건너뛴다).
 * @param {string} profileDir  계정의 CLAUDE_CONFIG_DIR
 * @param {string} mainDir     공유 원본(~/.claude)
 * @param {string} backupDir   이 계정의 합치고 남은 것을 둘 곳
 * @returns {{ linked: string[], moved: number, conflicts: string[], backup: string|null, errors: string[] }}
 */
function linkProfile(profileDir, mainDir, backupDir) {
  const report = { linked: [], moved: 0, conflicts: [], backup: null, errors: [] };
  if (samePath(profileDir, mainDir)) return report;
  fs.mkdirSync(profileDir, { recursive: true });
  for (const d of SHARED_DIRS) {
    const p = path.join(profileDir, d);
    const target = path.join(mainDir, d);
    try {
      if (isLink(p)) {
        if (linkPointsTo(p, target)) continue;
        fs.unlinkSync(p); // 엉뚱한 곳을 가리키는 연결 — 다시 만든다(연결만 지우고 대상은 건드리지 않음)
      } else if (exists(p)) {
        fs.mkdirSync(target, { recursive: true });
        const m = mergeDir(p, target);
        report.moved += m.moved;
        report.conflicts.push(...m.conflicts.map((c) => d + '/' + c));
        const keep = path.join(backupDir, d);
        if (fs.readdirSync(p).length) { moveSync(p, uniquePath(keep)); report.backup = backupDir; }
        else fs.rmdirSync(p);
      }
      makeDirLink(p, target);
      report.linked.push(d);
    } catch (e) {
      report.errors.push(d + ': ' + (e.message || e));
    }
  }
  try { ensureClaudeMdImport(profileDir); } catch (e) { report.errors.push('CLAUDE.md: ' + (e.message || e)); }
  return report;
}

function uniquePath(p) {
  if (!exists(p)) return p;
  for (let i = 2; ; i++) if (!exists(p + '-' + i)) return p + '-' + i;
}

// 전역 지침(CLAUDE.md)은 파일이라 폴더 연결이 안 된다 — 메인 것을 불러오는 한 줄을 넣는다.
function ensureClaudeMdImport(profileDir) {
  const f = path.join(profileDir, 'CLAUDE.md');
  let cur = '';
  try { cur = fs.readFileSync(f, 'utf8'); } catch { /* 없음 */ }
  if (cur.split(/\r?\n/).some((l) => l.trim() === CLAUDE_MD_IMPORT)) return false;
  fs.writeFileSync(f, CLAUDE_MD_IMPORT + '\n' + (cur ? '\n' + cur : ''));
  return true;
}

/** 메인 .claude.json 의 사용자 MCP 서버 — 계정 쪽 claude 에 --mcp-config 로 넘길 내용. 없으면 null. */
function readUserMcpServers(mainAccountFile) {
  try {
    const j = JSON.parse(fs.readFileSync(mainAccountFile, 'utf8'));
    const m = j && j.mcpServers;
    return m && typeof m === 'object' && Object.keys(m).length ? m : null;
  } catch { return null; }
}

module.exports = { SHARED_DIRS, CLAUDE_MD_IMPORT, mergeDir, linkProfile, ensureClaudeMdImport, readUserMcpServers, compareFiles };

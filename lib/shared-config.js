'use strict';
/**
 * 계정끼리 작업 환경 공유 — 로그인만 계정별, 나머지는 메인(~/.claude) 하나를 같이 쓴다.
 *
 * 계정 폴더(~/.claude-hub-profiles/<id>)는 CLAUDE_CONFIG_DIR 로 그대로 쓰되, 그 안의 공유 대상을
 * 메인으로 가는 연결(Windows 는 junction — 관리자 권한 불필요, 그 밖은 symlink)로 바꾼다.
 * 대화 기록(projects)이 한 곳이라 어느 계정으로 --resume 해도 같은 파일에 이어 쌓인다.
 *
 * 두 가지 방식:
 *   - SHARED_DIRS: 폴더 통째로 연결
 *   - PER_ENTRY_DIRS: 폴더는 계정 것으로 두고 안의 항목만 하나씩 연결 — claude.ai 계정에서 내려오는
 *     `synced` 같은 계정 전용 항목이 섞여 있어서다. 파일 항목은 연결할 수 없어(개발자 모드 없이 파일 symlink 불가)
 *     메인 것을 복사하되, 계정 쪽에서 바뀐 파일은 덮어쓰지 않는다(마지막으로 복사한 사본과 비교).
 *
 * 연결 전에 계정 폴더에 이미 쌓인 내용은 메인으로 합친다. 아무것도 지우지 않는다:
 *   - 메인에 없는 것 → 옮긴다
 *   - 같은 내용이거나 한쪽이 다른 쪽의 앞부분(복사 후 한쪽에서만 이어 쓴 대화) → 긴 쪽을 남긴다
 *   - 양쪽이 갈라진 것 → 기본은 메인 유지, NEWER_WINS 폴더는 수정 시각이 새로운 쪽. 진 쪽은 백업(conflicts 로 보고)
 * 합치고 남은 계정 쪽 폴더는 통째로 백업 폴더로 옮긴 뒤 그 자리에 연결을 만든다.
 * 옮기는 일은 opts.canMove() 가 true 일 때만 한다 — 그 계정의 claude 가 돌고 있으면 쓰는 도중의 파일을 옮기게 된다.
 */
const fs = require('fs');
const path = require('path');

// sessions: 실행 중 세션 목록(+ Windows 세션 간 메시지 인증 키). Claude Code 는 같은 목록을 쓰는 세션끼리만
// 서로 찾고(@멘션 · 메시지) 「같은 대화가 두 곳에서 열림」을 감지한다 — 공유해야 계정이 달라도 된다.
// 실행 중인 claude 가 제 파일을 쥐고 있으므로 그 계정 claude 가 다 꺼졌을 때만 바꾼다(canMove).
const SHARED_DIRS = ['projects', 'agents', 'commands', 'rules', 'hooks', 'output-styles',
  'file-history', 'tasks', 'plans', 'session-env', 'sessions'];
// 폴더 이름 → 계정마다 따로 두는 항목
// plugins 는 공유하지 않는다 — 설치 목록(installed_plugins.json)과 설치본(cache)이 한 쌍인데, 파일은 연결할 수 없어
// 목록만 계정마다 갈라지면 한 계정의 정리 작업이 다른 계정이 쓰는 설치본을 지울 수 있다. 계정마다 설치한다.
const PER_ENTRY_DIRS = {
  skills: ['synced'],
};
// 갈라졌을 때 수정 시각이 새로운 쪽을 남기는 폴더(통째로 다시 쓰는 상태 파일). 나머지는 메인 유지.
const NEWER_WINS = new Set(['tasks', 'plans', 'session-env']);
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
// 연결이 dir 안을 가리키거나 이미 끊긴(대상이 없는) 연결인가 — 허브가 만든 것으로 본다
function linksInto(p, dir) {
  let real;
  try { real = fs.realpathSync(p); } catch { return true; }
  const norm = (x) => { const r = path.resolve(x); return process.platform === 'win32' ? r.toLowerCase() : r; };
  let root;
  try { root = norm(fs.realpathSync(dir)); } catch { root = norm(dir); }
  return norm(real) === root || norm(real).startsWith(root + path.sep);
}
function sameFile(a, b) {
  try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch { return false; }
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
function uniquePath(p) {
  if (!exists(p)) return p;
  for (let i = 2; ; i++) if (!exists(p + '-' + i)) return p + '-' + i;
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

// 계정 쪽(src)을 메인(dst) 자리에 두고, 밀려난 메인 사본은 src 자리에 남겨 백업으로 보낸다
function swapInto(s, d) {
  const tmp = s + '.hub-swap';
  moveSync(d, tmp); // 메인이 다른 드라이브로 연결돼 있어도 되게 rename 대신 moveSync
  moveSync(s, d);
  moveSync(tmp, s);
}

/**
 * src 의 내용을 dst 로 합친다. 옮기지 못한 것(갈라진 파일, 밀려난 사본)은 src 안에 남는다.
 * opts.newerWins: 갈라진 파일은 수정 시각이 새로운 쪽을 메인에 둔다.
 * opts.copy: 옮기지 않고 복사한다(src 를 건드리지 않음). 갈라진 파일은 opts.backupDir 로 복사만 한다.
 * @returns {{ moved: number, conflicts: string[] }} conflicts 는 src 기준 상대 경로
 */
function mergeDir(src, dst, opts = {}, rel = '') {
  const report = { moved: 0, conflicts: [] };
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    const r = rel ? rel + '/' + name : name;
    const sst = fs.lstatSync(s);
    if (sst.isSymbolicLink()) continue; // 계정 쪽 연결은 따라가지 않는다
    if (!exists(d)) {
      if (opts.copy) fs.cpSync(s, d, { recursive: true }); else moveSync(s, d);
      report.moved++;
      continue;
    }
    const dst2 = fs.statSync(d);
    if (sst.isDirectory() && dst2.isDirectory()) {
      const sub = mergeDir(s, d, opts, r);
      report.moved += sub.moved;
      report.conflicts.push(...sub.conflicts);
      continue;
    }
    if (!sst.isFile() || !dst2.isFile()) { report.conflicts.push(r); continue; }
    const rel2 = compareFiles(s, d);
    if (rel2 === 'same' || rel2 === 'dst-longer') continue; // 메인이 이미 다 갖고 있다
    const srcWins = rel2 === 'src-longer' || (opts.newerWins && sst.mtimeMs > dst2.mtimeMs);
    if (opts.copy) {
      // 메인은 건드리지 않는다 — 계정 쪽 사본을 백업에 남겨 보고만 한다
      if (opts.backupDir) fs.cpSync(s, uniquePath(path.join(opts.backupDir, r)));
      report.conflicts.push(r);
    } else if (srcWins) {
      swapInto(s, d);
      report.moved++;
      if (rel2 === 'diverged') report.conflicts.push(r); // 메인 쪽이 밀려났다 — 백업에 있다
    } else {
      report.conflicts.push(r);
    }
  }
  return report;
}

function makeDirLink(linkPath, target) {
  fs.mkdirSync(target, { recursive: true });
  fs.symlinkSync(target, linkPath, 'junction'); // 'junction' 은 Windows 에서만 쓰이고 그 밖은 일반 symlink
}

// 계정 쪽 실제 폴더 p 를 메인 target 으로 합치고 남은 것은 백업으로 보낸다
function absorbDir(p, target, backupPath, opts, report, label) {
  fs.mkdirSync(target, { recursive: true });
  const m = mergeDir(p, target, opts);
  report.moved += m.moved;
  report.conflicts.push(...m.conflicts.map((c) => label + '/' + c));
  if (fs.readdirSync(p).length) { moveSync(p, uniquePath(backupPath)); report.backup = report.backupDir; }
  else fs.rmdirSync(p);
}

/**
 * 메인 파일을 계정 쪽에 복사한다. 계정 쪽이 마지막 복사본(base)과 다르면 계정에서 바꾼 것이라 덮어쓰지 않는다.
 * @returns 'copied' | 'same' | 'kept'
 */
function syncCopiedFile(dst, src, base) {
  if (exists(dst) && sameFile(dst, src)) {
    if (!sameFile(base, src)) { fs.mkdirSync(path.dirname(base), { recursive: true }); fs.copyFileSync(src, base); }
    return 'same';
  }
  if (exists(dst) && !sameFile(dst, base)) return 'kept';
  fs.copyFileSync(src, dst);
  fs.mkdirSync(path.dirname(base), { recursive: true });
  fs.copyFileSync(src, base);
  return 'copied';
}

// PER_ENTRY_DIRS 하나 — 계정 폴더는 실제 폴더로 두고, 메인 항목을 하나씩 연결(폴더) · 복사(파일)한다
function linkEntries(profileDir, mainDir, d, exclude, opts, report) {
  const p = path.join(profileDir, d);
  const target = path.join(mainDir, d);
  fs.mkdirSync(target, { recursive: true });
  const skip = new Set(exclude);
  // 예전(v1.27)엔 폴더 통째로 연결했다 — 계정 전용 항목이 메인에 섞이므로 항목별 연결로 바꾼다
  if (isLink(p)) {
    if (!opts.canMove()) { report.pending.push(d); return; }
    fs.unlinkSync(p); // 연결만 지운다(메인은 그대로)
  }
  fs.mkdirSync(p, { recursive: true });
  for (const name of fs.readdirSync(p)) {
    if (skip.has(name)) continue;
    const e = path.join(p, name);
    const t = path.join(target, name);
    if (isLink(e)) {
      // 허브가 만든 연결(메인 쪽을 가리킴)만 정리한다 — 사용자가 직접 건 연결(개발 폴더 등)은 그대로 둔다
      if (!linkPointsTo(e, t) && linksInto(e, target)) fs.unlinkSync(e);
      continue;
    }
    const st = fs.statSync(e);
    if (!st.isDirectory()) continue; // 파일은 아래 복사 단계에서 맞춘다(계정에서 바꾼 것은 덮어쓰지 않음)
    // 메인 쪽 같은 이름이 다른 곳(외부 저장소 등)으로 가는 연결이면 그 안으로 옮기지 않는다
    if (isLink(t)) { report.kept.push(d + '/' + name); continue; }
    if (!opts.canMove()) { report.pending.push(d + '/' + name); continue; }
    absorbDir(e, t, path.join(opts.backupDir, d, name), {}, report, d + '/' + name);
  }
  for (const name of fs.readdirSync(target)) {
    if (skip.has(name)) continue;
    const e = path.join(p, name);
    const t = path.join(target, name);
    try {
      if (fs.statSync(t).isDirectory()) {
        if (!exists(e)) { makeDirLink(e, t); report.linked.push(d + '/' + name); }
      } else {
        const r = syncCopiedFile(e, t, path.join(opts.baseDir, d, name));
        if (r === 'kept') report.kept.push(d + '/' + name);
      }
    } catch (err) { report.errors.push(d + '/' + name + ': ' + (err.message || err)); }
  }
}

/**
 * 계정 폴더 하나를 공유 구조로 맞춘다. 패널을 열 때마다 불러도 된다(이미 맞춘 것은 건너뛰고, 메인에 새로 생긴 항목만 잇는다).
 * @param {string} profileDir  계정의 CLAUDE_CONFIG_DIR
 * @param {string} mainDir     공유 원본(~/.claude)
 * @param {object} opts
 *   backupDir  합치고 남은 것을 둘 곳 / baseDir  복사한 파일의 마지막 사본을 둘 곳
 *   canMove()  계정 쪽 실제 폴더를 옮겨도 되는가(그 계정 claude 가 꺼져 있는가) — 필요할 때만 부른다
 * @returns {{ linked, moved, conflicts, backup, errors, pending, kept, projectsReady }}
 */
function linkProfile(profileDir, mainDir, opts = {}) {
  const report = { linked: [], moved: 0, conflicts: [], backup: null, backupDir: opts.backupDir, errors: [], pending: [], kept: [], projectsReady: false };
  if (samePath(profileDir, mainDir)) { report.projectsReady = true; return report; }
  let movable = null;
  const o = {
    backupDir: opts.backupDir || path.join(profileDir, '.hub-merge-backup'),
    baseDir: opts.baseDir || path.join(profileDir, '.hub-copy-base'),
    canMove: () => (movable === null ? (movable = opts.canMove ? !!opts.canMove() : true) : movable),
  };
  report.backupDir = o.backupDir;
  fs.mkdirSync(profileDir, { recursive: true });
  for (const d of SHARED_DIRS) {
    const p = path.join(profileDir, d);
    const target = path.join(mainDir, d);
    try {
      if (isLink(p)) {
        if (linkPointsTo(p, target)) continue;
        fs.unlinkSync(p); // 엉뚱한 곳을 가리키는 연결 — 다시 만든다(연결만 지우고 대상은 건드리지 않음)
      } else if (exists(p)) {
        if (!o.canMove()) { report.pending.push(d); continue; }
        absorbDir(p, target, path.join(o.backupDir, d), { newerWins: NEWER_WINS.has(d) }, report, d);
      }
      makeDirLink(p, target);
      report.linked.push(d);
    } catch (e) {
      report.errors.push(d + ': ' + (e.message || e));
    }
  }
  for (const [d, exclude] of Object.entries(PER_ENTRY_DIRS)) {
    try { linkEntries(profileDir, mainDir, d, exclude, o, report); } catch (e) { report.errors.push(d + ': ' + (e.message || e)); }
  }
  try { ensureClaudeMdImport(profileDir); } catch (e) { report.errors.push('CLAUDE.md: ' + (e.message || e)); }
  report.projectsReady = isLink(path.join(profileDir, 'projects')) && linkPointsTo(path.join(profileDir, 'projects'), path.join(mainDir, 'projects'));
  return report;
}

/**
 * 계정 목록에서 빠진 계정 폴더의 대화를 메인으로 가져온다. 그 폴더를 허브 밖 도구가 따로 쓸 수 있어
 * 옮기지 않고 복사만 한다. 메인과 갈라진 대화는 메인을 건드리지 않고 backupDir 에 복사해 보고한다.
 */
function importProjects(srcProjects, mainProjects, backupDir) {
  if (!exists(srcProjects) || isLink(srcProjects)) return { moved: 0, conflicts: [] };
  return mergeDir(srcProjects, mainProjects, { copy: true, backupDir });
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

module.exports = {
  SHARED_DIRS, PER_ENTRY_DIRS, CLAUDE_MD_IMPORT,
  mergeDir, linkProfile, importProjects, ensureClaudeMdImport, compareFiles, syncCopiedFile,
};

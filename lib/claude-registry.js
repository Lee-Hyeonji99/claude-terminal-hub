'use strict';
/**
 * Claude Code 세션 등록부 따라가기 — 패널의 claude 가 지금 쓰는 세션 ID 를 알아낸다.
 *
 * Claude Code 는 실행 중인 프로세스마다 <CLAUDE_CONFIG_DIR>/sessions/<pid>.json 에
 * { pid, sessionId, cwd, ... } 를 적어 둔다. /clear 하면 같은 프로세스가 새 세션 ID 로 바꾸고 이 파일도 바뀐다.
 * 허브는 패널을 열 때 정한 ID 만 알고 있었기 때문에, /clear 후 허브를 다시 켜면 옛 대화가 --resume 되었다.
 *
 * 패널 ↔ claude 프로세스 짝짓기:
 *   1) 등록부의 sessionId 가 패널이 연 ID 와 같으면 그 프로세스 (tmux 처럼 프로세스 트리가 끊겨도 된다)
 *   2) 아니면 claude 프로세스가 패널 셸의 자손인지 (프로세스 트리)
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DEPTH = 6;

function samePath(a, b) {
  if (!a || !b) return false;
  const norm = (p) => {
    const r = path.resolve(String(p)).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

/** sessions 폴더의 등록부 — 읽을 수 있고 세션 ID 가 올바른 것만. */
function readEntries(sessionsDir) {
  let names = [];
  try { names = fs.readdirSync(sessionsDir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(sessionsDir, name), 'utf8'));
      const pid = Number(d && d.pid);
      if (Number.isInteger(pid) && pid > 0 && SESSION_ID_RE.test(String(d.sessionId || ''))) {
        out.push({ pid, sessionId: String(d.sessionId), cwd: d.cwd ? String(d.cwd) : '' });
      }
    } catch { /* 쓰는 중이거나 깨진 파일 — 다음에 */ }
  }
  return out;
}

function isDescendant(pid, ancestor, parentOf) {
  let cur = pid;
  for (let i = 0; i < MAX_DEPTH && cur; i++) {
    const p = parentOf.get(cur);
    if (!p) return false;
    if (p === ancestor) return true;
    cur = p;
  }
  return false;
}

/**
 * @param sessions [{ key, shellPid, cwd, resumeId, claudePid, noTree }]  claudePid 는 이미 짝지은 claude 프로세스(없으면 0),
 *                 noTree 면 프로세스 트리로는 더 찾지 않는다(여러 번 못 찾은 패널)
 * @param entries  readEntries 결과
 * @param parentOf Map<pid, ppid> | null — 없으면 프로세스 트리로는 짝짓지 않는다
 * @returns { links: [{key, claudePid}], changes: [{key, sessionId}], needTree: boolean }
 */
function track(sessions, entries, parentOf) {
  const byPid = new Map(entries.map((e) => [e.pid, e]));
  const claimed = new Set(sessions.map((s) => s.claudePid).filter(Boolean));
  const links = [], changes = [];
  let needTree = false;
  for (const s of sessions) {
    let entry = s.claudePid ? byPid.get(s.claudePid) : null;
    if (s.claudePid && !entry) links.push({ key: s.key, claudePid: 0 });   // claude 가 끝났다
    if (!entry) {
      const free = entries.filter((e) => !claimed.has(e.pid) && samePath(e.cwd, s.cwd));
      entry = (s.resumeId && free.find((e) => e.sessionId === s.resumeId)) || null;
      if (!entry && free.length && !s.noTree) {
        if (parentOf) entry = free.find((e) => isDescendant(e.pid, s.shellPid, parentOf)) || null;
        else needTree = true;
      }
      if (entry) { claimed.add(entry.pid); links.push({ key: s.key, claudePid: entry.pid }); }
    }
    if (entry && entry.sessionId !== s.resumeId) changes.push({ key: s.key, sessionId: entry.sessionId });
  }
  return { links, changes, needTree };
}

/** 프로세스 트리 (pid → 부모 pid). 실패하면 null. */
function processTree() {
  return new Promise((resolve) => {
    const done = (err, out) => {
      if (err) return resolve(null);
      const map = new Map();
      for (const line of String(out).split(/\r?\n/)) {
        const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
        if (m) map.set(Number(m[1]), Number(m[2]));
      }
      resolve(map.size ? map : null);
    };
    if (process.platform === 'win32') {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'],
      { windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024 }, done);
    } else {
      execFile('ps', ['-A', '-o', 'pid=,ppid='], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, done);
    }
  });
}

module.exports = { readEntries, track, processTree, isDescendant, samePath };

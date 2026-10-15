'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readEntries, track } = require('../lib/claude-registry');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const CWD = path.resolve(os.tmpdir(), 'proj');

test('등록부 파일 읽기 — 올바른 것만', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-reg-'));
  fs.writeFileSync(path.join(dir, '100.json'), JSON.stringify({ pid: 100, sessionId: A, cwd: CWD }));
  fs.writeFileSync(path.join(dir, '200.json'), '{ 깨진');
  fs.writeFileSync(path.join(dir, '300.json'), JSON.stringify({ pid: 300, sessionId: 'nope', cwd: CWD }));
  fs.writeFileSync(path.join(dir, '400.abc.key'), 'x');
  assert.deepEqual(readEntries(dir), [{ pid: 100, sessionId: A, cwd: CWD }]);
  assert.deepEqual(readEntries(path.join(dir, 'none')), []);
});

test('연 ID 와 같은 등록부로 짝짓고, /clear 로 ID 가 바뀌면 알려 준다', () => {
  const sessions = [{ key: 'k1', shellPid: 10, cwd: CWD, resumeId: A, claudePid: 0 }];
  const r1 = track(sessions, [{ pid: 100, sessionId: A, cwd: CWD }], null);
  assert.deepEqual(r1.links, [{ key: 'k1', claudePid: 100 }]);
  assert.deepEqual(r1.changes, []);
  sessions[0].claudePid = 100;
  const r2 = track(sessions, [{ pid: 100, sessionId: B, cwd: CWD }], null);
  assert.deepEqual(r2.changes, [{ key: 'k1', sessionId: B }]);
});

test('같은 폴더에 세션이 여럿이어도 자기 프로세스만 따라간다', () => {
  const sessions = [
    { key: 'k1', shellPid: 10, cwd: CWD, resumeId: A, claudePid: 100 },
    { key: 'k2', shellPid: 20, cwd: CWD, resumeId: C, claudePid: 200 },
  ];
  const r = track(sessions, [{ pid: 100, sessionId: A, cwd: CWD }, { pid: 200, sessionId: B, cwd: CWD }], null);
  assert.deepEqual(r.changes, [{ key: 'k2', sessionId: B }]);
});

test('ID 로 못 찾으면 프로세스 트리로 — 셸의 자손인 claude', () => {
  const sessions = [
    { key: 'k1', shellPid: 10, cwd: CWD, resumeId: A, claudePid: 0 },
    { key: 'k2', shellPid: 20, cwd: CWD, resumeId: C, claudePid: 0 },
  ];
  const entries = [{ pid: 101, sessionId: B, cwd: CWD }];
  assert.equal(track(sessions, entries, null).needTree, true);
  const parentOf = new Map([[101, 50], [50, 20], [20, 1]]);   // claude 101 → node 50 → 셸 20
  const r = track(sessions, entries, parentOf);
  assert.deepEqual(r.links, [{ key: 'k2', claudePid: 101 }]);
  assert.deepEqual(r.changes, [{ key: 'k2', sessionId: B }]);
});

test('claude 가 끝나면 짝을 푼다', () => {
  const r = track([{ key: 'k1', shellPid: 10, cwd: CWD, resumeId: A, claudePid: 100 }], [], null);
  assert.deepEqual(r.links, [{ key: 'k1', claudePid: 0 }]);
  assert.deepEqual(r.changes, []);
});

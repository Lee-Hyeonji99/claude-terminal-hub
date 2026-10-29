'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { linkProfile, mergeDir, ensureClaudeMdImport, readUserMcpServers, CLAUDE_MD_IMPORT } = require('../lib/shared-config');

const roots = [];
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-share-'));
  roots.push(root);
  const main = path.join(root, 'main');
  const prof = path.join(root, 'prof');
  const backup = path.join(root, 'backup');
  const put = (base, rel, body) => {
    const f = path.join(base, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  };
  return { root, main, prof, backup, put };
}
const read = (f) => fs.readFileSync(f, 'utf8');

test('계정 폴더의 대화를 메인으로 옮기고 연결로 바꾼다', () => {
  const { main, prof, backup, put } = fixture();
  put(prof, 'projects/C--w/a.jsonl', 'A\n');
  put(prof, 'projects/C--w/a/subagents/agent-1.jsonl', 'S\n');
  put(prof, 'projects/C--w/memory/MEMORY.md', 'M');
  const r = linkProfile(prof, main, backup);
  assert.deepEqual(r.errors, []);
  assert.equal(read(path.join(main, 'projects/C--w/a.jsonl')), 'A\n');
  assert.equal(read(path.join(main, 'projects/C--w/a/subagents/agent-1.jsonl')), 'S\n');
  assert.equal(read(path.join(main, 'projects/C--w/memory/MEMORY.md')), 'M');
  assert.ok(fs.lstatSync(path.join(prof, 'projects')).isSymbolicLink());
  // 연결을 거쳐 쓰면 메인에 쌓인다
  fs.appendFileSync(path.join(prof, 'projects/C--w/a.jsonl'), 'B\n');
  assert.equal(read(path.join(main, 'projects/C--w/a.jsonl')), 'A\nB\n');
  assert.equal(r.conflicts.length, 0);
});

test('복사 후 한쪽에서만 이어 쓴 대화는 긴 쪽을 메인에 남긴다', () => {
  const { main, prof, backup, put } = fixture();
  put(main, 'projects/p/x.jsonl', 'one\n');
  put(prof, 'projects/p/x.jsonl', 'one\ntwo\n');     // 계정 쪽이 더 길다
  put(main, 'projects/p/y.jsonl', 'one\ntwo\n');
  put(prof, 'projects/p/y.jsonl', 'one\n');          // 메인 쪽이 더 길다
  const r = linkProfile(prof, main, backup);
  assert.equal(read(path.join(main, 'projects/p/x.jsonl')), 'one\ntwo\n');
  assert.equal(read(path.join(main, 'projects/p/y.jsonl')), 'one\ntwo\n');
  assert.deepEqual(r.conflicts, []);
  // 밀려난 짧은 사본도 지우지 않고 백업에 있다
  assert.equal(read(path.join(backup, 'projects/p/x.jsonl')), 'one\n');
});

test('양쪽이 갈라진 대화는 메인을 그대로 두고 계정 쪽을 백업한다', () => {
  const { main, prof, backup, put } = fixture();
  put(main, 'projects/p/z.jsonl', 'one\nmain\n');
  put(prof, 'projects/p/z.jsonl', 'one\nsub\n');
  const r = linkProfile(prof, main, backup);
  assert.deepEqual(r.conflicts, ['projects/p/z.jsonl']);
  assert.equal(read(path.join(main, 'projects/p/z.jsonl')), 'one\nmain\n');
  assert.equal(read(path.join(backup, 'projects/p/z.jsonl')), 'one\nsub\n');
  assert.equal(r.backup, backup);
});

test('다시 불러도 아무것도 바꾸지 않는다', () => {
  const { main, prof, backup, put } = fixture();
  put(prof, 'agents/a.md', 'x');
  linkProfile(prof, main, backup);
  const r2 = linkProfile(prof, main, backup);
  assert.deepEqual(r2.linked, []);
  assert.deepEqual(r2.errors, []);
  assert.equal(read(path.join(prof, 'agents/a.md')), 'x');
});

test('로그인 파일은 건드리지 않는다', () => {
  const { main, prof, backup, put } = fixture();
  put(prof, '.credentials.json', 'secret');
  put(prof, '.claude.json', '{}');
  linkProfile(prof, main, backup);
  assert.equal(read(path.join(prof, '.credentials.json')), 'secret');
  assert.ok(!fs.existsSync(path.join(main, '.credentials.json')));
});

test('CLAUDE.md 에 메인 지침 불러오기를 한 번만 넣는다', () => {
  const { prof, put } = fixture();
  put(prof, 'CLAUDE.md', '# 내 메모\n');
  assert.equal(ensureClaudeMdImport(prof), true);
  assert.equal(ensureClaudeMdImport(prof), false);
  const body = read(path.join(prof, 'CLAUDE.md'));
  assert.ok(body.startsWith(CLAUDE_MD_IMPORT + '\n'));
  assert.ok(body.includes('# 내 메모'));
});

test('mergeDir 는 메인에 없는 폴더를 통째로 옮긴다', () => {
  const { root, put } = fixture();
  const a = path.join(root, 'a'); const b = path.join(root, 'b');
  put(a, 'x/y/z.txt', 'z');
  const r = mergeDir(a, b);
  assert.equal(r.moved, 1);
  assert.equal(read(path.join(b, 'x/y/z.txt')), 'z');
});

test('메인 .claude.json 의 MCP 서버를 읽는다', () => {
  const { root, put } = fixture();
  put(root, 'c.json', JSON.stringify({ oauthAccount: { emailAddress: 'a@b' }, mcpServers: { x: { command: 'npx' } } }));
  assert.deepEqual(readUserMcpServers(path.join(root, 'c.json')), { x: { command: 'npx' } });
  put(root, 'd.json', '{}');
  assert.equal(readUserMcpServers(path.join(root, 'd.json')), null);
  assert.equal(readUserMcpServers(path.join(root, 'none.json')), null);
});

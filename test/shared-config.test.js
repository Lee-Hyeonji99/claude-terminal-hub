'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { linkProfile, mergeDir, importProjects, ensureClaudeMdImport, CLAUDE_MD_IMPORT } = require('../lib/shared-config');

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
  const opts = (extra) => ({ backupDir: backup, baseDir: path.join(root, 'base'), ...extra });
  return { root, main, prof, backup, put, opts };
}
const read = (f) => fs.readFileSync(f, 'utf8');
const isLink = (p) => fs.lstatSync(p).isSymbolicLink();

test('계정 폴더의 대화를 메인으로 옮기고 연결로 바꾼다', () => {
  const { main, prof, put, opts } = fixture();
  put(prof, 'projects/C--w/a.jsonl', 'A\n');
  put(prof, 'projects/C--w/a/subagents/agent-1.jsonl', 'S\n');
  put(prof, 'projects/C--w/memory/MEMORY.md', 'M');
  const r = linkProfile(prof, main, opts());
  assert.deepEqual(r.errors, []);
  assert.equal(r.projectsReady, true);
  assert.equal(read(path.join(main, 'projects/C--w/a.jsonl')), 'A\n');
  assert.equal(read(path.join(main, 'projects/C--w/a/subagents/agent-1.jsonl')), 'S\n');
  assert.equal(read(path.join(main, 'projects/C--w/memory/MEMORY.md')), 'M');
  assert.ok(isLink(path.join(prof, 'projects')));
  // 연결을 거쳐 쓰면 메인에 쌓인다
  fs.appendFileSync(path.join(prof, 'projects/C--w/a.jsonl'), 'B\n');
  assert.equal(read(path.join(main, 'projects/C--w/a.jsonl')), 'A\nB\n');
  assert.equal(r.conflicts.length, 0);
});

test('복사 후 한쪽에서만 이어 쓴 대화는 긴 쪽을 메인에 남긴다', () => {
  const { main, prof, backup, put, opts } = fixture();
  put(main, 'projects/p/x.jsonl', 'one\n');
  put(prof, 'projects/p/x.jsonl', 'one\ntwo\n');     // 계정 쪽이 더 길다
  put(main, 'projects/p/y.jsonl', 'one\ntwo\n');
  put(prof, 'projects/p/y.jsonl', 'one\n');          // 메인 쪽이 더 길다
  const r = linkProfile(prof, main, opts());
  assert.equal(read(path.join(main, 'projects/p/x.jsonl')), 'one\ntwo\n');
  assert.equal(read(path.join(main, 'projects/p/y.jsonl')), 'one\ntwo\n');
  assert.deepEqual(r.conflicts, []);
  // 밀려난 짧은 사본도 지우지 않고 백업에 있다
  assert.equal(read(path.join(backup, 'projects/p/x.jsonl')), 'one\n');
});

test('양쪽이 갈라진 대화는 메인을 그대로 두고 계정 쪽을 백업한다', () => {
  const { main, prof, backup, put, opts } = fixture();
  put(main, 'projects/p/z.jsonl', 'one\nmain\n');
  put(prof, 'projects/p/z.jsonl', 'one\nsub\n');
  const r = linkProfile(prof, main, opts());
  assert.deepEqual(r.conflicts, ['projects/p/z.jsonl']);
  assert.equal(read(path.join(main, 'projects/p/z.jsonl')), 'one\nmain\n');
  assert.equal(read(path.join(backup, 'projects/p/z.jsonl')), 'one\nsub\n');
  assert.equal(r.backup, backup);
});

test('다시 불러도 아무것도 바꾸지 않는다', () => {
  const { main, prof, put, opts } = fixture();
  put(prof, 'agents/a.md', 'x');
  put(main, 'skills/s/SKILL.md', 's');
  linkProfile(prof, main, opts());
  const r2 = linkProfile(prof, main, opts());
  assert.deepEqual(r2.linked, []);
  assert.deepEqual(r2.errors, []);
  assert.equal(read(path.join(prof, 'agents/a.md')), 'x');
});

test('로그인 파일은 건드리지 않는다', () => {
  const { main, prof, put, opts } = fixture();
  put(prof, '.credentials.json', 'secret');
  put(prof, '.claude.json', '{}');
  linkProfile(prof, main, opts());
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

test('그 계정 claude 가 돌고 있으면 실제 폴더는 옮기지 않고 미뤄 둔다', () => {
  const { main, prof, put, opts } = fixture();
  put(prof, 'projects/p/a.jsonl', 'A\n');
  const r = linkProfile(prof, main, opts({ canMove: () => false }));
  assert.ok(r.pending.includes('projects'));
  assert.equal(r.projectsReady, false);
  assert.equal(read(path.join(prof, 'projects/p/a.jsonl')), 'A\n');
  assert.ok(!fs.existsSync(path.join(main, 'projects/p/a.jsonl')));
  // 꺼진 뒤에는 옮기고 연결한다
  const r2 = linkProfile(prof, main, opts());
  assert.equal(r2.projectsReady, true);
  assert.equal(read(path.join(main, 'projects/p/a.jsonl')), 'A\n');
});

test('이미 연결돼 있으면 claude 가 돌고 있어도 준비된 것으로 보고, 묻지도 않는다', () => {
  const { main, prof, opts } = fixture();
  linkProfile(prof, main, opts());
  let asked = 0;
  const r = linkProfile(prof, main, opts({ canMove: () => { asked++; return false; } }));
  assert.equal(r.projectsReady, true);
  assert.deepEqual(r.pending, []);
  assert.equal(asked, 0); // 옮길 게 없으면 등록부(비싼 확인)를 보지 않는다
});

test('되돌리기 · 작업 목록 폴더도 공유한다 — 상태 파일은 새로운 쪽을 남긴다', () => {
  const { main, prof, backup, put, opts } = fixture();
  put(main, 'tasks/s1/list.json', 'old');
  put(prof, 'tasks/s1/list.json', 'new');
  const past = new Date(Date.now() - 60000);
  fs.utimesSync(path.join(main, 'tasks/s1/list.json'), past, past);
  put(prof, 'file-history/s1/abc@v1', 'B');
  linkProfile(prof, main, opts());
  assert.equal(read(path.join(main, 'tasks/s1/list.json')), 'new');
  assert.equal(read(path.join(backup, 'tasks/s1/list.json')), 'old');
  assert.equal(read(path.join(main, 'file-history/s1/abc@v1')), 'B');
  assert.ok(isLink(path.join(prof, 'file-history')));
});

test('실행 중 세션 목록(sessions)도 공유한다 — 그 계정 claude 가 돌고 있으면 미룬다', () => {
  const { main, prof, put, opts } = fixture();
  put(prof, 'sessions/123.json', '{"pid":123}');
  put(prof, 'sessions/123.abc.key', 'k');
  const r = linkProfile(prof, main, opts({ canMove: () => false }));
  assert.ok(r.pending.includes('sessions'));
  assert.ok(!isLink(path.join(prof, 'sessions')));
  linkProfile(prof, main, opts());
  assert.ok(isLink(path.join(prof, 'sessions')));
  assert.equal(read(path.join(main, 'sessions/123.json')), '{"pid":123}');
  assert.equal(read(path.join(main, 'sessions/123.abc.key')), 'k');
});

test('skills 는 항목별로 잇고 계정 전용 synced 는 따로 둔다', () => {
  const { main, prof, put, opts } = fixture();
  put(main, 'skills/foo/SKILL.md', 'foo');
  put(main, 'skills/synced/remote/SKILL.md', 'main-synced');
  // v1.27 처럼 skills 를 통째로 연결해 둔 계정
  fs.mkdirSync(prof, { recursive: true });
  fs.symlinkSync(path.join(main, 'skills'), path.join(prof, 'skills'), 'junction');
  const r = linkProfile(prof, main, opts());
  assert.deepEqual(r.errors, []);
  assert.ok(!isLink(path.join(prof, 'skills')));
  assert.ok(isLink(path.join(prof, 'skills/foo')));
  assert.equal(read(path.join(prof, 'skills/foo/SKILL.md')), 'foo');
  assert.ok(!fs.existsSync(path.join(prof, 'skills/synced')));
  // 계정이 받은 synced 는 메인에 섞이지 않는다
  put(prof, 'skills/synced/mine/SKILL.md', 'acct');
  assert.ok(!fs.existsSync(path.join(main, 'skills/synced/mine')));
  // 계정에서 만든 스킬은 메인으로 올라가 모든 계정이 쓴다
  put(prof, 'skills/bar/SKILL.md', 'bar');
  linkProfile(prof, main, opts());
  assert.equal(read(path.join(main, 'skills/bar/SKILL.md')), 'bar');
  assert.ok(isLink(path.join(prof, 'skills/bar')));
});

test('plugins 는 계정마다 따로 둔다(설치 목록과 설치본이 갈라지면 서로 지울 수 있다)', () => {
  const { main, prof, put, opts } = fixture();
  put(main, 'plugins/installed_plugins.json', '{"a":1,"b":1}');
  put(prof, 'plugins/installed_plugins.json', '{"a":1}');
  put(prof, 'plugins/cache/a/plugin.json', 'A');
  linkProfile(prof, main, opts());
  assert.ok(!isLink(path.join(prof, 'plugins')));
  assert.equal(read(path.join(prof, 'plugins/installed_plugins.json')), '{"a":1}');
  assert.equal(read(path.join(prof, 'plugins/cache/a/plugin.json')), 'A');
});

test('skills 안에 사용자가 직접 건 연결은 지우지 않고, 메인 쪽이 외부로 가는 연결이면 그 안으로 옮기지 않는다', () => {
  const { root, main, prof, put, opts } = fixture();
  const ext = path.join(root, 'ext-repo');
  put(ext, 'SKILL.md', 'ext');
  put(root, 'dev/mine/SKILL.md', 'dev');
  fs.mkdirSync(path.join(main, 'skills'), { recursive: true });
  fs.symlinkSync(ext, path.join(main, 'skills/shared-ext'), 'junction');
  put(prof, 'skills/shared-ext/SKILL.md', 'acct'); // 같은 이름의 계정 쪽 실제 폴더
  fs.symlinkSync(path.join(root, 'dev/mine'), path.join(prof, 'skills/mine'), 'junction');
  const r = linkProfile(prof, main, opts());
  assert.equal(read(path.join(ext, 'SKILL.md')), 'ext');               // 외부 저장소는 그대로
  assert.equal(read(path.join(prof, 'skills/shared-ext/SKILL.md')), 'acct');
  assert.ok(r.kept.includes('skills/shared-ext'));
  assert.equal(read(path.join(prof, 'skills/mine/SKILL.md')), 'dev');   // 사용자 연결 유지
});

test('목록에서 빠진 계정 폴더의 대화는 복사만 하고 원본과 메인은 그대로 둔다', () => {
  const { main, prof, backup, put } = fixture();
  put(prof, 'projects/p/new.jsonl', 'N\n');
  put(prof, 'projects/p/both.jsonl', 'one\nsub\n');
  put(main, 'projects/p/both.jsonl', 'one\nmain\n');
  const r = importProjects(path.join(prof, 'projects'), path.join(main, 'projects'), backup);
  assert.equal(read(path.join(main, 'projects/p/new.jsonl')), 'N\n');
  assert.equal(read(path.join(prof, 'projects/p/new.jsonl')), 'N\n');
  assert.equal(read(path.join(main, 'projects/p/both.jsonl')), 'one\nmain\n');
  assert.equal(read(path.join(backup, 'p/both.jsonl')), 'one\nsub\n');
  assert.deepEqual(r.conflicts, ['p/both.jsonl']);
});

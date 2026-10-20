'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanSubagents, subagentDir, isEnded } = require('../lib/subagents');

const line = (o) => JSON.stringify(o) + '\n';
const toolUse = (name, input) => line({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
const endTurn = line({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '끝' }] } });

const roots = [];
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-sub-'));
  roots.push(root);
  const jsonl = path.join(root, 'sess.jsonl');
  fs.writeFileSync(jsonl, '');
  const dir = subagentDir(jsonl);
  fs.mkdirSync(dir, { recursive: true });
  const add = (id, meta, body) => {
    fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify(meta));
    fs.writeFileSync(path.join(dir, `agent-${id}.jsonl`), body);
  };
  return { root, jsonl, dir, add };
}

test('서브에이전트 폴더 = 대화 기록 파일 이름 폴더 아래 subagents', () => {
  assert.equal(subagentDir(path.join('a', 'b', 'x.jsonl')), path.join('a', 'b', 'x', 'subagents'));
});

test('끝남 판정 — 마지막 assistant 가 도구 없이 멈춤(end_turn · max_tokens 등)', () => {
  assert.equal(isEnded(toolUse('Read', { file_path: 'a.js' })), false);
  assert.equal(isEnded(toolUse('Read', { file_path: 'a.js' }) + endTurn), true);
  assert.equal(isEnded(endTurn + toolUse('Grep', { pattern: 'x' })), false);
  assert.equal(isEnded(line({ type: 'assistant', message: { stop_reason: 'max_tokens', content: [{ type: 'text', text: '…' }] } })), true);
});

test('끝남 판정 — 마지막 줄이 잘려 있으면 모른다(null) → 더 크게 다시 읽는다', () => {
  assert.equal(isEnded('잘린 줄 "assistant" ... }\n'), null);
});

test('마지막 보고가 64KB 를 넘어도 끝난 것으로 본다', () => {
  const f = fixture();
  const big = line({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'x'.repeat(200 * 1024) }] } });
  f.add('e1', { agentType: 'general-purpose', description: '긴 보고' }, toolUse('Read', { file_path: 'a' }) + big);
  assert.equal(scanSubagents(f.jsonl, { now: Date.now() })[0].state, 'done');
});

test('시작 시각 = 기록 첫 줄의 timestamp', () => {
  const f = fixture();
  const t0 = Date.now() - 30000;
  f.add('g1', { agentType: 'Explore', description: '' }, line({ type: 'user', timestamp: new Date(t0).toISOString(), message: { content: '찾아줘' } }) + toolUse('Grep', { pattern: 'x' }));
  assert.equal(scanSubagents(f.jsonl, { now: Date.now() })[0].since, t0);
});

test('캐시 — 파일이 그대로면 다시 읽지 않고 같은 결과', () => {
  const f = fixture();
  f.add('h1', { agentType: 'Explore', description: '찾기' }, toolUse('Grep', { pattern: 'x' }));
  const cache = new Map();
  const a = scanSubagents(f.jsonl, { now: Date.now(), cache });
  assert.equal(cache.size, 1);
  const b = scanSubagents(f.jsonl, { now: Date.now(), cache });
  assert.deepEqual(b, a);
});

test('도는 중인 서브에이전트 — 종류 · 설명 · 지금 도구', () => {
  const f = fixture();
  f.add('a1', { agentType: 'code-reviewer', description: '변경 리뷰' }, toolUse('Read', { file_path: 'C:/x/hud-view.js' }));
  const [s] = scanSubagents(f.jsonl, { now: Date.now() });
  assert.equal(s.id, 'a1');
  assert.equal(s.type, 'code-reviewer');
  assert.equal(s.desc, '변경 리뷰');
  assert.equal(s.state, 'work');
  assert.equal(s.tool, 'Read');
  assert.equal(s.target, 'hud-view.js');
});

test('끝난 것은 잠깐 done 으로 남았다가 빠진다', () => {
  const f = fixture();
  f.add('b1', { agentType: 'planner', description: '계획', finished: true }, endTurn);
  const now = Date.now();
  const [s] = scanSubagents(f.jsonl, { now, keepDoneMs: 8000 });
  assert.equal(s.state, 'done');
  assert.equal(s.tool, '');
  assert.deepEqual(scanSubagents(f.jsonl, { now: now + 60000, keepDoneMs: 8000 }), []);
});

test('오래 아무 변화 없는 것은 끝난 것으로 본다(옛 기록에 finished 가 없을 때)', () => {
  const f = fixture();
  f.add('c1', { agentType: 'Explore', description: '찾기' }, toolUse('Grep', { pattern: 'x' }));
  assert.deepEqual(scanSubagents(f.jsonl, { now: Date.now() + 60 * 60 * 1000 }), []);
});

test('폴더가 없거나 메타가 깨져도 빈 목록', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.dir, 'agent-bad.meta.json'), '{깨짐');
  fs.writeFileSync(path.join(f.dir, 'agent-bad.jsonl'), toolUse('Read', { file_path: 'a' }));
  assert.equal(scanSubagents(f.jsonl, { now: Date.now() })[0].type, 'agent');
  assert.deepEqual(scanSubagents(path.join(f.root, 'none.jsonl'), { now: Date.now() }), []);
});

test('도는 중 → 시작 순, 끝난 것은 뒤로', () => {
  const f = fixture();
  f.add('d2', { agentType: 'B', description: '' }, toolUse('Read', { file_path: 'b' }));
  f.add('d1', { agentType: 'A', description: '', finished: true }, endTurn);
  const list = scanSubagents(f.jsonl, { now: Date.now() });
  assert.deepEqual(list.map((s) => s.state), ['work', 'done']);
});

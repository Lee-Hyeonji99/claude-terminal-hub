'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { layoutRoom, skyAt, minionPick } = require('../public/room-view.js');

const s = (o) => ({ title: o.key, project: o.project, projectKey: o.project, projectId: '/' + o.project, hue: 10, subagents: [], ...o });

test('작업 중 프로젝트는 책상에, 넘치면 개수만', () => {
  const items = ['a', 'b', 'c', 'd'].map((p, i) => s({ key: p + '1', project: p, state: 'work', since: 1000 + i }));
  const r = layoutRoom(items, 5000);
  assert.equal(r.desks.length, 3);
  assert.equal(r.extraWork, 1);
  assert.deepEqual(r.desks.map((d) => d.projectKey), ['a', 'b', 'c']);   // 오래 일한 순
  assert.equal(r.desks[0].sessionKey, 'a1');
});

test('서브에이전트는 그 프로젝트 책상 옆 꼬마 — 도는 것 먼저, 넘치면 개수', () => {
  const subs = ['x1', 'x2', 'x3', 'x4', 'x5'].map((id, i) => ({ id, type: 'Explore', state: i === 0 ? 'done' : 'work', since: i }));
  const r = layoutRoom([s({ key: 'a1', project: 'a', state: 'work', since: 1, subagents: subs })], 10);
  const d = r.desks[0];
  assert.equal(d.minions.length, 4);
  assert.equal(d.minions[0].state, 'work');
  assert.equal(d.extraMinions, 1);
  assert.equal(r.stats.subs, 4);
});

test('질문은 세션마다 줄을 선다 — 오래 기다린 순, 맨 앞 서류는 책상 위', () => {
  const q = (text) => ({ kind: 'question', text, options: ['예', '아니오'] });
  const items = [
    s({ key: 'q2', project: 'b', state: 'ask', since: 300, question: q('둘째') }),
    s({ key: 'q1', project: 'a', state: 'ask', since: 100, question: q('첫째') }),
    s({ key: 'q3', project: 'c', state: 'ask', since: 500, question: { kind: 'permission', text: 'push?', options: [] } }),
  ];
  const r = layoutRoom(items, 1000);
  assert.deepEqual(r.queue.map((x) => x.key), ['q1', 'q2', 'q3']);
  assert.equal(r.queue[2].kind, 'permission');
  assert.equal(r.paper.key, 'q1');
  assert.equal(r.paper.text, '첫째');
  assert.ok(r.queue[0].size > r.queue[1].size);
});

test('쉬는 프로젝트는 소파, 끝난 세션은 결재함', () => {
  const items = [
    s({ key: 'r1', project: 'r', state: 'idle' }),
    s({ key: 'r2', project: 'r', state: 'done', doneAt: 50 }),
    s({ key: 'z1', project: 'z', state: 'done', doneAt: 20 }),
  ];
  const r = layoutRoom(items, 100);
  assert.deepEqual(r.sofa.map((p) => p.projectKey).sort(), ['r', 'z']);
  assert.equal(r.inbox.count, 2);
  assert.equal(r.inbox.firstKey, 'z1');   // 먼저 끝난 것부터
  assert.deepEqual(r.stats, { work: 0, ask: 0, rest: 2, subs: 0, done: 2 });
});

test('빈 방', () => {
  const r = layoutRoom([], 0);
  assert.deepEqual([r.desks.length, r.queue.length, r.sofa.length, r.inbox.count], [0, 0, 0, 0]);
  assert.equal(r.paper, null);
});

test('하늘 — 낮엔 해, 밤엔 달과 별, 노을엔 낮은 해와 주황빛', () => {
  const noon = skyAt(12 * 60);
  assert.equal(noon.isDay, true);
  assert.equal(noon.phase, '한낮');
  assert.equal(noon.starAlpha, 0);
  assert.equal(noon.lampOn, false);
  const night = skyAt(23 * 60);
  assert.equal(night.isDay, false);
  assert.equal(night.starAlpha, 1);
  assert.equal(night.lampOn, true);
  const dusk = skyAt(18 * 60 + 40);
  assert.equal(dusk.sunLow, true);
  assert.match(dusk.tint, /^rgba\(255,140,60/);
  assert.match(skyAt(15 * 60).top, /^rgb\(/);
});

test('꼬마 팩 — 같은 서브에이전트는 늘 같은 팩', () => {
  const packs = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
  assert.equal(minionPick(packs, 'abc'), minionPick(packs, 'abc'));
  assert.equal(minionPick([], 'abc'), null);
});

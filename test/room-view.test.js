'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { layoutRoom, skyAt, minionPick, zoomAt, panBy } = require('../public/room-view.js');

const s = (o) => ({ title: o.key, project: o.project, projectKey: o.project, projectId: '/' + o.project, hue: 10, subagents: [], ...o });

test('작업 중 프로젝트는 책상에(4개씩 2줄, 최대 8), 넘치면 개수만', () => {
  const items = 'abcdefghij'.split('').map((p, i) => s({ key: p + '1', project: p, state: 'work', since: 1000 + i }));
  const r = layoutRoom(items, 5000);
  assert.equal(r.desks.length, 8);
  assert.equal(r.extraWork, 2);
  assert.deepEqual(r.desks.slice(0, 3).map((d) => d.projectKey), ['a', 'b', 'c']);   // 오래 일한 순
  assert.equal(r.desks[0].sessionKey, 'a1');
  assert.deepEqual([...new Set(r.desks.map((d) => d.y))], [290, 600]);
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

test('휠 확대 — 커서 아래 지점이 그대로 남고, 100~400% · 무대 밖으로 못 나감', () => {
  const v0 = { zoom: 1, ox: 0, oy: 0 };
  const v1 = zoomAt(v0, 900, 480, 2);          // 무대 가운데에서 2배
  assert.equal(v1.zoom, 2);
  assert.deepEqual([v1.ox, v1.oy], [450, 240]);
  // 커서 아래 무대 좌표 = ox + cx / zoom 이 그대로
  assert.equal(v1.ox + 900 / v1.zoom, 900);
  const corner = zoomAt(v0, 0, 0, 3);           // 왼쪽 위 모서리
  assert.deepEqual([corner.ox, corner.oy], [0, 0]);
  assert.equal(zoomAt(v0, 10, 10, 0.5).zoom, 1);   // 100% 아래로는 안 줄어듦
  assert.equal(zoomAt({ zoom: 4.8, ox: 0, oy: 0 }, 0, 0, 2).zoom, 5);
  const back = zoomAt(v1, 900, 600, 0.1);       // 다시 100% 면 원위치
  assert.deepEqual(back, { zoom: 1, ox: 0, oy: 0 });
});

test('확대 중 끌기 — 무대 안에서만 움직인다', () => {
  const v = { zoom: 2, ox: 100, oy: 100 };
  assert.deepEqual(panBy(v, 40, 20), { zoom: 2, ox: 80, oy: 90 });
  assert.deepEqual(panBy(v, 1000, 1000), { zoom: 2, ox: 0, oy: 0 });
  assert.deepEqual(panBy(v, -5000, -5000), { zoom: 2, ox: 900, oy: 480 });
});

test('질문 줄은 다 보인다 — 맨 앞은 내 책상 앞, 나머지는 바닥 줄에 촘촘히', () => {
  const ask = (n) => Array.from({ length: n }, (_, i) => s({ key: `q${i}`, project: `p${i}`, state: 'ask', since: i }));
  const r12 = layoutRoom(ask(12), 100);
  assert.equal(r12.queue.length, 12);
  assert.equal(r12.extraAsk, 0);
  assert.equal(r12.queue[0].size, 104);
  const row = r12.queue.slice(1);
  assert.ok(row.every((q) => q.y === row[0].y));                 // 한 줄
  assert.ok(row.every((q, i) => i === 0 || q.x < row[i - 1].x));  // 왼쪽으로 이어짐
  assert.ok(row.every((q) => q.x >= 0));
  assert.ok(r12.queue.every((q) => q.x + q.size <= 1550));        // 내 책상(1560~) 앞까지
  const r30 = layoutRoom(ask(30), 100);
  assert.equal(r30.queue.length, 30);
  const r50 = layoutRoom(ask(50), 100);
  assert.equal(r50.queue.length, 40);
  assert.equal(r50.extraAsk, 10);
});

test('소파 두 개 16명까지 — 한 소파에 3명이 넘으면 작게 붙어 앉는다', () => {
  const rest = (n) => Array.from({ length: n }, (_, i) => s({ key: `r${i}`, project: `r${i}`, state: 'idle' }));
  const r6 = layoutRoom(rest(6), 0);
  assert.equal(r6.sofa.length, 6);
  assert.equal(r6.sofa[0].size, 80);
  const r10 = layoutRoom(rest(10), 0);
  assert.equal(r10.sofa.length, 10);
  assert.equal(r10.sofa[0].size, 64);
  assert.ok(r10.sofa.every((p) => p.x >= 1060 && p.x + p.size <= 1430));
  const r20 = layoutRoom(rest(20), 0);
  assert.equal(r20.sofa.length, 16);
  assert.equal(r20.extraRest, 4);
});

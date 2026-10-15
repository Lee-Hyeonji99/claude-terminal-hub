'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { groupProjects, summary, clock } = require('../public/hud-view.js');

const s = (o) => ({ key: o.key, title: o.key, project: o.project, projectKey: o.project, hue: 10, character: o.character || '', state: o.state, since: o.since || 0 });

test('작업 시간 표기 — mm:ss, 한 시간이 넘으면 h:mm:ss', () => {
  assert.equal(clock(134 * 1000), '02:14');
  assert.equal(clock(41 * 1000), '00:41');
  assert.equal(clock((3600 + 65) * 1000), '1:01:05');
});

test('세션을 프로젝트(탭)로 묶고 상태를 정한다 — 작업 중 > 질문 > 쉬는 중', () => {
  const items = [
    s({ key: 'a1', project: 'nexus', state: 'idle' }),
    s({ key: 'a2', project: 'nexus', state: 'work', since: 500 }),
    s({ key: 'a3', project: 'nexus', state: 'work', since: 200 }),
    s({ key: 'b1', project: 'hub', state: 'ask' }),
    s({ key: 'c1', project: 'docs', state: 'done' }),
  ];
  const ps = groupProjects(items);
  assert.deepEqual(ps.map((p) => [p.key, p.state]), [['nexus', 'work'], ['hub', 'ask'], ['docs', 'rest']]);
  const nexus = ps[0];
  assert.equal(nexus.since, 200);                       // 가장 오래 일한 세션 기준
  assert.equal(nexus.workingCount, 2);
  assert.deepEqual(nexus.sessions.map((x) => x.key), ['a3', 'a2', 'a1']);   // 작업 중(오래된 순) → 쉬는 중
});

test('캐릭터 테마가 있으면 캐릭터 이름 + 프로젝트, 없으면 프로젝트 이름', () => {
  const [withChar] = groupProjects([s({ key: 'x', project: 'nexus', character: '우사기', state: 'idle' })]);
  assert.equal(withChar.name, '우사기');
  assert.equal(withChar.sub, 'nexus');
  const [plain] = groupProjects([s({ key: 'y', project: 'hub', state: 'idle' })]);
  assert.equal(plain.name, 'hub');
});

test('요약 한 줄', () => {
  assert.equal(summary([s({ key: 'a', project: 'p', state: 'work' }), s({ key: 'b', project: 'p', state: 'work' }), s({ key: 'c', project: 'q', state: 'ask' })]),
    '프로젝트 1곳 · 세션 2개 작업 중');
  assert.equal(summary([s({ key: 'c', project: 'q', state: 'ask' })]), '질문 1곳 기다리는 중');
  assert.equal(summary([s({ key: 'd', project: 'r', state: 'idle' })]), '모두 쉬는 중');
});

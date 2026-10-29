'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { groupProjects, summary, clock, sessionsOpen, sessionToolText, subagentText, hasRunningSubagents } = require('../public/hud-view.js');

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

test('세션 목록 펼침 — 기본은 작업 중만, showAll 이면 전부, 접어 둔 건 접힘', () => {
  const [work, rest] = groupProjects([s({ key: 'a', project: 'p', state: 'work' }), s({ key: 'b', project: 'q', state: 'idle' })]);
  assert.equal(sessionsOpen(work), true);
  assert.equal(sessionsOpen(rest), false);
  assert.equal(sessionsOpen(rest, { showAll: true }), true);
  assert.equal(sessionsOpen(rest, { showAll: true, isFolded: (k) => k === 'q' }), false);
});

test('세션 도구 줄 — 서브에이전트가 돌면 개수, 아니면 지금 도구', () => {
  const sub = (state) => ({ id: state, type: 'Explore', state });
  assert.equal(sessionToolText({ state: 'work', tool: 'Agent', target: '찾기', subagents: [sub('work'), sub('work'), sub('done')] }), '에이전트 2개 실행 중');
  assert.equal(sessionToolText({ state: 'work', tool: 'Edit', target: 'a.js', subagents: [sub('work')] }), 'Edit · a.js');
  assert.equal(sessionToolText({ state: 'work', tool: 'Agent', target: '찾기', subagents: [sub('done')] }), 'Agent · 찾기');
  assert.equal(sessionToolText({ state: 'idle', tool: 'Edit', subagents: [sub('work')] }), '');
});

test('서브에이전트 한 줄 — 종류 · 설명 / 도구, 끝나면 «완료»', () => {
  assert.deepEqual(subagentText({ type: 'code-reviewer', desc: '변경 리뷰', state: 'work', tool: 'Read', target: 'a.js' }),
    { type: 'code-reviewer', desc: '변경 리뷰', tool: 'Read · a.js' });
  assert.deepEqual(subagentText({ type: 'planner', desc: '계획', state: 'done', tool: 'Read' }),
    { type: 'planner', desc: '계획 · 완료', tool: '' });
});

test('서브에이전트가 돌고 있으면 그 세션은 일하는 중 — 부모 화면이 조용해도', () => {
  assert.equal(hasRunningSubagents([{ state: 'work' }, { state: 'done' }]), true);
  assert.equal(hasRunningSubagents([{ state: 'done' }]), false);
  assert.equal(hasRunningSubagents(undefined), false);
});

test('같은 프로젝트는 계정이 달라도 한 묶음 — 부제에 계정을 모두 적는다', () => {
  const ps = groupProjects([
    { ...s({ key: 'a', project: 'hub', state: 'idle' }), profile: '[팀] 기본' },
    { ...s({ key: 'b', project: 'hub', state: 'work' }), profile: 'everyun' },
    { ...s({ key: 'c', project: 'hub', state: 'idle' }), profile: 'everyun' },
  ]);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].sub, '[팀] 기본 · everyun');
});

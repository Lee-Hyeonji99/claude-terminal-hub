'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickAction } = require('../public/pet-mood.js');

const ALL = ['idle', 'walk', 'run', 'pose', 'happy', 'sleepy', 'look-around'];
const base = { actions: ALL, questions: 0, done: 0, working: 0, dragging: false, idleMs: 0, roll: 0.99 };

test('끌고 있으면 run', () => {
  assert.equal(pickAction({ ...base, dragging: true, questions: 2 }), 'run');
});

test('질문이 있으면 pose (완료·작업보다 우선)', () => {
  assert.equal(pickAction({ ...base, questions: 1, done: 1, working: 1 }), 'pose');
});

test('작업 완료가 있으면 happy', () => {
  assert.equal(pickAction({ ...base, done: 1, working: 1 }), 'happy');
});

test('Claude 가 일하는 중이면 walk', () => {
  assert.equal(pickAction({ ...base, working: 1 }), 'walk');
});

test('오래 아무 일 없으면 sleepy', () => {
  assert.equal(pickAction({ ...base, idleMs: 10 * 60 * 1000 }), 'sleepy');
});

test('평소엔 idle, 가끔 look-around', () => {
  assert.equal(pickAction({ ...base, roll: 0.9 }), 'idle');
  assert.equal(pickAction({ ...base, roll: 0.05 }), 'look-around');
});

test('팩에 없는 동작은 대체 동작으로', () => {
  assert.equal(pickAction({ ...base, actions: ['idle', 'happy'], working: 1 }), 'idle');
  assert.equal(pickAction({ ...base, actions: ['idle', 'happy'], questions: 1 }), 'happy');
  assert.equal(pickAction({ ...base, actions: ['idle'], dragging: true }), 'idle');
});

test('idle 도 없으면 아무거나 첫 동작', () => {
  assert.equal(pickAction({ ...base, actions: ['pose'] }), 'pose');
});

test('동작이 하나도 없으면 null', () => {
  assert.equal(pickAction({ ...base, actions: [] }), null);
});

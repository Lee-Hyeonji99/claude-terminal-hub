'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { keepOnTop, LEVEL } = require('../electron/keep-on-top');

function fakeWin() {
  const w = new EventEmitter();
  w.top = false; w.level = null; w.visible = true; w.destroyed = false; w.moves = 0;
  w.isDestroyed = () => w.destroyed;
  w.isVisible = () => w.visible;
  w.isAlwaysOnTop = () => w.top;
  w.setAlwaysOnTop = (on, level) => { w.top = on; w.level = level; };
  w.moveTop = () => { w.moves++; };
  return w;
}

test('가장 높은 단계로 항상 위를 건다', () => {
  const w = fakeWin();
  keepOnTop(w, { everyMs: 60000 });
  assert.equal(w.top, true);
  assert.equal(w.level, LEVEL);
  w.emit('closed');
});

test('항상 위가 풀리면 바로 다시 건다', () => {
  const w = fakeWin();
  keepOnTop(w, { everyMs: 60000 });
  w.top = false;
  w.emit('always-on-top-changed', {}, false);
  assert.equal(w.top, true);
  w.emit('closed');
});

test('다시 올리기 — 보이는 창만, 닫힌 창은 건드리지 않음', () => {
  const w = fakeWin();
  const raise = keepOnTop(w, { everyMs: 60000 });
  w.top = false;
  raise();
  assert.equal(w.top, true);
  assert.equal(w.moves, 1);
  w.visible = false;
  raise();
  assert.equal(w.moves, 1);
  w.destroyed = true;
  w.visible = true;
  raise();
  assert.equal(w.moves, 1);
  w.emit('closed');
});

test('canMove 가 false 면 항상 위만 다시 걸고 순서는 그대로', () => {
  const w = fakeWin();
  let ok = false;
  const raise = keepOnTop(w, { everyMs: 60000, canMove: () => ok });
  raise();
  assert.equal(w.moves, 0);
  ok = true;
  raise();
  assert.equal(w.moves, 1);
  w.emit('closed');
});

test('stop 하면 더는 다시 올리거나 다시 걸지 않는다', () => {
  const w = fakeWin();
  const raise = keepOnTop(w, { everyMs: 60000 });
  raise.stop();
  w.top = false;
  w.emit('always-on-top-changed', {}, false);
  raise();
  assert.equal(w.top, false);
  assert.equal(w.moves, 0);
});

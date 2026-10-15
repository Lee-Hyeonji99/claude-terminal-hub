'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeLayout, clampPet, PET_BOX } = require('../electron/pet-layout.js');

// 1920x1080 모니터, 작업표시줄 40px
const bounds = { x: 0, y: 0, width: 1920, height: 1080 };
const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
const card = { w: 340, h: 300 };

const inside = (r, a) => r.x >= a.x && r.y >= a.y && r.x + r.width <= a.x + a.width && r.y + r.height <= a.y + a.height;

test('카드가 없으면 창 = 펫 상자', () => {
  const L = computeLayout({ anchor: { x: 500, y: 500 }, card: null, workArea, bounds });
  assert.deepEqual(L.window, { x: 500, y: 500, width: PET_BOX, height: PET_BOX });
  assert.deepEqual(L.local.pet, { x: 0, y: 0 });
  assert.equal(L.local.card, null);
});

test('오른쪽 아래(기본 자리): 카드는 위로, 왼쪽으로 펼쳐진다', () => {
  const anchor = { x: 1920 - 24 - PET_BOX, y: 1040 - 24 - PET_BOX };
  const L = computeLayout({ anchor, card, workArea, bounds });
  assert.equal(L.side, 'above-left');
  // 펫은 움직이지 않는다
  assert.equal(L.window.x + L.local.pet.x, anchor.x);
  assert.equal(L.window.y + L.local.pet.y, anchor.y);
});

test('모니터 왼쪽 끝: 카드 때문에 펫이 밀려나지 않고 카드가 오른쪽으로 펼쳐진다', () => {
  const anchor = { x: 0, y: 600 };
  const L = computeLayout({ anchor, card, workArea, bounds });
  assert.equal(L.window.x + L.local.pet.x, 0, '펫이 왼쪽 끝에 그대로 있다');
  assert.equal(L.window.y + L.local.pet.y, 600);
  assert.equal(L.side, 'above-right');
  const c = { x: L.window.x + L.local.card.x, y: L.window.y + L.local.card.y, width: card.w, height: card.h };
  assert.ok(inside(c, workArea), '카드는 작업영역 안');
});

test('위쪽 끝: 카드가 아래로 펼쳐진다', () => {
  const L = computeLayout({ anchor: { x: 800, y: 0 }, card, workArea, bounds });
  assert.equal(L.window.y + L.local.pet.y, 0);
  assert.match(L.side, /^below-/);
});

test('왼쪽 위 구석: 아래·오른쪽', () => {
  const L = computeLayout({ anchor: { x: 0, y: 0 }, card, workArea, bounds });
  assert.equal(L.side, 'below-right');
});

test('위아래 모두 자리가 없으면 옆으로 펼친다', () => {
  const tall = { w: 340, h: 900 };
  const L = computeLayout({ anchor: { x: 900, y: 400 }, card: tall, workArea, bounds });
  assert.match(L.side, /^side-/);
  const c = { x: L.window.x + L.local.card.x, y: L.window.y + L.local.card.y, width: tall.w, height: tall.h };
  assert.ok(inside(c, workArea));
});

test('펫은 작업표시줄 위까지(화면 전체) 놓을 수 있다', () => {
  const p = clampPet({ x: 100, y: 1080 - PET_BOX }, bounds);
  assert.deepEqual(p, { x: 100, y: 1080 - PET_BOX });
});

test('펫은 화면 밖으로는 못 나간다', () => {
  assert.deepEqual(clampPet({ x: -50, y: -50 }, bounds), { x: 0, y: 0 });
  assert.deepEqual(clampPet({ x: 5000, y: 5000 }, bounds), { x: 1920 - PET_BOX, y: 1080 - PET_BOX });
});

test('두 번째 모니터(왼쪽에 있는 음수 좌표)의 왼쪽 끝', () => {
  const b2 = { x: -1920, y: 0, width: 1920, height: 1080 };
  const w2 = { x: -1920, y: 0, width: 1920, height: 1040 };
  const L = computeLayout({ anchor: { x: -1920, y: 700 }, card, workArea: w2, bounds: b2 });
  assert.equal(L.window.x + L.local.pet.x, -1920);
  const c = { x: L.window.x + L.local.card.x, y: L.window.y + L.local.card.y, width: card.w, height: card.h };
  assert.ok(inside(c, w2));
});

test('창은 펫과 카드를 모두 감싼다', () => {
  const L = computeLayout({ anchor: { x: 600, y: 600 }, card, workArea, bounds });
  const { pet, card: cc } = L.local;
  assert.ok(pet.x >= 0 && pet.y >= 0 && pet.x + PET_BOX <= L.window.width && pet.y + PET_BOX <= L.window.height);
  assert.ok(cc.x >= 0 && cc.y >= 0 && cc.x + card.w <= L.window.width && cc.y + card.h <= L.window.height);
});

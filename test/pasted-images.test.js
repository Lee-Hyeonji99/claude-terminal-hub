'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { savePasted, prune, decodeDataUrl, KEEP_MS } = require('../lib/pasted-images');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cth-paste-'));
// 1x1 투명 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test('붙여넣은 PNG 를 저장하고 절대 경로를 돌려준다', () => {
  const dir = tmp();
  const p = savePasted(dir, PNG, new Date(2026, 9, 15, 13, 5, 9));
  assert.ok(path.isAbsolute(p));
  assert.match(path.basename(p), /^paste-20261015-130509-[0-9a-f]{6}\.png$/);
  assert.deepEqual(fs.readFileSync(p).subarray(1, 4).toString(), 'PNG');
});

test('이미지가 아니거나 지원하지 않는 형식이면 거절한다', () => {
  assert.throws(() => decodeDataUrl('data:text/plain;base64,aGVsbG8='), /이미지 데이터/);
  assert.throws(() => decodeDataUrl('data:image/svg+xml;base64,PHN2Zz4='), /png · jpg · webp · gif/);
  assert.throws(() => decodeDataUrl(''), /이미지 데이터/);
});

test('8MB 넘는 이미지는 거절한다', () => {
  const big = 'data:image/png;base64,' + Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64');
  assert.throws(() => decodeDataUrl(big), /8MB/);
});

test('7일 지난 붙여넣기 파일만 지우고 다른 파일은 건드리지 않는다', () => {
  const dir = tmp();
  const now = Date.now();
  const old = path.join(dir, 'paste-20260101-000000-abcdef.png');
  const fresh = path.join(dir, 'paste-20261015-000000-123456.png');
  const other = path.join(dir, 'keep-me.png');
  for (const f of [old, fresh, other]) fs.writeFileSync(f, 'x');
  const past = new Date(now - KEEP_MS - 1000);
  fs.utimesSync(old, past, past);
  fs.utimesSync(other, past, past);
  assert.equal(prune(dir, now), 1);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(fresh), true);
  assert.equal(fs.existsSync(other), true);
});

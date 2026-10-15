'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { importPack, listPacks, listAvailablePacks, packSlug } = require('../lib/pet-pack.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'petpack-')); }
function makePack(dir, manifest, files) {
  fs.mkdirSync(dir, { recursive: true });
  if (manifest !== undefined) fs.writeFileSync(path.join(dir, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  for (const [n, data] of Object.entries(files || {})) fs.writeFileSync(path.join(dir, n), data);
}
const GIF = Buffer.from('GIF89a....');
const WEBP = Buffer.from('RIFF....WEBP');

test('packSlug: 폴더 이름을 안전한 id 로', () => {
  assert.equal(packSlug('C:\\Downloads\\desktop-pet-pack\\pet-pack'), 'pet-pack');
  assert.equal(packSlug('/a/My Pet!!'), 'my-pet');
  assert.equal(packSlug('/a/한글'), 'pack');
});

test('importPack: manifest 의 동작 파일만 복사하고, webp 를 우선한다', () => {
  const src = path.join(tmp(), 'pet-pack'), dest = tmp();
  makePack(src, { size: [256, 256], actions: { idle: { gif: 'idle.gif', webp: 'idle.webp' }, happy: { gif: 'happy.gif' } } },
    { 'idle.gif': GIF, 'idle.webp': WEBP, 'happy.gif': GIF, 'secret.txt': 'x' });
  const r = importPack(src, dest);
  assert.equal(r.id, 'pet-pack');
  assert.deepEqual(r.actions, { idle: 'idle.webp', happy: 'happy.gif' });
  const out = fs.readdirSync(path.join(dest, 'pet-pack')).sort();
  assert.deepEqual(out, ['happy.gif', 'idle.webp', 'manifest.json']);
});

test('importPack: manifest 가 없으면 거절', () => {
  const src = path.join(tmp(), 'p');
  makePack(src, undefined, { 'idle.gif': GIF });
  assert.throws(() => importPack(src, tmp()), /manifest\.json/);
});

test('importPack: 깨진 manifest 거절', () => {
  const src = path.join(tmp(), 'p');
  makePack(src, '{not json', {});
  assert.throws(() => importPack(src, tmp()), /manifest\.json/);
});

test('importPack: 폴더 밖 경로(../)를 가리키는 파일은 무시', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'outside.gif'), GIF);
  const src = path.join(root, 'p'), dest = tmp();
  makePack(src, { actions: { idle: { gif: '../outside.gif' }, walk: { gif: 'walk.gif' } } }, { 'walk.gif': GIF });
  const r = importPack(src, dest);
  assert.deepEqual(r.actions, { walk: 'walk.gif' });
});

test('importPack: 이상한 동작 이름·확장자는 무시, 쓸 동작이 없으면 거절', () => {
  const src = path.join(tmp(), 'p');
  makePack(src, { actions: { 'bad name!': { gif: 'a.gif' }, idle: { gif: 'a.exe' } } }, { 'a.gif': GIF, 'a.exe': 'MZ' });
  assert.throws(() => importPack(src, tmp()), /동작/);
});

test('importPack: 같은 이름으로 다시 가져오면 덮어쓴다(옛 파일 정리)', () => {
  const dest = tmp();
  const s1 = path.join(tmp(), 'pk');
  makePack(s1, { actions: { idle: { gif: 'idle.gif' }, run: { gif: 'run.gif' } } }, { 'idle.gif': GIF, 'run.gif': GIF });
  importPack(s1, dest);
  const s2 = path.join(tmp(), 'pk');
  makePack(s2, { actions: { idle: { webp: 'idle.webp' } } }, { 'idle.webp': WEBP });
  importPack(s2, dest);
  assert.deepEqual(fs.readdirSync(path.join(dest, 'pk')).sort(), ['idle.webp', 'manifest.json']);
});

test('importPack: 이미 가져온 팩 폴더를 다시 고르면 거절하고 지우지 않는다', () => {
  const dest = tmp();
  const s = path.join(tmp(), 'foo');
  makePack(s, { actions: { idle: { gif: 'i.gif' } } }, { 'i.gif': GIF });
  importPack(s, dest);
  assert.throws(() => importPack(path.join(dest, 'foo'), dest), /이미 가져온/);
  assert.ok(fs.existsSync(path.join(dest, 'foo', 'i.gif')), '팩이 그대로 남아 있다');
  assert.throws(() => importPack(dest, dest), /이미 가져온/);
});

test('importPack: 실패해도 기존 팩은 남는다', () => {
  const dest = tmp();
  const s1 = path.join(tmp(), 'keep');
  makePack(s1, { actions: { idle: { gif: 'i.gif' } } }, { 'i.gif': GIF });
  importPack(s1, dest);
  const s2 = path.join(tmp(), 'keep');
  makePack(s2, { actions: { idle: { gif: 'none.gif' } } }, {});
  assert.throws(() => importPack(s2, dest));
  assert.ok(fs.existsSync(path.join(dest, 'keep', 'i.gif')));
});

test('importPack: 심볼릭 링크 파일은 복사하지 않는다', (t) => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'secret.gif'), GIF);
  const src = path.join(root, 'p');
  makePack(src, { actions: { idle: { gif: 'link.gif' }, walk: { gif: 'walk.gif' } } }, { 'walk.gif': GIF });
  try { fs.symlinkSync(path.join(root, 'secret.gif'), path.join(src, 'link.gif')); }
  catch { t.skip('심볼릭 링크를 만들 권한이 없음'); return; }
  const r = importPack(src, tmp());
  assert.deepEqual(r.actions, { walk: 'walk.gif' });
});

test('listPacks: 가져온 팩 목록', () => {
  const dest = tmp();
  const s = path.join(tmp(), 'alpha');
  makePack(s, { actions: { idle: { gif: 'i.gif' } } }, { 'i.gif': GIF });
  importPack(s, dest);
  fs.mkdirSync(path.join(dest, 'junk')); // manifest 없는 폴더는 건너뛴다
  assert.deepEqual(listPacks(dest), [{ id: 'alpha', name: 'alpha', actions: { idle: 'i.gif' } }]);
  assert.deepEqual(listPacks(path.join(dest, 'nope')), []);
});

test('테마 전용 팩과 같은 이름의 가져온 팩도 각각 선택할 수 있다', () => {
  const user = tmp(), themeRoot = tmp();
  makePack(path.join(user, 'rakko'), { name: '내 랏코', actions: { idle: 'i.gif' } }, { 'i.gif': GIF });
  makePack(path.join(themeRoot, 'rakko'), { name: '랏코', actions: { idle: { webp: 'i.webp', gif: 'i.gif' } } }, { 'i.webp': WEBP, 'i.gif': GIF });
  assert.deepEqual(listAvailablePacks(user, themeRoot), [
    { id: 'theme:rakko', name: '랏코', actions: { idle: 'i.webp' }, themed: true, theme: 'rakko' },
    { id: 'rakko', name: '내 랏코', actions: { idle: 'i.gif' } },
  ]);
});

test('listPacks: 사라진 파일은 빼고 다른 형식으로 대체한다', () => {
  const root = tmp();
  makePack(path.join(root, 'test'), { actions: { idle: 'missing.webp', walk: { webp: 'missing.webp', gif: 'walk.gif' } } }, { 'walk.gif': GIF });
  assert.deepEqual(listPacks(root)[0].actions, { walk: 'walk.gif' });
});

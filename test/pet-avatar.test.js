'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function avatar(saved = {}) {
  const values = new Map(Object.entries(saved));
  const packs = ['hachiware', 'usagi', 'momonga', 'rakko', 'flurry', 'rasher', 'marshal'].map((key) => ({
    id: `theme:${key}`, themed: true, theme: key, name: key, actions: { idle: 'idle.webp', walk: 'walk.webp' },
  }));
  packs.push({ id: 'mine', name: '내 팩', actions: { idle: 'custom.gif' } });
  const ctx = vm.createContext({
    window: {},
    localStorage: {
      getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k),
      get length() { return values.size; }, key: (i) => [...values.keys()][i] ?? null,
    },
    fetch: async (url) => ({ json: async () => url === '/api/pet-packs' ? { packs } : { files: ['pet-custom.gif'] } }),
  });
  for (const file of ['themes.js', 'pet-avatar.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), ctx);
  const api = ctx.window.PetAvatar;
  await api.loadFiles();
  return api;
}

test('처음 실행한 일반 테마에서는 랏코 기본 팩, 캐릭터 테마에서는 해당 팩', async () => {
  const a = await avatar();
  assert.equal(a.resolve().pack.id, 'theme:rakko');
  for (const key of ['hachiware', 'usagi', 'momonga', 'rakko', 'flurry', 'rasher', 'marshal']) {
    const p = a.resolve('/project', key).pack;
    assert.equal(p.id, `theme:${key}`);
    assert.equal(p.scope, 'theme');
    assert.equal(p.actions.idle, `/theme-packs/${key}/idle.webp`);
  }
});

test('프로젝트 테마가 전체 테마보다 우선하고 일반 프로젝트 테마는 랏코', async () => {
  const a = await avatar({ cth_theme: 'usagi' });
  assert.equal(a.resolve().pack.id, 'theme:usagi');
  assert.equal(a.resolve('/p', 'marshal').pack.id, 'theme:marshal');
  assert.equal(a.resolve('/p', 'dark').pack.id, 'theme:rakko');
});

test('직접 고른 전체 팩·프로젝트 팩·이미지·기본 도형 설정은 유지한다', async () => {
  const a = await avatar();
  a.usePack('mine', 'all');
  assert.equal(a.resolve('/p', 'usagi').pack.actions.idle, '/pet-packs/mine/custom.gif');
  a.usePack('theme:flurry', 'project', '/p');
  assert.equal(a.resolve('/p', 'usagi').pack.id, 'theme:flurry');
  assert.equal(a.resolve('/q', 'usagi').pack.id, 'mine');
  a.clearProjectPack('/p');
  a.setMode('default');
  assert.equal(a.resolve('/p', 'usagi').url, null);
  assert.equal(a.resolve('/p', 'usagi').mode, 'default');
  const custom = await avatar({ cth_pet_mode: 'custom', cth_pet_image: 'pet-custom.gif' });
  assert.match(custom.resolve('/p', 'usagi').url, /^\/theme-assets\/pet-custom.gif/);
});

test('테마 전용 팩 폴더가 없으면 테마 이미지, 그것도 없으면 기본 SVG', async () => {
  const values = new Map();
  const ctx = vm.createContext({
    window: {}, localStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) },
    fetch: async (url) => ({ json: async () => url === '/api/pet-packs' ? { packs: [] } : { files: ['usagi-default.webp'] } }),
  });
  for (const file of ['themes.js', 'pet-avatar.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', file), 'utf8'), ctx);
  const a = ctx.window.PetAvatar;
  await a.loadFiles();
  assert.equal(a.resolve('/p', 'usagi').url, '/theme-assets/usagi-default.webp');
  assert.equal(a.resolve('/p', 'hachiware').url, null);
  assert.equal(a.resolve('/p', 'dark').url, null);
});

test('저장소에 캐릭터 이미지를 넣지 않는다', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '../assets')), false);
});

test('펫마다 표시 방식이 따로다 — 한 펫에서 바꿔도 다른 펫은 그대로', async () => {
  const a = await avatar();
  a.setMode('default', '/a');
  assert.equal(a.resolve('/a', 'usagi').url, null);
  assert.equal(a.resolve('/a', 'usagi').mode, 'default');
  assert.equal(a.resolve('/b', 'usagi').pack.id, 'theme:usagi');
});

test('한 펫에 넣은 팩은 그 펫에만, «모든 펫» 은 펫마다 고른 것을 지우고 맞춘다', async () => {
  const a = await avatar();
  a.usePack('mine', 'project', '/a');
  a.setMode('default', '/b');
  assert.equal(a.resolve('/a', 'usagi').pack.id, 'mine');
  assert.equal(a.resolve('/c', 'usagi').pack.id, 'theme:usagi');
  a.usePack('mine', 'all');
  for (const pid of ['/a', '/b', '/c']) assert.equal(a.resolve(pid, 'usagi').pack.id, 'mine');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PK = require('../public/project-key.js');

test('projectId: Windows 경로는 대소문자·구분자·끝 슬래시와 무관하게 같은 프로젝트', () => {
  assert.equal(PK.projectId('C:\\Users\\me\\proj'), PK.projectId('c:/users/me/proj/'));
  assert.equal(PK.projectId('C:\\Users\\me\\proj\\'), 'c:\\users\\me\\proj');
});

test('projectId: POSIX 경로는 대소문자를 보존한다', () => {
  assert.equal(PK.projectId('/Users/Me/Proj/'), '/Users/Me/Proj');
  assert.notEqual(PK.projectId('/Users/Me/Proj'), PK.projectId('/users/me/proj'));
});

test('projectId: 빈 값은 빈 문자열', () => {
  assert.equal(PK.projectId(''), '');
  assert.equal(PK.projectId(null), '');
  assert.equal(PK.projectId(undefined), '');
});

test('projectName: 마지막 폴더 이름', () => {
  assert.equal(PK.projectName('C:\\Users\\me\\my-app'), 'my-app');
  assert.equal(PK.projectName('/home/me/site/'), 'site');
  assert.equal(PK.projectName(''), '');
});

test('workspaceKey / parseWorkspaceKey 왕복', () => {
  const k = PK.workspaceKey('p_1', 'c:\\a\\b');
  assert.deepEqual(PK.parseWorkspaceKey(k), { profile: 'p_1', project: 'c:\\a\\b' });
  assert.deepEqual(PK.parseWorkspaceKey(PK.workspaceKey('default', '')), { profile: 'default', project: '' });
});

test('parseWorkspaceKey: 옛 형식(프로필 id 만)은 null', () => {
  assert.equal(PK.parseWorkspaceKey('default'), null);
  assert.equal(PK.parseWorkspaceKey('__minimized'), null);
});

test('projectHue: 같은 프로젝트는 같은 색, 0~359 범위', () => {
  const a = PK.projectHue('c:\\a'), b = PK.projectHue('c:\\a');
  assert.equal(a, b);
  for (const id of ['', 'x', 'c:\\users\\me\\proj', '/home/a/b']) {
    const h = PK.projectHue(id);
    assert.ok(Number.isInteger(h) && h >= 0 && h < 360, `${id} → ${h}`);
  }
});

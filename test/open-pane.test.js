'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FLAG, normalizeRequest, requestPathFrom, readRequest } = require('../lib/open-pane');

const CWD = process.platform === 'win32' ? 'D:\\work\\proj' : '/work/proj';

function withRequestFile(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-pane-'));
  const file = path.join(dir, 'req.json');
  fs.writeFileSync(file, content);
  try { return fn(file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('경로만 있으면 claude 새 대화로 연다', () => {
  assert.deepEqual(normalizeRequest({ cwd: CWD }), { cwd: CWD, command: 'claude', title: '', profile: '' });
});

test('명령 · 제목 · 계정을 그대로 넘긴다', () => {
  const req = normalizeRequest({ cwd: CWD, command: " claude --remote-control '이름' ", title: '이름', profile: 'p1' });
  assert.deepEqual(req, { cwd: CWD, command: "claude --remote-control '이름'", title: '이름', profile: 'p1' });
});

test('경로가 없거나 상대 경로면 버린다', () => {
  assert.equal(normalizeRequest({ command: 'claude' }), null);
  assert.equal(normalizeRequest({ cwd: 'proj' }), null);
  assert.equal(normalizeRequest(null), null);
  assert.equal(normalizeRequest('claude'), null);
});

test('명령에 줄바꿈 · 탭이 섞이면 버린다', () => {
  assert.equal(normalizeRequest({ cwd: CWD, command: 'claude\nwhoami' }), null);
  assert.equal(normalizeRequest({ cwd: CWD, command: 'claude\tx' }), null);
  assert.equal(normalizeRequest({ cwd: CWD, title: 'a\rb' }), null);
});

test('너무 긴 값은 버린다', () => {
  assert.equal(normalizeRequest({ cwd: CWD, title: 'x'.repeat(121) }), null);
  assert.equal(normalizeRequest({ cwd: CWD, command: 'claude ' + 'x'.repeat(4000) }), null);
});

test('문자열이 아닌 값은 빈 값으로 본다', () => {
  assert.deepEqual(normalizeRequest({ cwd: CWD, command: 42, title: {} }), { cwd: CWD, command: 'claude', title: '', profile: '' });
});

test('실행 인자에서 요청 파일 경로를 찾는다', () => {
  assert.equal(requestPathFrom(['hub.exe', '--flag', FLAG + 'C:\\tmp\\a b.json']), 'C:\\tmp\\a b.json');
  assert.equal(requestPathFrom(['hub.exe']), null);
  assert.equal(requestPathFrom(undefined), null);
});

test('요청 파일을 읽는다 — BOM 이 있어도', () => {
  const body = JSON.stringify({ cwd: CWD, title: '확인' });
  withRequestFile('\uFEFF' + body, (file) => {
    assert.deepEqual(readRequest(['hub.exe', FLAG + file]), { cwd: CWD, command: 'claude', title: '확인', profile: '' });
  });
});

test('인자가 없거나 파일이 없거나 JSON 이 깨졌으면 null', () => {
  assert.equal(readRequest(['hub.exe']), null);
  assert.equal(readRequest(['hub.exe', FLAG + path.join(os.tmpdir(), 'open-pane-none', 'x.json')]), null);
  withRequestFile('{ 깨진', (file) => assert.equal(readRequest(['hub.exe', FLAG + file]), null));
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mcpServersFor, writeMcpConfig } = require('../lib/mcp-config');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-mcp-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const cwd = path.join(root, 'Repo');
const key = cwd.replace(/\\/g, '/'); // .claude.json 은 / 로 적는다
const file = path.join(root, 'claude.json');
fs.writeFileSync(file, JSON.stringify({
  oauthAccount: { emailAddress: 'a@b' },
  mcpServers: { user1: { command: 'u' }, off: { command: 'o' } },
  projects: { [key]: { mcpServers: { local1: { command: 'l' } }, disabledMcpServers: ['off'] } },
}));

test('사용자 범위 + 그 작업 경로의 프로젝트 범위 MCP 를 합치고, 그 프로젝트에서 끈 것은 뺀다', () => {
  assert.deepEqual(Object.keys(mcpServersFor(file, cwd)).sort(), ['local1', 'user1']);
  // Windows 는 대소문자 · 구분자 · 끝 슬래시가 달라도 같은 프로젝트
  if (process.platform === 'win32') assert.ok(mcpServersFor(file, cwd.toUpperCase() + '\\').local1);
});

test('다른 작업 경로에는 사용자 범위만', () => {
  assert.deepEqual(Object.keys(mcpServersFor(file, path.join(root, 'other'))).sort(), ['off', 'user1']);
});

test('작업 경로마다 파일을 따로 쓴다', () => {
  const a = writeMcpConfig(file, cwd, path.join(root, 'out'));
  const b = writeMcpConfig(file, path.join(root, 'other'), path.join(root, 'out'));
  assert.notEqual(a, b);
  assert.ok(JSON.parse(fs.readFileSync(a, 'utf8')).mcpServers.local1);
});

test('넘길 서버가 없으면 null', () => {
  fs.writeFileSync(path.join(root, 'empty.json'), '{}');
  assert.equal(mcpServersFor(path.join(root, 'empty.json'), cwd), null);
  assert.equal(writeMcpConfig(path.join(root, 'none.json'), cwd, path.join(root, 'out')), null);
});

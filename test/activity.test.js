'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { lastActivity, toolTarget } = require('../lib/activity');

const line = (o) => JSON.stringify(o);
const toolUse = (name, input) => line({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });

test('마지막 도구 사용을 고른다 — 파일은 이름만', () => {
  const text = [
    toolUse('Read', { file_path: 'C:\\proj\\a.js' }),
    toolUse('Edit', { file_path: '/home/u/proj/server.js', old_string: 'x', new_string: 'y' }),
  ].join('\n');
  assert.deepEqual(lastActivity(text), { tool: 'Edit', target: 'server.js' });
});

test('명령은 한 줄로 짧게, 서브에이전트는 설명', () => {
  assert.equal(toolTarget('Bash', { command: 'npm test\n  && echo done' }), 'npm test && echo done');
  assert.equal(toolTarget('Bash', { command: 'x'.repeat(80) }).length, 48);
  assert.equal(toolTarget('Task', { description: '코드 리뷰', subagent_type: 'code-reviewer' }), '코드 리뷰');
  assert.equal(toolTarget('WebFetch', { url: 'https://example.com/a/b' }), 'example.com');
});

test('사람이 새 메시지를 보내면 도구 표시를 비운다(생각 중), 도구 결과는 무시', () => {
  const text = [
    toolUse('Bash', { command: 'ls' }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
  ].join('\n');
  assert.deepEqual(lastActivity(text), { tool: 'Bash', target: 'ls' });
  const next = text + '\n' + line({ type: 'user', message: { content: '다음 작업 해줘' } });
  assert.deepEqual(lastActivity(next), { tool: '', target: '' });
});

test('관련 줄이 없으면 null', () => {
  assert.equal(lastActivity(line({ type: 'summary', summary: 'x' })), null);
  assert.equal(lastActivity('깨진 줄\n'), null);
});

'use strict';
/**
 * HUD «무슨 일 하는 중» — 대화 기록(jsonl)에 새로 붙은 줄에서 마지막 활동을 뽑는다.
 *   assistant 의 tool_use → { tool: 'Edit', target: 'server.js' }
 *   사람이 새로 보낸 메시지 → { tool: '', target: '' } (새 턴 시작: 아직 도구를 안 씀 = 생각 중)
 * 관련 줄이 없으면 null (화면 갱신 안 함).
 */
const path = require('path');

const MAX_TARGET = 48;

function clip(s) {
  const one = String(s || '').replace(/\s+/g, ' ').trim();
  return one.length > MAX_TARGET ? one.slice(0, MAX_TARGET - 1) + '…' : one;
}

/** 도구 입력에서 사람이 알아볼 대상 하나 — 파일은 이름만, 명령은 한 줄로 짧게. */
function toolTarget(name, input) {
  if (!input || typeof input !== 'object') return '';
  const file = input.file_path || input.notebook_path || input.path;
  if (file) return path.basename(String(file).replace(/[\\/]+$/, '')) || String(file);
  if (name === 'Task' || name === 'Agent') return clip(input.description || input.subagent_type || '');
  if (input.command) return clip(input.command);
  if (input.pattern) return clip(input.pattern);
  if (input.url) { try { return new URL(String(input.url)).host; } catch { return clip(input.url); } }
  if (input.query) return clip(input.query);
  if (input.description) return clip(input.description);
  return '';
}

const isHumanTurn = (content) => typeof content === 'string'
  || (Array.isArray(content) && content.some((c) => c && c.type === 'text'));

function lastActivity(text) {
  let last = null;
  for (const line of String(text || '').split('\n')) {
    if (!line || (line.indexOf('tool_use') < 0 && line.indexOf('"user"') < 0)) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const msg = obj && obj.message;
    if (!msg) continue;
    if (obj.type === 'user' && !obj.isMeta && isHumanTurn(msg.content)) { last = { tool: '', target: '' }; continue; }
    if (obj.type !== 'assistant' || !Array.isArray(msg.content)) continue;
    for (const it of msg.content) {
      if (it && it.type === 'tool_use') last = { tool: String(it.name || ''), target: toolTarget(it.name, it.input) };
    }
  }
  return last;
}

module.exports = { lastActivity, toolTarget };

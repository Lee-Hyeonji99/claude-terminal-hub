'use strict';
/**
 * 서브에이전트 현황 — Claude Code 가 세션 기록 옆에 남기는 파일을 읽는다(LLM 없음).
 *   <세션id>.jsonl                         부모 세션 기록
 *   <세션id>/subagents/agent-<id>.meta.json  { agentType, description, finished? }
 *   <세션id>/subagents/agent-<id>.jsonl      그 에이전트의 기록
 * 끝남: meta.finished(최신 버전) · 마지막 assistant 가 도구 없이 멈춤 · 오래 변화 없음(옛 기록 대비).
 * 끝난 것은 keepDoneMs 동안 'done' 으로 남겨 화면에서 체크 표시 후 사라지게 한다.
 *
 * 1.5초마다 여러 세션을 훑으므로 싸게: 오래전에 끝난 파일은 stat 만 보고 건너뛰고,
 * 크기·수정 시각이 그대로인 파일은 cache 에 둔 결과를 다시 쓴다.
 */
const fs = require('fs');
const path = require('path');
const { lastActivity } = require('./activity');

const TAIL_STEPS = [64 * 1024, 1024 * 1024, 4 * 1024 * 1024];   // 마지막 줄이 잘려 있으면 더 크게
const HEAD_BYTES = 4096;               // 첫 줄의 timestamp(시작 시각)
const STALE_MS = 10 * 60 * 1000;       // 이만큼 아무 변화 없으면 끝난 것으로 본다
const KEEP_DONE_MS = 8000;
const MAX_LIST = 12;

const subagentDir = (jsonl) => path.join(String(jsonl).replace(/\.jsonl$/i, ''), 'subagents');

function readRange(file, start, len) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(len);
    const n = fs.readSync(fd, b, 0, len, start);
    return b.subarray(0, n).toString('utf8');
  } finally { fs.closeSync(fd); }
}

/**
 * 마지막 assistant 메시지가 도구 없이 멈췄으면(end_turn · max_tokens …) 끝.
 * 그 줄이 잘렸거나 assistant 줄을 못 찾으면 null(모름) — 더 크게 읽어 다시 판단한다.
 */
function isEnded(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].indexOf('"assistant"') < 0) continue;
    let o;
    try { o = JSON.parse(lines[i]); } catch { if (i === 0) return null; continue; }
    if (o.type !== 'assistant' || !o.message) continue;
    const content = Array.isArray(o.message.content) ? o.message.content : [];
    return !!o.message.stop_reason && !content.some((c) => c && c.type === 'tool_use');
  }
  return null;   // assistant 줄을 못 찾음 — 앞부분이 잘렸을 수 있다
}

function readTailEnded(file, size) {
  let tail = '';
  for (const step of TAIL_STEPS) {
    const len = Math.min(size, step);
    tail = readRange(file, size - len, len);
    const ended = isEnded(tail);
    if (ended !== null || len === size) return { tail, ended: !!ended };
  }
  return { tail, ended: false };
}

function startTime(file, st) {
  try {
    const first = readRange(file, 0, Math.min(st.size, HEAD_BYTES)).split('\n')[0];
    const t = Date.parse(JSON.parse(first).timestamp);
    if (Number.isFinite(t)) return t;
  } catch { /* 첫 줄이 아직 없거나 길다 */ }
  return Math.round(st.birthtimeMs || st.mtimeMs);
}

function readMeta(file) {
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    return m && typeof m === 'object' ? m : {};
  } catch { return {}; }
}
const statOrNull = (f) => { try { return fs.statSync(f); } catch { return null; } };
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

function readOne(dir, id, now, keep, cache) {
  const file = path.join(dir, `agent-${id}.jsonl`);
  const st = statOrNull(file);
  if (!st) return null;
  if (now - st.mtimeMs > STALE_MS + keep) { cache.delete(file); return null; }   // 오래전에 끝남 — 읽지 않는다
  const metaFile = path.join(dir, `agent-${id}.meta.json`);
  const mst = statOrNull(metaFile);
  const metaM = mst ? mst.mtimeMs : 0;
  const hit = cache.get(file);
  let item;
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size && hit.metaM === metaM) {
    item = hit.item;
  } else {
    const meta = readMeta(metaFile);
    let done = meta.finished === true;
    let act = null;
    if (!done) {
      const r = readTailEnded(file, st.size);
      done = r.ended;
      if (!done) act = lastActivity(r.tail);
    }
    item = {
      id,
      type: clip(meta.agentType || 'agent', 40),
      desc: clip(meta.description, 60),
      state: done ? 'done' : 'work',
      tool: act ? act.tool : '',
      target: act ? act.target : '',
      since: hit && hit.item.since ? hit.item.since : startTime(file, st),
      doneAt: done ? Math.round(Math.max(st.mtimeMs, metaM)) : 0,
    };
    cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, metaM, item });
  }
  // 변화 없이 오래 멈춘 것(옛 기록 · 중단된 에이전트)은 끝난 것으로
  if (item.state === 'work' && now - st.mtimeMs > STALE_MS) {
    return { ...item, state: 'done', tool: '', target: '', doneAt: Math.round(st.mtimeMs) };
  }
  return item;
}

/** 지금 보여줄 서브에이전트 — 도는 중(시작 순) → 막 끝난 것. opts: { now, keepDoneMs, cache: Map } */
function scanSubagents(jsonl, opts = {}) {
  const now = opts.now || Date.now();
  const keep = opts.keepDoneMs == null ? KEEP_DONE_MS : opts.keepDoneMs;
  const cache = opts.cache || new Map();
  const dir = subagentDir(jsonl);
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const ids = names.map((n) => /^agent-([A-Za-z0-9_-]{1,64})\.jsonl$/.exec(n)).filter(Boolean).map((m) => m[1]);
  const list = ids.map((id) => readOne(dir, id, now, keep, cache))
    .filter((s) => s && (s.state === 'work' || now - s.doneAt <= keep));
  const rank = (s) => (s.state === 'work' ? 0 : 1);
  return list.sort((a, b) => (rank(a) - rank(b)) || (a.since - b.since)).slice(0, MAX_LIST);
}

module.exports = { scanSubagents, subagentDir, isEnded };

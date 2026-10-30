'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scan, isRepaint, transcriptHitLimit, turnInProgress } = require('../lib/usage-limit');

test('화면 전체를 다시 그리는 출력을 알아본다 — 지난 대화 속 옛 한도 문구가 다시 나오는 경우', () => {
  assert.equal(isRepaint('\x1b[2J\x1b[H' + "You've hit your 5-hour limit · resets 9pm"), true);
  assert.equal(isRepaint('\x1b[3J'), true);
  assert.equal(isRepaint('\x1bc'), true);
  assert.equal(isRepaint("\x1b[31mYou've hit your 5-hour limit · resets 9pm\x1b[0m"), false);
});

const L = (o) => JSON.stringify(o);
test('대화 기록의 rate_limit 응답으로 한도를 안다', () => {
  const hit = L({ type: 'assistant', isApiErrorMessage: true, error: 'rate_limit', message: { stop_reason: 'stop_sequence', content: [{ type: 'text', text: "You've hit your limit" }] } });
  assert.equal(transcriptHitLimit('x\n' + hit + '\n'), true);
  assert.equal(transcriptHitLimit(L({ type: 'user', message: { content: 'rate_limit 이 뭐야' } })), false);
  assert.equal(transcriptHitLimit(L({ type: 'assistant', error: 'rate_limit', isSidechain: true })), false);
});

test('일하는 중인지 — 답 없는 질문 · 도구 사용 중이면 true, 끝난 응답 · 한도로 멈춘 응답이면 false', () => {
  const user = L({ type: 'user', message: { content: '해줘' } });
  const tool = L({ type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use' }] } });
  const done = L({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text' }] } });
  const limited = L({ type: 'assistant', error: 'rate_limit', message: { stop_reason: 'stop_sequence', content: [{ type: 'text' }] } });
  assert.equal(turnInProgress([done, user].join('\n')), true);
  assert.equal(turnInProgress([user, tool].join('\n')), true);
  assert.equal(turnInProgress([user, done, L({ type: 'system', subtype: 'turn_duration' })].join('\n')), false);
  assert.equal(turnInProgress([user, limited].join('\n')), false);
  assert.equal(turnInProgress(''), null);
  // Esc 로 멈춘 뒤 · 압축 요약 뒤는 끝난 것
  const interrupted = L({ type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
  const summary = L({ type: 'user', isCompactSummary: true, message: { content: 'This session is being continued…' } });
  assert.equal(turnInProgress([user, tool, interrupted].join('\n')), false);
  assert.equal(turnInProgress([done, summary].join('\n')), false);
  // 한도에 걸린 뒤 /usage 를 쳐 봐도 답변 중이 아니다
  const cmd = L({ type: 'user', message: { content: '<command-name>/usage</command-name>' } });
  const out = L({ type: 'user', message: { content: '<local-command-stdout>…</local-command-stdout>' } });
  assert.equal(turnInProgress([user, limited, cmd, out].join('\n')), false);
});

test('코드 · 다른 오류 문구는 한도로 보지 않는다', () => {
  for (const s of [
    'if (limitReached) reset();',
    'rateLimitReached = true; // reset later',
    'rate limit reached, contact your administrator',
    'memory limit reached; see /usage',
  ]) assert.equal(scan('', s).hit, false, s);
  // 단어 중간에 글자 꾸밈 코드가 끼어도 잡는다
  assert.equal(scan('', "You've hit your 5-hour lim\x1b[1mit\x1b[22m · resets 9pm").hit, true);
});

test('Claude Code 의 한도 문구들을 잡는다', () => {
  for (const s of [
    'Claude usage limit reached. Your limit will reset at 3pm (Asia/Seoul).',
    '\x1b[31m5-hour limit reached ∙ resets 3pm\x1b[0m',
    "You've hit your limit · resets 11am",
    'Weekly limit reached · resets Mon 9am',
  ]) assert.equal(scan('', s).hit, true, s);
});

test('2026-10 실제 기록에 남은 문구를 잡는다', () => {
  for (const s of [
    "You've hit your 5-hour limit · resets 9:50pm (Asia/Seoul)",
    "You've hit your individual spend limit · run /usage-credits to ask your admin for a higher limit",
    'Usage limit reached · continuing automatically at 7:20pm · esc to cancel',
  ]) assert.equal(scan('', s).hit, true, s);
});

test('공백 대신 커서 이동 코드로 띄운 문구도 잡는다', () => {
  assert.equal(scan('', "You've\x1b[1Chit\x1b[1Cyour\x1b[1C5-hour\x1b[1Climit\x1b[1C·\x1b[1Cresets\x1b[1C9pm").hit, true);
});

test('조각으로 나뉘어 와도 잡는다', () => {
  const a = scan('', '5-hour limit rea');
  assert.equal(a.hit, false);
  assert.equal(scan(a.tail, 'ched ∙ resets 3pm').hit, true);
});

test('대화 속 단어만으로는 걸리지 않는다', () => {
  assert.equal(scan('', '사용 한도(usage limit)를 넘으면 계정을 바꿉니다').hit, false);
  assert.equal(scan('', 'the limit reached zero\nthen we reset the counter').hit, false);
});

test('한 번 잡은 문구로 다시 걸리지 않는다', () => {
  const a = scan('', 'usage limit reached. resets 3pm');
  assert.equal(a.hit, true);
  assert.equal(scan(a.tail, '\n> ').hit, false);
});

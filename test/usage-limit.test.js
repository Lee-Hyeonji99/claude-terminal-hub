'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scan } = require('../lib/usage-limit');

test('Claude Code 의 한도 문구들을 잡는다', () => {
  for (const s of [
    'Claude usage limit reached. Your limit will reset at 3pm (Asia/Seoul).',
    '\x1b[31m5-hour limit reached ∙ resets 3pm\x1b[0m',
    "You've hit your limit · resets 11am",
    'Weekly limit reached · resets Mon 9am',
  ]) assert.equal(scan('', s).hit, true, s);
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

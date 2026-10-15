'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../public/md-lite.js');

test('HTML 은 이스케이프된다', () => {
  const out = render('<script>alert(1)</script> & "x"');
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
  assert.ok(out.includes('&amp;'));
});

test('코드 블록 — 안의 마크다운은 해석하지 않는다', () => {
  const out = render('앞\n```js\nconst a = **b**;\n<div>\n```\n뒤');
  assert.match(out, /<pre><code[^>]*>const a = \*\*b\*\*;\n&lt;div&gt;<\/code><\/pre>/);
  assert.ok(out.includes('<p>앞</p>'));
  assert.ok(out.includes('<p>뒤</p>'));
});

test('닫히지 않은 코드 블록도 끝까지 코드로', () => {
  const out = render('```\nabc');
  assert.match(out, /<pre><code>abc<\/code><\/pre>/);
});

test('인라인 코드 · 굵게', () => {
  const out = render('`a<b` 와 **굵게**');
  assert.ok(out.includes('<code>a&lt;b</code>'));
  assert.ok(out.includes('<strong>굵게</strong>'));
});

test('인라인 코드 안의 ** 는 굵게가 아니다', () => {
  const out = render('`**x**`');
  assert.ok(out.includes('<code>**x**</code>'));
});

test('제목', () => {
  assert.ok(render('## 제목').includes('<h3>제목</h3>'));
  assert.ok(render('# 큰 제목').includes('<h2>큰 제목</h2>'));
});

test('목록', () => {
  const out = render('- 하나\n- 둘\n\n1. 첫째\n2. 둘째');
  assert.match(out, /<ul><li>하나<\/li><li>둘<\/li><\/ul>/);
  assert.match(out, /<ol><li>첫째<\/li><li>둘째<\/li><\/ol>/);
});

test('링크는 http(s) 만, 새 창으로', () => {
  const out = render('[문서](https://example.com/a?b=1&c=2) [나쁨](javascript:alert(1))');
  assert.ok(out.includes('<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">문서</a>'));
  assert.ok(!out.includes('href="javascript'));
});

test('링크 주소에 따옴표를 넣어 속성을 깨지 못한다', () => {
  const out = render('[x](https://a.com/"onmouseover="alert(1))');
  assert.ok(!/href="[^"]*"onmouseover/.test(out));
});

test('빈 값', () => {
  assert.equal(render(''), '');
  assert.equal(render(null), '');
});

test('문단 안 줄바꿈은 <br>', () => {
  assert.ok(render('a\nb').includes('<p>a<br>b</p>'));
});

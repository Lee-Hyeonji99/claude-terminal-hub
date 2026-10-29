'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planOf } = require('../lib/account-plan.js');

test('팀 — 구독 종류나 조직 종류 중 하나라도 팀이면', () => {
  assert.equal(planOf({ claudeAiOauth: { subscriptionType: 'team' } }, {}), 'team');
  assert.equal(planOf({}, { organizationType: 'claude_team' }), 'team');
});

test('개인 플랜은 구독 종류 그대로, 모르면 null', () => {
  assert.equal(planOf({ claudeAiOauth: { subscriptionType: 'pro' } }, { organizationType: 'claude_pro' }), 'pro');
  assert.equal(planOf({ claudeAiOauth: { subscriptionType: 'max' } }, null), 'max');
  assert.equal(planOf(null, null), null);
  assert.equal(planOf({ claudeAiOauth: { subscriptionType: 42 } }, {}), null);
});

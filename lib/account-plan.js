'use strict';
/**
 * 계정의 플랜 — Claude Code 가 로그인할 때 남기는 값에서 읽는다.
 * .credentials.json 의 claudeAiOauth.subscriptionType(team / pro / max …)과
 * .claude.json 의 oauthAccount.organizationType(claude_team …). 문서화된 형식이 아니라 모르면 null.
 */
function planOf(credentials, oauthAccount) {
  const sub = credentials && credentials.claudeAiOauth && credentials.claudeAiOauth.subscriptionType;
  const org = oauthAccount && oauthAccount.organizationType;
  if (sub === 'team' || org === 'claude_team') return 'team';
  return typeof sub === 'string' && sub ? sub : null;
}

module.exports = { planOf };

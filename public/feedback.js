'use strict';
/**
 * 문의 · 건의 · 오류 제보 — GitHub 이슈 작성 화면을 브라우저로 연다.
 *
 * 별도 서버가 없고, 앱이 직접 이슈를 올리려면 GitHub 토큰을 앱에 넣어야 한다. 공개 배포되는 앱에
 * 토큰을 넣으면 누구나 꺼내 저장소에 쓸 수 있으므로 하지 않는다. 대신 이슈 폼(.github/ISSUE_TEMPLATE)
 * 을 버전·환경을 채운 채로 열어 주고, 올리는 건 사용자 브라우저의 GitHub 로그인으로 한다(설치 불필요).
 *
 * 미리 채우는 건 버전 · OS · 셸 종류뿐이다. 세션 제목·작업 경로는 넣지 않는다 — 저장소가 공개다.
 */
(function initFeedback() {
  const REPO = 'https://github.com/Lee-Hyeonji99/claude-terminal-hub';
  const TEMPLATES = { bug: 'bug.yml', feature: 'feature.yml', question: 'question.yml' };
  const PLATFORM = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  const row = document.getElementById('feedbackRow');
  if (!row) return;

  let version = '';
  fetch('/health').then((r) => r.json()).then((d) => { version = d.version || ''; }).catch(() => {});

  function envText() {
    const s = (typeof shellSettings !== 'undefined' && shellSettings) || {};
    const os = PLATFORM[s.platform] || s.platform || '';
    const app = window.claudeHub && window.claudeHub.isApp ? '데스크톱 앱' : '브라우저';
    return [os, app, s.shell ? `셸 ${s.shell}` : ''].filter(Boolean).join(' · ');
  }

  row.querySelectorAll('button[data-fb]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const q = new URLSearchParams({ template: TEMPLATES[b.dataset.fb] || 'bug.yml' });
    if (version) q.set('version', 'v' + version);
    const env = envText();
    if (env) q.set('env', env);
    // 앱에서는 setWindowOpenHandler 가 기본 브라우저로 넘긴다.
    window.open(`${REPO}/issues/new?${q}`, '_blank', 'noopener');
  }));
})();

# Claude Terminal Hub — 프로젝트 규칙

여러 Claude Code / 셸 세션을 한 브라우저(또는 Electron 앱) 화면에서 split 뷰로 관리하는 로컬 도구.
- 서버: `server.js` (Express + ws + node-pty), 포트 4778
- 프론트: `public/index.html`, `public/app.js` (xterm.js + split.js)
- 앱 래퍼: `electron/` (`claude-hub-app`)
- 실행: `claude-hub`(브라우저 앱창) / `claude-hub-app`(Electron) / `claude-hub tab`(탭)

## 1) 코드 변경 시 커밋·푸시 필수 (MUST)

이 저장소의 **코드/파일을 변경하면 반드시 git 커밋 후 push** 한다. 예외 없이 지속적으로 반영한다.

- 원격: `git@github.com:Lee-Hyeonji99/claude-terminal-hub.git` (개인 비공개, SSH)
- 커밋 identity 는 이 저장소 로컬 설정(`Lee-Hyeonji99` / `Lee-Hyeonji99@users.noreply.github.com`)을 사용 — **회사 메일/신원 금지**.
- 절차: `git add -A && git commit -m "<메시지>" && git push`
- 커밋 메시지는 한국어 + 간결. 변경 주제별로 나눠 커밋.
- 시크릿/토큰/회사 내부 정보가 들어가지 않는지 확인 후 push.

## 2) 검증

UI/서버 변경 후 가능하면 실제로 확인한다.
- 서버 헬스: `curl -s http://localhost:4778/health`
- 서버는 detach 실행 권장: `Start-Process node -ArgumentList server.js -WindowStyle Hidden` (또는 `claude-hub`)
- Electron 앱은 F5/Ctrl+R 차단(세션 보존) — 새 코드 반영은 **Ctrl+Shift+R**(명시적 새로고침) 또는 앱 재기동.

## 3) 저장 위치

- 세션 커스텀 이름/프로필: 서버 전역 파일 `~/.claude-terminal-hub/state.json` (localStorage 아님).
- 세션 제목 우선순위: Claude `/rename`(custom-title) > ai-title > 첫 메시지.
- 프로필별 계정 분리: `CLAUDE_CONFIG_DIR = ~/.claude-hub-profiles/<id>`.

# Claude Terminal Hub — 프로젝트 규칙

여러 Claude Code / 셸 세션을 한 브라우저(또는 Electron 앱) 화면에서 split 뷰로 관리하는 로컬 도구.
- 서버: `server.js` (Express + ws + node-pty), 포트 4778
- 프론트: `public/index.html`, `public/app.js` (xterm.js + split.js)
- 앱 래퍼: `electron/` (`claude-hub-app`)
- 실행: `claude-hub`(브라우저 앱창) / `claude-hub-app`(Electron) / `claude-hub tab`(탭)

## 0) 작업 시작 전 pull 필수 (MUST)

파일을 읽거나 코드를 수정하기 전에 **항상 먼저 `git pull`** 로 최신 상태를 받는다. 로컬이 원격보다 오래된 상태로 읽거나 작업을 시작하지 않는다.

- 절차: `git fetch origin && git pull origin main`
- 로컬에 반영 안 된 변경사항이 있으면 먼저 stash/commit 후 pull.

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
- 서버는 `claude-hub` / `claude-hub tab` 로 띄우는 걸 권장. `node-pty` 는 `postinstall`에서 Electron ABI 로 리빌드되므로, 수동으로 띄울 때도 시스템 `node`가 아니라 `ELECTRON_RUN_AS_NODE=1 <node_modules 안 electron 바이너리> server.js` 로 실행해야 PTY 가 정상 동작한다.
- Electron 앱은 F5/Ctrl+R 차단(세션 보존) — 새 코드 반영은 **Ctrl+Shift+R**(명시적 새로고침) 또는 앱 재기동.

## 3) 프로세스 종료 금지 (MUST)

`server.js`(node)와 Electron 앱 안에는 사용자가 실제 작업 중인 세션(pty/셸)이 떠 있을 수 있다. 이미지 이름 기준으로 무차별 종료하면(`taskkill /IM node.exe`, `taskkill /IM electron.exe`, `Stop-Process -Name ...` 등) 테스트용이 아닌 실제 작업 세션까지 같이 죽어 복구 불가능한 손실이 생긴다.

- 검증/테스트 목적이라도 **먼저 이미 떠 있는 프로세스가 있는지 확인**하고(`tasklist`, `curl /health`, PID의 `CommandLine` 확인 등), 자신이 방금 띄운 PID인지 특정한 뒤에만 종료한다.
- 기존에 떠 있던 프로세스인지 애매하면 **종료하기 전에 사용자에게 먼저 물어본다.**
- 이미지 이름 전체(`/IM`) 기준 강제 종료는 원칙적으로 금지. 반드시 특정 PID로만 종료한다.

## 4) 저장 위치

- 세션 커스텀 이름/프로필: 서버 전역 파일 `~/.claude-terminal-hub/state.json` (localStorage 아님).
- 세션 제목 우선순위: Claude `/rename`(custom-title) > ai-title > 첫 메시지.
- 프로필별 계정 분리: `CLAUDE_CONFIG_DIR = ~/.claude-hub-profiles/<id>`.

## 5) 버전 관리

의미 있는 변경(기능 추가/버그 수정 묶음)마다 `package.json` 버전을 올리고 태그를 남긴다.

- 절차: `npm version patch|minor|major -m "vX.Y.Z: 간단 요약"` → package.json 버전 bump + 커밋 + `vX.Y.Z` 태그 자동 생성.
  - patch: 버그 수정만 / minor: 기능 추가 / major: 호환 깨지는 큰 변경(개인 도구라 사실상 안 씀).
- 반영: `git push && git push --tags`.
- 같이 `CHANGELOG.md`에 Added/Fixed 항목 기록(한국어, Keep a Changelog 형식).
- 실행 중인 서버 버전 확인: `curl http://localhost:4778/health` (`version` 필드) — 앱 헤더 로고에 마우스 올려도 툴팁으로 표시됨.

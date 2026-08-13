# Claude Terminal Hub

여러 개의 Claude Code(또는 일반 셸) 세션을 하나의 브라우저(또는 데스크톱 앱) 화면에서 split 뷰로 관리하는 로컬 도구입니다. 각 패널은 진짜 PTY(Windows는 ConPTY)로 동작해 `claude` CLI를 그대로 실행하며, 브라우저 탭을 닫거나 앱을 재시작해도 세션은 백그라운드에서 계속 살아있습니다.

> 개인 로컬 도구로 시작된 프로젝트라 문서가 아직 부족할 수 있습니다. 이슈/PR 환영합니다.

## 주요 기능

- **여러 세션을 한 화면에**: 터미널 패널을 원하는 대로 분할·도킹(드래그)해서 동시에 여러 `claude` 세션을 볼 수 있습니다.
- **세션 영속(reattach)**: 브라우저 탭/창을 닫아도 서버가 떠 있는 한 PTY 프로세스는 계속 실행되고, 재접속 시 같은 화면 그대로 복귀합니다.
- **레이아웃 자동 저장**: 마지막으로 열어둔 패널 구성(분할 크기 포함)을 기억해뒀다가 다음 실행 시 그대로 복원합니다.
- **세션 목록 · 검색**: 최근 세션, 전체 세션(닫힌 것 포함), 프로필별/전체 계정 검색을 좌측 내비게이션에서 바로 볼 수 있습니다.
- **여러 계정(프로필) 지원**: 프로필별로 `CLAUDE_CONFIG_DIR`을 분리해 여러 Claude 계정을 앱 하나에서 전환하며 사용할 수 있습니다.
- **아티팩트/파일/URL 미리보기**: Claude가 만든 파일이나 로컬 파일, 웹페이지를 패널 안에서 바로 확인합니다.
- **세션 뷰어**: 터미널 대신 대화·서브에이전트 작업을 카드 형태로 보여주는 뷰어 패널.

## 실행 방법

### 요구 사항

- [Node.js](https://nodejs.org/) (LTS 권장)
- [Claude Code CLI](https://docs.claude.com/claude-code)가 설치되어 있고 `claude` 명령으로 실행 가능해야 합니다.

### 설치 후 실행

```bash
git clone <repo-url>
cd claude-terminal-hub
npm install
```

- **데스크톱 앱으로 실행**: `npm run app` (또는 설치된 `claude-hub` / `claude-hub-app` 명령)
- **브라우저 탭으로 실행**: `npm start` 후 `http://localhost:4778` 접속, 또는 `claude-hub tab`

기본 포트는 `4778`이며 `CLAUDE_HUB_PORT` 환경변수로 바꿀 수 있습니다.

### Windows 설치 파일(.exe)

`npm run dist:win`으로 NSIS 설치 파일을 빌드할 수 있습니다(Windows 환경 필요 — `node-pty` 네이티브 모듈 특성상 다른 OS에서 크로스컴파일이 안 됩니다). 저장소에는 GitHub Actions 워크플로(`.github/workflows/build-windows.yml`)가 있어 태그 푸시나 수동 실행으로 CI에서 빌드할 수 있습니다.

## 아키텍처

- `server.js` — Express + `ws`(WebSocket) + `node-pty` 서버. PTY 세션 관리, 세션 파일(jsonl) 파싱, 로컬 파일시스템 탐색 API 제공.
- `public/` — 프론트엔드. `xterm.js`로 터미널을 렌더링하고 `split.js`로 패널을 분할합니다.
- `electron/` — Electron 앱 창 래퍼. 로컬에서 `server.js`를 자식 프로세스로 띄우고 그 화면을 보여줍니다.

## 상태 저장 위치

- 세션 커스텀 이름/프로필 목록: `~/.claude-terminal-hub/state.json`
- 프로필별 Claude 계정 설정: `~/.claude-hub-profiles/<프로필 id>`
- 패널 레이아웃(마지막 화면): 브라우저/앱의 `localStorage`

## 라이선스

별도 라이선스 파일이 없으며, 이 저장소의 코드는 모든 권리를 보유합니다(All rights reserved). 별도 허가 없이 복제·수정·재배포할 수 없습니다.

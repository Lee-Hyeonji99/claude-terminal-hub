# Claude Terminal Hub

여러 개의 Claude Code(또는 일반 셸) 세션을 하나의 브라우저(또는 데스크톱 앱) 화면에서 split 뷰로 관리하는 로컬 도구입니다. 각 패널은 진짜 PTY(Windows는 ConPTY)로 동작해 `claude` CLI를 그대로 실행하며, 브라우저 탭을 닫거나 앱을 재시작해도 세션은 백그라운드에서 계속 살아있습니다.

## 주요 기능

- **여러 세션을 한 화면에**: 터미널 패널을 원하는 대로 분할·도킹(드래그)해서 동시에 여러 `claude` 세션을 볼 수 있습니다.
- **세션 영속(reattach)**: 브라우저 탭/창을 닫아도 서버가 떠 있는 한 PTY 프로세스는 계속 실행되고, 재접속 시 같은 화면 그대로 복귀합니다.
- **레이아웃 자동 저장**: 마지막으로 열어둔 패널 구성(분할 크기 포함)을 기억해뒀다가 다음 실행 시 그대로 복원합니다.
- **세션 목록 · 검색**: 최근 세션, 전체 세션(닫힌 것 포함), 검색을 좌측 내비게이션에서 바로 볼 수 있습니다. 마지막으로 돌린 계정과 열림 여부가 표시됩니다.
- **여러 계정, 작업 환경은 하나**: 계정마다 다른 건 로그인과 사용량뿐입니다. 설정 · 권한 · 훅 · 에이전트 · 스킬 · 커맨드 · rules · CLAUDE.md · MCP · 대화 기록은 모든 계정이 `~/.claude` 하나를 같이 씁니다.
  - 패널 머리줄의 계정 칩으로 같은 대화를 다른 계정으로 바로 이어갑니다(claude 를 정상 종료한 뒤 같은 대화를 다시 엽니다). 대화 파일이 하나라 몇 번을 오가도 유실이 없습니다.
  - 사용 한도에 걸리면 그 패널에 다른 계정으로 이어가기를 제안합니다.
  - 같은 대화를 두 곳에서 동시에 열면 기록이 뒤섞이므로 막고, 그 패널로 이동하거나 갈라서(`--fork-session`) 열 수 있게 합니다.
  - 머리줄 계정 버튼에서 새 패널을 열 계정을 고르고 계정을 추가 · 관리합니다.
- **파일/URL 미리보기**: 로컬 파일이나 웹페이지를 패널 안에서 바로 확인합니다.
- **세션 뷰어**: 터미널 대신 대화·서브에이전트 작업을 카드 형태로 보여주는 뷰어 패널.
- **테마 전용 펫**: 캐릭터 테마마다 펫 팩 폴더를 넣어 두면 그 테마를 쓰는 프로젝트의 펫이 그 캐릭터로 움직입니다. 펫 오른쪽 클릭으로 다른 팩이나 내 이미지를 고를 수 있습니다.

## 펫 동작

캐릭터 이미지는 설치 파일에 들어 있지 않습니다. 아래 폴더에 직접 넣어 쓰세요. 없으면 기본 펫으로 동작합니다.

| 넣을 것 | 경로 |
|---|---|
| 테마 전용 펫 팩 | `~/.claude-terminal-hub/theme-packs/<테마키>/` (`manifest.json` + 동작 이미지). 일반 테마는 `rakko` |
| 테마 이미지 (아이콘·배경·색 추출) | `~/.claude-terminal-hub/theme-assets/<테마키>-default.webp` |

테마키: `hachiware` `usagi` `momonga` `rakko` `flurry` `rasher` `marshal`. Windows 에서 `~` 는 사용자 폴더(`%USERPROFILE%`)입니다.

Claude 작업 중에는 걷기, 질문 대기는 포즈, 완료 알림은 신나기, 끌어 옮길 때는 달리기, 5분간 조용하면 졸기를 보여줍니다. 평소에는 쉬기와 두리번거리기를 반복합니다. 펫 우선순위는 직접 고른 프로젝트 팩 → 직접 고른 전체 팩 → 테마 전용 팩 → 테마 이미지 → 기본 펫입니다.

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

- 세션 커스텀 이름 · 계정 목록 · 대화별 마지막 계정: `~/.claude-terminal-hub/state.json`
- 계정별 로그인: `~/.claude-hub-profiles/<계정 id>` (`CLAUDE_CONFIG_DIR`). 이 안의 `projects` · `agents` · `commands` · `rules` · `hooks` · `output-styles` · `file-history` · `tasks` · `plans` · `session-env` · `sessions`(실행 중 세션 목록) 는 `~/.claude` 로 가는 연결(Windows junction)이고 — 그래서 계정이 달라도 세션끼리 `@` 멘션 · 메시지를 주고받습니다 — `skills` 는 계정 전용 `synced` 를 빼고 항목별로 연결합니다. 플러그인은 계정마다 설치합니다. `CLAUDE.md` 는 `@~/.claude/CLAUDE.md` 를 불러오고, settings 와 MCP(사용자 + 그 프로젝트 범위)는 실행할 때 `--settings` · `--mcp-config` 로 넘깁니다.
- 계정 폴더를 합칠 때 양쪽에서 따로 이어진 대화: `~/.claude-terminal-hub/merge-backup/`
- 패널 레이아웃(마지막 화면): 브라우저/앱의 `localStorage`

## 라이선스

별도 라이선스 파일이 없으며, 이 저장소의 코드는 모든 권리를 보유합니다(All rights reserved). 별도 허가 없이 복제·수정·재배포할 수 없습니다.

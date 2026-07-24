# Changelog

## [1.2.0] - 2026-07-24

### Added
- **macOS/Linux 지원**: `claude-hub-app.command` 런처 추가(Finder 더블클릭 실행), Dock 아이콘 지정(`app.dock.setIcon`), `electron/icon.png`(ICO에서 추출한 256×256) 추가. 플랫폼별 아이콘 자동 선택(Windows `.ico` / 그 외 `.png`).
- **웹 미리보기 파일 지원 확대**: 로컬 파일 경로(`C:\...`, UNC `\\`, POSIX `/...`, `~/...`)와 `file:` URL을 서버 `/api/file`로 라우팅해 브라우저·앱 양쪽에서 렌더. `/api/file`이 이미지/오디오/비디오/PDF/텍스트·코드 등 폭넓은 형식을 인라인(`Content-Disposition: inline`)으로 서빙하고, 확장자 미매핑 파일은 앞부분을 읽어 텍스트/바이너리를 판별.

### Fixed
- 작업표시줄 고정 시 "Electron"이 아닌 앱으로 고정되도록 브랜딩된 exe(`Claude Terminal Hub.exe`) 실행 경로 정리 (Windows).
- 터미널 세션 패널 헤더의 아이콘-텍스트 줄바꿈 잔여 문제 (flex + `<span>` 래핑으로 정렬 고정).

### Removed
- 가독성이 나쁜 라이트 테마 2종 제거: `라이트 (기본)`, `Solarized Light` (저장돼 있던 경우 자동으로 다크로 폴백).

## [1.1.1] - 2026-07-24

### Added
- 앱 아이콘 추가 (`electron/icon.ico`, 터미널 프롬프트 `>_` 모양, 앱 색상 반영) — BrowserWindow·바탕화면 바로가기에 적용
- Electron 앱에 AppUserModelID 지정 (작업표시줄에 "Electron"이 아닌 앱 이름으로 표시)
- 바탕화면 바로가기(`Claude Terminal Hub.lnk`) 생성 — 작업표시줄 고정 가능
- 세션 목록/검색창 레이아웃 버그 수정(아이콘-텍스트 줄바꿈, 검색 아이콘 겹침), 폴더 선택 모달 버튼 위치 개선

## [1.1.0] - 2026-07-24

### Added
- 색상 팔레트 12종 (다크/라이트 포함, WCAG AA 대비 검증 완료) — 헤더 팔레트 아이콘에서 선택
- 강조(하이라이트) 색상 팔레트와 별개로 선택 가능
- `claude-hub-app` 실행 시 Electron 바이너리 미설치면 설치 여부 확인 후 진행
- `/health`에 버전 정보 노출

### Fixed
- xterm 기본 DOM 렌더러 → Canvas 렌더러 애드온으로 교체 (Claude Code처럼 화면을 자주 다시 그리는 TUI에서 렌더링이 깨지던 문제)
- 허브 프로세스가 `NO_COLOR` 환경(예: 에이전트 셸)에서 뜨면 자식 셸까지 색이 꺼지던 문제 — `cleanEnv()`에서 명시적으로 제거
- 라이트/다크 테마 전환 시 반영 안 되던 하드코딩 색상 5곳(`#tabs`, 버튼 hover, `.gutter`, 파일/세션 목록 구분선)
- `claude-hub-app.cmd`/`.vbs` 경로 하드코딩 — 다른 PC에 클론하면 실행 안 되던 문제

### Docs
- 프로세스 무차별 종료 금지 규칙 추가 (PID 특정 없는 `taskkill /IM` 등 금지)

## [1.0.0] - 이전

최초 버전 — 세션 관리(split 뷰, 프로필별 계정 분리), 아티팩트/파일 미리보기, 세션 이름 자동 반영 등.

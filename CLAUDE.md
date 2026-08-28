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

- 원격: `git@github.com:Lee-Hyeonji99/claude-terminal-hub.git` (SSH)
- **저장소는 GitHub 에서 public(전체 공개)** 이고 Release 로 설치파일을 배포한다. 공개된다는 전제로 커밋할 것.
- 커밋 identity 는 이 저장소 로컬 설정(`Lee-Hyeonji99` / `padul1210@gmail.com`)을 사용 — **회사 메일/신원 금지**.
  - 설정: `git config user.name "Lee-Hyeonji99" && git config user.email "padul1210@gmail.com"`
- 커밋 메시지는 한국어 + 간결. 변경 주제별로 나눠 커밋.

### 커밋 전 필수 확인 (MUST — 어긴 적 있음)

1. **`git add -A` 금지.** 반드시 `git status --porcelain` 으로 **파일 목록을 먼저 눈으로 확인**하고, 의도한 파일만 경로로 지정해 add 한다.
   ```bash
   git status --porcelain          # 무엇이 올라가는지 먼저 본다
   git add public/app.js CHANGELOG.md   # 경로를 명시
   git commit -m "..."
   ```
2. **작업 중 생성물은 절대 커밋 금지**: 스크린샷(`*.png`), Playwright 스냅샷(`.playwright-mcp/`), 로그, 임시 스크립트.
   이런 파일에는 **열려 있던 세션 제목 · 회사 프로젝트 경로 · 업무 내용**(예: `inov.lexfarm.workspace`, JIRA 티켓, 요건 문구)이 그대로 박혀 있다.
   저장소가 public 이므로 커밋 = 전 세계 공개다. `.gitignore` 에 막아뒀지만 그것에 의존하지 말고 목록을 직접 확인할 것.
3. **커밋 identity 는 `Lee-Hyeonji99` / `padul1210@gmail.com` 하나만 사용한다.** 회사 계정·회사 메일로는 어떤 경우에도 커밋하지 않는다.
   커밋 전에 `git config user.email` 로 확인한다.
4. 시크릿/토큰이 들어가지 않는지 확인 후 push.
5. **실수로 올렸다면**: `git reset --soft` 로 이력에서 빼고 `git push --force` 하되, **태그도 같이 force-push** 해야 한다.
   태그가 옛 커밋을 붙잡고 있으면 커밋이 계속 공개 상태로 남는다. 릴리즈가 이미 만들어졌다면 그 릴리즈도 지워야 한다.

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
- **캐릭터 테마 이미지**: `~/.claude-terminal-hub/theme-assets/` (서버가 `/theme-assets` 로 읽기 제공, `POST /api/theme-assets` 로 저장).
  - **저작권 있는 캐릭터 이미지는 저장소·설치파일에 절대 넣지 않는다.** 저장소가 public 이고 Release 로 배포되므로 재배포가 된다. 앱은 사용자 PC 의 이 폴더를 읽기만 하고, 이미지가 없으면 색상 팔레트만 적용하고 아이콘 자리는 숨긴다(정상 동작).
  - 팔레트는 하드코딩하지 않고 이미지에서 대표색을 추출해 생성한다(`public/app.js` 의 `extractColors`/`buildCharPalette`). 테마 메타는 `public/themes.js`.
- **세션 영속(reattach)**: pty 는 ws 에 종속되지 않고 `ptyStore`(key→session)로 유지된다. ws 가 끊겨도 pty 는 살아있고 재연결 시 같은 key 로 재부착한다. 실제 종료는 클라이언트의 `{type:'kill'}`(패널 X) 또는 프로세스 exit 뿐 — 따라서 **서버 프로세스를 죽이면 살아있는 모든 세션이 사라진다**(§3 더욱 중요).

## 5) 버전 관리

의미 있는 변경(기능 추가/버그 수정 묶음)마다 `package.json` 버전을 올리고 태그를 남긴다.

- 절차: `npm version patch|minor|major -m "vX.Y.Z: 간단 요약"` → package.json 버전 bump + 커밋 + `vX.Y.Z` 태그 자동 생성.
  - patch: 버그 수정만 / minor: 기능 추가 / major: 호환 깨지는 큰 변경(개인 도구라 사실상 안 씀).
- 반영: `git push && git push --tags`.
- 같이 `CHANGELOG.md`에 Added/Fixed 항목 기록(한국어, Keep a Changelog 형식).
- 실행 중인 서버 버전 확인: `curl http://localhost:4778/health` (`version` 필드) — 앱 헤더 로고에 마우스 올려도 툴팁으로 표시됨.

## 6) 배포 = 릴리즈 발행까지 (MUST)

**태그를 push 하는 것만으로는 배포가 끝난 게 아니다.** GitHub Release 가 **정식 발행(draft 해제)** 되어야 사용자에게 보이고 `electron-updater` 의 auto-update 가 잡는다. 배포 요청을 받으면 아래를 끝까지 수행하고, 마지막에 **정식 발행 여부를 API 로 확인**한 뒤 보고한다.

### 절차

1. 변경 커밋 & push (§1)
2. `npm version patch|minor|major -m "vX.Y.Z: 요약"` → package.json bump + 커밋 + 태그 생성 (§5)
3. `git push && git push --tags`
4. 태그 push 가 **`release.yml` 하나**를 기동한다. job 3개:
   - `windows` (windows-latest): draft 릴리즈 확보 → `electron-builder --win --publish always` → **업로드 검증**(exe·`latest.yml` 존재 확인, 없으면 실패)
   - `mac` (macos-latest): 같은 방식으로 dmg/zip·`latest-mac.yml`
   - `publish` (`needs: [windows, mac]`): **두 빌드가 모두 끝난 뒤에만** `gh release edit <tag> --draft=false` 로 정식 발행
   - `build-windows.yml` / `build-mac.yml` 은 **수동 테스트 빌드 전용**(workflow_dispatch, 릴리즈 안 건드림).
5. 완료 확인 (인증 없이 가능):
   ```bash
   # 빌드 성공 여부
   curl -s "https://api.github.com/repos/Lee-Hyeonji99/claude-terminal-hub/actions/runs?per_page=2" | grep -E '"(name|status|conclusion)"'
   # 정식 발행 여부 — latest 가 방금 태그면 성공 (draft 면 여기 안 잡힘)
   curl -s "https://api.github.com/repos/Lee-Hyeonji99/claude-terminal-hub/releases/latest" | grep tag_name
   ```

### 실패 시 폴백

- 릴리즈가 draft 로 남았으면 → Actions 의 **`Publish draft release`** 워크플로를 `workflow_dispatch` 로 실행(입력: 태그명). GitHub UI 의 Release 편집 화면에서 `Publish release` 를 눌러도 된다.
- 로컬에는 GitHub API 토큰이 없다(원격이 SSH). 즉 **에이전트가 직접 릴리즈를 발행할 수는 없으므로**, 발행은 반드시 CI 워크플로 스텝(위 4-3)에 맡긴다. 워크플로에서 그 스텝이 빠지면 배포가 draft 로 멈춘다.
- 빌드는 성공했는데 auto-update 가 안 잡히면 `latest.yml` 이 릴리즈에 올라갔는지 먼저 확인한다.
- **electron-builder 는 이미 published 된 릴리즈에는 업로드를 조용히 건너뛴다(스텝은 success 로 끝남).** 그래서 발행은 반드시 모든 플랫폼 빌드가 끝난 뒤 마지막에 한 번만 해야 한다. v1.14.1 에서 이 레이스로 Windows exe 와 `latest.yml` 이 통째로 누락된 적이 있다 — `release.yml` 의 `publish` job(`needs`) 구조를 깨지 말 것.

### 주의

- `node-pty` 네이티브 모듈 때문에 크로스컴파일이 안 된다 — Windows exe 는 windows 러너, mac 앱은 macos 러너에서만 빌드된다.
- 로컬에서 `npm install` 을 돌리면 Electron 바이너리 다운로드가 필요하다. 받지 못하면 `node_modules` 가 반쯤 설치된 상태가 되어 `npm run app` 이 실패한다(서버만 띄우는 건 가능). 어중간하면 지우고 다시 설치할 것.

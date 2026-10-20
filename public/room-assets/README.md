# 작업실 에셋

정면 2D 방치형 작업실 게임용 신규 생성 그림. 캐릭터·실존 브랜드를 포함하지 않는다.
사용자 요청에 따라 2026-10-20 생성한 에셋을 커밋했다. 내장 ImageGen으로 그린 뒤 지정 크기로 저장했다.

`/room-assets/<파일명>.png`로 불러올 수 있다. 기존 `build.files`의 `public/**/*`에 포함되므로 별도 다운로드 없이 패키징된다. 원본 사본은 사용자 PC의 `~/.claude-terminal-hub/room-assets/`에 저장했다. 이 변경은 에셋만 추가하며 게임 UI 연결은 포함하지 않는다.

- 벽·마루는 불투명 배경 타일이며 좌우 경계 픽셀이 일치한다.
- 나머지는 투명 배경 RGBA PNG. 창의 네 유리 칸과 열린 문의 내부는 완전 투명하다.
- 서류 더미는 같은 36×40 캔버스에서 하단 기준선을 고정하고 높이를 5단계로 늘린다.
- 연기는 작은 것 → 큰 것 → 커지며 흐려지는 순서다.
- 조명 켜짐에는 빛 번짐이 없으며 앱에서 별도로 합성한다.
- 글자·로고는 없다. 모니터 코드는 추상 선으로, 오류는 요청된 느낌표로 표시한다. `fx-zzz.png`에는 요청된 Z 두 개가 있다.
- `contact-sheet.png`는 파일명과 크기를 붙인 미리보기이며 게임 스프라이트가 아니다.

| 파일 | 크기(px) |
|---|---|
| room-wall.png | 1120×300 |
| room-floor.png | 1120×340 |
| window-frame.png | 200×150 |
| door-closed.png, door-open.png | 100×170 |
| lamp-off.png, lamp-on.png | 60×120 |
| sun.png, sun-low.png | 48×48 |
| moon.png | 40×40 |
| star.png | 12×12 |
| cloud-1.png | 90×30 |
| cloud-2.png | 70×24 |
| work-desk.png | 200×110 |
| monitor-on.png, monitor-error.png | 100×70 |
| paper-stack-1.png ~ paper-stack-5.png | 36×40 |
| sofa.png | 180×90 |
| whiteboard.png | 260×140 |
| my-desk.png | 210×200 |
| inbox-tray.png | 70×40 |
| inbox-paper.png | 56×8 |
| doc-question.png, doc-permission.png | 170×90 |
| fx-sweat.png | 14×18 |
| fx-smoke-1.png ~ fx-smoke-3.png | 24×24 |
| fx-check.png | 24×24 |
| fx-zzz.png | 30×30 |

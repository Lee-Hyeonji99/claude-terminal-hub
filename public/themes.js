/* ============================================================
 * 캐릭터 테마 정의
 *
 * 색은 여기에 하드코딩하지 않는다 — 캐릭터 이미지에서 자동 추출해서 만든다.
 * (app.js 의 extractColors / buildPalette 참고)
 * 이미지는 저장소에 넣지 않고 사용자 PC 의 아래 폴더에서 읽는다:
 *   ~/.claude-terminal-hub/theme-assets/
 * 이미지가 없으면 fallback 색으로 팔레트를 만들고 아이콘 자리는 숨긴다.
 * ============================================================ */

// 아이콘(아바타·커서)용 파일 후보 → 앞에서부터 있는 걸 쓴다.
// full(워터마크·배경·팔레트 추출)용도 마찬가지.
window.CHAR_THEMES = [
  {
    key: 'hachiware', name: '하치와레', ip: '치이카와', quirk: '야하-!',
    ph: '같이 해보자…   Enter 전송 · Shift+Enter 줄바꿈',
    ui: 'Gowun Dodum', fallback: '#7aaac3',
    icon: ['hachiware-icon.png', 'hachiware.webp', 'hachiware.png'],
    full: ['hachiware.webp', 'hachiware.png'],
  },
  {
    key: 'usagi', name: '우사기', ip: '치이카와', quirk: '우라-!',
    ph: '우랏!   Enter 전송 · Shift+Enter 줄바꿈',
    ui: 'Jua', fallback: '#ffd447',
    icon: ['usagi-icon.png', 'usagi.webp', 'usagi.png'],
    full: ['usagi.webp', 'usagi.png'],
  },
  {
    key: 'momonga', name: '모몽가', ip: '치이카와', quirk: '모몽가~',
    ph: '모몽가가 해줄게…   Enter 전송',
    ui: 'Gowun Dodum', fallback: '#fdc7ce',
    icon: ['momonga-icon.png', 'momonga.webp', 'momonga.png'],
    full: ['momonga.webp', 'momonga.png'],
  },
  {
    key: 'rakko', name: '랏코', ip: '치이카와', quirk: '훗…',
    ph: '다음 작업은?   Enter 전송',
    ui: 'Pretendard', fallback: '#f2dfae',
    icon: ['rakko-icon.png', 'rakko.webp', 'rakko.png'],
    full: ['rakko.webp', 'rakko.png'],
  },
  {
    key: 'flurry', name: '뽀야미', ip: '동물의숲', quirk: '뽀드득',
    ph: '무엇을 도와줄까 뽀드득…',
    ui: 'Gowun Dodum', fallback: '#c42838',
    icon: ['flurry-icon.png', 'flurry.png'],
    full: ['flurry.png', 'flurry-icon.png'],
  },
  {
    key: 'rasher', name: '글레이', ip: '동물의숲', quirk: '꾸엑',
    ph: '용건만 말해라 꾸엑…',
    ui: 'Pretendard', fallback: '#8f3243',
    icon: ['rasher-icon.png', 'rasher.png'],
    full: ['rasher.png', 'rasher-icon.png'],
  },
  {
    key: 'marshal', name: '쭈니', ip: '동물의숲', quirk: '어차피',
    ph: '어차피 할 거지만…   Enter 전송',
    ui: 'Gowun Dodum', fallback: '#a492cf',
    icon: ['marshal-icon.png', 'marshal.png'],
    full: ['marshal.png', 'marshal-icon.png'],
  },
];

window.CHAR_THEME_MAP = Object.fromEntries(window.CHAR_THEMES.map((t) => [t.key, t]));

// UI 글꼴 후보 (번들된 것 + 시스템)
window.UI_FONTS = [
  { label: 'Pretendard (기본)', css: "'Pretendard','Segoe UI',system-ui,sans-serif", bundled: true },
  { label: 'Segoe UI (기존)', css: "'Segoe UI',system-ui,sans-serif", bundled: false },
  { label: '고운돋움 (둥근)', css: "'Gowun Dodum','Pretendard','Segoe UI',sans-serif", bundled: true },
  { label: '주아 (통통)', css: "'Jua','Pretendard','Segoe UI',sans-serif", bundled: true },
  { label: '맑은 고딕', css: "'Malgun Gothic','Segoe UI',sans-serif", bundled: false },
];

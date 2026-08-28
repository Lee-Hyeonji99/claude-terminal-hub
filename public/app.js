'use strict';
/* Claude Terminal Hub — 폴더 선택 → 세션 목록(재개) → split/도킹 뷰 */

/* ---------- SVG 아이콘 (이모지 대체, currentColor) ---------- */
function ic(inner) {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
const ICON = {
  plus: ic('<path d="M12 5v14M5 12h14"/>'),
  globe: ic('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/>'),
  moon: ic('<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>'),
  sun: ic('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>'),
  menu: ic('<path d="M3 6h18M3 12h18M3 18h18"/>'),
  x: ic('<path d="M6 6l12 12M18 6L6 18"/>'),
  refresh: ic('<path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5"/>'),
  split: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18"/>'),
  chat: ic('<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  folder: ic('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  file: ic('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>'),
  eye: ic('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'),
  external: ic('<path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>'),
  back: ic('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
  search: ic('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  warn: ic('<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
  download: ic('<path d="M12 3v12M7 11l5 5 5-5M4 20h16"/>'),
  pointer: ic('<path d="M5 3 L5 20 L9.5 16 L12.5 21.5 L15 20.3 L12 15 L18 15 Z"/>'),
  palette: ic('<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.7 1.1-1.6-.3-.6-.1-1.4.6-1.7.5-.2 1-.2 1.5-.2 2 0 3.8-1.7 3.8-4.5C19 6.9 15.9 3 12 3z"/><circle cx="7.5" cy="11.5" r="1.2"/><circle cx="10.5" cy="7.5" r="1.2"/><circle cx="15" cy="8" r="1.2"/>'),
  droplet: ic('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
  minimize: ic('<path d="M5 12h14"/>'),
  restore: ic('<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 1 2-2v-3"/>'),
  help: ic('<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4"/><path d="M12 17h.01"/>'),
  keyboard: ic('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/>'),
  task: ic('<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>'),
  tool: ic('<path d="M4 17l6-6-6-6"/><path d="M12 19h8"/>'),
};
function hydrateIcons(root) {
  (root || document).querySelectorAll('[data-icon]').forEach((el) => {
    if (!el.dataset.done) { el.innerHTML = ICON[el.dataset.icon] || ''; el.dataset.done = '1'; }
  });
}

const Terminal = window.Terminal;
const FitAddon = (window.FitAddon && window.FitAddon.FitAddon) || window.FitAddon;
const CanvasAddon = (window.CanvasAddon && window.CanvasAddon.CanvasAddon) || window.CanvasAddon;
const Split = window.Split;

const stage = document.getElementById('stage');
const emptyMsg = document.getElementById('empty');
const overlay = document.getElementById('overlay');
const folderModal = document.getElementById('folderModal');
const sessionModal = document.getElementById('sessionModal');
const statusEl = document.getElementById('status');

/* ---------- 레이아웃 모델 ----------
 * columns: [{ el, panes:[pane], split }]
 * pane:    { el, term, ws, cfg, fit(), dispose(), connect() }
 * 최상위 columns 는 가로 Split, 각 column 의 panes 는 세로 Split.
 * 재배치(드래그 도킹)는 살아있는 pane.el(터미널 포함)을 DOM 이동만 하여 세션을 보존한다. */
let columns = [];
let columnSplit = null;
const minimized = [];              // 최소화된 패널 목록 (claude 는 계속 실행, DOM 만 숨김 보관)
const viewerByKey = new Map();     // 세션 key -> 열려있는 뷰어 패널 (중복 방지)
const minStash = document.createElement('div'); // 최소화 패널 DOM 을 살려두는 숨김 보관소 (term/ws 유지)
minStash.id = 'minStash'; minStash.style.display = 'none';
document.addEventListener('DOMContentLoaded', () => document.body.appendChild(minStash));
if (document.body) document.body.appendChild(minStash);

const TERM_THEMES = {
  dark: { background: '#12151f', foreground: '#d7dbe6', black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510', blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5', brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#e5e5e5' },
  dracula: { background: '#282a36', foreground: '#f8f8f2', black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2', brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff' },
  solarized: { background: '#002b36', foreground: '#93a1a1', black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5', brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3' },
  nord: { background: '#2e3440', foreground: '#d8dee9', black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0', brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4' },
  onedark: { background: '#282c34', foreground: '#abb2bf', black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf', brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#d19a66', brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff' },
  gruvbox: { background: '#282828', foreground: '#ebdbb2', black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984', brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2' },
  monokai: { background: '#272822', foreground: '#f8f8f2', black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75', blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2', brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e', brightYellow: '#f4bf75', brightBlue: '#66d9ef', brightMagenta: '#ae81ff', brightCyan: '#a1efe4', brightWhite: '#f9f8f5' },
  tokyonight: { background: '#1a1b26', foreground: '#c0caf5', black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6', brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68', brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5' },
  catppuccin: { background: '#1e1e2e', foreground: '#cdd6f4', black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de', brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1', brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#f5c2e7', brightCyan: '#94e2d5', brightWhite: '#a6adc8' },
  githubdark: { background: '#0d1117', foreground: '#c9d1d9', black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4', brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc' },
};
let activeTermTheme = null; // 캐릭터 테마일 때 이미지에서 만든 팔레트가 들어간다
function currentTermTheme() { return activeTermTheme || TERM_THEMES[document.body.dataset.theme] || TERM_THEMES.dark; }
let activePane = null;

/* ---------- 새 메시지 알림 (OS 알림 / 브라우저 알림) ---------- */
function ensureNotifyPermission() {
  if (window.claudeHub && window.claudeHub.isApp) return; // Electron: 메인 프로세스가 OS 알림 담당
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  Notification.requestPermission().catch(() => {});
}
// 작업 완료 알림 — 터미널 벨(\x07)에서만 발생. Claude 는 턴 완료/입력 대기 시 벨을 울린다.
// (벨을 안 울리는 환경이면 알림은 그냥 발생하지 않음). 디바운스는 세션(패널)별로 호출부에서 처리.
function notifyDone(cfg) {
  const title = (cfg.title || 'Claude').trim();
  const shortCwd = cfg.cwd ? (cfg.cwd.split(/[\\/]/).filter(Boolean).pop() || cfg.cwd) : '';
  const body = `작업 완료 — ${title}${shortCwd ? ' · ' + shortCwd : ''}`;
  // 세션별 구분을 위해 tag 사용(Electron/브라우저 모두) — 같은 세션 알림은 갱신, 다른 세션은 별도로 쌓임
  const tag = 'cth-' + (cfg.resumeId || title || Math.random().toString(36).slice(2));
  if (window.claudeHub && window.claudeHub.notify) { window.claudeHub.notify({ title: '작업 완료', body, tag }); return; }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification('작업 완료', { body, tag }); } catch {}
}

/* ---------- 터미널 글자 크기 조절 ---------- */
const FONT_MIN = 9, FONT_MAX = 28;
let termFontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, parseInt(localStorage.getItem('cth_font_size'), 10) || 13));
function applyFontSize(px) {
  termFontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, px));
  localStorage.setItem('cth_font_size', String(termFontSize));
  const label = document.getElementById('fontSizeLabel');
  if (label) label.textContent = termFontSize;
  columns.forEach((c) => c.panes.forEach((p) => { if (p.term) { try { p.term.options.fontSize = termFontSize; } catch {} } }));
  setTimeout(() => { try { fitAll(); } catch {} }, 30);
}

/* ---------- 터미널 글꼴(폰트) 선택 ---------- */
const FONT_FAMILIES = [
  { label: 'JetBrains Mono (번들)', css: "'JetBrains Mono',Consolas,monospace" },
  { label: 'Fira Code (번들)', css: "'Fira Code',Consolas,monospace" },
  { label: 'Cascadia Code', css: "'Cascadia Code','Cascadia Mono',Consolas,monospace" },
  { label: 'Cascadia Mono', css: "'Cascadia Mono',Consolas,monospace" },
  { label: 'D2Coding', css: "'D2Coding',Consolas,monospace" },
  { label: 'Consolas', css: "Consolas,'Courier New',monospace" },
];
let termFontFamily = localStorage.getItem('cth_font_family') || FONT_FAMILIES[0].css;
function applyFontFamily(css) {
  termFontFamily = css;
  localStorage.setItem('cth_font_family', css);
  columns.forEach((c) => c.panes.forEach((p) => {
    if (!p.term) return;
    try {
      p.term.options.fontFamily = css;
      // 캔버스 렌더러는 글리프를 캐시하므로 아틀라스를 비우고 다시 그려야 실제로 바뀐다.
      if (typeof p.term.clearTextureAtlas === 'function') p.term.clearTextureAtlas();
      p.term.refresh(0, Math.max(0, (p.term.rows || 1) - 1));
    } catch {}
  }));
  setTimeout(() => { try { fitAll(); } catch {} }, 30);
}

/* ---------- 화면(UI) 글꼴 — 헤더·목록·입력창 등 터미널 밖 전부 ---------- */
const DEFAULT_UI_FONT = "'Pretendard','Segoe UI',system-ui,sans-serif";
let uiFontFamily = localStorage.getItem('cth_ui_font') || DEFAULT_UI_FONT;
function applyUiFont(css, remember) {
  uiFontFamily = css || DEFAULT_UI_FONT;
  if (remember !== false) localStorage.setItem('cth_ui_font', uiFontFamily);
  document.documentElement.style.setProperty('--ui-font', uiFontFamily);
}

// 로컬에 설치된 글꼴인지 검사 — 없으면 조용히 폴백되므로 목록에 표시해준다.
async function fontInstalled(name) {
  try {
    if (!('FontFace' in window)) return true;
    await new FontFace('__cthprobe__', `local("${name}")`).load();
    return true;
  } catch { return false; }
}
const BUNDLED_FONTS = ['JetBrains Mono', 'Fira Code', 'Pretendard', 'Gowun Dodum', 'Jua'];
async function markMissingFonts(sel, list) {
  if (!sel) return;
  for (let i = 0; i < list.length; i++) {
    const first = (list[i].css.match(/'([^']+)'|"([^"]+)"|^([^,]+)/) || [])[0].replace(/['"]/g, '').trim();
    if (BUNDLED_FONTS.includes(first)) continue;
    const ok = await fontInstalled(first);
    const opt = sel.options[i];
    if (!ok && opt && !/미설치/.test(opt.textContent)) opt.textContent += '  (미설치)';
  }
}

/* ================= 대화 로그(메신저 뷰) =================
 * 컴포즈 입력창 위에 "내가 보낸 메시지 + Claude 응답"을 메신저처럼 보여준다.
 * 테마·강도와 무관하게 동작하며 표시 방식만 고른다: off / bubble(카톡) / discord.
 * 보낸 메시지는 transcript 에 반영되기 전에도 즉시 보이도록 로컬 에코를 함께 그린다.
 * ======================================================== */
const CHAT_MODES = ['off', 'bubble', 'discord'];
function chatMode() {
  const m = localStorage.getItem('cth_chat_mode');
  return CHAT_MODES.includes(m) ? m : 'off';
}
// 화면 배치: split = 터미널 + 아래 대화, chat = 터미널 접고 대화만
function chatLayout() { return localStorage.getItem('cth_chat_layout') === 'chat' ? 'chat' : 'split'; }
function applyChatLayout(l) {
  if (l !== 'chat') l = 'split';
  localStorage.setItem('cth_chat_layout', l);
  const on = l === 'chat' && chatMode() !== 'off';
  document.body.classList.toggle('chat-only', on);
  document.querySelectorAll('#chatLayoutRow button').forEach((b) => b.classList.toggle('on', b.dataset.layout === l));
  document.querySelectorAll('.compose .cbtn.chatonly-btn').forEach((b) => b.classList.toggle('on', on));
  refreshAllChats();
  setTimeout(() => { try { fitAll(); } catch {} }, 80);
}
function aiName() {
  const k = document.body.dataset.char;
  const t = k && window.CHAR_THEME_MAP ? window.CHAR_THEME_MAP[k] : null;
  return (t && t.name) || 'Claude';
}
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return '';
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  return `${h < 12 ? '오전' : '오후'} ${((h + 11) % 12) + 1}:${m}`;
}
function refreshAllChats() {
  columns.forEach((c) => c.panes.forEach((p) => { if (p._refreshLog) p._refreshLog(); }));
  minimized.forEach((p) => { if (p._refreshLog) p._refreshLog(); });
}
function applyChatMode(m) {
  if (!CHAT_MODES.includes(m)) m = 'off';
  localStorage.setItem('cth_chat_mode', m);
  document.body.classList.toggle('chat-on', m !== 'off');
  document.querySelectorAll('#chatPopover .popover-item').forEach((el) => el.classList.toggle('active', el.dataset.chat === m));
  const btn = document.getElementById('chatBtn');
  if (btn) btn.classList.toggle('on', m !== 'off');
  // 표시 방식이 꺼져 있으면 배치 선택은 의미가 없으므로 숨긴다.
  const sep = document.getElementById('chatLayoutSep'), row = document.getElementById('chatLayoutRow');
  if (sep) sep.style.display = m === 'off' ? 'none' : 'block';
  if (row) row.style.display = m === 'off' ? 'none' : 'flex';
  const note = document.getElementById('chatNote');
  if (note) {
    note.textContent = m === 'off'
      ? '대화 보기를 켜면 입력창 위에 주고받은 메시지가 쌓입니다.'
      : '“대화만”을 고르면 터미널을 접고 메신저 화면만 씁니다. Claude 가 y/n 같은 걸 물어보면 터미널을 다시 펴야 보입니다.';
  }
  // 대화 보기를 켰는데 컴포즈가 꺼져 있으면 아무것도 안 보이므로 같이 켠다.
  if (m !== 'off') setCompose(true);
  applyChatLayout(chatLayout());   // 배치(터미널+대화 / 대화만)까지 반영
}

/* ---------- 계정 프로필 / 탭 ---------- */
let profiles = [{ id: 'default', name: '기본' }]; // 서버 /api/state 에서 로드됨
function saveProfiles() {
  fetch('/api/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profiles }) }).catch(() => {});
}
let activeProfileId = localStorage.getItem('cth_active_profile') || 'default';
const profileWorkspaces = {}; // id -> { columns, activePane }
const accountCache = {}; // id -> 계정 라벨 (탭 호버 툴팁)
function fetchAccount(id) {
  accountCache[id] = '계정 확인 중…';
  fetch(`/api/account?profile=${encodeURIComponent(id)}`).then((r) => r.json()).then((a) => {
    accountCache[id] = a.loggedIn ? `계정: ${a.email}` : '로그인 안 됨 — 첫 세션에서 /login 하세요';
    renderTabs();
  }).catch(() => { accountCache[id] = '계정 정보 없음'; renderTabs(); });
}
const wsStash = document.createElement('div');
wsStash.style.display = 'none';
document.body.appendChild(wsStash);
const profileQ = () => `profile=${encodeURIComponent(activeProfileId)}`;
// LNB(최근/검색)에서 "모든 계정" 보기 토글 — 켜면 모든 프로필 세션을 함께 나열
let lnbAllProfiles = localStorage.getItem('cth_lnb_all_profiles') === '1';
// LNB "모든 세션" 보기 토글 — 켜면 개수 제한 없이(서버 상한 500) 닫힌 세션까지 전부 나열 + 입력 시각 표시
let lnbAllSessions = localStorage.getItem('cth_lnb_all_sessions') === '1';
const lnbProfileQ = () => (lnbAllProfiles ? 'profile=__all__' : profileQ());
function profileName(id) { const p = profiles.find((x) => x.id === id); return p ? p.name : (id || '기본'); }

// 세션 열기: 다른 계정 소속이면 그 계정 탭으로 전환 후 열기(원 계정으로 이어가기 = 방식 A)
function openSession(s, placement) {
  if (s.profile && s.profile !== activeProfileId && profiles.find((p) => p.id === s.profile)) switchProfile(s.profile);
  addPane({ cwd: s.cwd, resumeId: s.id, title: s.title, profile: s.profile || activeProfileId }, placement || 'column');
}

// 다른 계정 대화를 현재 활성 계정으로 복사해서 이어가기(방식 B). 원본은 그대로 유지.
async function continueHere(s) {
  const target = activeProfileId;
  const r = await fetch('/api/session/copy', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: s.id, cwd: s.cwd, fromProfile: s.profile || 'default', toProfile: target }),
  }).then((x) => x.json()).catch(() => ({ error: '요청 실패' }));
  if (!r || r.error) { await uiConfirm((r && r.error) || '복사에 실패했습니다.', '이어가기 실패'); return; }
  addPane({ cwd: s.cwd, resumeId: s.id, title: s.title, profile: target }, 'column');
}

function paneCountOf(id) {
  const cols = id === activeProfileId ? columns : ((profileWorkspaces[id] && profileWorkspaces[id].columns) || []);
  return cols.reduce((a, c) => a + c.panes.length, 0);
}

function switchProfile(id) {
  if (id === activeProfileId) { renderTabs(); return; }
  // 현재 워크스페이스 저장 + DOM 을 스태시로 분리 (패널/세션 유지)
  profileWorkspaces[activeProfileId] = { columns, activePane };
  columns.forEach((c) => wsStash.appendChild(c.el));
  if (columnSplit) { try { columnSplit.destroy(); } catch {} columnSplit = null; }
  // 대상 워크스페이스 로드
  activeProfileId = id;
  localStorage.setItem('cth_active_profile', id);
  delete accountCache[id]; // 전환 시 계정 정보 재조회 (로그인 변경 반영)
  const w = profileWorkspaces[id] || { columns: [], activePane: null };
  columns = w.columns;
  activePane = w.activePane || null;
  columns.forEach((c) => stage.appendChild(c.el));
  if (columns.length === 0 && !layoutRestoreAttempted.has(id)) restoreLayoutForProfile(id);
  rebuildAll();
  renderTabs();
  updateStatus();
  const si = document.getElementById('lnbSearch');
  if (si) { si.value = ''; document.getElementById('lnbSearchClear').style.display = 'none'; }
  loadRecent();
}

function renderTabs() {
  const list = document.getElementById('tabList');
  if (!list) return;
  list.innerHTML = '';
  profiles.forEach((p) => {
    const t = document.createElement('div');
    t.className = 'tab' + (p.id === activeProfileId ? ' active' : '');
    const n = paneCountOf(p.id);
    t.innerHTML = `<span class="tname">${escapeHtml(p.name)}</span>` +
      (n ? `<span class="cnt">${n}</span>` : '') +
      (p.id !== 'default' ? `<button class="tclose" title="프로필 삭제">${ICON.x}</button>` : '');
    if (!(p.id in accountCache)) fetchAccount(p.id);
    const acct = accountCache[p.id] || '계정 확인 중…';
    t.title = acct + (p.id !== 'default' ? '\n더블클릭 = 이름 변경' : '');
    t.addEventListener('click', () => switchProfile(p.id));
    if (p.id !== 'default') {
      t.addEventListener('dblclick', (e) => { e.stopPropagation(); renameProfile(p.id); });
    }
    const cb = t.querySelector('.tclose');
    if (cb) cb.addEventListener('click', (e) => { e.stopPropagation(); deleteProfile(p.id); });
    list.appendChild(t);
  });
}

async function addProfile() {
  const name = await uiPrompt('새 계정(프로필) 추가', '', '예: 회사, 개인 — 첫 세션에서 /login 으로 그 계정에 로그인하세요.');
  if (!name || !name.trim()) return;
  const id = 'p_' + Math.abs(Date.now()).toString(36);
  profiles.push({ id, name: name.trim() });
  saveProfiles();
  switchProfile(id);
}

async function renameProfile(id) {
  if (id === 'default') return; // 기본 프로필은 이름 고정
  const p = profiles.find((x) => x.id === id);
  if (!p) return;
  const v = await uiPrompt('프로필 이름 변경', p.name);
  if (v === null || !v.trim()) return;
  p.name = v.trim();
  saveProfiles();
  renderTabs();
}

async function deleteProfile(id) {
  if (paneCountOf(id) > 0) { await uiConfirm('이 프로필에 열린 세션이 있습니다. 먼저 닫아주세요.', '삭제 불가'); return; }
  if (!(await uiConfirm('계정 로그인 폴더(~/.claude-hub-profiles)는 남습니다.', '이 프로필 탭을 삭제할까요?'))) return;
  profiles = profiles.filter((p) => p.id !== id);
  delete profileWorkspaces[id];
  saveProfiles();
  if (activeProfileId === id) { activeProfileId = 'default'; switchProfile('default'); }
  else renderTabs();
}

/* ---------- 인페이지 프롬프트/확인 모달 (네이티브 prompt/confirm 대체) ---------- */
function uiPrompt(title, value, msg) {
  return new Promise((resolve) => {
    const ov = document.getElementById('promptOverlay');
    document.getElementById('pmTitle').textContent = title || '';
    const mEl = document.getElementById('pmMsg'); mEl.textContent = msg || ''; mEl.style.display = msg ? 'block' : 'none';
    const inp = document.getElementById('pmInput'); inp.style.display = 'block'; inp.value = value || '';
    const ok = document.getElementById('pmOk'); const cancel = document.getElementById('pmCancel');
    ov.classList.add('open');
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
    const done = (val) => { ov.classList.remove('open'); ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); inp.removeEventListener('keydown', onKey); resolve(val); };
    const onOk = () => done(inp.value);
    const onCancel = () => done(null);
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); done(inp.value); } else if (e.key === 'Escape') { e.preventDefault(); done(null); } };
    ok.addEventListener('click', onOk); cancel.addEventListener('click', onCancel); inp.addEventListener('keydown', onKey);
  });
}
function uiConfirm(msg, title) {
  return new Promise((resolve) => {
    const ov = document.getElementById('promptOverlay');
    document.getElementById('pmTitle').textContent = title || '확인';
    const mEl = document.getElementById('pmMsg'); mEl.textContent = msg || ''; mEl.style.display = msg ? 'block' : 'none';
    const inp = document.getElementById('pmInput'); inp.style.display = 'none';
    const ok = document.getElementById('pmOk'); const cancel = document.getElementById('pmCancel');
    ov.classList.add('open');
    setTimeout(() => ok.focus(), 30);
    const done = (val) => { ov.classList.remove('open'); ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); document.removeEventListener('keydown', onKey); resolve(val); };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
    ok.addEventListener('click', onOk); cancel.addEventListener('click', onCancel); document.addEventListener('keydown', onKey);
  });
}

/* ---------- 테마 (색상 팔레트) ---------- */
function closePopovers() { document.querySelectorAll('.popover').forEach((p) => p.classList.remove('open')); }
function setupPopover(btnId, popId) {
  const btn = document.getElementById(btnId);
  const pop = document.getElementById(popId);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = !pop.classList.contains('open');
    closePopovers();
    if (willOpen) pop.classList.add('open');
  });
  pop.addEventListener('click', (e) => e.stopPropagation());
}
document.addEventListener('click', closePopovers);

/* ================= 캐릭터 테마 =================
 * 색은 하드코딩하지 않고 캐릭터 이미지에서 뽑아 팔레트를 만든다.
 * 이미지는 ~/.claude-terminal-hub/theme-assets/ (저장소·설치파일에 없음).
 * ============================================== */
const CHAR_MAP = () => window.CHAR_THEME_MAP || {};
let themeAssetFiles = [];
async function loadThemeAssets() {
  try { themeAssetFiles = (await fetch('/api/theme-assets').then((r) => r.json())).files || []; }
  catch { themeAssetFiles = []; }
}
function pickAsset(cands) {
  for (const c of (cands || [])) if (themeAssetFiles.includes(c)) return '/theme-assets/' + encodeURIComponent(c);
  return null;
}
function charAssets(key) {
  const t = CHAR_MAP()[key];
  if (!t) return { icon: null, full: null };
  const icon = pickAsset(t.icon), full = pickAsset(t.full);
  return { icon: icon || full, full: full || icon };
}

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, sa = 0;
  if (mx !== mn) {
    const d = mx - mn;
    sa = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, sa, l];
}
const hsl = (h, s, l) => `hsl(${h.toFixed(0)} ${Math.max(0, Math.min(100, s)).toFixed(0)}% ${Math.max(0, Math.min(100, l)).toFixed(0)}%)`;
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [220, 0.6, 0.6];
  const n = parseInt(m[1], 16);
  return rgb2hsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

const palCache = {};
function loadPalCache() {
  try { Object.assign(palCache, JSON.parse(localStorage.getItem('cth_pal_cache') || '{}')); } catch {}
}
function savePalCache() {
  try { localStorage.setItem('cth_pal_cache', JSON.stringify(palCache)); } catch {}
}
// 이미지에서 대표색 뽑기 (흰/검 제외, 비슷한 색 병합)
function extractColors(url) {
  if (palCache[url]) return Promise.resolve(palCache[url]);
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onerror = reject;
    im.onload = () => {
      try {
        const n = 56, c = document.createElement('canvas');
        c.width = n; c.height = n;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(im, 0, 0, n, n);
        const d = g.getImageData(0, 0, n, n).data;
        const buckets = new Map();
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 200) continue;
          const r = d[i], gg = d[i + 1], b = d[i + 2];
          const [h, sa, l] = rgb2hsl(r, gg, b);
          if (l > 0.93 || l < 0.07) continue;
          const key = Math.round(h / 14) + '|' + Math.round(sa * 5) + '|' + Math.round(l * 6);
          const o = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
          o.n++; o.r += r; o.g += gg; o.b += b; buckets.set(key, o);
        }
        const list = [...buckets.values()].map((o) => {
          const r = o.r / o.n, g2 = o.g / o.n, b = o.b / o.n, [h, sa, l] = rgb2hsl(r, g2, b);
          return { n: o.n, h, s: sa, l, hex: toHex(r, g2, b) };
        }).sort((a, b) => b.n - a.n);
        const out = [];
        for (const c2 of list) {
          if (out.some((o) => Math.abs(o.h - c2.h) < 22 && Math.abs(o.l - c2.l) < 0.18)) continue;
          out.push(c2);
          if (out.length >= 6) break;
        }
        palCache[url] = out; savePalCache();
        resolve(out);
      } catch (e) { reject(e); }
    };
    im.src = url;
  });
}
function rankColors(cols) {
  return cols.map((c) => ({ c, w: (c.s * 1.6 + 0.25) * Math.sqrt(c.n) * ((c.l > 0.2 && c.l < 0.85) ? 1 : 0.5) }))
    .sort((a, b) => b.w - a.w).map((x) => x.c);
}
// 대표색 → UI 팔레트 (다크는 배경까지 캐릭터 색으로 물들인다)
function buildCharPalette(cols, mode, fallbackHex, forceHex) {
  let a1, a2;
  if (cols && cols.length) {
    let ranked = rankColors(cols);
    if (forceHex) {                                   // 사용자가 고른 기준색을 맨 앞으로
      const i = ranked.findIndex((c) => c.hex === forceHex);
      if (i > 0) ranked = [ranked[i]].concat(ranked.slice(0, i), ranked.slice(i + 1));
    }
    a1 = ranked[0];
    a2 = ranked.find((c) => Math.abs(c.h - a1.h) > 28) || ranked[1] || a1;
  } else {
    const [h, sa, l] = hexToHsl(fallbackHex);
    a1 = { h, s: sa, l }; a2 = { h: (h + 40) % 360, s: sa, l };
  }
  const h = a1.h, h2 = a2.h;
  const sat = Math.max(28, Math.min(70, a1.s * 100));
  const v = {};
  if (mode === 'pastel') {
    v['--bg'] = hsl(h, Math.min(72, sat + 18), 95);
    v['--panel'] = hsl(h, 60, 99);
    v['--head'] = hsl(h, Math.min(78, sat + 22), 89);
    v['--border'] = hsl(h, Math.min(58, sat + 6), 79);
    v['--text'] = hsl(h, 38, 16);
    v['--muted'] = hsl(h, 20, 42);
    v['--accent'] = hsl(h, Math.max(48, sat + 8), Math.min(48, Math.max(36, a1.l * 100)));
    v['--active'] = v['--accent'];
    v['--ok'] = hsl(150, 45, 34);
    v['--danger'] = hsl(2, 62, 46);
    v['--sb-thumb'] = hsl(h, 35, 76);
    v['--term-bg'] = hsl(h, 34, 11);
    v['--term-fg'] = hsl(h, 30, 92);
    v['--accent2'] = hsl(h2, Math.max(42, a2.s * 100), 44);
    v['--on-accent'] = '#ffffff';
  } else {
    // 캐릭터 색이 배경에서 실제로 보여야 한다 — 채도/명도 하한을 올려
    // "결국 그냥 새까만 화면"이 되지 않게 한다(무채색 캐릭터도 색감이 남도록).
    const bs = Math.max(38, Math.min(70, sat * 1.1));
    v['--bg'] = hsl(h, bs, 13);
    v['--panel'] = hsl(h, bs * 0.95, 17);
    v['--head'] = hsl(h, bs, 21);
    v['--border'] = hsl(h, bs * 0.9, 34);
    v['--text'] = hsl(h, 30, 94);
    v['--muted'] = hsl(h, 17, 64);
    const accL = Math.min(76, Math.max(60, a1.l * 100));
    v['--accent'] = hsl(h, Math.max(62, sat + 16), accL);
    v['--active'] = v['--accent'];
    v['--ok'] = hsl(150, 52, 64);
    v['--danger'] = hsl(2, 78, 66);
    v['--sb-thumb'] = hsl(h, bs, 34);
    v['--term-bg'] = hsl(h, bs * 0.8, 9);
    v['--term-fg'] = hsl(h, 26, 91);
    v['--accent2'] = hsl(h2, Math.max(52, a2.s * 100), Math.min(80, Math.max(64, a2.l * 100)));
    v['--on-accent'] = accL > 62 ? hsl(h, 60, 12) : '#ffffff';
  }
  return v;
}
// UI 팔레트 → xterm ANSI 16색 (배경/전경/파랑·시안만 캐릭터 색으로, 나머지는 가독성 좋은 기본값)
function ansiFromVars(v, mode) {
  const base = mode === 'pastel' ? TERM_THEMES.tokyonight : TERM_THEMES.tokyonight;
  return Object.assign({}, base, {
    background: v['--term-bg'], foreground: v['--term-fg'],
    blue: v['--accent'], brightBlue: v['--accent'],
    cyan: v['--accent2'], brightCyan: v['--accent2'],
  });
}

const CHAR_VARS = ['--bg', '--panel', '--head', '--border', '--text', '--muted', '--accent', '--active',
  '--ok', '--danger', '--sb-thumb', '--term-bg', '--term-fg', '--accent2', '--on-accent', '--cth-av', '--cth-full'];
function clearCharVars() { CHAR_VARS.forEach((k) => document.body.style.removeProperty(k)); }

function themeMode() { return localStorage.getItem('cth_theme_mode') === 'pastel' ? 'pastel' : 'dark'; }
function themeLevel() { const n = parseInt(localStorage.getItem('cth_theme_level'), 10); return (n >= 1 && n <= 3) ? n : 2; }

async function applyCharTheme(key) {
  const t = CHAR_MAP()[key];
  if (!t) return;
  const { icon, full } = charAssets(key);
  const mode = themeMode(), lv = themeLevel();
  let cols = null;
  if (full) { try { cols = await extractColors(full); } catch {} }
  const v = buildCharPalette(cols, mode, t.fallback, localStorage.getItem('cth_pick_' + key) || null);
  const b = document.body;
  b.dataset.theme = 'char';
  b.dataset.char = key;
  b.classList.add('cth-char');
  b.classList.remove('lv1', 'lv2', 'lv3');
  b.classList.add('lv' + lv);
  Object.entries(v).forEach(([k, val]) => b.style.setProperty(k, val));
  b.style.setProperty('--cth-av', icon ? `url("${icon}")` : 'none');
  b.style.setProperty('--cth-full', full ? `url("${full}")` : 'none');
  if (lv >= 2 && t.ui) applyUiFont(`'${t.ui}',${DEFAULT_UI_FONT}`, false);
  else applyUiFont(localStorage.getItem('cth_ui_font') || DEFAULT_UI_FONT, false);
  activeTermTheme = ansiFromVars(v, mode);
  const termTheme = currentTermTheme();
  columns.forEach((c) => c.panes.forEach((p) => { if (p.term) { try { p.term.options.theme = termTheme; } catch {} } }));
  updateComposePlaceholders(t);
  renderCharColors(key, cols);
  applyCursors();
  setTimeout(() => { try { fitAll(); } catch {} }, 60);
}
// 이미지에서 뽑은 색들 — 누르면 그 색을 기준으로 팔레트를 다시 만든다.
function renderCharColors(key, cols) {
  const box = document.getElementById('charColors');
  const sep = document.getElementById('charColorSep');
  if (!box) return;
  const ranked = (cols && cols.length) ? rankColors(cols).slice(0, 6) : [];
  const show = ranked.length > 1;
  box.style.display = show ? 'flex' : 'none';
  if (sep) sep.style.display = show ? 'block' : 'none';
  if (!show) { box.innerHTML = ''; return; }
  const picked = localStorage.getItem('cth_pick_' + key) || ranked[0].hex;
  box.innerHTML = ranked.map((c) => `<button data-hex="${c.hex}" title="${c.hex}" style="background:${c.hex}" class="${c.hex === picked ? 'on' : ''}"></button>`).join('');
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    localStorage.setItem('cth_pick_' + key, b.dataset.hex);
    applyCharTheme(key);
  }));
}

function updateComposePlaceholders(t) {
  const ph = (t && themeLevel() === 3 && t.ph) ? t.ph : '메시지 입력…   Enter 전송 · Shift+Enter 줄바꿈';
  document.querySelectorAll('.compose textarea').forEach((ta) => { ta.placeholder = ph; });
}

function applyTheme(t) {
  const isChar = !!CHAR_MAP()[t];
  localStorage.setItem('cth_theme', t);
  document.querySelectorAll('#themePopover .popover-item').forEach((el) => el.classList.toggle('active', el.dataset.theme === t));
  const charOn = ['charOptsSep', 'themeModeRow', 'themeLevelRow', 'assetDrop', 'charColorSep', 'charColors'];
  charOn.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!isChar) { el.style.display = 'none'; return; }
    if (id === 'charColorSep' || id === 'charColors') return;   // 색 칩은 팔레트 계산 후 renderCharColors 가 정한다
    el.style.display = (id === 'charOptsSep' ? 'block' : (id === 'assetDrop' ? 'block' : 'flex'));
  });
  if (isChar) { applyCharTheme(t); return; }
  if (!TERM_THEMES[t]) t = 'dark';
  activeTermTheme = null;
  clearCharVars();
  document.body.classList.remove('cth-char', 'lv1', 'lv2', 'lv3');
  document.body.removeAttribute('data-char');
  document.body.dataset.theme = t;
  applyUiFont(localStorage.getItem('cth_ui_font') || DEFAULT_UI_FONT, false);
  updateComposePlaceholders(null);
  const termTheme = currentTermTheme();
  columns.forEach((c) => c.panes.forEach((p) => { if (p.term) { try { p.term.options.theme = termTheme; } catch {} } }));
  applyCursors();
  setTimeout(() => { try { fitAll(); } catch {} }, 60);
}

// 게임풍 커서: 뾰족한 각진 화살표를 테마 강조색으로 칠해 body 및 클릭요소에 동적 주입.
// (CSS 정적 data-URI 는 CSS 변수를 못 읽으므로 테마색을 따라가려면 JS 로 생성해야 한다)
function lightenHex(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return hex || '#4c8bf5';
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.round(r + (255 - r) * amt); g = Math.round(g + (255 - g) * amt); b = Math.round(b + (255 - b) * amt);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
function cursorUri(fill, glow) {
  const enc = (c) => String(c).replace('#', '%23');
  const D = "M4 2 L4 21 L9.2 16.3 L12.4 22.6 L15.4 21.2 L12.2 15 L19 15 Z";
  const shadow = `<path d='${D}' fill='%2300000055' transform='translate(0.8 1)'/>`;
  const main = `<path d='${D}' fill='${enc(fill)}' stroke='%23ffffff' stroke-width='${glow ? 1.7 : 1.3}' stroke-linejoin='round'/>`;
  return `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24'>${shadow}${main}</svg>") 4 2`;
}
/* ---------- 커서: 캐릭터 이미지 / 내 이미지 / 기본 화살표 ---------- */
const CURSOR = {
  get src() { return localStorage.getItem('cth_cursor_src') || 'theme'; },
  get size() { const n = parseInt(localStorage.getItem('cth_cursor_size'), 10); return (n >= 16 && n <= 64) ? n : 32; },
  get fit() { return localStorage.getItem('cth_cursor_fit') === 'head' ? 'head' : 'contain'; },
  get hot() { return localStorage.getItem('cth_cursor_hotspot') === 'center' ? 'center' : 'tl'; },
  get tip() { return localStorage.getItem('cth_cursor_tip') !== '0'; },
  get scope() { return localStorage.getItem('cth_cursor_scope') === 'pointer' ? 'pointer' : 'both'; },
  get customFile() { return localStorage.getItem('cth_cursor_custom_file') || null; },
};
const POINTER_SEL = 'a,button,summary,select,[role="button"],.tab,.ic,.chip,.recent-item,.sesitem,.fsitem,'
  + '.popover-item,.lnb-alltoggle,.disc-banner button,.placement label,.rcont';
function cursorStyleEl() {
  let st = document.getElementById('cthCursorStyle');
  if (!st) { st = document.createElement('style'); st.id = 'cthCursorStyle'; document.head.appendChild(st); }
  return st;
}
function cursorImageSource() {
  if (CURSOR.src === 'arrow') return null;
  if (CURSOR.src === 'custom') return CURSOR.customFile ? '/theme-assets/' + encodeURIComponent(CURSOR.customFile) : null;
  const key = document.body.dataset.char;
  if (!key) return null;
  return charAssets(key).icon;
}
// 원본 이미지를 커서 크기로 축소 + (옵션) 좌상단 화살표 촉 합성
function buildImageCursor(url, accent) {
  return new Promise((resolve, reject) => {
    const s = CURSOR.size;
    const im = new Image();
    im.onerror = reject;
    im.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = s; c.height = s;
        const g = c.getContext('2d');
        if (CURSOR.fit === 'head') {
          const side = Math.min(im.width, im.height * 0.6);
          g.drawImage(im, (im.width - side) / 2, im.height * 0.02, side, side, 0, 0, s, s);
        } else {
          const r = Math.min(s / im.width, s / im.height);
          g.drawImage(im, (s - im.width * r) / 2, (s - im.height * r) / 2, im.width * r, im.height * r);
        }
        if (CURSOR.tip) {
          const t = Math.round(s * 0.42);
          const tip = new Image();
          tip.onload = () => {
            g.drawImage(tip, 0, 0, t, t);
            resolve(c.toDataURL('image/png'));
          };
          tip.onerror = () => resolve(c.toDataURL('image/png'));
          tip.src = cursorUri(accent, false).replace(/^url\("|"\) \d+ \d+$/g, '');
        } else resolve(c.toDataURL('image/png'));
      } catch (e) { reject(e); }
    };
    im.src = url;
  });
}
async function applyCursors() {
  const accent = (getComputedStyle(document.body).getPropertyValue('--accent') || '').trim() || '#4c8bf5';
  const st = cursorStyleEl();
  const url = cursorImageSource();
  if (!url) {
    const arrow = cursorUri(accent, false);
    const point = cursorUri(lightenHex(accent, 0.4), true);
    st.textContent = `body{cursor:${arrow},auto}\n${POINTER_SEL}{cursor:${point},pointer}`;
    updateCursorPreview(null);
    return;
  }
  try {
    const data = await buildImageCursor(url, accent);
    const s = CURSOR.size;
    const hot = CURSOR.hot === 'center' ? [Math.round(s / 2), Math.round(s / 2)] : [1, 1];
    const cur = `url("${data}") ${hot[0]} ${hot[1]}`;
    const arrow = cursorUri(accent, false);
    st.textContent = (CURSOR.scope === 'both' ? `body{cursor:${cur},auto}\n` : `body{cursor:${arrow},auto}\n`)
      + `${POINTER_SEL}{cursor:${cur},pointer}`;
    updateCursorPreview(data, s, hot);
  } catch {
    const arrow = cursorUri(accent, false);
    st.textContent = `body{cursor:${arrow},auto}`;
    updateCursorPreview(null);
  }
}
function updateCursorPreview(data, s, hot) {
  const img = document.getElementById('curPreview');
  const info = document.getElementById('curInfo');
  if (img) img.src = data || cursorUri('#888', false).replace(/^url\("|"\) \d+ \d+$/g, '');
  if (info) info.textContent = data ? `${s}×${s} · 핫스팟 (${hot[0]}, ${hot[1]})` : '기본 화살표';
}

const ACCENTS = { blue: '#4c8bf5', purple: '#bd93f9', green: '#3fb950', red: '#e5484d', orange: '#f0a020', pink: '#ff79c6', cyan: '#22d3ee' };
const ACCENT_LABELS = { blue: '파랑', purple: '보라', green: '초록', red: '빨강', orange: '주황', pink: '핑크', cyan: '시안' };
function applyAccent(key) {
  if (!ACCENTS[key]) key = null;
  if (key) {
    document.body.style.setProperty('--active', ACCENTS[key]);
    document.body.style.setProperty('--accent', ACCENTS[key]);
    localStorage.setItem('cth_accent', key);
  } else {
    document.body.style.removeProperty('--active');
    document.body.style.removeProperty('--accent');
    localStorage.removeItem('cth_accent');
  }
  document.querySelectorAll('#accentPopover .popover-item').forEach((b) => b.classList.toggle('active', b.dataset.accent === key));
  applyCursors();
}
function buildAccentPicker() {
  const el = document.getElementById('accentPopover');
  if (!el) return;
  const items = Object.entries(ACCENTS).map(([k, hex]) => `<div class="popover-item" data-accent="${k}"><span class="swatch" style="background:${hex}"></span>${ACCENT_LABELS[k]}</div>`).join('');
  el.innerHTML = `<div class="popover-item" data-accent="">테마 기본값</div>${items}`;
  el.querySelectorAll('.popover-item').forEach((b) => b.addEventListener('click', () => { applyAccent(b.dataset.accent); closePopovers(); }));
}

function updateStatus() {
  const n = columns.reduce((a, c) => a + c.panes.length, 0);
  statusEl.textContent = `세션 ${n}`;
  emptyMsg.style.display = n === 0 ? 'flex' : 'none';
  renderTabs();
}

function fitAll() { columns.forEach((c) => c.panes.forEach((p) => p.fit())); }
function findColumnOf(pane) { return columns.find((c) => c.panes.includes(pane)) || null; }

/* ---------- 세션 최소화 / 복원 ---------- */
// 최소화: 레이아웃에서 빼서 숨김 보관소로 이동. term/ws 를 그대로 두므로 claude 는 백그라운드에서 계속 실행.
function minimizePane(paneObj) {
  if (!paneObj || paneObj.minimized) return;
  const c = findColumnOf(paneObj);
  if (c) {
    const ci = c.panes.indexOf(paneObj);
    if (ci >= 0) c.panes.splice(ci, 1);
    if (c.panes.length === 0) { const idx = columns.indexOf(c); if (idx >= 0) columns.splice(idx, 1); c.el.remove(); }
  }
  paneObj.minimized = true;
  minStash.appendChild(paneObj.el); // DOM 유지 → term/ws 살아있음
  minimized.push(paneObj);
  if (activePane === paneObj) setActive(columns[0] ? columns[0].panes[0] : null);
  rebuildAll(); renderTray(); updateStatus();
}
// 복원: 활성 컬럼(없으면 새 컬럼)으로 되돌리고 크기 재조정.
function restorePane(paneObj) {
  const mi = minimized.indexOf(paneObj);
  if (mi < 0) return;
  minimized.splice(mi, 1);
  paneObj.minimized = false;
  emptyMsg.style.display = 'none';
  const col = (activePane && findColumnOf(activePane)) || newColumn();
  col.panes.push(paneObj);
  col.el.appendChild(paneObj.el);
  rebuildAll(); renderTray(); updateStatus();
  setActive(paneObj);
  requestAnimationFrame(() => paneObj.fit());
}
function renderTray() {
  const tray = document.getElementById('minTray');
  if (!tray) return;
  if (minimized.length === 0) { tray.style.display = 'none'; tray.innerHTML = ''; return; }
  tray.style.display = 'flex';
  tray.innerHTML = '<span class="min-tray-label">최소화됨</span>';
  minimized.forEach((p) => {
    const done = p.el.classList.contains('done');
    const chip = document.createElement('span');
    chip.className = 'min-chip' + (done ? ' done' : '');
    chip.title = '클릭하면 다시 꺼냅니다';
    const t = (p.cfg && p.cfg.title) || 'claude';
    chip.innerHTML = `<span class="cd"></span><span class="mt"></span><button class="mx" title="세션 종료">${ICON.x}</button>`;
    chip.querySelector('.mt').textContent = t;
    chip.addEventListener('click', () => restorePane(p));
    chip.querySelector('.mx').addEventListener('click', (e) => { e.stopPropagation(); p.dispose(); });
    tray.appendChild(chip);
  });
}

/* ---------- 세션 뷰어 (대화·서브에이전트 카드 뷰) ---------- */
function renderViewer(body, items) {
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
  const html = (items || []).map((it) => {
    if (it.role === 'tool_result') {
      return `<div class="vcard result"><div class="vcc">${escapeHtml(it.text)}</div></div>`;
    }
    if (it.role === 'user') {
      return `<div class="vmsg"><div class="vwho user">나</div><div class="vbub user">${escapeHtml(it.text)}</div></div>`;
    }
    const tools = (it.tools || []).map((t) => {
      const ic = t.isTask ? ICON.task : ICON.tool;
      const pv = t.preview ? ` · <span class="vp">${escapeHtml(t.preview)}</span>` : '';
      return `<div class="vcard${t.isTask ? ' task' : ''}"><div class="vch">${ic}<span>${escapeHtml(t.name)}</span>${pv}</div></div>`;
    }).join('');
    const txt = it.text ? `<div class="vmsg"><div class="vwho ai">AI</div><div class="vbub">${escapeHtml(it.text)}</div></div>` : '';
    return txt + tools;
  }).join('');
  body.innerHTML = html || '<div class="vempty">아직 메시지가 없습니다.</div>';
  if (atBottom) body.scrollTop = body.scrollHeight;
}
function addViewerPane(src) {
  if (!src || !src.cfg || !src.cfg.key) return;
  const key = src.cfg.key;
  if (viewerByKey.has(key)) { setActive(viewerByKey.get(key)); return; }
  emptyMsg.style.display = 'none';
  const col = newColumn();
  const pane = document.createElement('div');
  pane.className = 'pane viewer';
  pane.innerHTML = `
    <div class="bar">
      <span class="dot"></span>
      <span class="label"><span class="ttl">${ICON.eye}<span>세션 뷰어</span></span><span class="cwd">${escapeHtml(src.cfg.title || '')}</span></span>
      <button class="vrefresh" title="새로고침">${ICON.refresh}</button>
      <button class="x" title="뷰어 닫기">${ICON.x}</button>
    </div>
    <div class="vbody"><div class="vempty">불러오는 중…</div></div>`;
  col.el.appendChild(pane);
  const body = pane.querySelector('.vbody');
  let disposed = false, timer = null;
  const refresh = async () => {
    try {
      const r = await fetch(`/api/transcript?key=${encodeURIComponent(key)}`).then((x) => x.json());
      if (disposed) return;
      if (!r.ready) { if (!body.querySelector('.vmsg')) body.innerHTML = '<div class="vempty">첫 메시지 이후 표시됩니다…</div>'; return; }
      renderViewer(body, r.items);
    } catch {}
  };
  const paneObj = {
    el: pane, cfg: { title: '세션 뷰어', viewer: true, watchKey: key }, term: null,
    fit() {},
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      viewerByKey.delete(key);
      const c = findColumnOf(paneObj);
      if (c) {
        const ci = c.panes.indexOf(paneObj);
        if (ci >= 0) c.panes.splice(ci, 1);
        if (c.panes.length === 0) { const idx = columns.indexOf(c); if (idx >= 0) columns.splice(idx, 1); c.el.remove(); }
      }
      pane.remove(); rebuildAll();
      if (activePane === paneObj) setActive(columns[0] ? columns[0].panes[0] : null);
      updateStatus();
    },
  };
  col.panes.push(paneObj);
  viewerByKey.set(key, paneObj);
  pane.querySelector('.x').addEventListener('click', (e) => { e.stopPropagation(); paneObj.dispose(); });
  pane.querySelector('.vrefresh').addEventListener('click', (e) => { e.stopPropagation(); refresh(); });
  pane.addEventListener('mousedown', () => setActive(paneObj));
  try { enablePaneDrag(paneObj, pane.querySelector('.bar')); } catch {}
  rebuildAll(); setActive(paneObj); updateStatus();
  refresh();
  timer = setInterval(refresh, 2000);
}

// 모델 순서 기준으로 DOM 순서를 맞추고 split.js 를 재생성한다.
function rebuildAll() {
  columns.forEach((c) => { if (c.split) { try { c.split.destroy(); } catch {} c.split = null; } });
  if (columnSplit) { try { columnSplit.destroy(); } catch {} columnSplit = null; }
  columns.forEach((col) => {
    stage.appendChild(col.el);
    col.panes.forEach((p) => col.el.appendChild(p.el));
  });
  if (columns.length >= 2) {
    columnSplit = Split(columns.map((c) => c.el), {
      direction: 'horizontal', gutterSize: 3, minSize: 220, snapOffset: 0, onDrag: fitAll,
      onDragEnd: () => { fitAll(); saveLayoutDebounced(); },
    });
  } else if (columns.length === 1) {
    columns[0].el.style.width = '100%';
  }
  columns.forEach((col) => {
    if (col.panes.length >= 2) {
      col.split = Split(col.panes.map((p) => p.el), {
        direction: 'vertical', gutterSize: 3, minSize: 120, snapOffset: 0, onDrag: fitAll,
        onDragEnd: () => { fitAll(); saveLayoutDebounced(); },
      });
    } else if (col.panes.length === 1) {
      col.panes[0].el.style.height = '100%';
    }
  });
  requestAnimationFrame(() => { fitAll(); requestAnimationFrame(fitAll); });
  saveLayoutDebounced();
}

/* ---------- 창 레이아웃(열린 패널) 저장·복원 — 앱 재시작 시 마지막 화면 그대로 ---------- */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
function paneSnapshot(p) {
  const cfg = (p && p.cfg) || {};
  if (cfg.viewer) return cfg.watchKey ? { type: 'viewer', watchKey: cfg.watchKey } : null;
  if (cfg.preview) return cfg.url ? { type: 'preview', url: cfg.url } : null;
  if (cfg.key && cfg.cwd) {
    return {
      type: 'term', key: cfg.key, cwd: cfg.cwd, profile: cfg.profile,
      resumeId: cfg.resumeId || null, command: cfg.command || null, runClaude: !!cfg.runClaude,
      title: cfg.title || null,
    };
  }
  return null;
}
function collectWorkspaceSnapshot(cols) {
  return (cols || [])
    .map((col) => {
      let sizes = null;
      try { if (col.split) sizes = col.split.getSizes(); } catch { /* ignore */ }
      return { sizes, panes: col.panes.map(paneSnapshot).filter(Boolean) };
    })
    .filter((c) => c.panes.length);
}
function saveLayout() {
  try {
    const all = { ...profileWorkspaces, [activeProfileId]: { columns } };
    const out = {};
    for (const pid of Object.keys(all)) {
      const snap = collectWorkspaceSnapshot(all[pid].columns);
      if (snap.length) out[pid] = { columns: snap, columnSizes: (pid === activeProfileId && columnSplit) ? columnSplit.getSizes() : null };
    }
    // 최소화된 패널(트레이)은 프로필 소속과 무관하게 하나의 전역 목록 — 별도 키로 저장
    out.__minimized = minimized.map(paneSnapshot).filter((s) => s && s.type === 'term');
    localStorage.setItem('cth_layout', JSON.stringify(out));
  } catch { /* ignore */ }
}
const saveLayoutDebounced = debounce(saveLayout, 400);

const layoutRestoreAttempted = new Set();
// 저장된 레이아웃을 현재(활성) columns 로 복원. 뷰어 패널은 대상 터미널 패널을 먼저 만든 뒤 마지막에 연결.
function restoreLayoutForProfile(pid) {
  layoutRestoreAttempted.add(pid);
  let saved;
  try { saved = JSON.parse(localStorage.getItem('cth_layout') || '{}')[pid]; } catch { saved = null; }
  if (!saved || !Array.isArray(saved.columns) || !saved.columns.length) return;

  const keyToPane = new Map();
  const pendingViewers = [];
  const colSizesList = [];
  for (const colSnap of saved.columns) {
    let first = true;
    for (const ps of colSnap.panes) {
      if (ps.type === 'term') {
        addPane({
          key: ps.key, cwd: ps.cwd, profile: ps.profile, resumeId: ps.resumeId || undefined,
          command: ps.command || undefined, runClaude: !!ps.runClaude, title: ps.title || undefined,
        }, first ? 'newcol' : 'row');
        const col = columns[columns.length - 1];
        keyToPane.set(ps.key, col.panes[col.panes.length - 1]);
        first = false;
      } else if (ps.type === 'preview') {
        const fm = ps.url.match(/^\/api\/file\?path=(.+)$/);
        const label = fm ? (decodeURIComponent(fm[1]).split(/[\\/]/).filter(Boolean).pop() || null) : null;
        addPreviewPane(ps.url, first ? 'newcol' : 'row', label);
        first = false;
      } else if (ps.type === 'viewer') {
        pendingViewers.push(ps); // 뷰어는 항상 새 컬럼으로 열리므로 마지막에 처리
      }
    }
    if (!first) colSizesList.push(colSnap.sizes); // 실제로 패널이 만들어진 컬럼만 사이즈 기록
  }
  for (const ps of pendingViewers) {
    const src = keyToPane.get(ps.watchKey);
    if (src) addViewerPane(src);
  }
  requestAnimationFrame(() => {
    try { if (saved.columnSizes && columnSplit) columnSplit.setSizes(saved.columnSizes); } catch { /* ignore */ }
    columns.forEach((col, i) => {
      const sizes = colSizesList[i];
      try { if (sizes && col.split) col.split.setSizes(sizes); } catch { /* ignore */ }
    });
  });
}

let minimizedRestored = false;
// 최소화(트레이) 상태였던 패널 복원 — 프로필 무관 전역 목록이라 앱 시작 시 한 번만 실행.
function restoreMinimized() {
  if (minimizedRestored) return;
  minimizedRestored = true;
  let list;
  try { list = JSON.parse(localStorage.getItem('cth_layout') || '{}').__minimized; } catch { list = null; }
  if (!Array.isArray(list) || !list.length) return;
  for (const ps of list) {
    if (ps.type !== 'term') continue;
    addPane({
      key: ps.key, cwd: ps.cwd, profile: ps.profile, resumeId: ps.resumeId || undefined,
      command: ps.command || undefined, runClaude: !!ps.runClaude, title: ps.title || undefined,
    }, 'newcol');
    const col = columns[columns.length - 1];
    const paneObj = col.panes[col.panes.length - 1];
    minimizePane(paneObj);
  }
}

function newColumn(atIndex) {
  const el = document.createElement('div');
  el.className = 'column';
  const col = { el, panes: [], split: null };
  if (typeof atIndex === 'number') columns.splice(atIndex, 0, col);
  else columns.push(col);
  stage.appendChild(el);
  return col;
}

// focusTerm=false 로 부르면 활성 표시만 하고 키보드 포커스는 건드리지 않는다.
// (컴포즈 입력창을 눌렀는데 터미널이 포커스를 도로 가져가면 타이핑이 셸로 들어간다)
function setActive(pane, focusTerm) {
  if (activePane && activePane.el) activePane.el.classList.remove('active');
  activePane = pane;
  if (pane && pane.el) {
    pane.el.classList.add('active');
    pane.el.classList.remove('done');
    if (focusTerm !== false && pane.term) { try { pane.term.focus(); } catch {} }
  }
}

// 새 패널이 들어갈 컬럼 결정: 'row'면 현재 활성 패널의 컬럼에, 아니면 컬럼이 잘게 늘어나지 않도록
// 마지막 컬럼에 아직 자리(2행 미만)가 있으면 거기 채우고, 꽉 찼을 때만 새 컬럼을 연다.
const PANES_PER_COLUMN = 2;
function pickColumnForPlacement(placement) {
  if (placement === 'row' && activePane && findColumnOf(activePane)) return findColumnOf(activePane);
  if (placement === 'newcol') return newColumn(); // 저장된 레이아웃 복원 시 컬럼 경계를 그대로 재현하기 위한 강제 새 컬럼
  const last = columns[columns.length - 1];
  if (last && last.panes.length < PANES_PER_COLUMN) return last;
  return newColumn();
}

/* ---------- 패널(세션) 생성 ---------- */
function addPane(cfg, placement) {
  emptyMsg.style.display = 'none';
  if (!cfg.profile) cfg.profile = activeProfileId; // 현재 계정 프로필에 소속
  if (!cfg.key) cfg.key = 'k_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); // 재부착용 안정 키

  const col = pickColumnForPlacement(placement);

  const pane = document.createElement('div');
  pane.className = 'pane';
  const shortCwd = cfg.cwd.split(/[\\/]/).filter(Boolean).pop() || cfg.cwd;
  const title = cfg.title || (cfg.resumeId ? '재개한 세션' : (cfg.command && cfg.command !== 'claude' ? cfg.command : 'claude 새 대화'));
  pane.innerHTML = `
    <div class="bar">
      <span class="dot"></span>
      <span class="label" title="${escapeHtml(cfg.cwd)}">
        <span class="ttl">${escapeHtml(title)}</span><span class="cwd">${ICON.folder}<span>${escapeHtml(shortCwd)}</span></span>
      </span>
      <button class="artifact" title="Claude 아티팩트 미리보기" style="display:none"></button>
      <button class="reload" title="새로고침 (세션 다시 불러오기)">${ICON.refresh}</button>
      <button class="split" title="아래로 분할">${ICON.split}</button>
      <button class="min" title="최소화 (숨김 — claude 는 계속 실행)">${ICON.minimize}</button>
      <button class="x" title="세션 종료">${ICON.x}</button>
    </div>
    <div class="term"></div>
    <div class="compose">
      <div class="chatlog"></div>
      <textarea rows="1" spellcheck="false" placeholder="메시지 입력…   Enter 전송 · Shift+Enter 줄바꿈"></textarea>
      <div class="crow">
        <button class="cbtn" data-act="esc" title="중단 (Esc)">Esc</button>
        <button class="cbtn" data-act="shifttab" title="모드 전환 (Shift+Tab)">모드</button>
        <button class="cbtn" data-act="clear" title="/clear 전송">/clear</button>
        <button class="cbtn" data-act="image" title="이미지 파일 경로 추가">이미지</button>
        <button class="cbtn chatonly-btn" data-act="chatonly" title="터미널 접고 대화만 보기 / 되돌리기">대화만</button>
        <span class="chint">터미널 단축키·붙여넣기는 그대로 사용 가능</span>
        <button class="cbtn send" data-act="send">보내기</button>
      </div>
    </div>`;
  col.el.appendChild(pane);

  const termEl = pane.querySelector('.term');
  termEl.style.position = 'relative';
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: termFontFamily,
    fontSize: termFontSize,
    theme: currentTermTheme(),
    scrollback: 8000,
    allowProposedApi: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(termEl);
  if (CanvasAddon) { try { term.loadAddon(new CanvasAddon()); } catch {} }
  // 작업 완료 알림: Claude 가 턴 완료 시 울리는 터미널 벨에서만 (세션별 1.5s 디바운스)
  // + 앱을 보고 있어도 어느 세션이 끝났는지 보이도록 패널에 완료 표시(활성 패널 제외)
  let lastBellAt = 0;
  try {
    term.onBell(() => {
      if (!pane.classList.contains('active')) pane.classList.add('done');
      if (pane.parentElement === minStash) renderTray(); // 최소화 상태면 트레이 칩에 완료 표시
      const now = Date.now(); if (now - lastBellAt < 1500) return; lastBellAt = now; notifyDone(cfg);
    });
  } catch {}

  // 복사/붙여넣기 + 제어키 처리
  const pasteFromClipboard = () => {
    navigator.clipboard.readText().then((t) => {
      if (t && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: t }));
    }).catch(() => {});
  };
  const copySelection = () => {
    const s = term.getSelection();
    if (s) navigator.clipboard.writeText(s).catch(() => {});
    return !!s;
  };
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      // 붙여넣기: Ctrl+V / Ctrl+Shift+V
      if (k === 'v') { e.preventDefault(); pasteFromClipboard(); return false; }
      // 복사: Ctrl+Shift+C 는 항상, Ctrl+C 는 선택영역이 있을 때만(없으면 인터럽트 \x03 전달)
      if (k === 'c') {
        if (e.shiftKey) { e.preventDefault(); copySelection(); return false; }
        if (copySelection()) { e.preventDefault(); return false; }
        return true;
      }
      // 나머지 제어키: 브라우저 기본동작만 막고 pty 로 전달
      if (!e.shiftKey && ['u', 'w', 'a', 'e', 'k', 'r', 'l', 'd'].includes(k)) { try { e.preventDefault(); } catch {} }
    }
    return true;
  });
  // 우클릭 붙여넣기
  termEl.addEventListener('contextmenu', (e) => { e.preventDefault(); pasteFromClipboard(); });

  let disposed = false;
  let reloading = false;
  let autoReload = false;
  let lastActivityAt = Date.now();
  let ws = null;
  let reconnectTries = 0;
  let reconnectTimer = null;
  let hbTimer = null;       // 하트비트 인터벌
  let missedPongs = 0;      // 연속 무응답 ping 횟수
  const RECONNECT_MAX = 6;
  const HB_INTERVAL = 10000;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';

  // 하트비트: 주기적으로 ping → 서버 pong 이 안 오면(좀비 소켓) 강제 재연결.
  // 브라우저 WebSocket 은 JS 에서 프로토콜 ping 을 못 보내므로 앱 레벨 ping/pong 으로 감지한다.
  function stopHeartbeat() { if (hbTimer) { clearInterval(hbTimer); hbTimer = null; } }
  function startHeartbeat() {
    stopHeartbeat();
    missedPongs = 0;
    hbTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (missedPongs >= 2) { forceReconnect('무응답'); return; } // ~20s 무응답 = 죽음
      missedPongs++;
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
    }, HB_INTERVAL);
  }

  // 강제 재연결: 좀비 소켓이어도 옛 소켓을 확실히 폐기하고 새 소켓으로 즉시 연결(백오프 무시).
  function forceReconnect(reason) {
    if (disposed) return;
    stopHeartbeat();
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectTries = 0;
    missedPongs = 0;
    try { if (ws) { ws.onclose = null; ws.onmessage = null; ws.onopen = null; ws.close(); } } catch {}
    ws = null;
    connect(true);
  }

  // 절전/잠금에서 깨어나거나 창에 복귀했을 때: 연결이 살아있으면 ping 으로 확인, 죽었으면 즉시 강제 재연결.
  function onWake() {
    if (disposed) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) forceReconnect('복귀');
    else { missedPongs = 0; try { ws.send(JSON.stringify({ type: 'ping' })); } catch {} }
  }
  function onVisible() { if (document.visibilityState === 'visible') onWake(); }

  // 세션 파일이 외부에서 커졌을 때 (새 메시지). 최근 내 입력이면 내 세션 자체 쓰기일 수 있어 무시.
  function onExternalChange() {
    if (Date.now() - lastActivityAt < 5000) return;
    if (autoReload) { reload(); return; }
    pane.classList.add('has-changes');
    // 알림은 여기서 보내지 않음 — 작업 완료(터미널 벨)에서만 notifyDone 발생
  }

  function showBanner(msg, btnLabel) {
    hideBanner();
    const b = document.createElement('div');
    b.className = 'disc-banner';
    b.innerHTML = `<span class="i">${ICON.warn}</span><span>${escapeHtml(msg)}</span>` + (btnLabel ? ` <button>${escapeHtml(btnLabel)}</button>` : '');
    const btn = b.querySelector('button');
    if (btn) btn.onclick = () => { hideBanner(); forceReconnect('수동'); };
    termEl.appendChild(b);
  }
  function hideBanner() { const b = termEl.querySelector('.disc-banner'); if (b) b.remove(); }

  // 끊김 시 자동 백오프 재연결 (서버가 다시 뜨면 자동 복구). 서버 pty 는 ws close 시 종료되므로 중복 세션 없음.
  function scheduleReconnect() {
    if (disposed || reconnectTimer) return;
    if (reconnectTries >= RECONNECT_MAX) {
      showBanner('연결 끊김 — 자동 재연결 실패(서버 꺼짐?). 수동으로 재시도하세요.', '재연결');
      return;
    }
    reconnectTries++;
    const delay = Math.min(8000, 1000 * Math.pow(2, Math.min(reconnectTries - 1, 3)));
    showBanner(`연결 끊김 — ${Math.round(delay / 1000)}초 후 재연결 시도 (${reconnectTries}/${RECONNECT_MAX})`, '지금 재시도');
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(true); }, delay);
  }

  function connect(isReconnect) {
    ws = new WebSocket(`${proto}://${location.host}/pty`);
    ws.binaryType = 'arraybuffer';
    paneObj.ws = ws;
    ws.onopen = () => {
      hideBanner();
      reconnectTries = 0;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      startHeartbeat();
      if (isReconnect) term.write('\r\n\x1b[90m[재연결됨]\x1b[0m\r\n');
      paneObj.fit();
      ws.send(JSON.stringify({
        type: 'init', key: cfg.key, cwd: cfg.cwd, runClaude: cfg.runClaude, command: cfg.command,
        resumeId: cfg.resumeId, profile: cfg.profile, cols: term.cols || 80, rows: term.rows || 24,
      }));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string' && ev.data.startsWith('{')) {
        try {
          const m = JSON.parse(ev.data);
          if (m.type === 'ready') {
            pane.classList.remove('exited'); pane.classList.add('running');
            // 재부착이면 곧 서버가 최근 출력 버퍼를 재생 → 중복 방지 위해 화면 비우고 받는다
            if (m.reattached) { try { term.reset(); } catch {} }
            // claude 등 TUI 기동 후 한 번 더 크기 동기화 (입력줄 정렬)
            setTimeout(() => paneObj.fit(), 800);
            return;
          }
          if (m.type === 'exit') {
            pane.classList.remove('running'); pane.classList.add('exited');
            term.write(`\r\n\x1b[90m[프로세스 종료됨 (code ${m.code})]\x1b[0m\r\n`); return;
          }
          if (m.type === 'error') { term.write(`\r\n\x1b[31m${m.message}\x1b[0m\r\n`); return; }
          if (m.type === 'pong') { missedPongs = 0; return; } // 하트비트 응답 → 살아있음
          if (m.type === 'changed') { onExternalChange(); return; }
          if (m.type === 'artifact') { onArtifact(m.path); return; }
        } catch { /* 실제 출력 → write */ }
      }
      term.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data));
    };
    ws.onclose = () => {
      pane.classList.remove('running');
      stopHeartbeat();
      if (reloading) { reloading = false; return; } // 새로고침으로 인한 의도된 종료
      if (!disposed) scheduleReconnect(); // 자동 백오프 재연결 (서버 복구 시 자동)
    };
  }

  // 깨어남/복귀 감지 (절전·잠금·백그라운드 → 복귀 시 자동 재연결). pane 당 1회 등록, dispose 시 해제.
  window.addEventListener('online', onWake);
  window.addEventListener('focus', onWake);
  document.addEventListener('visibilitychange', onVisible);

  // 세션 새로고침: 현재 프로세스를 끝내고 같은 세션을 다시 불러온다 (최신 메시지 반영)
  function reload() {
    reloading = true;
    pane.classList.remove('has-changes');
    lastActivityAt = Date.now();
    // 기존 pty 를 실제 종료하고, 새 key 로 재시작(단순 재부착이 아니라 --resume 재실행)
    try { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'kill' })); } catch {}
    try { if (ws) ws.close(); } catch {}
    cfg.key = 'k_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    reconnectTries = 0;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    term.reset();
    term.write('\r\n\x1b[90m[세션 새로고침 중…]\x1b[0m\r\n');
    connect(true);
  }

  const ro = new ResizeObserver(() => paneObj.fit());

  const paneObj = {
    el: pane, term, ws: null, cfg,
    fit() {
      if (!termEl.clientWidth || !termEl.clientHeight) return;
      try { fit.fit(); } catch {}
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    },
    connect,
    dispose() {
      disposed = true;
      stopHeartbeat();
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      try { window.removeEventListener('online', onWake); } catch {}
      try { window.removeEventListener('focus', onWake); } catch {}
      try { document.removeEventListener('visibilitychange', onVisible); } catch {}
      try { ro.disconnect(); } catch {}
      closeArtifactDropdown();
      // 서버 pty 를 실제로 종료(패널 닫기 = 세션 종료). ws close 만으로는 이제 pty 가 안 죽음.
      try { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'kill' })); } catch {}
      try { if (ws) ws.close(); } catch {}
      try { term.dispose(); } catch {}
      const mi = minimized.indexOf(paneObj); // 최소화 상태에서 종료하는 경우
      if (mi >= 0) minimized.splice(mi, 1);
      const c = findColumnOf(paneObj);
      if (c) {
        const ci = c.panes.indexOf(paneObj);
        if (ci >= 0) c.panes.splice(ci, 1);
        if (c.panes.length === 0) {
          const idx = columns.indexOf(c);
          if (idx >= 0) columns.splice(idx, 1);
          c.el.remove();
        }
      }
      pane.remove();
      rebuildAll();
      if (mi >= 0) renderTray();
      if (activePane === paneObj) setActive(columns[0] ? columns[0].panes[0] : null);
      updateStatus();
    },
  };
  col.panes.push(paneObj);

  term.onData((d) => {
    lastActivityAt = Date.now();
    pane.classList.remove('has-changes', 'done'); // 내가 입력 중 → 알림/완료표시 해제
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: d }));
    else { showBanner('연결이 끊겨 입력이 전달되지 않습니다 — 재연결 중…'); onWake(); }
  });
  termEl.addEventListener('mousedown', () => setActive(paneObj));
  if (term.textarea) term.textarea.addEventListener('focus', () => setActive(paneObj));

  // 컴포즈 입력창 (선택) — 터미널은 그대로 두고 GUI 식 입력을 추가로 제공.
  (function wireCompose() {
    const box = pane.querySelector('.compose');
    if (!box) return;
    const localMsgs = [];   // 컴포즈로 방금 보낸 메시지 (transcript 반영 전 임시 표시)
    box.addEventListener('mousedown', () => setActive(paneObj, false));
    const ta = box.querySelector('textarea');
    const sendToPty = (data) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
      else { showBanner('연결이 끊겨 전달되지 않습니다 — 재연결 중…'); onWake(); }
    };
    const autoGrow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; };
    const insertAtCursor = (t) => {
      const s = ta.selectionStart || 0, e = ta.selectionEnd || 0;
      ta.value = ta.value.slice(0, s) + t + ta.value.slice(e);
      ta.selectionStart = ta.selectionEnd = s + t.length; autoGrow(); ta.focus();
    };
    const submit = () => {
      const v = ta.value;
      sendToPty(v ? v + '\r' : '\r');
      // 로컬 에코: transcript 에 반영되기 전에도 방금 보낸 메시지가 바로 보이게 한다.
      if (v.trim()) { localMsgs.push({ role: 'user', text: v, ts: Date.now(), pending: true }); renderChat(); }
      ta.value = ''; autoGrow();
    };
    ta.addEventListener('focus', () => setActive(paneObj, false));
    ta.addEventListener('input', autoGrow);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    box.querySelectorAll('.cbtn').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const act = b.dataset.act;
      if (act === 'send') { submit(); ta.focus(); }
      else if (act === 'esc') { sendToPty('\x1b'); }
      else if (act === 'shifttab') { sendToPty('\x1b[Z'); }
      else if (act === 'clear') { sendToPty('/clear\r'); }
      else if (act === 'image') {
        if (window.claudeHub && window.claudeHub.pickFile) {
          try { const p = await window.claudeHub.pickFile(); if (p) insertAtCursor(p + ' '); } catch {}
        } else { insertAtCursor(''); ta.focus(); }
      } else if (act === 'chatonly') {
        if (chatMode() === 'off') applyChatMode('bubble');   // 대화가 꺼져 있으면 켜주고 접는다
        applyChatLayout(chatLayout() === 'chat' ? 'split' : 'chat');
      }
    }));

    // ---- 대화 로그 (세션 뷰어와 같은 /api/transcript 재사용 + 로컬 에코) ----
    const log = box.querySelector('.chatlog');
    let lastItems = [];       // 서버에서 읽은 transcript
    let transcriptReady = false;

    // transcript 에 아직 안 나타난 내 메시지만 뒤에 붙인다(반영되면 로컬 것은 버림).
    function mergedItems() {
      const items = lastItems.slice();
      const recent = new Set(items.filter((i) => i.role === 'user').map((i) => (i.text || '').trim()));
      const now = Date.now();
      for (let i = localMsgs.length - 1; i >= 0; i--) {
        const m = localMsgs[i];
        if (recent.has((m.text || '').trim()) || now - m.ts > 15 * 60 * 1000) localMsgs.splice(i, 1);
      }
      return items.concat(localMsgs);
    }
    const bubbleHtml = (items) => items.map((it) => {
      if (it.role === 'user') return `<div class="cbub me${it.pending ? ' pending' : ''}"><span class="ctx">${escapeHtml(it.text || '')}</span></div>`;
      if (it.role === 'tool_result') return '';
      const tools = (it.tools || []).map((t) => `<div class="ctool">● ${escapeHtml(t.name)}${t.preview ? ' · ' + escapeHtml(t.preview) : ''}</div>`).join('');
      const txt = it.text ? `<div class="cbub"><span class="cav"></span><span class="ctx">${escapeHtml(it.text)}</span></div>` : '';
      return txt + tools;
    }).join('');
    // 디스코드: 아바타 + 이름 + 시각, 같은 사람이 연속으로 말하면 헤더/아바타 생략
    const discordHtml = (items) => {
      let prevWho = null, prevTs = 0;
      const out = [];
      for (const it of items) {
        if (it.role === 'tool_result') {
          out.push(`<div class="dmsg"><div class="dav spacer"></div><div class="dbody"><div class="dresult">${escapeHtml((it.text || '').slice(0, 400))}</div></div></div>`);
          prevWho = null; continue;
        }
        const me = it.role === 'user';
        const who = me ? 'me' : 'ai';
        const ts = it.ts ? new Date(it.ts).getTime() : 0;
        const cont = who === prevWho && ts && prevTs && Math.abs(ts - prevTs) < 5 * 60 * 1000;
        const head = cont ? '' : `<div class="dhead"><b>${escapeHtml(me ? '나' : aiName())}</b><span>${fmtTime(it.ts)}</span></div>`;
        const av = cont ? '<div class="dav spacer"></div>' : (me ? '<div class="dav">나</div>' : '<div class="dav"></div>');
        const tools = (it.tools || []).map((t) => `<div class="dtool${t.isTask ? ' task' : ''}">● <b>${escapeHtml(t.name)}</b>${t.preview ? ' · ' + escapeHtml(t.preview) : ''}</div>`).join('');
        const txt = it.text ? `<div class="dtext">${escapeHtml(it.text)}</div>` : '';
        out.push(`<div class="dmsg ${who}${cont ? '' : ' first'}${it.pending ? ' pending' : ''}">${av}<div class="dbody">${head}${txt}${tools}</div></div>`);
        prevWho = who; prevTs = ts || Date.now();
      }
      return out.join('');
    };
    function renderChat() {
      if (!log) return;
      const mode = chatMode();
      if (mode === 'off') return;
      const all = mergedItems();
      const items = all.slice(document.body.classList.contains('chat-only') ? -60 : -14);
      log.className = 'chatlog' + (mode === 'discord' ? ' discord' : '');
      const html = items.length ? (mode === 'discord' ? discordHtml(items) : bubbleHtml(items))
        : `<div class="cempty">${transcriptReady ? '아직 주고받은 메시지가 없습니다.' : '이 세션의 대화 기록을 아직 못 찾았습니다.<br><b>여기서 메시지를 보내면 바로 표시됩니다.</b>'}</div>`;
      if (html !== log.dataset.html) {
        const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
        log.innerHTML = html; log.dataset.html = html;
        if (atBottom) log.scrollTop = log.scrollHeight;
      }
    }
    let logBusy = false;
    async function refreshLog() {
      if (!log) return;
      if (!document.body.contains(pane) && pane.parentElement !== minStash) { clearInterval(logTimer); return; }
      if (chatMode() === 'off' || !document.body.classList.contains('compose-on')) return;
      if (logBusy) { renderChat(); return; }
      logBusy = true;
      try {
        const r = await fetch(`/api/transcript?key=${encodeURIComponent(cfg.key)}`).then((x) => x.json());
        transcriptReady = !!r.ready;
        lastItems = r.ready ? (r.items || []) : [];
      } catch { /* 네트워크 실패 시 로컬 에코만 유지 */ } finally { logBusy = false; }
      renderChat();
    }
    const logTimer = setInterval(refreshLog, 3000);
    paneObj._refreshLog = refreshLog;
    refreshLog();
    updateComposePlaceholders(CHAR_MAP()[document.body.dataset.char] || null);
  })();

  pane.querySelector('.x').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (await uiConfirm('이 세션을 종료할까요?', '세션 종료')) paneObj.dispose();
  });
  pane.querySelector('.min').addEventListener('click', (e) => {
    e.stopPropagation();
    minimizePane(paneObj);
  });
  pane.querySelector('.split').addEventListener('click', (e) => {
    e.stopPropagation();
    setActive(paneObj);
    addPane({ cwd: cfg.cwd, runClaude: true, command: 'claude', title: 'claude 새 대화' }, 'row');
  });
  pane.querySelector('.reload').addEventListener('click', (e) => {
    e.stopPropagation();
    setActive(paneObj);
    reload();
  });
  const reloadBtn = pane.querySelector('.reload');

  // Claude 아티팩트(세션 중 만들거나 고친 파일) 감지 → 칩에 개수 표시, 클릭하면 전체 목록을 드롭다운으로
  const artifactBtn = pane.querySelector('.artifact');
  const artifactSeen = new Set(); // 배지 카운트용(서버가 최종 목록의 authoritative source)
  let artifactDropdown = null;
  function closeArtifactDropdown() {
    if (artifactDropdown) { artifactDropdown.remove(); artifactDropdown = null; }
    document.removeEventListener('mousedown', onDocMouseDownForArtifact, true);
  }
  function onDocMouseDownForArtifact(e) {
    if (artifactDropdown && !artifactDropdown.contains(e.target) && e.target !== artifactBtn) closeArtifactDropdown();
  }
  async function openArtifactDropdown() {
    if (artifactDropdown) { closeArtifactDropdown(); return; }
    const dd = document.createElement('div');
    dd.className = 'popover open artifact-dropdown';
    dd.innerHTML = '<div class="popover-item" style="cursor:default;color:var(--muted)">불러오는 중…</div>';
    artifactBtn.appendChild(dd);
    artifactDropdown = dd;
    setTimeout(() => document.addEventListener('mousedown', onDocMouseDownForArtifact, true), 0);
    const r = await fetch(`/api/artifacts?key=${encodeURIComponent(cfg.key)}`).then((x) => x.json()).catch(() => ({ files: [] }));
    if (artifactDropdown !== dd) return; // 그 사이 닫혔으면 무시
    const files = r.files || [];
    if (!files.length) { dd.innerHTML = '<div class="popover-item" style="cursor:default;color:var(--muted)">아직 만들거나 고친 파일이 없습니다.</div>'; return; }
    dd.innerHTML = '';
    files.forEach((f) => {
      const base = f.path.split(/[\\/]/).filter(Boolean).pop() || f.path;
      const item = document.createElement('div');
      item.className = 'popover-item';
      item.title = f.path;
      item.innerHTML = `${ICON.file}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(base)}</span><span style="margin-left:auto;color:var(--muted);font-size:10px">${escapeHtml(f.tool || '')}</span>`;
      item.addEventListener('click', () => { closeArtifactDropdown(); addFilePreview(f.path, 'column'); });
      dd.appendChild(item);
    });
  }
  artifactBtn.addEventListener('click', (e) => { e.stopPropagation(); openArtifactDropdown(); });
  function onArtifact(p) {
    artifactSeen.add(p);
    artifactBtn.innerHTML = `${ICON.eye}<span class="alabel">파일 ${artifactSeen.size}개</span>`;
    artifactBtn.title = '이 세션에서 만들거나 고친 파일 보기';
    artifactBtn.style.display = '';
  }

  enablePaneDrag(paneObj, pane.querySelector('.bar'));

  ro.observe(termEl);
  connect(false);
  rebuildAll();
  setActive(paneObj);
  updateStatus();
}

/* ---------- 웹 미리보기 패널 (iframe) ---------- */
function normalizeUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  // 이미 서버 파일 서빙 경로면 그대로 (재-normalize 시 이중 변환 방지)
  if (/^\/api\/file\?/.test(u)) return u;
  // 로컬 파일 경로 → 서버(/api/file)가 올바른 Content-Type 으로 서빙 → 브라우저·앱 모두 렌더.
  //  (iframe 은 http 문서에서 file:// 을 차단하므로 file:// 대신 서버 서빙 경로를 쓴다)
  //   - Windows 절대경로:  C:\...  또는 C:/...
  //   - UNC:               \\host\share
  //   - POSIX 절대경로:     /Users/... , /home/...
  //   - 홈 상대경로:        ~/...
  if (/^[a-zA-Z]:[\\/]/.test(u) || /^\\\\/.test(u) || /^~\//.test(u) || /^\//.test(u)) {
    return '/api/file?path=' + encodeURIComponent(u);
  }
  // file: 스킴도 서버 서빙으로 재라우팅
  const m = u.match(/^file:\/{2,}(.*)$/i);
  if (m) {
    let p = decodeURIComponent(m[1]);
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1); // /C:/... → C:/...
    return '/api/file?path=' + encodeURIComponent(p);
  }
  // 그 외 스킴(data:, about:, blob:, http(s): 등)은 그대로 둔다
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  // 스킴 없는 호스트: 로컬/IP/포트지정은 http, 그 외 공개 도메인은 https 기본
  const head = u.split('/')[0];
  const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?|\d{1,3}(\.\d{1,3}){3})(:\d+)?$/i.test(head) || /:\d+$/.test(head);
  return (isLocal ? 'http://' : 'https://') + u;
}

function addPreviewPane(url, placement, label) {
  const isFile = !!label; // 파일 미리보기: label(파일명) 지정, url 은 이미 완성된 /api/file 경로
  if (!isFile) url = normalizeUrl(url); // 빈 값이면 '' (빈 패널로 열림)
  emptyMsg.style.display = 'none';

  const col = pickColumnForPlacement(placement);

  const pane = document.createElement('div');
  pane.className = 'pane running';
  let host = label || '웹 미리보기'; if (!isFile && url) { try { host = new URL(url).host; } catch {} }
  pane.innerHTML = `
    <div class="bar">
      <span class="dot"></span>
      <span class="label" title="${escapeHtml(isFile ? label : url)}"><span class="ttl">${isFile ? ICON.file : ICON.globe}<span>${escapeHtml(host)}</span></span></span>
      <button class="reload" title="새로고침">${ICON.refresh}</button>
      <button class="ext" title="외부 브라우저로 열기">${ICON.external}</button>
      <button class="x" title="닫기">${ICON.x}</button>
    </div>
    <div class="preview">
      <div class="urlbar">
        <input type="text" spellcheck="false" placeholder="URL 또는 파일 경로 입력 후 Enter (예: localhost:3000, C:\\file.pdf, /Users/me/img.png)" value="${escapeHtml(url)}" />
        <button class="go">이동</button>
      </div>
      <iframe referrerpolicy="no-referrer"></iframe>
    </div>`;
  col.el.appendChild(pane);

  const iframe = pane.querySelector('iframe');
  const input = pane.querySelector('.urlbar input');
  if (url) iframe.src = url; // 빈 값이면 빈 iframe

  const paneObj = {
    el: pane, cfg: { preview: true, url },
    fit() { /* iframe 은 flex 로 자동 채움 */ },
    dispose() {
      const c = findColumnOf(paneObj);
      if (c) {
        const ci = c.panes.indexOf(paneObj);
        if (ci >= 0) c.panes.splice(ci, 1);
        if (c.panes.length === 0) { const idx = columns.indexOf(c); if (idx >= 0) columns.splice(idx, 1); c.el.remove(); }
      }
      pane.remove();
      rebuildAll();
      if (activePane === paneObj) setActive(columns[0] ? columns[0].panes[0] : null);
      updateStatus();
    },
  };
  col.panes.push(paneObj);

  function navigate(u) {
    u = normalizeUrl(u);
    if (!u) return;
    paneObj.cfg.url = u;
    input.value = u;
    iframe.src = u;
    try {
      const fm = u.match(/^\/api\/file\?path=(.+)$/);
      if (fm) {
        const p = decodeURIComponent(fm[1]);
        const base = p.split(/[\\/]/).filter(Boolean).pop() || p;
        pane.querySelector('.label').title = p;
        pane.querySelector('.ttl').innerHTML = `${ICON.file}<span>${escapeHtml(base)}</span>`;
      } else {
        pane.querySelector('.label').title = u;
        pane.querySelector('.ttl').innerHTML = `${ICON.globe}<span>${escapeHtml(new URL(u).host)}</span>`;
      }
    } catch {}
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(e.target.value); });
  pane.querySelector('.go').addEventListener('click', (e) => { e.stopPropagation(); navigate(input.value); });
  pane.querySelector('.reload').addEventListener('click', (e) => { e.stopPropagation(); iframe.src = iframe.src; });
  pane.querySelector('.ext').addEventListener('click', (e) => { e.stopPropagation(); window.open(paneObj.cfg.url, '_blank'); });
  pane.querySelector('.x').addEventListener('click', (e) => { e.stopPropagation(); paneObj.dispose(); });
  pane.querySelector('.preview .urlbar').addEventListener('mousedown', () => setActive(paneObj));

  enablePaneDrag(paneObj, pane.querySelector('.bar'));
  rebuildAll();
  setActive(paneObj);
  updateStatus();
  if (!url) setTimeout(() => input.focus(), 80); // 빈 패널이면 주소창에 바로 입력
}

document.getElementById('addWeb').addEventListener('click', () => {
  addPreviewPane('', 'column'); // URL 은 패널 주소창에서 입력
});

// 로컬 파일 미리보기 패널 (Claude 산출물/이미지/HTML/MD)
function addFilePreview(absPath, placement) {
  if (!absPath) return;
  const base = absPath.split(/[\\/]/).filter(Boolean).pop() || absPath;
  addPreviewPane('/api/file?path=' + encodeURIComponent(absPath), placement || 'column', base);
}

document.getElementById('addFile').addEventListener('click', async () => {
  if (window.claudeHub && window.claudeHub.pickFile) {
    const p = await window.claudeHub.pickFile();
    if (p) addFilePreview(p, 'column');
  } else {
    const p = await uiPrompt('미리보기할 파일의 전체 경로', '', '예: C:\\Users\\me\\report.html');
    if (p && p.trim()) addFilePreview(p.trim(), 'column');
  }
});

/* ---------- 드래그 도킹 ---------- */
const dropIndicator = document.getElementById('dropIndicator');
let drag = null;

function enablePaneDrag(paneObj, bar) {
  bar.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    setActive(paneObj);
    const startX = e.clientX, startY = e.clientY;
    drag = { pane: paneObj, bar, started: false, target: null, zone: null };

    const onMove = (ev) => {
      if (!drag) return;
      if (!drag.started) {
        if (Math.abs(ev.clientX - startX) < 5 && Math.abs(ev.clientY - startY) < 5) return;
        drag.started = true;
        bar.classList.add('grabbing');
        paneObj.el.classList.add('dragging');
        document.body.classList.add('dragging-pane');
        document.body.style.userSelect = 'none';
      }
      const targetEl = paneUnderPoint(ev.clientX, ev.clientY, paneObj.el);
      if (!targetEl) { dropIndicator.style.display = 'none'; drag.target = null; return; }
      const tPane = columns.flatMap((c) => c.panes).find((p) => p.el === targetEl);
      const zone = computeZone(targetEl, ev.clientX, ev.clientY);
      drag.target = tPane; drag.zone = zone;
      showDropIndicator(targetEl, zone);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      bar.classList.remove('grabbing');
      paneObj.el.classList.remove('dragging');
      document.body.classList.remove('dragging-pane');
      document.body.style.userSelect = '';
      dropIndicator.style.display = 'none';
      if (drag && drag.started && drag.target && drag.target !== paneObj) dockPane(paneObj, drag.target, drag.zone);
      drag = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function paneUnderPoint(x, y, exceptEl) {
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    const pane = el.closest && el.closest('.pane');
    if (pane && pane !== exceptEl) return pane;
  }
  return null;
}
function computeZone(el, x, y) {
  const r = el.getBoundingClientRect();
  const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
  if (fx < 0.25) return 'left';
  if (fx > 0.75) return 'right';
  if (fy < 0.5) return 'top';
  return 'bottom';
}
function showDropIndicator(el, zone) {
  const r = el.getBoundingClientRect();
  let { left, top, width, height } = r;
  if (zone === 'left') width = r.width / 2;
  else if (zone === 'right') { left = r.left + r.width / 2; width = r.width / 2; }
  else if (zone === 'top') height = r.height / 2;
  else if (zone === 'bottom') { top = r.top + r.height / 2; height = r.height / 2; }
  Object.assign(dropIndicator.style, { display: 'block', left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
  dropIndicator.querySelector('.dz').textContent = { left: '왼쪽', right: '오른쪽', top: '위', bottom: '아래' }[zone] || '';
}
function dockPane(src, target, zone) {
  const srcCol = findColumnOf(src);
  const tgtCol = findColumnOf(target);
  if (!srcCol || !tgtCol) return;
  srcCol.panes.splice(srcCol.panes.indexOf(src), 1);
  if (zone === 'left' || zone === 'right') {
    const tgtIdx = columns.indexOf(tgtCol);
    const at = zone === 'left' ? tgtIdx : tgtIdx + 1;
    newColumn(at).panes.push(src);
  } else {
    const ti = tgtCol.panes.indexOf(target);
    tgtCol.panes.splice(zone === 'top' ? ti : ti + 1, 0, src);
  }
  if (srcCol.panes.length === 0) { columns.splice(columns.indexOf(srcCol), 1); srcCol.el.remove(); }
  rebuildAll();
  setActive(src);
  updateStatus();
}

/* ---------- 모달 흐름 ---------- */
let currentPath = '';
function openOverlay(which) {
  folderModal.style.display = which === 'folder' ? 'flex' : 'none';
  sessionModal.style.display = which === 'session' ? 'flex' : 'none';
  overlay.classList.add('open');
}
function closeOverlay() { overlay.classList.remove('open'); }

async function startNewSession() {
  const defs = await fetch('/api/defaults').then((r) => r.json()).catch(() => ({}));
  document.getElementById('curPath').value = localStorage.getItem('cth_last_path') || defs.cwd || defs.home || '';
  document.getElementById('fsnote').textContent = '';
  openOverlay('folder');
  loadRecentPaths();
}
window.startNewSession = startNewSession;
document.getElementById('add').addEventListener('click', startNewSession);

// 최근 작업 경로 추천 목록
async function loadRecentPaths() {
  const box = document.getElementById('recentPaths');
  box.innerHTML = '<div class="fsnote">불러오는 중…</div>';
  const res = await fetch(`/api/recent-paths?limit=25&${profileQ()}`).then((r) => r.json()).catch(() => ({ paths: [] }));
  box.innerHTML = '';
  if (!res.paths || res.paths.length === 0) {
    box.innerHTML = '<div class="fsnote">최근 작업 경로가 없습니다. 위에 경로를 직접 입력하거나 폴더 선택기를 쓰세요.</div>';
    return;
  }
  res.paths.forEach((p) => {
    const folder = p.path.split(/[\\/]/).filter(Boolean).pop() || p.path;
    const it = document.createElement('div');
    it.className = 'fsitem';
    it.title = p.path;
    it.innerHTML = `
      <span class="ico">${ICON.folder}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        <b>${escapeHtml(folder)}</b> <span style="color:var(--muted);font-size:11px">${escapeHtml(p.path)}</span>
      </span>
      <span style="color:var(--muted);font-size:11px;flex:none">${relTime(p.mtime)}</span>`;
    it.onclick = () => { document.getElementById('curPath').value = p.path; choosePath(p.path); };
    box.appendChild(it);
  });
}

// 경로 "선택 확정" → 검증 후 세션 목록으로
async function choosePath(p) {
  p = (p || '').trim();
  if (!p) return;
  const res = await fetch(`/api/fs/list?path=${encodeURIComponent(p)}&${profileQ()}`).then((r) => r.json()).catch(() => ({ error: '경로 조회 실패' }));
  if (res.error) { document.getElementById('fsnote').textContent = res.error; return; }
  localStorage.setItem('cth_last_path', res.path);
  openSessionPicker(res.path);
}

document.getElementById('curPath').addEventListener('keydown', (e) => { if (e.key === 'Enter') choosePath(e.target.value); });
document.getElementById('pickHere').addEventListener('click', () => choosePath(document.getElementById('curPath').value));
document.getElementById('changeFolder').addEventListener('click', () => { openOverlay('folder'); loadRecentPaths(); });

document.getElementById('osPick').addEventListener('click', async () => {
  const btn = document.getElementById('osPick');
  const orig = btn.textContent;
  const note = document.getElementById('fsnote');
  const cur = document.getElementById('curPath').value.trim();
  btn.disabled = true; btn.textContent = '선택기 여는 중…';
  try {
    // Electron 앱: 네이티브 다이얼로그(절대경로, 항상 최상단)
    if (window.claudeHub && window.claudeHub.pickFolder) {
      const picked = await window.claudeHub.pickFolder(cur);
      if (picked) { document.getElementById('curPath').value = picked; choosePath(picked); }
      return;
    }
    // 브라우저 모드: 서버측 다이얼로그 폴백
    const res = await fetch(`/api/fs/pick?path=${encodeURIComponent(cur)}`).then((r) => r.json());
    if (res.error) { note.textContent = res.error; return; }
    if (res.canceled || !res.path) return;
    document.getElementById('curPath').value = res.path;
    choosePath(res.path);
  } catch (e) {
    note.textContent = '폴더 선택 실패: ' + e.message;
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
});

async function openSessionPicker(p) {
  document.getElementById('sesCwd').textContent = p;
  document.getElementById('seslist').innerHTML = '<div class="sesempty">불러오는 중…</div>';
  openOverlay('session');
  const res = await fetch(`/api/sessions?path=${encodeURIComponent(p)}&${profileQ()}`).then((r) => r.json()).catch(() => ({ sessions: [] }));
  const list = document.getElementById('seslist');
  document.getElementById('sesCount').textContent = res.total ? `(${res.sessions.length}/${res.total})` : '(0)';
  list.innerHTML = '';
  if (!res.sessions || res.sessions.length === 0) {
    list.innerHTML = '<div class="sesempty">저장된 세션이 없습니다. 위의 <b>새 대화 시작</b>으로 시작하세요.</div>';
    return;
  }
  res.sessions.forEach((s) => {
    const it = document.createElement('div');
    it.className = 'sesitem';
    it.innerHTML = `
      <span class="ico">${ICON.chat}</span>
      <div class="meta">
        <div class="title">${escapeHtml(s.title)}</div>
        <div class="sub">${relTime(s.mtime)} · ${s.sizeKB}KB · ${s.id.slice(0, 8)}</div>
      </div>`;
    it.onclick = () => { closeOverlay(); addPane({ cwd: p, resumeId: s.id, title: s.title }, getPlacement()); };
    list.appendChild(it);
  });
}

function getPlacement() {
  const r = document.querySelector('input[name="placement"]:checked');
  return r ? r.value : 'column';
}

document.getElementById('newChat').addEventListener('click', () => {
  const p = document.getElementById('sesCwd').textContent;
  closeOverlay(); addPane({ cwd: p, runClaude: true, command: 'claude', title: 'claude 새 대화' }, getPlacement());
});
document.getElementById('customCmd').addEventListener('click', async () => {
  const p = document.getElementById('sesCwd').textContent;
  const cmd = await uiPrompt('명령 직접 입력', 'claude --continue', '빈칸이면 셸만 열립니다.');
  if (cmd === null) return;
  closeOverlay();
  addPane({ cwd: p, runClaude: !!cmd.trim(), command: cmd.trim() || 'claude', title: cmd.trim() || '셸' }, getPlacement());
});

// backdrop 클릭으로는 닫지 않음 — 실수 방지. ✕/취소/닫기/Esc 로만.
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeOverlay));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeOverlay(); });

/* ---------- 유틸 ---------- */
function joinPath(base, name) {
  const sep = base.includes('/') && !base.includes('\\') ? '/' : '\\';
  return base.endsWith(sep) ? base + name : base + sep + name;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function relTime(ms) {
  if (!ms) return '?';
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return '방금';
  if (d < 3600) return `${Math.floor(d / 60)}분 전`;
  if (d < 86400) return `${Math.floor(d / 3600)}시간 전`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)}일 전`;
  return new Date(ms).toLocaleDateString('ko-KR');
}

/* ---------- LNB (최근 세션 + 전체 검색) ---------- */
function isoTime(iso) { return iso ? relTime(new Date(iso).getTime()) : '?'; }
function renderSessionList(sessions, emptyMsg, showTimes) {
  const box = document.getElementById('recentList');
  box.innerHTML = '';
  if (!sessions || sessions.length === 0) {
    box.innerHTML = `<div class="recent-empty">${escapeHtml(emptyMsg || '결과가 없습니다.')}</div>`;
    return;
  }
  sessions.forEach((s) => {
    const folder = s.cwd.split(/[\\/]/).filter(Boolean).pop() || s.cwd;
    const other = s.profile && s.profile !== activeProfileId; // 다른 계정 소속 세션
    const it = document.createElement('div');
    it.className = 'recent-item';
    it.title = `${s.title}\n${s.cwd}` + (other ? `\n계정: ${profileName(s.profile)}` : '') + `\n클릭 = 열기`;
    it.innerHTML = `
      <div class="rt">${ICON.chat}<span>${escapeHtml(s.title)}</span></div>
      <div class="rf">${ICON.folder}<span>${escapeHtml(folder)}</span></div>
      ${showTimes
        ? `<div class="rs">최초 ${isoTime(s.firstInputAt)} · 마지막 ${isoTime(s.lastInputAt)}${other ? ` · <span class="rprof">${escapeHtml(profileName(s.profile))}</span>` : ''}</div>`
        : `<div class="rs">${relTime(s.mtime)}${other ? ` · <span class="rprof">${escapeHtml(profileName(s.profile))}</span>` : ''}</div>`}
      ${other ? `<button class="rcont" title="이 대화를 현재 계정(${escapeHtml(profileName(activeProfileId))})으로 복사해 이어가기">${escapeHtml(profileName(activeProfileId))} 계정으로 이어가기</button>` : ''}`;
    it.onclick = () => openSession(s);
    const cont = it.querySelector('.rcont');
    if (cont) cont.addEventListener('click', (e) => { e.stopPropagation(); continueHere(s); });
    box.appendChild(it);
  });
}

async function loadRecent() {
  const titleBits = [lnbAllSessions ? '모든 세션' : '최근 세션', lnbAllProfiles ? '모든 계정' : null].filter(Boolean);
  document.getElementById('lnbTitle').textContent = titleBits.join(' · ');
  document.getElementById('recentList').innerHTML = '<div class="recent-empty">불러오는 중…</div>';
  const q = lnbAllSessions ? `all=1&${lnbProfileQ()}` : `limit=${lnbAllProfiles ? 40 : 15}&${lnbProfileQ()}`;
  const res = await fetch(`/api/recent?${q}`).then((r) => r.json()).catch(() => ({ sessions: [] }));
  renderSessionList(res.sessions, '세션이 없습니다.', lnbAllSessions);
}

async function searchSessions(q) {
  document.getElementById('lnbTitle').textContent = '검색 중…';
  document.getElementById('recentList').innerHTML = '<div class="recent-empty">검색 중…</div>';
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=60&${lnbProfileQ()}`).then((r) => r.json()).catch(() => ({ sessions: [] }));
  document.getElementById('lnbTitle').textContent = `검색 결과 (${res.sessions.length})`;
  renderSessionList(res.sessions, `"${q}" 와 일치하는 세션이 없습니다.`);
}

function refreshLnb() {
  const q = document.getElementById('lnbSearch').value.trim();
  if (q) searchSessions(q); else loadRecent();
}

let searchTimer;
document.getElementById('lnbSearch').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  document.getElementById('lnbSearchClear').style.display = q ? 'block' : 'none';
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { if (q) searchSessions(q); else loadRecent(); }, 250);
});
document.getElementById('lnbSearchClear').addEventListener('click', () => {
  const inp = document.getElementById('lnbSearch');
  inp.value = ''; inp.focus();
  document.getElementById('lnbSearchClear').style.display = 'none';
  loadRecent();
});

function setLnb(collapsed) {
  document.body.classList.toggle('lnb-collapsed', collapsed);
  localStorage.setItem('cth_lnb_collapsed', collapsed ? '1' : '0');
  setTimeout(fitAll, 180);
}
document.getElementById('lnbToggle').addEventListener('click', () => {
  setLnb(!document.body.classList.contains('lnb-collapsed'));
});
document.getElementById('lnbRefresh').addEventListener('click', refreshLnb);
function setLnbAll(on) {
  lnbAllProfiles = on;
  localStorage.setItem('cth_lnb_all_profiles', on ? '1' : '0');
  const b = document.getElementById('lnbAllToggle');
  if (b) b.classList.toggle('on', on);
  refreshLnb();
}
document.getElementById('lnbAllToggle').addEventListener('click', () => setLnbAll(!lnbAllProfiles));
document.getElementById('lnbAllToggle').classList.toggle('on', lnbAllProfiles);
function setLnbAllSessions(on) {
  lnbAllSessions = on;
  localStorage.setItem('cth_lnb_all_sessions', on ? '1' : '0');
  const b = document.getElementById('lnbAllSessionsToggle');
  if (b) b.classList.toggle('on', on);
  refreshLnb();
}
document.getElementById('lnbAllSessionsToggle').addEventListener('click', () => setLnbAllSessions(!lnbAllSessions));
document.getElementById('lnbAllSessionsToggle').classList.toggle('on', lnbAllSessions);
document.getElementById('addProfile').addEventListener('click', addProfile);
document.querySelectorAll('#themePopover .popover-item').forEach((el) => {
  el.addEventListener('click', () => { applyTheme(el.dataset.theme); closePopovers(); });
});
setupPopover('themeBtn', 'themePopover');
setupPopover('accentBtn', 'accentPopover');
setupPopover('cursorBtn', 'cursorPopover');
buildAccentPicker();

/* ---------- 캐릭터 테마 · 커서 UI 배선 ---------- */
function segSelect(rowId, value) {
  const row = document.getElementById(rowId);
  if (!row) return;
  row.querySelectorAll('button').forEach((b) => {
    const v = b.dataset.mode || b.dataset.lv || b.dataset.src || b.dataset.fit || b.dataset.hot || b.dataset.tip || b.dataset.scope;
    b.classList.toggle('on', String(v) === String(value));
  });
}
function buildCharThemeList() {
  const box = document.getElementById('charThemeList');
  if (!box || !window.CHAR_THEMES) return;
  box.innerHTML = window.CHAR_THEMES.map((t) => {
    const a = charAssets(t.key);
    const av = a.icon
      ? `<img class="avatar" src="${a.icon}" alt="">`
      : `<span class="swatch" style="background:${t.fallback}"></span>`;
    return `<div class="popover-item" data-theme="${t.key}">${av}${t.name}<span class="ipname">${t.ip}</span></div>`;
  }).join('');
  box.querySelectorAll('.popover-item').forEach((el) => {
    el.addEventListener('click', () => { applyTheme(el.dataset.theme); });
  });
  const cur = localStorage.getItem('cth_theme');
  box.querySelectorAll('.popover-item').forEach((el) => el.classList.toggle('active', el.dataset.theme === cur));
}
document.getElementById('themeModeRow').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  localStorage.setItem('cth_theme_mode', b.dataset.mode);
  segSelect('themeModeRow', b.dataset.mode);
  applyTheme(localStorage.getItem('cth_theme') || 'dark');
});
document.getElementById('themeLevelRow').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  localStorage.setItem('cth_theme_level', b.dataset.lv);
  segSelect('themeLevelRow', b.dataset.lv);
  applyTheme(localStorage.getItem('cth_theme') || 'dark');
});

// 캐릭터 이미지 넣기 (클릭 · 드래그&드롭) → 서버의 theme-assets 폴더에 저장
async function uploadThemeAsset(file, name) {
  const dataUrl = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  const r = await fetch('/api/theme-assets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, dataUrl }),
  }).then((x) => x.json());
  if (r.error) throw new Error(r.error);
  return r.file;
}
function extOf(file) {
  const m = /\.(png|webp|jpe?g|gif|svg)$/i.exec(file.name || '');
  return m ? m[0].toLowerCase() : (file.type === 'image/webp' ? '.webp' : '.png');
}
async function takeThemeImage(file) {
  const key = document.body.dataset.char;
  if (!key || !file) return;
  const hint = document.getElementById('assetDropHint');
  try {
    if (hint) hint.textContent = '저장 중…';
    const saved = await uploadThemeAsset(file, key + '-icon' + extOf(file));
    // 얼굴 아이콘만 바꾸면 전신(팔레트 추출용)이 없는 경우가 있으므로 없으면 같이 저장
    const t = (window.CHAR_THEME_MAP || {})[key];
    if (t && !pickAsset(t.full)) await uploadThemeAsset(file, key + extOf(file));
    // 새 이미지이므로 팔레트 캐시 무효화
    Object.keys(palCache).forEach((k) => { if (k.includes(key)) delete palCache[k]; });
    savePalCache();
    await loadThemeAssets();
    buildCharThemeList();
    applyTheme(key);
    if (hint) hint.textContent = saved + ' 저장됨';
  } catch (e) {
    if (hint) hint.textContent = '실패: ' + ((e && e.message) || e);
  }
}
(function wireAssetDrop() {
  const dz = document.getElementById('assetDrop');
  if (!dz) return;
  dz.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => takeThemeImage(inp.files[0]);
    inp.click();
  });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('over');
    takeThemeImage(e.dataTransfer.files[0]);
  });
})();

// 커서 설정
(function wireCursorUI() {
  const rows = [['curSrcRow', 'src', 'cth_cursor_src'], ['curFitRow', 'fit', 'cth_cursor_fit'],
    ['curHotRow', 'hot', 'cth_cursor_hotspot'], ['curTipRow', 'tip', 'cth_cursor_tip'],
    ['curScopeRow', 'scope', 'cth_cursor_scope']];
  rows.forEach(([id, attr, key]) => {
    const row = document.getElementById(id);
    if (!row) return;
    row.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      localStorage.setItem(key, b.dataset[attr]);
      segSelect(id, b.dataset[attr]);
      applyCursors();
    });
  });
  const size = document.getElementById('curSize');
  if (size) {
    size.value = CURSOR.size;
    const lab = document.getElementById('curSizeLabel');
    if (lab) lab.textContent = CURSOR.size + 'px';
    size.addEventListener('input', () => {
      localStorage.setItem('cth_cursor_size', size.value);
      if (lab) lab.textContent = size.value + 'px';
      applyCursors();
    });
  }
  const f = document.getElementById('curFile');
  if (f) f.addEventListener('change', async () => {
    const file = f.files[0]; if (!file) return;
    try {
      const saved = await uploadThemeAsset(file, 'cursor-custom' + extOf(file));
      localStorage.setItem('cth_cursor_custom_file', saved);
      localStorage.setItem('cth_cursor_src', 'custom');
      segSelect('curSrcRow', 'custom');
      await loadThemeAssets();
      applyCursors();
    } catch (e) { showBanner('커서 이미지 저장 실패: ' + ((e && e.message) || e)); }
  });
  segSelect('curSrcRow', CURSOR.src);
  segSelect('curFitRow', CURSOR.fit);
  segSelect('curHotRow', CURSOR.hot);
  segSelect('curTipRow', CURSOR.tip ? '1' : '0');
  segSelect('curScopeRow', CURSOR.scope);
})();

// 테마 적용 — 이미지 목록을 먼저 받아와야 캐릭터 테마가 아이콘/팔레트를 쓸 수 있다.
loadPalCache();
applyUiFont(localStorage.getItem('cth_ui_font') || DEFAULT_UI_FONT, false);
segSelect('themeModeRow', themeMode());
segSelect('themeLevelRow', String(themeLevel()));
loadThemeAssets().then(() => {
  buildCharThemeList();
  applyTheme(localStorage.getItem('cth_theme') || 'dark');
  applyAccent(localStorage.getItem('cth_accent') || null);
});

// 도움말 오버레이 (단축키 · 명령어)
(function initHelp() {
  const btn = document.getElementById('helpBtn');
  const ov = document.getElementById('helpOverlay');
  const close = document.getElementById('helpClose');
  if (!ov) return;
  const open = () => ov.classList.add('open');
  const hide = () => ov.classList.remove('open');
  if (btn) btn.addEventListener('click', open);
  if (close) close.addEventListener('click', hide);
  ov.addEventListener('click', (e) => { if (e.target === ov) hide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ov.classList.contains('open')) hide(); });
})();

// 컴포즈 입력창 토글
function setCompose(on) {
  document.body.classList.toggle('compose-on', !!on);
  localStorage.setItem('cth_compose', on ? '1' : '0');
  const btn = document.getElementById('composeBtn');
  if (btn) btn.classList.toggle('on', !!on);
  if (on) refreshAllChats();
  setTimeout(() => { try { fitAll(); } catch {} }, 60);
}
(function initCompose() {
  const btn = document.getElementById('composeBtn');
  setCompose(localStorage.getItem('cth_compose') === '1');
  if (btn) btn.addEventListener('click', () => setCompose(!document.body.classList.contains('compose-on')));
})();

// 대화 표시 방식 (끄기 / 말풍선 / 디스코드)
(function initChatMode() {
  setupPopover('chatBtn', 'chatPopover');
  document.querySelectorAll('#chatPopover .popover-item').forEach((el) => {
    el.addEventListener('click', () => { applyChatMode(el.dataset.chat); });
  });
  const row = document.getElementById('chatLayoutRow');
  if (row) row.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) applyChatLayout(b.dataset.layout);
  });
  applyChatMode(chatMode());
})();

/* ---------- 버전 · 업데이트 ---------- */
(function initUpdateUI() {
  setupPopover('updateBtn', 'updatePopover');
  const $ = (id) => document.getElementById(id);
  const state = $('updState'), note = $('updNote'), prog = $('updProgress');
  const btnCheck = $('updCheck'), btnInstall = $('updInstall');
  const hub = window.claudeHub;
  const isApp = !!(hub && hub.isApp && hub.checkUpdate);

  fetch('/health').then((r) => r.json()).then((d) => { if ($('updCur')) $('updCur').textContent = 'v' + d.version; }).catch(() => {});

  if (!isApp) {
    if (state) state.textContent = '브라우저 모드';
    if (note) note.innerHTML = '자동 업데이트는 <b>데스크톱 앱</b>에서만 동작합니다. 브라우저/탭 모드는 <code>git pull</code> 후 서버를 재시작하세요.';
    if (btnCheck) { btnCheck.disabled = true; btnCheck.textContent = '앱에서만 가능'; }
    return;
  }
  const set = (txt, hint) => { if (state) state.textContent = txt; if (hint != null && note) note.innerHTML = hint; };
  hub.onUpdateStatus((p) => {
    if (!p || !p.state) return;
    if (p.state === 'checking') { set('확인 중…', ''); }
    else if (p.state === 'available') { set(`새 버전 v${p.version} 내려받는 중`, ''); if (prog) prog.style.display = 'block'; }
    else if (p.state === 'progress') {
      if (prog) { prog.style.display = 'block'; const bar = prog.querySelector('i'); if (bar) bar.style.width = Math.round(p.percent || 0) + '%'; }
      set(`다운로드 ${Math.round(p.percent || 0)}%`, '');
    } else if (p.state === 'downloaded') {
      set(`v${p.version} 설치 준비 완료`, '지금 재시작하거나, 앱을 종료하면 자동으로 설치됩니다.');
      if (prog) prog.style.display = 'none';
      if (btnInstall) btnInstall.style.display = 'block';
    } else if (p.state === 'none') { set('최신 버전입니다', ''); }
    else if (p.state === 'dev') { set('개발 실행', '패키징된 앱에서만 업데이트를 확인할 수 있습니다.'); }
    else if (p.state === 'error') { set('확인 실패', escapeHtml(p.message || '')); }
  });
  if (btnCheck) btnCheck.addEventListener('click', () => { set('확인 중…', ''); hub.checkUpdate(); });
  if (btnInstall) btnInstall.addEventListener('click', () => hub.installUpdate());
})();

document.getElementById('fontDown').addEventListener('click', () => applyFontSize(termFontSize - 1));
document.getElementById('fontUp').addEventListener('click', () => applyFontSize(termFontSize + 1));
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.key === '=' || e.key === '+') { e.preventDefault(); applyFontSize(termFontSize + 1); }
  else if (e.key === '-' || e.key === '_') { e.preventDefault(); applyFontSize(termFontSize - 1); }
  else if (e.key === '0') { e.preventDefault(); applyFontSize(13); }
});
applyFontSize(termFontSize);

// 화면(UI) 글꼴 선택
(function initUiFont() {
  const sel = document.getElementById('uiFontFamily');
  if (!sel || !window.UI_FONTS) return;
  sel.innerHTML = window.UI_FONTS.map((f) => `<option value="${f.css.replace(/"/g, '&quot;')}">${f.label}</option>`).join('');
  if (!window.UI_FONTS.some((f) => f.css === uiFontFamily)) uiFontFamily = window.UI_FONTS[0].css;
  sel.value = uiFontFamily;
  sel.addEventListener('change', () => {
    applyUiFont(sel.value);
    // 캐릭터 테마 Lv2+ 는 테마 추천 글꼴을 쓰므로, 직접 고르면 그 선택이 우선하도록 다시 적용
    applyTheme(localStorage.getItem('cth_theme') || 'dark');
    applyUiFont(sel.value);
  });
  markMissingFonts(sel, window.UI_FONTS);
})();

// 글꼴 선택 채우기 + 배선
(function initFontFamily() {
  const sel = document.getElementById('fontFamily');
  if (!sel) return;
  sel.innerHTML = FONT_FAMILIES.map((f) => `<option value="${f.css.replace(/"/g, '&quot;')}">${f.label}</option>`).join('');
  if (!FONT_FAMILIES.some((f) => f.css === termFontFamily)) {
    // 저장값이 목록에 없으면 첫 항목으로 정규화
    termFontFamily = FONT_FAMILIES[0].css;
  }
  sel.value = termFontFamily;
  sel.addEventListener('change', () => applyFontFamily(sel.value));
  markMissingFonts(sel, FONT_FAMILIES);
})();

ensureNotifyPermission();

let rt;
window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(fitAll, 120); });

hydrateIcons();
setLnb(localStorage.getItem('cth_lnb_collapsed') === '1');
updateStatus();

fetch('/health').then((r) => r.json()).then((d) => {
  const brand = document.querySelector('.brand');
  if (brand && d.version) brand.title = `v${d.version}`;
}).catch(() => {});

// 서버 전역 상태(프로필) 로드
async function initState() {
  try {
    const s = await fetch('/api/state').then((r) => r.json());
    if (Array.isArray(s.profiles) && s.profiles.length) profiles = s.profiles;
  } catch {}
  if (!profiles.find((p) => p.id === 'default')) profiles.unshift({ id: 'default', name: '기본' });
  if (!profiles.find((p) => p.id === activeProfileId)) activeProfileId = 'default';
  restoreLayoutForProfile(activeProfileId); // 마지막으로 열려있던 패널 레이아웃 복원
  restoreMinimized(); // 최소화(트레이)돼 있던 패널도 복원
  renderTabs();
  loadRecent();
}
initState();
// 로드 시 모달을 자동으로 열지 않는다 — 모달이 LNB(최근 세션) 클릭을 가리기 때문.
// 사용자가 좌측 최근 세션을 클릭하거나 "＋ 새 세션"을 눌러 시작한다.

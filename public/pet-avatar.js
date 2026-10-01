'use strict';
/**
 * 펫 캐릭터 고르기 — 셋 중 하나.
 *   theme   : 허브의 캐릭터 테마를 따라간다(테마 아이콘 → 전신 이미지 순). 테마가 없으면 기본.
 *   custom  : 사용자가 펫에 끌어다 놓은(또는 고른) 이미지. gif 면 움직인다.
 *   default : 기본 동그라미(SVG).
 *
 * 이미지는 허브의 캐릭터 이미지와 같은 폴더(~/.claude-terminal-hub/theme-assets/)에 둔다 —
 * 저장소·설치파일에 넣지 않는다(저작권). 펫 창과 허브 창은 같은 주소라 localStorage 를
 * 함께 쓰므로, 허브에서 테마를 바꾸면 storage 이벤트로 펫도 바로 바뀐다.
 */
(function () {
  const KEY_MODE = 'cth_pet_mode';
  const KEY_FILE = 'cth_pet_image';
  const KEY_VER = 'cth_pet_ver';
  const MODES = ['theme', 'custom', 'default'];
  const IMG_RE = /\.(png|webp|jpe?g|gif|svg)$/i;

  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } };

  let files = [];
  async function loadFiles() {
    try { files = (await fetch('/api/theme-assets').then((r) => r.json())).files || []; } catch { files = []; }
  }
  const pick = (cands) => (cands || []).find((c) => files.includes(c)) || null;

  function mode() { const m = get(KEY_MODE); return MODES.includes(m) ? m : 'theme'; }
  function themeInfo() {
    const t = (window.CHAR_THEME_MAP || {})[get('cth_theme') || ''];
    if (!t) return { theme: null, file: null };
    return { theme: t, file: pick(t.icon) || pick(t.full) };
  }

  /** 지금 보여줄 이미지. url 이 null 이면 기본 SVG. */
  function resolve() {
    const m = mode();
    if (m === 'custom') {
      const f = get(KEY_FILE);
      if (f && files.includes(f)) return { mode: m, url: `/theme-assets/${encodeURIComponent(f)}?v=${get(KEY_VER) || 0}` };
    }
    if (m === 'theme') {
      const { file } = themeInfo();
      if (file) return { mode: m, url: `/theme-assets/${encodeURIComponent(file)}` };
    }
    return { mode: m, url: null };
  }

  const readAsDataUrl = (file) => new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => fail(r.error || new Error('파일을 읽지 못했어요'));
    r.readAsDataURL(file);
  });

  /** 펫 전용 이미지 저장 — 한 장만 유지(pet-custom.<확장자>). */
  async function uploadCustom(file) {
    if (!file || !IMG_RE.test(file.name || '')) throw new Error('이미지 파일만 쓸 수 있어요 (png·gif·webp·jpg·svg)');
    if (file.size > 8 * 1024 * 1024) throw new Error('8MB 보다 큰 이미지는 못 써요');
    const ext = (file.name.match(IMG_RE) || ['.png'])[0].toLowerCase();
    const name = 'pet-custom' + ext;
    const r = await fetch('/api/theme-assets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, dataUrl: await readAsDataUrl(file) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '저장하지 못했어요');
    set(KEY_FILE, j.file || name);
    set(KEY_VER, String(Date.now())); // 같은 이름으로 덮어써도 새로 읽게
    set(KEY_MODE, 'custom');
    await loadFiles();
  }

  window.PetAvatar = {
    loadFiles, resolve, mode, themeInfo, uploadCustom,
    setMode: (m) => { if (MODES.includes(m)) set(KEY_MODE, m); },
    hasCustom: () => { const f = get(KEY_FILE); return !!(f && files.includes(f)); },
    isImage: (file) => !!(file && IMG_RE.test(file.name || '')),
  };
})();

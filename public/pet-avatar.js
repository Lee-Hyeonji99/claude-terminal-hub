'use strict';
/**
 * 펫 캐릭터 고르기 — 넷 중 하나.
 *   pack    : 펫 팩(동작별 움직이는 이미지 묶음). 상태에 따라 동작이 바뀐다(public/pet-mood.js).
 *   theme   : 허브의 캐릭터 테마를 따라간다(테마 아이콘 → 전신 이미지 순). 테마가 없으면 기본.
 *   custom  : 사용자가 펫에 끌어다 놓은(또는 고른) 이미지 한 장. gif 면 움직인다.
 *   default : 기본 동그라미(SVG).
 *
 * 펫 팩은 «모든 펫» 에 쓰거나 «이 프로젝트 펫만» 에 쓸 수 있다(프로젝트별 지정이 우선).
 *
 * 이미지는 사용자 PC 에만 둔다 — 단일 이미지는 ~/.claude-terminal-hub/theme-assets/,
 * 팩은 ~/.claude-terminal-hub/pet-packs/<id>/ (저장소·설치파일에 넣지 않는다: 저작권).
 * 펫 창과 허브 창은 같은 주소라 localStorage 를 함께 쓰므로 storage 이벤트로 서로 바로 바뀐다.
 */
(function () {
  const KEY_MODE = 'cth_pet_mode';
  const KEY_FILE = 'cth_pet_image';
  const KEY_VER = 'cth_pet_ver';
  const KEY_PACK = 'cth_pet_pack';               // 모든 펫에 쓸 팩 id
  const projectPackKey = (pid) => `cth_pet_pack@${pid}`;   // 이 프로젝트 펫만 (빈 값 = 지정 없음)
  const MODES = ['pack', 'theme', 'custom', 'default'];
  const IMG_RE = /\.(png|webp|jpe?g|gif|svg)$/i;

  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } };
  const del = (k) => { try { localStorage.removeItem(k); } catch { /* 저장 불가 환경 */ } };

  let files = [];
  let packs = [];
  async function loadFiles() {
    const [a, b] = await Promise.all([
      fetch('/api/theme-assets').then((r) => r.json()).catch(() => ({})),
      fetch('/api/pet-packs').then((r) => r.json()).catch(() => ({})),
    ]);
    files = (a && a.files) || [];
    packs = (b && b.packs) || [];
  }
  const pick = (cands) => (cands || []).find((c) => files.includes(c)) || null;
  const packById = (id) => packs.find((p) => p.id === id) || null;

  function mode() { const m = get(KEY_MODE); return MODES.includes(m) ? m : 'theme'; }
  function themeInfo() {
    const t = (window.CHAR_THEME_MAP || {})[get('cth_theme') || ''];
    if (!t) return { theme: null, file: null };
    return { theme: t, file: pick(t.icon) || pick(t.full) };
  }

  // 이 프로젝트 펫에 쓸 팩 — 프로젝트 지정 → (팩 모드면) 전체 지정
  function packFor(projectId) {
    const own = projectId ? get(projectPackKey(projectId)) : null;
    if (own && packById(own)) return { pack: packById(own), scope: 'project' };
    if (mode() === 'pack') { const g = packById(get(KEY_PACK)); if (g) return { pack: g, scope: 'all' }; }
    return null;
  }
  const packUrls = (p) => Object.fromEntries(Object.entries(p.actions).map(([a, f]) => [a, `/pet-packs/${encodeURIComponent(p.id)}/${encodeURIComponent(f)}`]));

  /** 지금 보여줄 캐릭터. {mode, url} — url 이 null 이면 기본 SVG. 팩이면 {mode:'pack', pack:{id, name, actions:{동작:url}}} */
  function resolve(projectId) {
    const pk = packFor(projectId);
    if (pk) return { mode: 'pack', url: null, pack: { id: pk.pack.id, name: pk.pack.name, scope: pk.scope, actions: packUrls(pk.pack) } };
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

  /** 팩 폴더 가져오기(서버가 복사). @returns 팩 {id, name, actions} */
  async function importPack(folderPath) {
    const r = await fetch('/api/pet-packs/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) throw new Error('허브 서버가 옛 버전이에요 — 앱을 다시 켜 주세요');
    if (!r.ok || !j.pack) throw new Error(j.error || '팩을 가져오지 못했어요');
    await loadFiles();
    return j.pack;
  }

  /** 팩 쓰기 — scope 'all' 이면 모든 펫, 'project' 면 이 프로젝트 펫만. */
  function usePack(id, scope, projectId) {
    if (scope === 'project' && projectId) { set(projectPackKey(projectId), id); return; }
    set(KEY_PACK, id);
    set(KEY_MODE, 'pack');
  }
  // 이 프로젝트 지정 해제 — 전체 설정을 따른다
  function clearProjectPack(projectId) { if (projectId) del(projectPackKey(projectId)); }

  window.PetAvatar = {
    loadFiles, resolve, mode, themeInfo, uploadCustom, importPack, usePack, clearProjectPack,
    packs: () => packs.slice(),
    projectPack: (pid) => (pid ? get(projectPackKey(pid)) || '' : ''),
    globalPack: () => get(KEY_PACK) || '',
    setMode: (m) => { if (MODES.includes(m)) set(KEY_MODE, m); },
    hasCustom: () => { const f = get(KEY_FILE); return !!(f && files.includes(f)); },
    isImage: (file) => !!(file && IMG_RE.test(file.name || '')),
  };
})();

'use strict';
/**
 * 펫 캐릭터 고르기 — 넷 중 하나.
 *   pack    : 펫 팩(동작별 움직이는 이미지 묶음). 상태에 따라 동작이 바뀐다(public/pet-mood.js).
 *   theme   : 허브의 캐릭터 테마 전용 팩을 따라간다(일반 테마는 랏코 팩). 팩이 없으면 테마 이미지 → 기본 SVG.
 *   custom  : 사용자가 펫에 끌어다 놓은(또는 고른) 이미지 한 장. gif 면 움직인다.
 *   default : 기본 동그라미(SVG).
 *
 * 펫 팩은 «모든 펫» 에 쓰거나 «이 프로젝트 펫만» 에 쓸 수 있다(프로젝트별 지정이 우선).
 *
 * 이미지·팩은 모두 사용자 PC 에만 둔다(저작권: 저장소·설치파일에 넣지 않는다).
 *   테마 전용 팩 ~/.claude-terminal-hub/theme-packs/<테마키>/ · 가져온 팩 ~/.claude-terminal-hub/pet-packs/<id>/
 * 펫 창과 허브 창은 같은 주소라 localStorage 를 함께 쓰므로 storage 이벤트로 서로 바로 바뀐다.
 */
(function () {
  const KEY_MODE = 'cth_pet_mode';
  const KEY_FILE = 'cth_pet_image';
  const KEY_VER = 'cth_pet_ver';
  const KEY_PACK = 'cth_pet_pack';               // 모든 펫에 쓸 팩 id
  // 작업실의 서브에이전트 꼬마 — 'auto'(이름이 mob 으로 시작하는 가져온 팩들) · 팩 id 하나 · 'parent'(부모 펫을 작게)
  const KEY_MINION = 'cth_pet_minion';
  // 펫마다(프로젝트마다) 따로 — 표시 방식 · 내 이미지 · 팩. 없으면 위의 전체 값(옛 설정)을 따른다.
  const projectPackKey = (pid) => `cth_pet_pack@${pid}`;
  const projectModeKey = (pid) => `cth_pet_mode@${pid}`;
  const projectFileKey = (pid) => `cth_pet_image@${pid}`;
  const MODES = ['pack', 'theme', 'custom', 'default'];
  const IMG_RE = /\.(png|webp|jpe?g|gif|svg)$/i;

  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } };
  const del = (k) => { try { localStorage.removeItem(k); } catch { /* 저장 불가 환경 */ } };

  let files = [];
  let packs = [];
  let themeDir = '';
  async function loadFiles() {
    const [a, b] = await Promise.all([
      fetch('/api/theme-assets').then((r) => r.json()).catch(() => ({})),
      fetch('/api/pet-packs').then((r) => r.json()).catch(() => ({})),
    ]);
    files = (a && a.files) || [];
    packs = (b && b.packs) || [];
    themeDir = (b && b.themeDir) || '';
  }
  const pick = (cands) => (cands || []).find((c) => files.includes(c)) || null;
  const packById = (id) => packs.find((p) => p.id === id) || null;

  function globalMode() { const m = get(KEY_MODE); return MODES.includes(m) ? m : 'theme'; }
  function mode(projectId) {
    const own = projectId ? get(projectModeKey(projectId)) : null;
    return MODES.includes(own) ? own : globalMode();
  }
  const customFile = (projectId) => (projectId && get(projectFileKey(projectId))) || get(KEY_FILE);
  // 프로젝트 경로 → 짧은 파일 이름 조각 (펫마다 내 이미지를 따로 저장)
  function slugOf(projectId) {
    let h = 2166136261;
    const s = String(projectId || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  function themeInfo(themeKey) {
    const t = (window.CHAR_THEME_MAP || {})[themeKey || get('cth_theme') || ''];
    if (!t) return { theme: null, file: null };
    return { theme: t, file: pick(t.icon) || pick(t.full) };
  }

  // 이 프로젝트 펫에 쓸 팩 — 프로젝트 지정 → (팩 모드면) 전체 지정
  function packFor(projectId) {
    const own = projectId ? get(projectPackKey(projectId)) : null;
    if (own && packById(own)) return { pack: packById(own), scope: 'project' };
    if (mode(projectId) === 'pack') { const g = packById(get(KEY_PACK)); if (g) return { pack: g, scope: 'all' }; }
    return null;
  }
  const packUrls = (p) => {
    const base = p.themed ? `/theme-packs/${encodeURIComponent(p.theme)}` : `/pet-packs/${encodeURIComponent(p.id)}`;
    return Object.fromEntries(Object.entries(p.actions).map(([a, f]) => [a, `${base}/${encodeURIComponent(f)}`]));
  };
  function themePack(themeKey) {
    const { theme } = themeInfo(themeKey);
    return packById(theme ? theme.petPack : 'theme:rakko');
  }
  const resolvedPack = (p, scope) => ({ mode: 'pack', url: null, pack: { id: p.id, name: p.name, scope, actions: packUrls(p) } });

  /** 지금 보여줄 캐릭터. {mode, url} — url 이 null 이면 기본 SVG. 팩이면 {mode:'pack', pack:{id, name, actions:{동작:url}}} */
  function resolve(projectId, themeKey) {
    const pk = packFor(projectId);
    if (pk) return resolvedPack(pk.pack, pk.scope);
    const m = mode(projectId);
    if (m === 'custom') {
      const f = customFile(projectId);
      if (f && files.includes(f)) return { mode: m, url: `/theme-assets/${encodeURIComponent(f)}?v=${get(KEY_VER) || 0}` };
    }
    if (m === 'theme') {
      const themed = themePack(themeKey);
      if (themed) return resolvedPack(themed, 'theme');
      const { file } = themeInfo(themeKey);
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

  /** 펫 전용 이미지 저장 — 펫(프로젝트)마다 한 장(pet-custom-<조각>.<확장자>). */
  async function uploadCustom(file, projectId) {
    if (!file || !IMG_RE.test(file.name || '')) throw new Error('이미지 파일만 쓸 수 있어요 (png·gif·webp·jpg·svg)');
    if (file.size > 8 * 1024 * 1024) throw new Error('8MB 보다 큰 이미지는 못 써요');
    const ext = (file.name.match(IMG_RE) || ['.png'])[0].toLowerCase();
    const name = (projectId ? `pet-custom-${slugOf(projectId)}` : 'pet-custom') + ext;
    const r = await fetch('/api/theme-assets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, dataUrl: await readAsDataUrl(file) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '저장하지 못했어요');
    set(projectId ? projectFileKey(projectId) : KEY_FILE, j.file || name);
    set(KEY_VER, String(Date.now())); // 같은 이름으로 덮어써도 새로 읽게
    set(projectId ? projectModeKey(projectId) : KEY_MODE, 'custom');
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

  /** 팩 쓰기 — scope 'project' 면 이 펫만, 'all' 이면 모든 펫(펫마다 따로 고른 것도 지우고 맞춘다). */
  function usePack(id, scope, projectId) {
    if (scope === 'project' && projectId) { set(projectPackKey(projectId), id); return; }
    clearPerPetChoices();
    set(KEY_PACK, id);
    set(KEY_MODE, 'pack');
  }
  function clearPerPetChoices() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/^cth_pet_(pack|mode|image)@/.test(k)) keys.push(k);
      }
      keys.forEach(del);
    } catch { /* 저장 불가 환경 */ }
  }
  /** 꼬마에 쓸 팩들 [{ id, name, actions:{동작:url} }] — 비면 부모 펫을 작게 그린다 */
  function minionSetting() { return get(KEY_MINION) || 'auto'; }
  function minionPacks() {
    const s = minionSetting();
    if (s === 'parent') return [];
    const list = s === 'auto' ? packs.filter((p) => !p.themed && /^mob/i.test(p.id)) : [packById(s)].filter(Boolean);
    return list.map((p) => ({ id: p.id, name: p.name, actions: packUrls(p) }));
  }

  // 이 프로젝트 지정 해제 — 전체 설정을 따른다
  function clearProjectPack(projectId) { if (projectId) del(projectPackKey(projectId)); }

  window.PetAvatar = {
    loadFiles, resolve, mode, globalMode, themeInfo, themePack, uploadCustom, importPack, usePack, clearProjectPack,
    packs: () => packs.slice(),
    themeDir: () => themeDir,
    projectPack: (pid) => (pid ? get(projectPackKey(pid)) || '' : ''),
    globalPack: () => get(KEY_PACK) || '',
    minionSetting, minionPacks,
    setMinion: (v) => set(KEY_MINION, String(v || 'auto')),
    setMode: (m, projectId) => { if (MODES.includes(m)) set(projectId ? projectModeKey(projectId) : KEY_MODE, m); },
    hasCustom: (projectId) => { const f = customFile(projectId); return !!(f && files.includes(f)); },
    isImage: (file) => !!(file && IMG_RE.test(file.name || '')),
  };
})();

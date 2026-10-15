'use strict';
/**
 * 펫 팩 — 동작별 움직이는 이미지 묶음(폴더)을 가져와 사용자 PC 에 둔다.
 *
 * 팩 폴더 형식 (manifest.json):
 *   { "size": [256,256], "actions": { "idle": { "gif": "idle.gif", "webp": "idle.webp" }, ... } }
 * 동작마다 webp(반투명 테두리 보존) → gif → png 순으로 하나만 고른다.
 *
 * 캐릭터 이미지는 저작권이 있을 수 있으므로 저장소·설치파일에 넣지 않는다.
 * 가져온 팩은 ~/.claude-terminal-hub/pet-packs/<id>/ 에만 있다.
 * manifest 가 가리키는 이름만 복사한다 — 폴더 밖(../)이나 다른 확장자는 무시.
 */
const fs = require('fs');
const path = require('path');

const ACTION_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(webp|gif|png)$/i;
const FORMAT_ORDER = ['webp', 'gif', 'png'];
const MAX_FILE = 8 * 1024 * 1024;
const MAX_ACTIONS = 32;

function packSlug(dir) {
  const base = path.basename(String(dir || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '');
  const s = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'pack';
}

function readManifest(dir) {
  let m;
  try { m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); }
  catch { throw new Error('manifest.json 이 없거나 읽을 수 없습니다 — 펫 팩 폴더를 골라 주세요'); }
  if (!m || typeof m !== 'object' || !m.actions || typeof m.actions !== 'object') {
    throw new Error('manifest.json 에 actions 가 없습니다');
  }
  return m;
}

// 동작 하나에 쓸 파일 — 이름이 안전하고 실제로 있고 크기가 적당한 것 중 선호 형식 순.
function pickFile(dir, entry) {
  if (!entry || typeof entry !== 'object') return null;
  for (const fmt of FORMAT_ORDER) {
    const name = entry[fmt];
    if (typeof name !== 'string' || !FILE_RE.test(name)) continue;
    const full = path.join(dir, name);
    try {
      // lstat — 심볼릭 링크로 다른 파일(예: 비밀키)을 끌어오지 못하게 링크는 받지 않는다
      const st = fs.lstatSync(full);
      if (st.isFile() && !st.isSymbolicLink() && st.size > 0 && st.size <= MAX_FILE) return name;
    } catch { /* 없음 */ }
  }
  return null;
}

/** 팩 폴더를 destRoot/<id>/ 로 복사한다. @returns {{id, name, actions:{동작:파일명}}} */
function importPack(srcDir, destRoot) {
  const src = path.resolve(String(srcDir || ''));
  let st;
  try { st = fs.statSync(src); } catch { st = null; }
  if (!st || !st.isDirectory()) throw new Error('폴더를 찾을 수 없습니다');
  // 가져온 팩 폴더(또는 그 위·아래)를 다시 고르면 복사 전에 지워 버리게 된다
  const root = path.resolve(destRoot);
  const rel = path.relative(root, src);
  const inside = !rel || (!rel.startsWith('..') && !path.isAbsolute(rel));
  const outside = path.relative(src, root);
  if (inside || (!outside.startsWith('..') && !path.isAbsolute(outside))) {
    throw new Error('이미 가져온 펫 팩 폴더입니다 — 처음 받은 원본 폴더를 골라 주세요');
  }
  const manifest = readManifest(src);

  const actions = {};
  for (const [name, entry] of Object.entries(manifest.actions).slice(0, MAX_ACTIONS)) {
    if (!ACTION_RE.test(name)) continue;
    const file = pickFile(src, entry);
    if (file) actions[name] = file;
  }
  if (!Object.keys(actions).length) throw new Error('쓸 수 있는 동작 이미지가 없습니다 (webp·gif·png)');

  const id = packSlug(src);
  const dest = path.join(root, id);
  // 임시 폴더에 다 복사한 뒤 바꿔 끼운다 — 중간에 실패해도 옛 팩은 남는다
  const tmp = `${dest}.tmp-${Date.now()}`;
  try {
    fs.mkdirSync(tmp, { recursive: true });
    for (const file of new Set(Object.values(actions))) fs.copyFileSync(path.join(src, file), path.join(tmp, file));
    const size = Array.isArray(manifest.size) ? manifest.size.slice(0, 2).map(Number).filter(Number.isFinite) : undefined;
    fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({ name: id, size, actions }, null, 2));
    fs.rmSync(dest, { recursive: true, force: true });   // 다시 가져오면 옛 파일 정리
    fs.renameSync(tmp, dest);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return { id, name: id, actions };
}

/** 가져온 팩 목록 — manifest 가 멀쩡한 폴더만. */
function listPacks(root) {
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !/\.tmp-\d+$/.test(d.name)).map((d) => d.name);
  } catch { return []; }
  const out = [];
  for (const id of dirs.sort()) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(root, id, 'manifest.json'), 'utf8'));
      const actions = {};
      for (const [a, f] of Object.entries((m && m.actions) || {})) {
        if (ACTION_RE.test(a) && typeof f === 'string' && FILE_RE.test(f)) actions[a] = f;
      }
      if (Object.keys(actions).length) out.push({ id, name: (m && typeof m.name === 'string' && m.name) || id, actions });
    } catch { /* manifest 없는 폴더는 건너뛴다 */ }
  }
  return out;
}

module.exports = { importPack, listPacks, packSlug };

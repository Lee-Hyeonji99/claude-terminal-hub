'use strict';
/**
 * 펫 — 바탕화면 맨 앞에 떠 있는 작은 창. **프로젝트(작업 경로)마다 하나**씩 뜬다.
 * 그 프로젝트 세션에 Claude 질문이 뜨거나 작업이 끝나면 카드로 알려 주고,
 * 카드에서 고르거나 글을 써 보내거나 «보기» 로 허브의 그 세션을 연다.
 *
 * - 알림을 모으는 건 허브 창(public/pet-bridge.js)이다. 이 파일은 창 관리와 두 창 사이 전달만 한다.
 * - 배치는 electron/pet-layout.js — 펫은 화면 어디든 놓이고, 카드는 자리가 있는 쪽으로 펼친다.
 * - 투명 창의 빈 곳도 클릭을 먹으므로 창 자체를 «펫 + 카드» 크기에 맞춘다.
 * - 펫마다 «숨기기» 하면 그 프로젝트에 새 알림이 올 때 다시 나타난다. 전체 숨기기는 Ctrl+Alt+P.
 */
const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { computeLayout, clampPet, PET_BOX } = require('./pet-layout');
const { bringToFront } = require('./focus-main');

const MAX_CARD = { w: 420, h: 640 };
const SPACING = 12;
const SHORTCUT = 'CommandOrControl+Alt+P';
const statePath = () => path.join(app.getPath('userData'), 'pet.json');

function loadState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')) || {}; } catch { return {}; }
}
function saveState(st) {
  try { fs.writeFileSync(statePath(), JSON.stringify(st)); } catch { /* 위치 기억 실패는 무시 */ }
}

const notifySig = (proj) => [...proj.questions.map((q) => q.sig), ...proj.done.map((d) => `${d.key}@${d.at}`)].join('|');

function initPet({ url, mainWin }) {
  const st = { visible: true, anchors: {}, hidden: {}, ...loadState() };
  st.anchors = st.anchors || {};
  st.hidden = st.hidden || {};
  // 옛 상태(펫 하나, 오른쪽 아래 기준점) → 첫 펫 자리로 이어 쓴다
  const legacy = st.anchor && Number.isFinite(st.anchor.right) ? { x: st.anchor.right - PET_BOX, y: st.anchor.bottom - PET_BOX } : null;
  delete st.anchor;

  const pets = new Map();   // projectId -> { id, win, card:{w,h}, data, sig, drag }
  let projects = [];

  const persist = () => saveState(st);
  const displayFor = (a) => screen.getDisplayNearestPoint({ x: Math.round(a.x + PET_BOX / 2), y: Math.round(a.y + PET_BOX / 2) });

  // 새 펫 자리: 주 모니터 오른쪽 아래에서 왼쪽으로 줄지어. 다른 펫과 겹치지 않게.
  function freshAnchor() {
    if (legacy && !Object.keys(st.anchors).length) return { ...legacy };
    const wa = screen.getPrimaryDisplay().workArea;
    const taken = Object.values(st.anchors);
    for (let i = 0; i < 40; i++) {
      const a = { x: wa.x + wa.width - 24 - PET_BOX - i * (PET_BOX + SPACING), y: wa.y + wa.height - 24 - PET_BOX };
      if (a.x < wa.x) break;
      if (!taken.some((t) => Math.abs(t.x - a.x) < PET_BOX && Math.abs(t.y - a.y) < PET_BOX)) return a;
    }
    return { x: wa.x + wa.width - 24 - PET_BOX, y: wa.y + wa.height - 24 - PET_BOX };
  }
  function anchorOf(id) {
    if (!st.anchors[id]) { st.anchors[id] = freshAnchor(); persist(); }
    return st.anchors[id];
  }

  function place(pet) {
    if (!pet.win || pet.win.isDestroyed()) return;
    const a = anchorOf(pet.id);
    const d = displayFor(a);
    const L = computeLayout({ anchor: a, card: pet.card, workArea: d.workArea, bounds: d.bounds });
    try { pet.win.webContents.send('pet:layout', L.local); } catch {}
    pet.win.setBounds(L.window);
  }
  function sendState(pet) {
    if (pet.win && !pet.win.isDestroyed()) { try { pet.win.webContents.send('pet:state', pet.data); } catch {} }
  }

  function createWindow(pet) {
    const a = anchorOf(pet.id);
    const win = new BrowserWindow({
      x: Math.round(a.x), y: Math.round(a.y), width: PET_BOX, height: PET_BOX,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true, show: false, title: `Claude Pet — ${pet.data.project.name}`,
      webPreferences: { contextIsolation: true, spellcheck: false, preload: path.join(__dirname, 'pet-preload.js') },
    });
    pet.win = win;
    // 'screen-saver' 단계라야 다른 앱의 항상-위 창보다도 앞에 선다.
    win.setAlwaysOnTop(true, 'screen-saver');
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
    win.loadURL(`${url}/pet.html`);
    win.webContents.on('will-navigate', (e, to) => { if (!to.startsWith(url)) e.preventDefault(); });
    // 펫이 뜰 때 하던 작업의 포커스를 뺏지 않는다.
    win.once('ready-to-show', () => { place(pet); if (shouldShow(pet)) win.showInactive(); });
    win.webContents.on('did-finish-load', () => { place(pet); sendState(pet); });
    win.on('closed', () => { if (pet.win === win) pet.win = null; });
  }

  const shouldShow = (pet) => st.visible && !st.hidden[pet.id];
  function applyVisibility(pet) {
    if (!pet.win || pet.win.isDestroyed()) { if (shouldShow(pet)) createWindow(pet); return; }
    if (shouldShow(pet)) { if (!pet.win.isVisible()) pet.win.showInactive(); }
    else if (pet.win.isVisible()) pet.win.hide();
  }
  function destroyPet(pet) {
    if (pet.win && !pet.win.isDestroyed()) pet.win.destroy();
    pets.delete(pet.id);
  }

  // ---- 허브 → 펫: 프로젝트 목록 ----
  function syncProjects(list) {
    projects = Array.isArray(list) ? list : [];
    const alive = new Set(projects.map((p) => p.id));
    for (const pet of [...pets.values()]) if (!alive.has(pet.id)) destroyPet(pet);
    for (const proj of projects) {
      const data = { project: { id: proj.id, name: proj.name, cwd: proj.cwd, hue: proj.hue, theme: proj.theme }, working: proj.working || 0, questions: proj.questions, done: proj.done, sessions: proj.sessions || [] };
      let pet = pets.get(proj.id);
      if (!pet) { pet = { id: proj.id, win: null, card: null, data, sig: '', drag: null }; pets.set(proj.id, pet); }
      pet.data = data;
      // 숨겨 둔 펫도 새 알림이 오면 다시 나온다
      const sig = notifySig(proj);
      if (sig && sig !== pet.sig && st.hidden[proj.id]) { delete st.hidden[proj.id]; persist(); }
      pet.sig = sig;
      applyVisibility(pet);
      sendState(pet);
    }
  }

  function setVisible(v) {
    st.visible = !!v;
    if (st.visible) st.hidden = {};   // 전체 꺼내기는 하나씩 숨긴 펫도 꺼낸다
    persist();
    pets.forEach(applyVisibility);
    if (mainWin && !mainWin.isDestroyed()) { try { mainWin.webContents.send('pet:visible', st.visible); } catch {} }
  }

  const petOf = (e) => {
    for (const pet of pets.values()) if (pet.win && !pet.win.isDestroyed() && pet.win.webContents === e.sender) return pet;
    return null;
  };

  ipcMain.on('pet:state', (_e, payload) => syncProjects(payload && payload.projects));
  // 결과는 모든 펫에 — 각 펫이 제 세션 것만 받는다
  ipcMain.on('pet:result', (_e, r) => pets.forEach((pet) => { if (pet.win && !pet.win.isDestroyed()) pet.win.webContents.send('pet:result', r); }));
  ipcMain.on('pet:toggle', () => setVisible(!st.visible));
  ipcMain.handle('pet:visible', () => st.visible);

  const bringMainToFront = () => bringToFront(mainWin);

  // ---- 펫 → 허브 ----
  ipcMain.on('pet:answer', (_e, payload) => {
    if (payload && payload.action && payload.action.type === 'focus') bringMainToFront();
    if (mainWin && !mainWin.isDestroyed()) { try { mainWin.webContents.send('pet:answer', payload); } catch {} }
  });
  ipcMain.on('pet:hide', (e) => {
    const pet = petOf(e);
    if (!pet) return;
    st.hidden[pet.id] = true;
    persist();
    applyVisibility(pet);
  });
  ipcMain.on('pet:resize', (e, s) => {
    const pet = petOf(e);
    if (!pet || !s) return;
    const w = Math.min(MAX_CARD.w, Math.ceil(Number(s.w) || 0));
    const h = Math.min(MAX_CARD.h, Math.ceil(Number(s.h) || 0));
    const opened = !pet.card && w > 0 && h > 0;
    pet.card = w > 0 && h > 0 ? { w, h } : null;
    place(pet);
    // 카드를 펼친 펫을 다른 펫 창보다 앞으로 — 안 그러면 옆 펫이 카드 위에 비쳐 보인다
    if (opened && pet.win && !pet.win.isDestroyed()) pet.win.moveTop();
  });
  // 드래그 — 렌더러 좌표 대신 OS 커서 위치를 쓴다(배율이 다른 모니터 사이에서도 맞는다).
  ipcMain.on('pet:drag-start', (e) => {
    const pet = petOf(e);
    if (pet) pet.drag = { cursor: screen.getCursorScreenPoint(), anchor: { ...anchorOf(pet.id) } };
  });
  ipcMain.on('pet:drag', (e) => {
    const pet = petOf(e);
    if (!pet || !pet.drag) return;
    const c = screen.getCursorScreenPoint();
    st.anchors[pet.id] = { x: pet.drag.anchor.x + (c.x - pet.drag.cursor.x), y: pet.drag.anchor.y + (c.y - pet.drag.cursor.y) };
    place(pet);
  });
  ipcMain.on('pet:drag-end', (e) => {
    const pet = petOf(e);
    if (!pet || !pet.drag) return;
    pet.drag = null;
    const a = st.anchors[pet.id];
    st.anchors[pet.id] = clampPet(a, displayFor(a).bounds); // 놓인 화면 안으로만 맞춘다
    persist();
    place(pet);
  });

  try { globalShortcut.register(SHORTCUT, () => setVisible(!st.visible)); } catch { /* 다른 앱이 쓰고 있으면 버튼으로만 */ }
  app.on('will-quit', () => { try { globalShortcut.unregister(SHORTCUT); } catch {} });
  // 모니터 구성이 바뀌면(분리 등) 화면 밖에 남은 펫을 다시 들인다.
  screen.on('display-removed', () => pets.forEach((pet) => {
    const a = st.anchors[pet.id];
    if (a) st.anchors[pet.id] = clampPet(a, displayFor(a).bounds);
    place(pet);
  }));

  // 허브 창을 닫으면 펫도 닫아야 앱이 끝난다(window-all-closed).
  mainWin.on('closed', () => { [...pets.values()].forEach(destroyPet); });

  return { toggle: () => setVisible(!st.visible) };
}

module.exports = { initPet, PET_SHORTCUT: SHORTCUT };

'use strict';
/**
 * 작업실 그리기 — 자리 배치는 public/room-view.js, 데이터는 허브(pet-bridge.js)가 main 을 거쳐 준다.
 * 배치가 바뀔 때만 캐릭터 층을 다시 만들고(움직이는 이미지가 처음부터 다시 돌지 않게),
 * 시계 · 하늘 · 타이머는 1초마다 글자와 위치만 바꾼다. 사용자 문자열은 textContent 로만 넣는다.
 * 캐릭터(data-mover)는 자리가 바뀌면 걸어서 옮겨 간다 — 새로 생기면 문으로 들어오고, 사라지면 문으로 나간다.
 */
(function () {
  const api = window.roomApi;
  const RV = window.RoomView;
  const HV = window.HudView;
  const Avatar = window.PetAvatar;
  const BASE_W = RV.STAGE.w;
  const A = (f) => `/room-assets/${f}`;
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), dyn = $('dyn'), ghosts = $('ghosts');

  let items = [];
  let lastSig = '';

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const img = (src, style, cls) => {
    const i = el('img', cls);
    i.src = src; i.alt = ''; i.draggable = false;
    if (style) i.style.cssText = style;
    return i;
  };
  const at = (node, x, y) => { node.style.left = `${Math.round(x)}px`; node.style.top = `${Math.round(y)}px`; return node; };
  const onPick = (node, key) => {
    if (!key) return node;
    node.classList.add('click');
    node.addEventListener('click', () => api && api.focus(key));
    return node;
  };

  /* ---- 캐릭터 이미지 — 프로젝트 펫(pet-avatar.js), 없으면 기본 동그라미 ---- */
  const blob = (hue) => `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 12c22 0 38 17 38 40 0 21-15 36-38 36S12 73 12 52c0-23 16-40 38-40z" fill="hsl(${Number(hue) || 0} 72% 66%)"/><ellipse cx="38" cy="50" rx="5" ry="7" fill="#2a160c"/><ellipse cx="62" cy="50" rx="5" ry="7" fill="#2a160c"/></svg>`;
  function petUrl(projectId, theme, actions) {
    if (!Avatar) return null;
    let r = null;
    try { r = Avatar.resolve(projectId, theme); } catch { return null; }
    if (r && r.mode === 'pack' && r.pack && r.pack.actions) {
      const acts = r.pack.actions;
      const a = actions.find((x) => acts[x]) || Object.keys(acts)[0];
      return acts[a] || null;
    }
    return (r && r.url) || null;
  }
  function sprite(who, actions, size, cls) {
    const url = petUrl(who.projectId, who.theme, actions);
    if (url) return img(url, `width:${size}px;height:${size}px`, cls);
    const b = el('span', `blob ${cls || ''}`);
    b.style.cssText = `display:block;width:${size * 0.8}px;height:${size * 0.8}px;margin:${size * 0.1}px`;
    b.innerHTML = blob(who.hue);   // 정해진 SVG — 사용자 문자열 없음
    return b;
  }
  function minionSprite(desk, m, size) {
    const pack = RV.minionPick(Avatar ? Avatar.minionPacks() : [], m.id);
    if (pack) {
      const a = pack.actions;
      const url = (m.state === 'done' ? a.happy : a.walk) || a.idle || Object.values(a)[0];
      if (url) return img(url, `width:${size}px;height:${size}px`);
    }
    return sprite(desk, m.state === 'done' ? ['happy', 'idle'] : ['walk', 'idle'], size);   // 꼬마 팩이 없으면 부모 펫을 작게
  }

  /* ---- 장면 ---- */
  function drawDesk(d, root) {
    const pet = el('div', 'type abs');
    pet.append(sprite(d, ['idle'], 104, 'glow'));
    root.append(mover(onPick(at(pet, d.x + 8, d.y - 90), d.sessionKey), `p:${d.projectKey}`, d.projectKey));
    root.append(at(img(A('work-desk.png'), 'width:200px;height:110px', 'abs'), d.x, d.y));
    root.append(at(img(A('paper-stack-2.png'), 'width:36px;height:40px', 'abs'), d.x + 6, d.y - 38));
    root.append(at(img(A('monitor-on.png'), 'width:100px;height:70px', 'abs'), d.x + 98, d.y - 68));
    const label = el('div', 'pet o');
    label.style.width = '220px';
    const head = el('div');
    head.append(el('b', 'tag', d.name), document.createTextNode(' '), el('span', 'mono t-since', ''));
    head.querySelector('.t-since').dataset.since = String(d.since || 0);
    head.querySelector('b').style.color = '#f6d79c';
    head.querySelector('.t-since').style.color = '#f0b44c';
    label.append(head, el('span', 'sub', d.tool || d.title));
    root.append(at(label, d.x - 10, d.y - 116));
    d.minions.forEach((m, j) => {
      const w = el('div', `pet minion is-${m.state} ${m.state === 'work' ? (j % 2 ? 'walk2' : 'walk') : ''}`);
      if (m.state === 'work' && m.tool) w.append(el('div', 'bubble', `${m.tool}${m.target ? ' · ' + m.target : ''}`));
      if (m.state === 'done') w.append(img(A('fx-check.png'), 'width:20px;height:20px'));
      w.append(minionSprite(d, m, 50));
      const tag = el('span', 'tag o', m.type);
      if (m.state === 'work') { const t = el('span', 'mono t-since'); t.dataset.since = String(m.since || 0); tag.append(' ', t); }
      w.append(tag);
      root.append(mover(onPick(at(w, m.x, m.y), d.sessionKey), `m:${m.id}`, d.projectKey, true));
    });
    if (d.extraMinions) root.append(at(el('div', 'more o abs', `+${d.extraMinions}`), d.x + 206, d.y + 170));
  }

  // crowded: 줄이 길어 촘촘하면 이름 · 대기 시간은 맨 앞만 글자로, 나머지는 마우스를 올리면(title)
  function drawQueue(q, i, root, crowded) {
    const w = el('div', `pet ${i === 0 ? 'tap' : 'sway'}`);
    const label = q.kind === 'permission' ? `${q.name} · 권한` : q.name;
    const quiet = crowded && i > 0;
    w.title = `${label}\n${q.text || ''}`;
    if (!quiet) {
      const name = el('span', 'tag o', label);
      name.style.color = q.kind === 'permission' ? '#ffd9a8' : '#e2c7ff';
      w.append(name);
    }
    const body = el('div');
    body.style.cssText = `position:relative;width:${q.size}px;height:${q.size}px`;
    body.append(sprite(q, ['pose', 'look-around', 'idle'], q.size));
    const docW = Math.round(q.size * 0.54);
    body.append(img(A(q.kind === 'permission' ? 'doc-permission.png' : 'doc-question.png'),
      `position:absolute;left:${Math.round((q.size - docW) / 2)}px;top:${Math.round(q.size * 0.6)}px;width:${docW}px;height:${Math.round(docW * 0.53)}px;transform:rotate(${i % 2 ? 6 : -7}deg)`));
    if (i === 0) body.append(img(A('fx-sweat.png'), 'position:absolute;right:16px;top:20px;width:14px;height:18px', 'drop'));
    w.append(body);
    if (!quiet) {
      const t = el('span', 'mono o t-wait');
      t.dataset.since = String(q.since || 0);
      t.style.color = '#e2c7ff';
      w.append(t);
    }
    root.append(mover(onPick(at(w, q.x, q.y - (quiet ? 0 : 18)), q.key), `q:${q.key}`, q.projectKey));
  }

  function drawPaper(p, root) {
    const box = el('div', 'paper');
    box.style.cssText = 'width:150px;height:80px';
    box.append(img(A(p.kind === 'permission' ? 'doc-permission.png' : 'doc-question.png'), 'position:absolute;inset:0;width:150px;height:80px'));
    const txt = el('div', 'txt');
    txt.append(el('b', `k-${p.kind}`, `${p.kind === 'permission' ? '권한' : '질문'} · ${p.name}`));
    txt.append(el('span', 'q', p.text));
    if (p.options.length) txt.append(el('span', 'opts', p.options.map((o, i) => `${i + 1} ${o}`).join(' · ')));
    box.append(txt);
    root.append(onPick(at(box, 1530, 598), p.key));
  }

  // 3명까지는 이름을 소파 아래에, 붙어 앉으면 이름은 마우스를 올리면(title)
  function drawSofa(s, root, named) {
    const w = el('div', 'pet');
    w.title = s.name;
    w.append(sprite(s, ['sleepy', 'idle'], s.size));
    root.append(mover(onPick(at(w, s.x, s.y), s.sessionKey), `p:${s.projectKey}`, s.projectKey));
    if (!named) return;
    const n = el('span', 'tag o', s.name);
    n.style.cssText = `position:absolute;font-size:10.5px;color:#d5dbe5;width:${s.size}px;text-align:center;overflow:hidden;text-overflow:ellipsis`;
    root.append(at(n, s.x, 344));
  }

  /* ---- 드나들기 — 그리기 전 자리를 기억했다가, 새 자리로 걸어가게 한다 ---- */
  const WALK_PX_PER_S = 260;
  let firstDraw = true;
  let doorTimer = 0;
  function mover(node, id, projectKey, small) {
    node.dataset.mover = id;
    node.dataset.project = projectKey || '';
    if (small) node.dataset.small = '1';
    return node;
  }
  const doorSpot = (small) => (small ? { x: RV.DOOR.x + 26, y: RV.DOOR.y + 50 } : RV.DOOR);
  function openDoor(ms) {
    $('door').src = A('door-open.png');
    clearTimeout(doorTimer);
    doorTimer = setTimeout(() => { $('door').src = A('door-closed.png'); }, ms + 500);
  }
  /** from → 지금 자리(style.left/top)로 걸어간다. 걸린 시간(ms)을 돌려준다 */
  function walk(node, from, done) {
    const to = { x: parseFloat(node.style.left) || 0, y: parseFloat(node.style.top) || 0 };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    if (dist < 2) { if (done) done(); return 0; }
    const ms = Math.round(Math.min(5000, Math.max(500, (dist / WALK_PX_PER_S) * 1000)));
    node.classList.remove('moving');
    at(node, from.x, from.y);
    void node.offsetWidth;   // 시작 자리를 먼저 그리게
    node.style.transitionDuration = `${ms}ms`;
    node.classList.add('moving');
    at(node, to.x, to.y);
    setTimeout(() => { node.classList.remove('moving'); if (done) done(); }, ms + 50);
    return ms;
  }
  /** 지금 화면의 캐릭터 자리 — 걷는 중이면 걷고 있는 그 자리 */
  function snapshot() {
    const pos = new Map(), nodes = new Map();
    dyn.querySelectorAll('[data-mover]').forEach((n) => {
      const cs = getComputedStyle(n);
      pos.set(n.dataset.mover, { x: parseFloat(cs.left) || 0, y: parseFloat(cs.top) || 0 });
      nodes.set(n.dataset.mover, n);
    });
    return { pos, nodes };
  }
  function animateMoves(before) {
    const now = new Map();
    dyn.querySelectorAll('[data-mover]').forEach((n) => now.set(n.dataset.mover, n));
    // 처음 열 때(첫 데이터가 올 때까지)는 다들 이미 자리에 있다
    if (firstDraw) { if (now.size) firstDraw = false; return; }
    const projects = new Set([...now.values()].map((n) => n.dataset.project));
    let doorMs = 0;
    // 들어오기 · 자리 바꾸기
    for (const [id, n] of now) {
      let from = before.pos.get(id);
      if (!from && id.startsWith('q:')) from = before.pos.get(`p:${n.dataset.project}`);   // 자리에서 일어나 줄 서러
      if (!from) { from = doorSpot(!!n.dataset.small); doorMs = Math.max(doorMs, walk(n, from)); continue; }
      walk(n, from);
    }
    // 나가기 — 프로젝트가 닫혔거나 서브에이전트가 끝났으면 문으로, 질문을 마쳤으면 제자리로
    for (const [id, old] of before.nodes) {
      if (now.has(id)) continue;
      const ghost = old;
      ghost.classList.remove('click');
      ghosts.append(ghost);
      at(ghost, before.pos.get(id).x, before.pos.get(id).y);
      const back = id.startsWith('q:') && now.get(`p:${ghost.dataset.project}`);
      const target = back ? { x: parseFloat(back.style.left), y: parseFloat(back.style.top) }
        : (id.startsWith('m:') || !projects.has(ghost.dataset.project)) ? doorSpot(!!ghost.dataset.small) : null;
      if (!target) { ghost.remove(); continue; }
      const from = before.pos.get(id);
      at(ghost, target.x, target.y);
      const ms = walk(ghost, from, () => ghost.remove());
      if (!back) doorMs = Math.max(doorMs, ms);
    }
    if (doorMs) openDoor(doorMs);
  }

  function draw(layout) {
    const before = snapshot();
    dyn.textContent = '';
    const root = document.createDocumentFragment();
    layout.desks.forEach((d) => drawDesk(d, root));
    if (layout.extraWork) root.append(at(el('div', 'more o abs', `작업 중 +${layout.extraWork}곳`), 960, 560));
    const named = layout.sofa.length <= 6;
    layout.sofa.forEach((s) => drawSofa(s, root, named));
    if (!named) root.append(at(el('div', 'tag o abs', `쉬는 중 ${layout.stats.rest}곳`), 1210, 344));
    if (layout.sofa.length) root.append(at(img(A('fx-zzz.png'), 'width:30px;height:30px', 'zz abs'), 1410, 196));
    if (layout.extraRest) root.append(at(el('div', 'more o abs', `+${layout.extraRest}`), 1436, 312));
    if (layout.paper) drawPaper(layout.paper, root);
    const crowded = layout.queue.length > 7;
    layout.queue.forEach((q, i) => drawQueue(q, i, root, crowded));
    if (layout.extraAsk) root.append(at(el('div', 'more o abs', `줄 +${layout.extraAsk}`), 4, 840));
    dyn.append(root);
    animateMoves(before);

    const { count, firstKey } = layout.inbox;
    const papers = $('inboxPapers');
    papers.textContent = '';
    for (let i = 0; i < Math.min(count, 3); i++) papers.append(img(A('inbox-paper.png'), `position:absolute;left:7px;top:${16 + i * 5}px;width:56px;height:8px;transform:rotate(${i % 2 ? 2 : -3}deg)`));
    $('inboxBadge').hidden = !count;
    $('inboxBadge').textContent = String(count);
    $('inbox').onclick = () => { if (firstKey && api) api.focus(firstKey); };

    const b = $('board');
    b.textContent = '';
    const st = layout.stats;
    b.append(el('b', null, '지금'));
    b.append(el('span', null, `작업 ${st.work}곳 · 질문 ${st.ask} · 쉬는 중 ${st.rest}`));
    b.append(el('span', null, `서브에이전트 ${st.subs}명 출동 중`));
    b.append(el('span', null, `결재함 ${st.done}건`));
    $('empty').hidden = !!items.length;
  }

  /* ---- 하늘 · 조명 (1초마다, 실제로는 분 단위로만 바뀐다) ---- */
  const STARS = [[14, 14], [50, 34], [86, 10], [120, 26], [160, 16], [30, 70], [104, 60], [150, 78]];
  function buildSky() {
    const sky = $('sky');
    STARS.forEach(([x, y], i) => { const s = img(A('star.png'), '', 'star'); at(s, x, y); s.style.animationDelay = `${i * 0.3}s`; sky.append(s); });
    sky.append(img(A('cloud-1.png'), 'top:36px;width:64px;height:21px', 'cloud'));
    const c2 = img(A('cloud-2.png'), 'top:72px;width:50px;height:17px;animation-delay:-40s', 'cloud');
    sky.append(c2);
    const sun = img(A('sun.png'), 'position:absolute;width:30px;height:30px');
    sun.id = 'sun';
    const moon = img(A('moon.png'), 'position:absolute;width:26px;height:26px');
    moon.id = 'moon';
    sky.append(sun, moon);
  }
  let lastMinute = -1;
  function paintSky(date) {
    const minute = date.getHours() * 60 + date.getMinutes();
    if (minute === lastMinute) return;
    lastMinute = minute;
    const s = RV.skyAt(minute);
    $('sky').style.background = `linear-gradient(${s.top},${s.bottom})`;
    $('sky').querySelectorAll('.star').forEach((x) => { x.style.opacity = String(s.starAlpha); });
    $('sky').querySelectorAll('.cloud').forEach((x) => { x.style.opacity = String(s.cloudAlpha); });
    const sun = $('sun'), moon = $('moon');
    sun.hidden = !s.isDay; moon.hidden = s.isDay;
    sun.src = A(s.sunLow ? 'sun-low.png' : 'sun.png');
    at(sun, s.sun.x, s.sun.y); at(moon, s.moon.x, s.moon.y);
    $('tint').style.background = s.tint;
    $('lamp').src = A(s.lampOn ? 'lamp-on.png' : 'lamp-off.png');
    $('lampGlow').hidden = !s.lampOn;
  }

  function tick() {
    const now = Date.now();
    stage.querySelectorAll('.t-since,.t-wait').forEach((t) => {
      const since = Number(t.dataset.since) || now;
      t.textContent = `${t.classList.contains('t-wait') ? '대기 ' : ''}${HV.clock(now - since)}`;
    });
    paintSky(new Date(now));
  }

  function update() {
    const layout = RV.layoutRoom(items);
    // 타이머 숫자는 빼고 비교 — 배치 · 상태 · 글자가 바뀔 때만 다시 만든다
    const sig = JSON.stringify(layout, (k, v) => (k === 'now' ? undefined : v));
    if (sig !== lastSig) { lastSig = sig; draw(layout); }
    tick();
  }

  // 창 크기에 맞춰 무대를 늘리고 줄인다(창은 비율이 고정돼 있다) + 휠 확대
  let view = { zoom: 1, ox: 0, oy: 0 };
  const baseScale = () => window.innerWidth / BASE_W;
  function fit() {
    stage.style.transform = `scale(${baseScale() * view.zoom}) translate(${-view.ox}px, ${-view.oy}px)`;
    const zoomed = view.zoom > 1.001;
    // 확대 중에는 배경을 끌면 화면이 움직이고(창 옮기기 대신), 모서리에 배율 · 되돌리기 버튼
    document.body.classList.toggle('zoomed', zoomed);
    $('zoomReset').hidden = !zoomed;
    $('zoomReset').textContent = `${Math.round(view.zoom * 100)}%`;
  }
  function setView(v) { view = v; fit(); }
  window.addEventListener('resize', fit);
  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = baseScale();
    setView(RV.zoomAt(view, e.clientX / k, e.clientY / k, e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });
  // 배경 끌기 — 확대 중이면 화면을 옮기고, 아니면 창을 옮긴다.
  // 캐릭터 · 버튼을 누른 건 끌기가 아니다. 끌고 난 뒤의 클릭은 무시한다.
  let pan = null, panned = false;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.click')) return;
    pan = { x: e.clientX, y: e.clientY, window: view.zoom <= 1.001 };
    panned = false;
    stage.setPointerCapture(e.pointerId);
    if (pan.window && api && api.dragStart) api.dragStart();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pan) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) panned = true;
    if (pan.window) { if (api && api.drag) api.drag(); return; }   // 창이 따라 움직이므로 기준점은 그대로
    pan = { ...pan, x: e.clientX, y: e.clientY };
    const k = baseScale();
    setView(RV.panBy(view, dx / k, dy / k));
  });
  const endPan = () => { if (pan && pan.window && api && api.dragEnd) api.dragEnd(); pan = null; };
  stage.addEventListener('pointerup', endPan);
  stage.addEventListener('pointercancel', endPan);
  stage.addEventListener('click', (e) => { if (panned) { e.stopPropagation(); panned = false; } }, true);
  stage.addEventListener('dblclick', (e) => { if (!e.target.closest('.click')) setView({ zoom: 1, ox: 0, oy: 0 }); });
  $('zoomReset').addEventListener('click', () => setView({ zoom: 1, ox: 0, oy: 0 }));

  // ---- 모서리 도구 ----
  const pin = $('pin');
  const markPin = (on) => pin.classList.toggle('on', !!on);
  pin.addEventListener('click', () => { const on = !pin.classList.contains('on'); markPin(on); if (api) api.setTop(on); });
  $('close').addEventListener('click', () => api && api.hide());

  buildSky();
  fit();
  if (api) {
    api.onState((list) => { items = Array.isArray(list) ? list : []; update(); });
    api.onSettings((s) => markPin(s && s.onTop));
  }
  if (Avatar) {
    Avatar.loadFiles().then(() => { lastSig = ''; update(); }).catch(() => {});
    window.addEventListener('storage', (e) => { if (!e.key || /^cth_(theme|proj_themes|pet_)/.test(e.key)) Avatar.loadFiles().then(() => { lastSig = ''; update(); }).catch(() => {}); });
  }
  update();
  setInterval(tick, 1000);
})();

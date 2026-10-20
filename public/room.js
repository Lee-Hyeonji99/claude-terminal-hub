'use strict';
/**
 * 작업실 그리기 — 자리 배치는 public/room-view.js, 데이터는 허브(pet-bridge.js)가 main 을 거쳐 준다.
 * 배치가 바뀔 때만 캐릭터 층을 다시 만들고(움직이는 이미지가 처음부터 다시 돌지 않게),
 * 시계 · 하늘 · 타이머는 1초마다 글자와 위치만 바꾼다. 사용자 문자열은 textContent 로만 넣는다.
 */
(function () {
  const api = window.roomApi;
  const RV = window.RoomView;
  const HV = window.HudView;
  const Avatar = window.PetAvatar;
  const BASE_W = 1120;
  const A = (f) => `/room-assets/${f}`;
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), dyn = $('dyn');

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
    root.append(onPick(at(pet, d.x + 8, d.y - 90), d.sessionKey));
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
      root.append(onPick(at(w, m.x, m.y), d.sessionKey));
    });
    if (d.extraMinions) root.append(at(el('div', 'more o abs', `+${d.extraMinions}`), d.x + 206, d.y + 170));
  }

  function drawQueue(q, i, root) {
    const w = el('div', `pet ${i === 0 ? 'tap' : 'sway'}`);
    const name = el('span', 'tag o', q.kind === 'permission' ? `${q.name} · 권한` : q.name);
    name.style.color = q.kind === 'permission' ? '#ffd9a8' : '#e2c7ff';
    w.append(name);
    const body = el('div');
    body.style.cssText = `position:relative;width:${q.size}px;height:${q.size}px`;
    body.append(sprite(q, ['pose', 'look-around', 'idle'], q.size));
    const docW = Math.round(q.size * 0.54);
    body.append(img(A(q.kind === 'permission' ? 'doc-permission.png' : 'doc-question.png'),
      `position:absolute;left:${Math.round((q.size - docW) / 2)}px;top:${Math.round(q.size * 0.6)}px;width:${docW}px;height:${Math.round(docW * 0.53)}px;transform:rotate(${i % 2 ? 6 : -7}deg)`));
    if (i === 0) body.append(img(A('fx-sweat.png'), 'position:absolute;right:16px;top:20px;width:14px;height:18px', 'drop'));
    w.append(body);
    const t = el('span', 'mono o t-wait');
    t.dataset.since = String(q.since || 0);
    t.style.color = '#e2c7ff';
    w.append(t);
    root.append(onPick(at(w, q.x, q.y - 18), q.key));
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
    root.append(onPick(at(box, 870, 286), p.key));
  }

  function drawSofa(s, root) {
    const w = el('div', 'pet');
    w.append(sprite(s, ['sleepy', 'idle'], 80));
    root.append(onPick(at(w, s.x, s.y), s.sessionKey));
    const n = el('span', 'tag o', s.name);
    n.style.cssText = 'position:absolute;font-size:10.5px;color:#d5dbe5;width:80px;text-align:center;overflow:hidden;text-overflow:ellipsis';
    root.append(at(n, s.x, 344));
  }

  function draw(layout) {
    dyn.textContent = '';
    const root = document.createDocumentFragment();
    layout.desks.forEach((d) => drawDesk(d, root));
    if (layout.extraWork) root.append(at(el('div', 'more o abs', `작업 중 +${layout.extraWork}곳`), 60, 560));
    layout.sofa.forEach((s) => drawSofa(s, root));
    if (layout.sofa.length) root.append(at(img(A('fx-zzz.png'), 'width:30px;height:30px', 'zz abs'), 820, 196));
    if (layout.extraRest) root.append(at(el('div', 'more o abs', `+${layout.extraRest}`), 846, 312));
    if (layout.paper) drawPaper(layout.paper, root);
    layout.queue.forEach((q, i) => drawQueue(q, i, root));
    if (layout.extraAsk) root.append(at(el('div', 'more o abs', `줄 +${layout.extraAsk}`), 380, 600));
    dyn.append(root);

    $('door').src = A(layout.desks.some((d) => d.minions.some((m) => m.state === 'work')) ? 'door-open.png' : 'door-closed.png');
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

  // 창 크기에 맞춰 무대를 늘리고 줄인다(창은 비율이 고정돼 있다)
  function fit() { stage.style.transform = `scale(${window.innerWidth / BASE_W})`; }
  window.addEventListener('resize', fit);

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

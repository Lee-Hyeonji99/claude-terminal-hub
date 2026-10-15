'use strict';
/**
 * 펫 화면 — 프로젝트(작업 경로) 하나의 펫. 허브가 넘겨준 그 프로젝트의 질문·작업 완료를 카드로 보여주고,
 * 고른 답이나 «보기»·«확인» 을 허브에 돌려준다.
 * 창 관리·배치는 electron/pet.js(+pet-layout.js), 알림 모으기·키 입력은 public/pet-bridge.js 담당.
 */
(function () {
  // 브라우저에서는 id="pet" 요소가 window.pet 으로 노출될 수 있다.
  const api = window.pet && typeof window.pet.onState === 'function' ? window.pet : null;
  const $ = (id) => document.getElementById(id);
  const card = $('card'), petEl = $('pet'), badge = $('badge'), petBox = $('petBox'), ptag = $('ptag');
  const petImg = $('petImg'), petSvg = $('petSvg');
  const Avatar = window.PetAvatar;
  const BASE_HUE = 20;            // 기본 캐릭터(주황)의 색상각 — 프로젝트 색만큼 돌린다

  let project = null;             // { id, name, cwd, hue }
  let list = [];                  // 질문
  let done = [];                  // 작업 완료 { key, title, profile, at }
  let sessions = [];              // 이 프로젝트의 세션 전부 { key, title, profile, state: ask|work|done|idle }
  const seenDone = new Set();
  let idx = 0;
  let open = false;
  let view = 'questions';         // 'questions' | 'done' | 'sessions'(허브로 가기) | 'settings'(캐릭터 바꾸기)
  let typingFor = null;           // 글 입력 중인 선택지 번호 (sig 별)
  let draft = '';
  let msg = { text: '', kind: '' };
  const seen = new Set();         // 이미 알린 질문 — 새 질문만 카드를 펼친다

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const current = () => list[Math.min(idx, list.length - 1)] || null;

  // 말풍선(카드) 색 — 자동이면 윈도우 밝기 설정을 따른다. 모든 펫 공통.
  const CARD_KEY = 'cth_pet_card';
  const CARD_TONES = [['auto', '자동'], ['light', '밝게'], ['dark', '어둡게']];
  function cardTone() { try { const v = localStorage.getItem(CARD_KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch { return 'auto'; } }
  function applyCardTone() {
    const v = cardTone();
    if (v === 'auto') document.documentElement.removeAttribute('data-card');
    else document.documentElement.setAttribute('data-card', v);
  }
  applyCardTone();

  // 드롭다운처럼 — 사용자가 이 펫의 카드를 열면 다른 펫에 열려 있던 카드는 닫는다.
  // 펫 창들은 같은 주소라 localStorage 를 같이 쓰므로 storage 이벤트로 알린다(질문이 와서 저절로 열린 건 알리지 않음).
  const OPEN_KEY = 'cth_pet_open';
  const selfId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  function claimOpen() {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify({ by: selfId, at: Date.now() })); } catch { /* 저장 불가 환경 */ }
  }

  function send(action) {
    const r = current();
    if (!r || !api) return;
    msg = { text: '보내는 중…', kind: '' };
    render();
    api.answer({ key: r.key, sig: r.sig, action });
  }
  // 작업 완료 항목 — 보기(허브에서 그 세션 열기) / 확인(알림만 지우기)
  function sendDone(key, type) {
    if (!api) return;
    done = done.filter((d) => d.key !== key);
    if (!done.length && !list.length) open = false;
    render();
    api.answer({ key, sig: '', action: { type } });
  }

  function renderOptions(r, box) {
    for (const o of r.prompt.options) {
      if (o.isText && typingFor === `${r.sig}#${o.number}`) {
        const wrap = el('div', 'typing');
        const ta = el('textarea');
        ta.placeholder = '답을 입력하세요 — Enter 보내기 · 파일을 끌어다 놓으면 경로가 붙어요';
        ta.value = draft;
        ta.addEventListener('input', () => { draft = ta.value; });
        wireTextareaDrop(ta);
        ta.addEventListener('keydown', (e) => {
          // 한글 조합 중 Enter 는 글자 확정이다 — 그때 보내면 마지막 글자가 빠진다.
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitText(o.number); }
          if (e.key === 'Escape') { typingFor = null; render(); }
        });
        const row = el('div', 'row');
        const cancel = el('button', 'btn', '취소');
        cancel.onclick = () => { typingFor = null; render(); };
        const ok = el('button', 'btn primary', '보내기');
        ok.onclick = () => submitText(o.number);
        row.append(cancel, ok);
        wrap.append(ta, row);
        box.append(wrap);
        setTimeout(() => ta.focus(), 0);
        continue;
      }
      const b = el('button', 'opt' + (o.selected ? ' cur' : ''));
      b.append(el('span', 'n', String(o.number)));
      const t = el('span');
      t.append(el('span', 'l', o.isText ? '직접 입력…' : o.label));
      if (o.desc) t.append(el('span', 'd', o.desc));
      b.append(t);
      b.onclick = () => {
        if (o.isText) { typingFor = `${r.sig}#${o.number}`; draft = ''; render(); return; }
        send({ type: 'select', number: o.number });
      };
      box.append(b);
    }
  }
  function submitText(number) {
    const text = draft.trim();
    if (!text) return;
    typingFor = null;
    draft = '';
    send({ type: 'text', number, text });
  }

  /* ---------- 캐릭터 ---------- */
  // 펫 팩이면 상태에 맞는 동작 이미지로 갈아 끼운다(public/pet-mood.js).
  const Mood = window.PetMood;
  const MOOD_ROLL_MS = 6000;      // 이 간격마다 «가끔 두리번» 주사위를 다시 굴린다
  let packView = null;            // { id, name, scope, actions:{동작:url} }
  let curAction = null;
  let dragging = false;
  let working = 0;
  let lastActivity = Date.now();
  let roll = Math.random();
  function updateAction() {
    if (!packView || !Mood) return;
    const a = Mood.pickAction({
      actions: Object.keys(packView.actions), questions: list.length, done: done.length, working,
      dragging, idleMs: Date.now() - lastActivity, roll,
    });
    if (a && (a !== curAction || petImg.dataset.pack !== packView.id)) {
      curAction = a;
      petImg.dataset.pack = packView.id;
      petImg.src = packView.actions[a];
    }
  }
  setInterval(() => { roll = Math.random(); updateAction(); }, MOOD_ROLL_MS);

  function applyAvatar() {
    const a = Avatar ? Avatar.resolve(project && project.id, project && project.theme) : { url: null };
    packView = a.mode === 'pack' ? a.pack : null;
    petEl.classList.toggle('packed', !!packView);
    if (packView) {
      petImg.hidden = false; petSvg.toggleAttribute('hidden', true);
      updateAction();
      return;
    }
    curAction = null;
    delete petImg.dataset.pack;
    if (a.url) {
      if (petImg.getAttribute('src') !== a.url) petImg.src = a.url;
      petImg.hidden = false; petSvg.toggleAttribute('hidden', true);
    } else {
      petImg.hidden = true; petSvg.toggleAttribute('hidden', false);
    }
  }
  petImg.addEventListener('error', () => { petImg.hidden = true; petSvg.toggleAttribute('hidden', false); });

  function pickImageFile() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/png,image/gif,image/webp,image/jpeg,image/svg+xml';
    inp.onchange = () => takeImage(inp.files && inp.files[0]);
    inp.click();
  }
  async function takeImage(file) {
    if (!file || !Avatar) return;
    try {
      await Avatar.uploadCustom(file, project && project.id);
      msg = { text: '캐릭터를 바꿨어요', kind: 'ok' };
    } catch (e) {
      msg = { text: (e && e.message) || '바꾸지 못했어요', kind: 'err' };
    }
    applyAvatar();
    render();
  }

  // 펫 팩 폴더 가져오기 — 처음 가져온 팩은 모든 펫에, 이미 전체 팩이 있으면 이 펫에만 쓴다.
  async function takePackFolder(folder) {
    if (!folder || !Avatar) return;
    msg = { text: '펫 팩 가져오는 중…', kind: '' };
    render();
    try {
      const p = await Avatar.importPack(folder);
      const scope = project ? 'project' : 'all';   // 펫에 넣은 팩은 그 펫에만 — «모든 펫» 은 목록에서 따로 고른다
      Avatar.usePack(p.id, scope, project && project.id);
      msg = { text: scope === 'project' ? `${p.name} 팩을 이 펫에 썼어요` : `${p.name} 팩을 모든 펫에 썼어요`, kind: 'ok' };
    } catch (e) {
      msg = { text: (e && e.message) || '팩을 가져오지 못했어요', kind: 'err' };
    }
    applyAvatar();
    render();
  }
  async function pickPackFolder() {
    if (!api || !api.pickFolder) return;
    try { const f = await api.pickFolder(); if (f) takePackFolder(f); } catch { /* 취소 */ }
  }

  function renderPackSection(box) {
    box.append(el('div', 't', '펫 팩 — 상태에 따라 움직여요'));
    if (Avatar.themeDir()) box.append(el('div', 'hint', `테마 전용 펫: ${Avatar.themeDir()}${Avatar.themeDir().includes('\\') ? '\\' : '/'}<테마키> 폴더에 넣으면 그 테마에서 자동으로 써요`));
    const pid = project && project.id;
    const mine = Avatar.projectPack(pid);
    const all = Avatar.globalMode() === 'pack' ? Avatar.globalPack() : '';
    const automatic = !mine && Avatar.mode(pid) === 'theme' ? Avatar.themePack(project && project.theme) : null;
    for (const p of Avatar.packs()) {
      const row = el('div', 'packrow' + (p.id === (mine || all || (automatic && automatic.id)) ? ' on' : ''));
      const t = el('span', 'pn');
      t.append(el('span', null, p.name));
      t.append(el('small', null, p.id === mine ? '이 펫에 쓰는 중' : p.id === all ? '모든 펫에 쓰는 중' : automatic && p.id === automatic.id ? '테마에 맞춰 쓰는 중' : `${p.themed ? '테마 팩 · ' : ''}${Object.keys(p.actions).length}가지 동작`));
      const toAll = el('button', 'btn' + (p.id === all ? ' primary' : ''), '모든 펫');
      toAll.onclick = () => { Avatar.usePack(p.id, 'all'); applyAvatar(); render(); };
      row.append(t, toAll);
      if (pid) {
        const toMe = el('button', 'btn' + (p.id === mine ? ' primary' : ''), '이 펫만');
        toMe.onclick = () => { Avatar.usePack(p.id, 'project', pid); applyAvatar(); render(); };
        row.append(toMe);
      }
      box.append(row);
    }
    const acts = el('div', 'row');
    if (mine) {
      const clear = el('button', 'btn', '이 펫 지정 해제');
      clear.title = '모든 펫 설정을 따릅니다';
      clear.onclick = () => { Avatar.clearProjectPack(pid); applyAvatar(); render(); };
      acts.append(clear);
    }
    const imp = el('button', 'btn', '팩 폴더 가져오기…');
    imp.title = 'manifest.json 이 든 펫 팩 폴더';
    imp.onclick = pickPackFolder;
    acts.append(imp);
    box.append(acts);
  }

  function renderSettings() {
    const box = el('div', 'set');
    if (Avatar) renderPackSection(box);
    box.append(el('div', 't', '캐릭터 표시 방식 — 이 펫만'));
    const pid = project && project.id;
    const m = Avatar ? Avatar.mode(pid) : 'default';
    // 이 펫에만 적용 — 단일 이미지를 고르면 이 펫의 팩 지정도 풀어야 바로 보인다
    const pickMode = (mode) => { Avatar.clearProjectPack(pid); Avatar.setMode(mode, pid); applyAvatar(); render(); };
    const { theme, file } = Avatar ? Avatar.themeInfo(project && project.theme) : { theme: null, file: null };
    const builtin = Avatar && Avatar.themePack(project && project.theme);
    const themeSub = builtin ? `${theme ? theme.name : '기본 랏코'} · 상태에 맞춰 7가지 동작으로 움직여요` : !theme ? '허브에서 캐릭터 테마를 고르면 그 캐릭터가 나와요'
      : file ? `지금 테마: ${theme.name}` : `${theme.name} 이미지가 없어요 — 허브 팔레트에서 넣을 수 있어요`;
    const choice = (key, label, sub, onPick) => {
      const b = el('button', 'choice' + (m === key ? ' on' : ''));
      b.append(el('span', 'dot'));
      const t = el('span'); t.append(el('span', null, label)); t.append(el('small', null, sub));
      b.append(t);
      b.onclick = onPick;
      return b;
    };
    box.append(choice('theme', '캐릭터 테마 따라가기', themeSub, () => pickMode('theme')));
    box.append(choice('custom', '내 이미지', Avatar && Avatar.hasCustom(pid) ? '골라 둔 이미지 · 눌러서 다시 고르기' : '이미지를 골라요 (gif 면 움직여요)', () => {
      if (Avatar.hasCustom(pid) && m !== 'custom') pickMode('custom'); else { Avatar.clearProjectPack(pid); pickImageFile(); }
    }));
    box.append(choice('default', '기본 캐릭터', '프로젝트마다 색이 달라요', () => pickMode('default')));
    box.append(el('div', 'hint', '팁: 이미지 파일이나 펫 팩 폴더를 캐릭터 위에 끌어다 놓아도 바뀌어요.'));
    box.append(el('div', 't', '말풍선 색 — 모든 펫'));
    const tones = el('div', 'tones');
    for (const [v, label] of CARD_TONES) {
      const b = el('button', 'btn' + (cardTone() === v ? ' primary' : ''), label);
      b.onclick = () => { try { localStorage.setItem(CARD_KEY, v); } catch { /* 저장 불가 */ } applyCardTone(); render(); };
      tones.append(b);
    }
    box.append(tones);
    const foot = el('div', 'foot');
    foot.append(el('span', 'msg' + (msg.kind ? ' ' + msg.kind : ''), msg.text));
    const back = el('button', 'ib', list.length ? '질문으로' : '닫기');
    back.onclick = () => { view = 'questions'; msg = { text: '', kind: '' }; if (!list.length && !done.length) open = false; render(); };
    const hide = el('button', 'ib', '펫 숨기기');
    hide.onclick = () => api && api.hide();
    foot.append(back, hide);
    card.append(box, foot);
  }

  /* ---------- 파일 끌어다 놓기 ---------- */
  const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
  const quote = (p) => (/\s/.test(p) ? `"${p}"` : p);
  function wireTextareaDrop(ta) {
    ta.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); ta.classList.add('drop-over'); });
    ta.addEventListener('dragleave', () => ta.classList.remove('drop-over'));
    ta.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); e.stopPropagation();
      ta.classList.remove('drop-over');
      const files = Array.from(e.dataTransfer.files || []);
      const paths = api && api.filePath ? files.map((f) => api.filePath(f)).filter(Boolean) : [];
      if (!paths.length) return;
      const s = ta.selectionStart || 0, en = ta.selectionEnd || 0;
      const before = ta.value.slice(0, s);
      const add = (before && !/\s$/.test(before) ? ' ' : '') + paths.map(quote).join(' ');
      ta.value = before + add + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + add.length;
      draft = ta.value;
      ta.focus();
    });
  }
  // 캐릭터 위에 이미지를 놓으면 캐릭터가 바뀐다.
  petEl.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); petEl.classList.add('drop-over'); });
  petEl.addEventListener('dragleave', () => petEl.classList.remove('drop-over'));
  petEl.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation();
    petEl.classList.remove('drop-over');
    const f = (e.dataTransfer.files || [])[0];
    open = true; view = 'settings'; claimOpen();
    if (Avatar && Avatar.isImage(f)) { takeImage(f); return; }
    // 이미지가 아니면 펫 팩 폴더로 본다(manifest.json 이 없으면 서버가 알려준다)
    const folder = f && api && api.filePath ? api.filePath(f) : '';
    if (folder) { takePackFolder(folder); return; }
    msg = { text: '이미지 파일이나 펫 팩 폴더를 놓아 주세요', kind: 'err' };
    render();
  });
  // 받는 칸 밖에 떨어뜨려도 창이 그 파일로 이동하지 않게.
  document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', (e) => { if (hasFiles(e)) e.preventDefault(); });

  const projectLabel = () => (project ? project.name : '');
  const ago = (t) => {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    return s < 60 ? '방금' : s < 3600 ? `${Math.floor(s / 60)}분 전` : `${Math.floor(s / 3600)}시간 전`;
  };
  function renderDone() {
    const head = el('div', 'head');
    const who = el('div', 'who');
    who.append(el('b', null, '작업 완료'));
    who.append(el('span', null, projectLabel()));
    head.append(who);
    if (list.length) {
      const toQ = el('button', 'ib', `질문 ${list.length}`);
      toQ.onclick = () => { view = 'questions'; render(); };
      head.append(toQ);
    }
    head.append(sessionsBtn());
    const close = el('button', 'ib', '접기');
    close.onclick = () => { open = false; render(); };
    head.append(close);
    const scroll = el('div', 'scroll');
    const box = el('div', 'dlist');
    for (const d of done) {
      const row = el('div', 'ditem');
      row.append(el('span', 'ok', '✓'));
      const t = el('div', 'dt');
      t.append(el('b', null, d.title));
      t.append(el('span', null, [ago(d.at), d.profile].filter(Boolean).join(' · ')));
      const view = el('button', 'btn primary', '보기');
      view.onclick = () => sendDone(d.key, 'focus');
      const ok = el('button', 'btn', '확인');
      ok.onclick = () => sendDone(d.key, 'dismiss');
      row.append(t, view, ok);
      box.append(row);
    }
    scroll.append(box);
    const foot = el('div', 'foot');
    foot.append(el('span', 'msg', ''));
    const all = el('button', 'ib', '모두 확인');
    all.onclick = () => { [...done].forEach((d) => sendDone(d.key, 'dismiss')); };
    foot.append(all);
    card.append(head, scroll, foot);
  }

  // 세션 목록 — 하나 고르면 허브 창을 맨 앞으로 올리고 그 프로젝트 탭 · 세션으로 간다
  const STATE_LABEL = { ask: '질문 대기', work: '작업 중', done: '완료', idle: '대기' };
  function focusSession(key) {
    if (!api || !key) return;
    open = false;
    render();
    api.answer({ key, sig: '', action: { type: 'focus' } });
  }
  function sessionsBtn() {
    const b = el('button', 'ib', '세션');
    b.title = '이 프로젝트 세션 목록 — 골라서 허브로 가기';
    b.onclick = () => { view = 'sessions'; render(); };
    return b;
  }
  function renderSessions() {
    const head = el('div', 'head');
    const who = el('div', 'who');
    who.append(el('b', null, '허브에서 열기'));
    who.append(el('span', null, projectLabel()));
    head.append(who);
    if (list.length) {
      const toQ = el('button', 'ib', `질문 ${list.length}`);
      toQ.onclick = () => { view = 'questions'; render(); };
      head.append(toQ);
    }
    const close = el('button', 'ib', '접기');
    close.onclick = () => { open = false; render(); };
    head.append(close);
    const scroll = el('div', 'scroll');
    if (!sessions.length) scroll.append(el('div', 'empty', '이 프로젝트에 열린 세션이 없어요.'));
    const box = el('div', 'slist');
    for (const s of sessions) {
      const row = el('button', 'sitem');
      row.title = '허브에서 이 세션 열기';
      row.append(el('span', 'sdot ' + s.state));
      const t = el('span', 'dt');
      t.append(el('b', null, s.title));
      t.append(el('span', null, [STATE_LABEL[s.state] || '', s.profile].filter(Boolean).join(' · ')));
      row.append(t);
      row.onclick = () => focusSession(s.key);
      box.append(row);
    }
    scroll.append(box);
    const foot = el('div', 'foot');
    foot.append(el('span', 'msg', '오른쪽 클릭 = 캐릭터 바꾸기'));
    const hide = el('button', 'ib', '숨기기');
    hide.title = '이 프로젝트 펫만 숨깁니다 — 새 알림이 오면 다시 나와요';
    hide.onclick = () => api && api.hide();
    foot.append(hide);
    card.append(head, scroll, foot);
  }

  function renderCard() {
    card.textContent = '';
    if (view === 'settings') { renderSettings(); return; }
    if (view === 'sessions') { renderSessions(); return; }
    const r = current();
    if (done.length && (view === 'done' || !r)) { renderDone(); return; }
    if (!r) {
      card.append(el('div', 'empty', `${projectLabel() ? projectLabel() + ' — ' : ''}기다리는 질문이 없어요. 질문이 오거나 작업이 끝나면 여기 뜹니다.`));
      const foot = el('div', 'foot');
      foot.append(el('span', 'msg', 'Ctrl+Alt+P 로 모두 꺼내기/숨기기'));
      const change = el('button', 'ib', '캐릭터 바꾸기');
      change.onclick = () => { view = 'settings'; render(); };
      const hide = el('button', 'ib', '숨기기');
      hide.title = '이 프로젝트 펫만 숨깁니다 — 새 알림이 오면 다시 나와요';
      hide.onclick = () => api && api.hide();
      foot.append(change, hide);
      card.append(foot);
      return;
    }
    const head = el('div', 'head');
    const who = el('div', 'who');
    who.append(el('b', null, r.title));
    who.append(el('span', null, [r.cwd, r.profile].filter(Boolean).join(' · ')));
    if (done.length) {
      const more = el('button', 'ib', `완료 ${done.length}`);
      more.title = '작업이 끝난 세션 보기';
      more.onclick = () => { view = 'done'; render(); };
      who.append(more);
    }
    const prev = el('button', 'ib', '‹'); prev.disabled = idx <= 0;
    prev.onclick = () => { idx--; typingFor = null; render(); };
    const pager = el('span', 'pager', `${idx + 1}/${list.length}`);
    const next = el('button', 'ib', '›'); next.disabled = idx >= list.length - 1;
    next.onclick = () => { idx++; typingFor = null; render(); };
    const close = el('button', 'ib', '접기');
    close.onclick = () => { open = false; render(); };
    head.append(who, prev, pager, next, sessionsBtn(), close);

    const scroll = el('div', 'scroll');
    if (r.prompt.body) scroll.append(el('div', 'tag', r.prompt.body));
    scroll.append(el('p', 'q', r.prompt.question || '선택해 주세요'));
    const opts = el('div', 'opts');
    renderOptions(r, opts);
    scroll.append(opts);

    const foot = el('div', 'foot');
    foot.append(el('span', 'msg' + (msg.kind ? ' ' + msg.kind : ''), msg.text));
    const toTerminal = el('button', 'ib', '터미널에서 보기');
    toTerminal.onclick = () => send({ type: 'focus' });
    const esc = el('button', 'ib', 'Esc 취소');
    esc.title = '이 질문을 취소합니다 (터미널에서 Esc)';
    esc.onclick = () => send({ type: 'cancel' });
    foot.append(toTerminal, esc);

    card.append(head, scroll, foot);
  }

  function render() {
    if (!open) view = 'questions';   // 접힌 카드는 다음에 열 때 처음 화면부터 — 알림이 와도 옛 설정 화면이 뜨지 않게
    if (idx >= list.length) idx = Math.max(0, list.length - 1);
    if (view === 'done' && !done.length) view = 'questions';
    const n = list.length + done.length;
    petEl.classList.toggle('asking', n > 0);
    petEl.classList.toggle('done-only', !list.length && done.length > 0);
    badge.hidden = n === 0;
    badge.textContent = String(n);
    card.hidden = !open;
    // 입력 중인 칸을 다시 그리면 한글 조합이 끊긴다 — 같은 질문이면 카드는 그대로 둔다.
    const r = current();
    const typing = typingFor && document.activeElement && document.activeElement.tagName === 'TEXTAREA';
    if (open && !(typing && r && card.dataset.sig === r.sig)) { renderCard(); card.dataset.sig = r ? r.sig : ''; }
    requestAnimationFrame(fit);
  }
  // 카드 크기를 main 에 알린다 — main 이 펫 자리는 그대로 두고 카드 펼칠 쪽과 창 크기를 정한다.
  function fit() {
    if (!api) return;
    if (card.hidden) { api.resize(0, 0); return; }
    // 줄여 놓은 높이가 아니라 원래 높이를 알려야 자리가 생겼을 때 다시 커진다
    const capped = card.style.maxHeight;
    card.style.maxHeight = '';
    const w = card.offsetWidth, h = card.offsetHeight;
    card.style.maxHeight = capped;
    api.resize(w, h);
  }
  function applyLayout(l) {
    if (!l || !l.pet) return;
    petBox.style.left = l.pet.x + 'px';
    petBox.style.top = l.pet.y + 'px';
    if (l.card) {
      card.style.left = l.card.x + 'px'; card.style.top = l.card.y + 'px';
      card.style.maxHeight = l.cardMaxH ? l.cardMaxH + 'px' : '';
    }
  }
  function applyProject() {
    ptag.textContent = project ? project.name : '';
    petBox.title = project ? project.cwd : '';
    const shift = project && Number.isFinite(project.hue) ? project.hue - BASE_HUE : 0;
    petEl.style.setProperty('--hue-shift', `${shift}deg`);
    document.title = project ? `Claude Pet — ${project.name}` : 'Claude Pet';
  }

  // ---- 캐릭터: 끌면 이동, 누르면 열기/접기 ----
  let press = null;
  petEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    press = { x: e.clientX, y: e.clientY, moved: false };
    petEl.setPointerCapture(e.pointerId);
    api && api.dragStart();
  });
  petEl.addEventListener('pointermove', (e) => {
    if (!press) return;
    if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) {
      press.moved = true;
      dragging = true; updateAction();
    }
    if (press.moved && api) api.drag();
  });
  petEl.addEventListener('pointerup', () => {
    if (!press) return;
    const clicked = !press.moved;
    press = null;
    api && api.dragEnd();
    lastActivity = Date.now();
    if (dragging) { dragging = false; updateAction(); }
    // 누르면: 질문·완료가 있으면 그 카드, 없으면 세션 목록(골라서 허브로 가기)
    if (clicked) {
      open = !open;
      if (open) { view = (list.length || done.length) ? 'questions' : 'sessions'; claimOpen(); }
      render();
    }
  });
  petEl.addEventListener('dblclick', (e) => e.preventDefault());
  // 오른쪽 클릭 → 캐릭터 바꾸기
  petEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const same = open && view === 'settings';
    view = same ? 'questions' : 'settings';
    open = !same || list.length > 0;
    if (open) claimOpen();
    msg = { text: '', kind: '' };
    render();
  });
  // 허브에서 캐릭터 테마를 바꾸면(같은 주소라 localStorage 공유) 펫도 따라 바꾼다.
  window.addEventListener('storage', (e) => {
    if (e.key === CARD_KEY) { applyCardTone(); return; }
    if (e.key === OPEN_KEY) {
      let who = null;
      try { who = JSON.parse(e.newValue || 'null'); } catch { /* 깨진 값 */ }
      if (who && who.by !== selfId && open) { open = false; typingFor = null; msg = { text: '', kind: '' }; render(); }
      return;
    }
    if (!e.key || /^cth_(theme|proj_themes|pet_)/.test(e.key)) {
      (Avatar ? Avatar.loadFiles() : Promise.resolve()).then(() => { applyAvatar(); if (view === 'settings') render(); });
    }
  });
  if (Avatar) Avatar.loadFiles().then(applyAvatar);

  if (api) {
    api.onLayout(applyLayout);
    api.onState((data) => {
      const d = data || {};
      const hadItems = list.length + done.length > 0;
      const projectChanged = (project && project.id) !== (d.project && d.project.id)
        || (project && project.theme) !== (d.project && d.project.theme);
      project = d.project || null;
      applyProject();
      if (projectChanged) applyAvatar();   // 프로젝트별 펫 팩 지정이 있을 수 있다
      working = Number(d.working) || 0;
      if (working || (d.questions || []).length || (d.done || []).length) lastActivity = Date.now();
      const prevKey = current() && current().sig;
      // 작업 완료 — 새로 끝난 세션이 있으면 카드를 펼친다(질문이 보이고 있으면 질문이 우선)
      done = Array.isArray(d.done) ? d.done : [];
      sessions = Array.isArray(d.sessions) ? d.sessions : [];
      const freshDone = done.filter((x) => !seenDone.has(`${x.key}@${x.at}`));
      freshDone.forEach((x) => seenDone.add(`${x.key}@${x.at}`));
      if (freshDone.length && !(open && view === 'questions' && current())) {
        open = true;
        if (!(open && view === 'settings')) view = 'done';   // 지금 설정을 보고 있을 때만 그대로 둔다
      }
      const next = d.questions;
      list = Array.isArray(next) ? next : [];
      // 보고 있던 질문이 남아 있으면 그 자리를 유지한다.
      const keep = list.findIndex((r) => r.sig === prevKey);
      idx = keep >= 0 ? keep : Math.min(idx, Math.max(0, list.length - 1));
      const fresh = list.filter((r) => !seen.has(r.sig));
      fresh.forEach((r) => seen.add(r.sig));
      if (fresh.length) {
        if (!open || keep < 0) idx = list.indexOf(fresh[0]);
        open = true;
        view = 'questions'; // 캐릭터 설정을 보고 있었어도 새 질문이 우선
        msg = { text: '', kind: '' };
      }
      if (!list.length) { msg = { text: '', kind: '' }; typingFor = null; }
      // 알림이 다 처리되면 카드를 접는다(사용자가 눌러 연 빈 카드는 그대로)
      if (hadItems && !list.length && !done.length && view !== 'settings' && view !== 'sessions') open = false;
      updateAction();
      render();
    });
    api.onResult((r) => {
      // 결과는 모든 펫에 온다 — 이 프로젝트 질문에 대한 것만 받는다
      if (!r || !list.some((q) => q.key === r.key && q.sig === r.sig)) return;
      msg = r.ok ? { text: '보냈어요', kind: 'ok' } : { text: r.message || '보내지 못했어요', kind: 'err' };
      render();
    });
  }
  render();
})();

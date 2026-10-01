'use strict';
/**
 * 펫 화면 — 허브가 넘겨준 질문 목록을 카드로 보여주고, 고른 답을 허브에 돌려준다.
 * 창 관리·전달은 electron/pet.js, 질문 찾기·키 입력은 public/pet-bridge.js 담당.
 */
(function () {
  const api = window.pet;
  const $ = (id) => document.getElementById(id);
  const root = $('root'), card = $('card'), petEl = $('pet'), badge = $('badge');
  const petImg = $('petImg'), petSvg = $('petSvg');
  const Avatar = window.PetAvatar;

  let list = [];
  let idx = 0;
  let open = false;
  let view = 'questions';         // 'questions' | 'settings'(캐릭터 바꾸기)
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

  function send(action) {
    const r = current();
    if (!r || !api) return;
    msg = { text: '보내는 중…', kind: '' };
    render();
    api.answer({ key: r.key, sig: r.sig, action });
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
  function applyAvatar() {
    const a = Avatar ? Avatar.resolve() : { url: null };
    if (a.url) {
      if (petImg.getAttribute('src') !== a.url) petImg.src = a.url;
      petImg.hidden = false; petSvg.hidden = true;
    } else {
      petImg.hidden = true; petSvg.hidden = false;
    }
  }
  petImg.addEventListener('error', () => { petImg.hidden = true; petSvg.hidden = false; });

  function pickImageFile() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/png,image/gif,image/webp,image/jpeg,image/svg+xml';
    inp.onchange = () => takeImage(inp.files && inp.files[0]);
    inp.click();
  }
  async function takeImage(file) {
    if (!file || !Avatar) return;
    try {
      await Avatar.uploadCustom(file);
      msg = { text: '캐릭터를 바꿨어요', kind: 'ok' };
    } catch (e) {
      msg = { text: (e && e.message) || '바꾸지 못했어요', kind: 'err' };
    }
    applyAvatar();
    render();
  }

  function renderSettings() {
    const box = el('div', 'set');
    box.append(el('div', 't', '캐릭터 바꾸기'));
    const m = Avatar ? Avatar.mode() : 'default';
    const { theme, file } = Avatar ? Avatar.themeInfo() : { theme: null, file: null };
    const themeSub = !theme ? '허브에서 캐릭터 테마를 고르면 그 캐릭터가 나와요'
      : file ? `지금 테마: ${theme.name}` : `${theme.name} 이미지가 없어요 — 허브 팔레트에서 넣을 수 있어요`;
    const choice = (key, label, sub, onPick) => {
      const b = el('button', 'choice' + (m === key ? ' on' : ''));
      b.append(el('span', 'dot'));
      const t = el('span'); t.append(el('span', null, label)); t.append(el('small', null, sub));
      b.append(t);
      b.onclick = onPick;
      return b;
    };
    box.append(choice('theme', '캐릭터 테마 따라가기', themeSub, () => { Avatar.setMode('theme'); applyAvatar(); render(); }));
    box.append(choice('custom', '내 이미지', Avatar && Avatar.hasCustom() ? '골라 둔 이미지 · 눌러서 다시 고르기' : '이미지를 골라요 (gif 면 움직여요)', () => {
      if (Avatar.hasCustom() && m !== 'custom') { Avatar.setMode('custom'); applyAvatar(); render(); } else pickImageFile();
    }));
    box.append(choice('default', '기본 캐릭터', '주황 동그라미', () => { Avatar.setMode('default'); applyAvatar(); render(); }));
    box.append(el('div', 'hint', '팁: 이미지 파일을 캐릭터 위에 끌어다 놓아도 바뀌어요.'));
    const foot = el('div', 'foot');
    foot.append(el('span', 'msg' + (msg.kind ? ' ' + msg.kind : ''), msg.text));
    const back = el('button', 'ib', list.length ? '질문으로' : '닫기');
    back.onclick = () => { view = 'questions'; msg = { text: '', kind: '' }; if (!list.length) open = false; render(); };
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
    if (Avatar && !Avatar.isImage(f)) { msg = { text: '캐릭터에는 이미지 파일만 놓을 수 있어요', kind: 'err' }; open = true; view = 'settings'; render(); return; }
    open = true; view = 'settings';
    takeImage(f);
  });
  // 받는 칸 밖에 떨어뜨려도 창이 그 파일로 이동하지 않게.
  document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', (e) => { if (hasFiles(e)) e.preventDefault(); });

  function renderCard() {
    card.textContent = '';
    if (view === 'settings') { renderSettings(); return; }
    const r = current();
    if (!r) {
      card.append(el('div', 'empty', '기다리는 질문이 없어요. 질문이 오면 여기 뜹니다.'));
      const foot = el('div', 'foot');
      foot.append(el('span', 'msg', 'Ctrl+Alt+P 로 꺼내기/숨기기'));
      const change = el('button', 'ib', '캐릭터 바꾸기');
      change.onclick = () => { view = 'settings'; render(); };
      const hide = el('button', 'ib', '숨기기');
      hide.onclick = () => api && api.hide();
      foot.append(change, hide);
      card.append(foot);
      return;
    }
    const head = el('div', 'head');
    const who = el('div', 'who');
    who.append(el('b', null, r.title));
    who.append(el('span', null, [r.cwd, r.profile].filter(Boolean).join(' · ')));
    const prev = el('button', 'ib', '‹'); prev.disabled = idx <= 0;
    prev.onclick = () => { idx--; typingFor = null; render(); };
    const pager = el('span', 'pager', `${idx + 1}/${list.length}`);
    const next = el('button', 'ib', '›'); next.disabled = idx >= list.length - 1;
    next.onclick = () => { idx++; typingFor = null; render(); };
    const close = el('button', 'ib', '접기');
    close.onclick = () => { open = false; render(); };
    head.append(who, prev, pager, next, close);

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
    if (idx >= list.length) idx = Math.max(0, list.length - 1);
    petEl.classList.toggle('asking', list.length > 0);
    badge.hidden = list.length === 0;
    badge.textContent = String(list.length);
    card.hidden = !open;
    // 입력 중인 칸을 다시 그리면 한글 조합이 끊긴다 — 같은 질문이면 카드는 그대로 둔다.
    const r = current();
    const typing = typingFor && document.activeElement && document.activeElement.tagName === 'TEXTAREA';
    if (open && !(typing && r && card.dataset.sig === r.sig)) { renderCard(); card.dataset.sig = r ? r.sig : ''; }
    requestAnimationFrame(fit);
  }
  // 창 크기를 내용에 맞춘다 — main 이 오른쪽 아래를 기준으로 다시 배치한다.
  function fit() {
    if (!api) return;
    const b = root.getBoundingClientRect();
    api.resize(b.width, b.height);
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
    if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) press.moved = true;
    if (press.moved && api) api.drag();
  });
  petEl.addEventListener('pointerup', () => {
    if (!press) return;
    const clicked = !press.moved;
    press = null;
    api && api.dragEnd();
    if (clicked) { open = !open; if (open) view = 'questions'; render(); }
  });
  petEl.addEventListener('dblclick', (e) => e.preventDefault());
  // 오른쪽 클릭 → 캐릭터 바꾸기
  petEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const same = open && view === 'settings';
    view = same ? 'questions' : 'settings';
    open = !same || list.length > 0;
    msg = { text: '', kind: '' };
    render();
  });
  // 허브에서 캐릭터 테마를 바꾸면(같은 주소라 localStorage 공유) 펫도 따라 바꾼다.
  window.addEventListener('storage', (e) => {
    if (!e.key || /^cth_(theme|pet_)/.test(e.key)) {
      (Avatar ? Avatar.loadFiles() : Promise.resolve()).then(() => { applyAvatar(); if (view === 'settings') render(); });
    }
  });
  if (Avatar) Avatar.loadFiles().then(applyAvatar);

  if (api) {
    api.onState((next) => {
      const prevKey = current() && current().sig;
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
      render();
    });
    api.onResult((r) => {
      msg = r && r.ok ? { text: '보냈어요', kind: 'ok' } : { text: (r && r.message) || '보내지 못했어요', kind: 'err' };
      render();
    });
  }
  render();
})();

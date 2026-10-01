'use strict';
/**
 * 펫 화면 — 허브가 넘겨준 질문 목록을 카드로 보여주고, 고른 답을 허브에 돌려준다.
 * 창 관리·전달은 electron/pet.js, 질문 찾기·키 입력은 public/pet-bridge.js 담당.
 */
(function () {
  const api = window.pet;
  const $ = (id) => document.getElementById(id);
  const root = $('root'), card = $('card'), petEl = $('pet'), badge = $('badge');

  let list = [];
  let idx = 0;
  let open = false;
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
        ta.placeholder = '답을 입력하세요 — Enter 보내기';
        ta.value = draft;
        ta.addEventListener('input', () => { draft = ta.value; });
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

  function renderCard() {
    card.textContent = '';
    const r = current();
    if (!r) {
      card.append(el('div', 'empty', '기다리는 질문이 없어요. 질문이 오면 여기 뜹니다.'));
      const foot = el('div', 'foot');
      foot.append(el('span', 'msg', 'Ctrl+Alt+P 로 꺼내기/숨기기'));
      const hide = el('button', 'ib', '숨기기');
      hide.onclick = () => api && api.hide();
      foot.append(hide);
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
    const view = el('button', 'ib', '터미널에서 보기');
    view.onclick = () => send({ type: 'focus' });
    const esc = el('button', 'ib', 'Esc 취소');
    esc.title = '이 질문을 취소합니다 (터미널에서 Esc)';
    esc.onclick = () => send({ type: 'cancel' });
    foot.append(view, esc);

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
    if (clicked) { open = !open; render(); }
  });
  petEl.addEventListener('dblclick', (e) => e.preventDefault());

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

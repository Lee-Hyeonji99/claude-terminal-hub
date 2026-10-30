'use strict';
/**
 * 계정 UI 조각 — 계정 색 점, 드롭다운 메뉴, 패널 위 안내 줄, 알림.
 * 계정 목록·패널 상태는 app.js 가 갖고, 여기는 그리고 클릭을 돌려주기만 한다.
 */
(function (root) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 계정마다 고정된 색 — 기본 계정은 테마 강조색, 나머지는 id 에서 뽑은 색상각
  function accountHue(id) {
    let h = 2166136261;
    const s = String(id || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h) % 360;
  }
  function dotHtml(id) {
    return !id || id === 'default'
      ? '<span class="adot adot-main"></span>'
      : `<span class="adot" style="--hue:${accountHue(id)}"></span>`;
  }

  let openMenuEl = null;
  function closeMenu() {
    if (!openMenuEl) return;
    openMenuEl.remove();
    openMenuEl = null;
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onEsc, true);
  }
  function onOutside(e) { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); }
  function onEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } }

  /**
   * anchor 아래에 메뉴를 띄운다. 같은 anchor 로 다시 부르면 닫는다.
   * sections: [{ title, items: [{ id, label, sub, current, onClick }] }], foot: 맨 아래 안내 문장
   */
  function openMenu(anchor, sections, foot) {
    const again = openMenuEl && openMenuEl._anchor === anchor;
    closeMenu();
    if (again) return;
    const m = document.createElement('div');
    m.className = 'acct-menu';
    m._anchor = anchor;
    m.innerHTML = sections.map((sec) => `
      ${sec.title ? `<div class="am-sep">${esc(sec.title)}</div>` : ''}
      ${sec.items.map((it, i) => `<button class="am-item${it.current ? ' current' : ''}" data-i="${i}" ${it.current ? 'disabled' : ''}>
        ${it.id !== undefined ? dotHtml(it.id) : ''}<span class="am-label">${esc(it.label)}</span>${it.sub ? `<span class="am-sub">${esc(it.sub)}</span>` : ''}
      </button>`).join('')}`).join('')
      + (foot ? `<div class="am-foot">${esc(foot)}</div>` : '');
    m.querySelectorAll('.am-item').forEach((b, idx) => {
      const flat = sections.flatMap((s) => s.items);
      b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); const it = flat[idx]; if (it && it.onClick) it.onClick(); });
    });
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    const w = m.offsetWidth;
    m.style.top = Math.round(r.bottom + 4) + 'px';
    m.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))) + 'px';
    openMenuEl = m;
    setTimeout(() => {
      document.addEventListener('mousedown', onOutside, true);
      document.addEventListener('keydown', onEsc, true);
    }, 0);
  }

  /** 패널 머리줄 바로 아래 안내 줄. 같은 패널에 다시 띄우면 바꿔 끼운다. 닫는 함수를 돌려준다. */
  function showBar(paneEl, text, actions) {
    const old = paneEl.querySelector('.acct-bar');
    if (old) old.remove();
    const bar = document.createElement('div');
    bar.className = 'acct-bar';
    bar.innerHTML = `<span class="ab-msg">${text}</span>`
      + actions.map((a, i) => `<button class="ab-btn${a.primary ? ' primary' : ''}" data-i="${i}">${a.id !== undefined ? dotHtml(a.id) : ''}${esc(a.label)}</button>`).join('')
      + '<button class="ab-close" title="닫기">✕</button>';
    const close = () => bar.remove();
    bar.querySelectorAll('.ab-btn').forEach((b) => b.addEventListener('click', () => { close(); const a = actions[+b.dataset.i]; if (a.onClick) a.onClick(); }));
    bar.querySelector('.ab-close').addEventListener('click', close);
    const head = paneEl.querySelector('.bar');
    if (head) head.after(bar); else paneEl.prepend(bar);
    return close;
  }

  function toast(msg, ms) {
    const t = document.createElement('div');
    t.className = 'acct-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms || 4000);
  }

  function isOpenFor(anchor) { return !!openMenuEl && openMenuEl._anchor === anchor; }

  root.AccountUI = { dotHtml, openMenu, closeMenu, isOpenFor, showBar, toast, esc };
})(typeof window !== 'undefined' ? window : globalThis);

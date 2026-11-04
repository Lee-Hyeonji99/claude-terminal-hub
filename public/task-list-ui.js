/* 패널 「작업 목록」 — Claude 작업 목록(서버 lib/task-list.js 가 보내는 {type:'tasks'})을 체크리스트로 보여 준다.
 * 제목줄 버튼에 「완료/전체」, 누르면 터미널 위 오른쪽에 목록이 뜬다(터미널 크기는 바꾸지 않는다).
 * 목록이 없으면 버튼을 숨긴다. app.js 보다 먼저 로드된다(window.TaskListUI). */
(function () {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function mount(pane, btn, host) {
    const pop = document.createElement('div');
    pop.className = 'task-pop';
    pop.hidden = true;
    host.appendChild(pop);
    btn.hidden = true;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      pop.hidden = !pop.hidden;
      btn.classList.toggle('on', !pop.hidden);
    });
    pop.addEventListener('mousedown', (e) => e.stopPropagation());
    return { btn, pop, items: [] };
  }

  function render(ui, items) {
    if (!ui) return;
    ui.items = Array.isArray(items) ? items : [];
    const total = ui.items.length;
    const done = ui.items.filter((t) => t.status === 'completed').length;
    ui.btn.hidden = total === 0;
    if (total === 0) { ui.pop.hidden = true; ui.btn.classList.remove('on'); }
    ui.btn.querySelector('.tl-cnt').textContent = `${done}/${total}`;
    ui.btn.classList.toggle('all-done', total > 0 && done === total);
    const pct = total ? Math.round((done / total) * 100) : 0;
    ui.pop.innerHTML = `<div class="tp-head">작업 목록<span>${done} / ${total}</span></div>`
      + `<div class="tp-prog"><i style="width:${pct}%"></i></div>`
      + `<ul>${ui.items.map((t) => `<li class="st-${esc(t.status)}"><span class="box"></span><span class="t">${esc(t.subject)}</span></li>`).join('')}</ul>`;
  }

  window.TaskListUI = { mount, render };
})();

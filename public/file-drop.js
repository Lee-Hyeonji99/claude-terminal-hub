'use strict';
/**
 * 파일 끌어다 놓기 — 터미널 패널이나 입력창(컴포즈)에 놓으면 그 파일의 경로를 넣는다.
 * Claude Code 는 메시지에 든 파일 경로를 읽으므로 경로를 넣는 것이 곧 첨부다(이미지도 같다).
 *
 * - 경로는 데스크톱 앱에서만 알 수 있다(claudeHub.filePath → webUtils). 브라우저 모드는 안내만 한다.
 * - 받는 칸 밖에 떨어뜨리면 기본 동작(창이 그 파일로 이동)이 세션 화면을 날리므로 창 전체에서 막는다.
 *   main 프로세스의 will-navigate 차단과 이중으로 막는다.
 * - 패널 순서 바꾸기는 마우스 이벤트로 하므로 여기 HTML 드래그와 겹치지 않는다.
 *
 * app.js 의 전역(columns · minimized · profileWorkspaces · setActive)을 쓴다 — app.js 다음에 로드한다.
 */
(function initFileDrop() {
  const hub = window.claudeHub;
  const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
  // 공백이 든 경로는 따옴표로 감싼다 — 안 그러면 Claude 가 두 개의 경로로 읽는다.
  const quote = (p) => (/\s/.test(p) ? `"${p}"` : p);

  function pathsOf(e) {
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (!files.length) return { paths: [], count: 0 };
    const paths = hub && hub.filePath ? files.map((f) => hub.filePath(f)).filter(Boolean) : [];
    return { paths, count: files.length };
  }

  let toastTimer;
  function toast(text) {
    let t = document.getElementById('dropToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'dropToast';
      t.className = 'drop-toast';
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function paneOfElement(el) {
    const paneEl = el && el.closest && el.closest('.pane');
    if (!paneEl) return null;
    const all = [...columns.flatMap((c) => c.panes), ...minimized];
    return all.find((p) => p.el === paneEl && p.term && p.cfg && !p.cfg.viewer && !p.cfg.preview) || null;
  }

  function insertIntoTextarea(ta, text) {
    const s = ta.selectionStart || 0, en = ta.selectionEnd || 0;
    const before = ta.value.slice(0, s);
    const pad = before && !/\s$/.test(before) ? ' ' : '';
    ta.value = before + pad + text + ta.value.slice(en);
    ta.selectionStart = ta.selectionEnd = s + pad.length + text.length;
    ta.dispatchEvent(new Event('input')); // 입력창 높이 자동 조절
    ta.focus();
  }

  let overPane = null;
  function markOver(p) {
    if (overPane === p) return;
    if (overPane) overPane.el.classList.remove('file-over');
    overPane = p;
    if (p) p.el.classList.add('file-over');
  }

  // 캐릭터 이미지 칸(팔레트 팝오버)은 자기가 받는다 — 건드리지 않는다.
  const ownZone = (e) => !!(e.target && e.target.closest && e.target.closest('#assetDrop'));

  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e) || ownZone(e)) return;
    e.preventDefault(); // 기본 동작(파일로 이동) 차단
    const p = paneOfElement(e.target);
    e.dataTransfer.dropEffect = p ? 'copy' : 'none';
    markOver(p);
  });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) markOver(null); });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e) || ownZone(e)) return;
    e.preventDefault();
    markOver(null);
    const p = paneOfElement(e.target);
    if (!p) return;
    const { paths, count } = pathsOf(e);
    if (!count) return;
    if (!paths.length) {
      // 앱인데 경로가 없으면 브라우저 다운로드 목록처럼 실제 파일이 아닌 곳에서 끈 것이다.
      toast(hub && hub.filePath ? '파일 경로를 알 수 없어요 — 탐색기에서 끌어다 놓아 주세요' : '파일 경로는 데스크톱 앱에서만 넣을 수 있어요');
      return;
    }
    const text = paths.map(quote).join(' ') + ' ';
    setActive(p, false);

    const ta = e.target.closest('.compose') && p.el.querySelector('.compose textarea');
    if (ta) { insertIntoTextarea(ta, text.trimEnd()); }
    else if (p.ws && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify({ type: 'input', data: text }));
      try { p.term.focus(); } catch {}
    } else { toast('연결이 끊겨 넣지 못했어요'); return; }
    toast(count === 1 ? '파일 경로를 넣었어요' : `파일 ${count}개 경로를 넣었어요`);
  });
})();

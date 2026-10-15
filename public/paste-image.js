'use strict';
/**
 * 입력창 이미지 붙여넣기 — 클립보드에 이미지가 있으면(캡처 Win+Shift+S, 이미지 복사 등)
 * 서버에 파일로 저장하고 그 경로를 입력창에 넣는다. 텍스트 붙여넣기는 그대로 둔다.
 * 서버 쪽은 lib/pasted-images.js (POST /api/paste-image).
 */
(function (root) {
  const quote = (p) => (/\s/.test(p) ? `"${p}"` : p);

  // 실패 안내 — 파일 끌어다 놓기와 같은 토스트(.drop-toast) 를 쓴다. 터미널을 접은 데스크톱 뷰에서도 보인다.
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

  /** 붙여넣기 이벤트의 이미지 파일들 (없으면 빈 배열) */
  function imagesOf(clipboardData) {
    const items = Array.from((clipboardData && clipboardData.items) || []);
    return items
      .filter((i) => i.kind === 'file' && /^image\//.test(i.type))
      .map((i) => i.getAsFile())
      .filter(Boolean);
  }

  const readAsDataUrl = (file) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('이미지를 읽지 못했습니다'));
    fr.readAsDataURL(file);
  });

  /**
   * @param opts.raw true 면 따옴표 없이 경로 그대로 (호출부가 따로 감쌀 때)
   * @returns {Promise<string>} 저장된 파일 경로(기본은 공백이 있으면 따옴표로 감싼 것)
   */
  async function save(file, opts = {}) {
    const dataUrl = await readAsDataUrl(file);
    const r = await fetch('/api/paste-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.path) throw new Error(j.error || '이미지를 저장하지 못했습니다');
    return opts.raw ? j.path : quote(j.path);
  }

  /** textarea 에 붙인다. insert(text) 는 커서 자리에 글을 넣는 함수. */
  function attach(ta, insert) {
    ta.addEventListener('paste', async (e) => {
      const files = imagesOf(e.clipboardData);
      if (!files.length) return;          // 텍스트는 기본 붙여넣기
      e.preventDefault();
      for (const f of files) {
        try { insert((await save(f)) + ' '); }
        catch (err) { toast((err && err.message) || '이미지를 붙여넣지 못했습니다'); }
      }
    });
  }

  const api = { imagesOf, save, attach };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PasteImage = api;
})(typeof window !== 'undefined' ? window : globalThis);

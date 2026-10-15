'use strict';
/**
 * 아주 작은 마크다운 → HTML (데스크톱 뷰의 Claude 답변 표시용).
 *
 * 안전이 먼저다: 원문을 통째로 이스케이프한 뒤에 정해진 문법만 태그로 바꾼다.
 * 그래서 원문 속 HTML 은 절대 태그가 되지 않는다. 링크는 http(s) 만, 새 창으로 연다.
 * 지원: 코드 블록(```), 인라인 코드, **굵게**, # 제목, - / 1. 목록, [글](주소), 문단·줄바꿈.
 */
(function (root) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 인라인 — 이미 이스케이프된 한 줄. 인라인 코드를 먼저 빼 두어 그 안은 건드리지 않는다.
  function inline(s) {
    const codes = [];
    let out = s.replace(/`([^`]+)`/g, (_m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    out = out
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s()&]*(?:&amp;[^\s()&]*)*)\)/g,
        (_m, t, u) => (/&quot;|&#39;/.test(u) ? _m : `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`));
    return out.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[Number(i)]}</code>`);
  }

  function render(text) {
    if (!text) return '';
    const lines = esc(text).replace(/\r\n?/g, '\n').split('\n');
    const html = [];
    let para = [];
    let list = null;   // { tag, items }

    const flushPara = () => { if (para.length) { html.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
    const flushList = () => { if (list) { html.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
    const flush = () => { flushPara(); flushList(); };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
      if (fence) {
        flush();
        const body = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
        const lang = fence[1] ? ` class="lang-${fence[1]}"` : '';
        html.push(`<pre><code${lang}>${body.join('\n')}</code></pre>`);
        continue;
      }
      if (!line.trim()) { flush(); continue; }
      const h = /^(#{1,4})\s+(.+)$/.exec(line);
      if (h) { flush(); const lv = Math.min(5, h[1].length + 1); html.push(`<h${lv}>${inline(h[2].trim())}</h${lv}>`); continue; }
      const ul = /^\s*[-*]\s+(.+)$/.exec(line);
      const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
      if (ul || ol) {
        flushPara();
        const tag = ul ? 'ul' : 'ol';
        if (list && list.tag !== tag) flushList();
        if (!list) list = { tag, items: [] };
        list.items.push((ul || ol)[1]);
        continue;
      }
      flushList();
      para.push(line);
    }
    flush();
    return html.join('');
  }

  const api = { render };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MdLite = api;
})(typeof window !== 'undefined' ? window : globalThis);

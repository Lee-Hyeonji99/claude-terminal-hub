'use strict';
/**
 * 터미널 화면 한 장에서 «Claude 가 지금 고르라고 묻는 것» 을 읽는다. 펫(데스크톱 위젯)이 쓴다.
 *
 * 대상: 선택지 질문(AskUserQuestion) · 권한 확인(Do you want to proceed?) 처럼
 *   번호 선택지 + 커서 + 바닥글(Esc to cancel 등) 이 있는 화면.
 *
 * 없는 것을 있다고 하지 않는 게 절반이다 — Claude 가 산문으로 쓴 번호 목록을 질문으로
 * 읽으면 사용자가 지울 수 없는 카드가 계속 뜬다. 그래서 세 가지가 모두 있어야 질문으로 본다:
 *   1) 화면 맨 아래 근처의 바닥글  2) 1번부터 이어지는 선택지  3) 선택지 하나에 커서
 *
 * 커서 기호는 환경마다 다르다. 맥·Windows Terminal 은 `❯`, WSL tmux 안의 Windows claude.exe
 * 처럼 유니코드 미지원으로 판정되면 ASCII `>` 로 그린다(실측). 둘 다 받는다.
 */
(function (root) {
  const OPTION_RE = /^\s*([❯>›])?\s*(\d{1,2})\.\s+(.+?)\s*$/;
  const FOOTER_RE = /Esc to (cancel|exit|go back|interrupt)|Enter to (select|confirm|submit)/;
  const RULE_RE = /^\s*[─━╌┄┈╍┅┉-]{10,}\s*$/;
  const FOOTER_WINDOW = 4;   // 바닥글은 화면의 마지막 내용 몇 줄 안에 있어야 한다
  const SCAN_UP = 60;        // 바닥글 위로 선택지를 찾아 올라가는 한도

  const stripGutter = (s) => s.replace(/^\s*│\s?/, '').replace(/\s*│\s*$/, '').trim();
  const isRule = (s) => RULE_RE.test(s);
  // 질문 폼 위의 탭 바 — `←  ☐ 본문  ✔ Submit  →`. 제목이 아니라 장치다.
  const isFormChrome = (s) => /[☐✔☒]/.test(s) && (/^\s*←/.test(s) || /→\s*$/.test(s) || /^\s*\[[ x]\]/.test(s));

  function parseOption(line) {
    const m = OPTION_RE.exec(line);
    if (!m) return null;
    const label = m[3].trim();
    if (!label) return null;
    return { number: Number(m[2]), label, selected: !!m[1], isText: /^Type something\.?$/.test(label) };
  }

  /** @param {string[]} lines 화면 줄(위→아래). @returns 질문 객체 또는 null */
  function parsePrompt(lines) {
    let end = lines.length;
    while (end > 0 && !lines[end - 1].trim()) end--;
    if (!end) return null;

    // 1) 바닥글 — 화면 맨 아래 쪽에 있어야 한다. 위쪽에 남은 지난 화면을 잡지 않기 위해.
    let footer = -1;
    for (let i = end - 1, seen = 0; i >= 0 && seen < FOOTER_WINDOW; i--) {
      if (!lines[i].trim()) continue;
      seen++;
      if (FOOTER_RE.test(lines[i])) { footer = i; break; }
    }
    if (footer < 0) return null;

    // 2) 바닥글 바로 위에서부터 거슬러 올라가며 마지막 «1.» 을 찾는다.
    let first = -1;
    for (let i = footer - 1; i >= Math.max(0, footer - SCAN_UP); i--) {
      const o = parseOption(lines[i]);
      if (o && o.number === 1) { first = i; break; }
    }
    if (first < 0) return null;

    // 선택지를 아래로 읽는다. 번호 없는 들여쓴 줄은 앞 선택지의 설명이다.
    const options = [];
    for (let i = first; i < footer; i++) {
      const line = lines[i];
      if (!line.trim() || isRule(line)) continue;
      const o = parseOption(line);
      if (o && o.number === options.length + 1) { options.push({ ...o, desc: '' }); continue; }
      if (o) break; // 번호가 끊기면 다른 목록이다
      if (!options.length) break;
      const last = options[options.length - 1];
      last.desc = last.desc ? `${last.desc} ${line.trim()}` : line.trim();
    }
    if (options.length < 2) return null;
    // 3) 커서 — Claude 는 기다리는 동안 반드시 한 선택지에 커서를 그린다.
    if (!options.some((o) => o.selected)) return null;

    // 질문은 선택지 바로 위의 내용 줄, 그 위로 테두리까지가 본문이다.
    let q = -1;
    for (let i = first - 1; i >= 0; i--) {
      if (lines[i].trim() && !isRule(lines[i])) { q = i; break; }
    }
    // 질문 폼은 질문을 `│` 세로줄 안에 그린다 — 좁은 창에서 접힌 줄을 이어 붙인다.
    if (q >= 0 && /^\s*│/.test(lines[q])) {
      while (q - 1 >= 0 && /^\s*│/.test(lines[q - 1])) q--;
    }
    let question = '';
    if (q >= 0) {
      const parts = [];
      for (let i = q; i < first; i++) {
        if (lines[i].trim() && !isRule(lines[i])) parts.push(stripGutter(lines[i]));
        if (!/^\s*│/.test(lines[i])) break; // 세로줄 묶음이 아니면 한 줄만
      }
      question = parts.join(' ');
    }
    const body = [];
    for (let i = q - 1; i >= 0 && i >= q - 8; i--) {
      if (isRule(lines[i])) break;
      if (!lines[i].trim() || isFormChrome(lines[i])) continue;
      body.unshift(stripGutter(lines[i]));
    }
    return {
      question,
      body: body.join('\n'),
      options: options.map(({ number, label, desc, selected, isText }) => ({ number, label, desc, selected, isText })),
    };
  }

  /** 같은 질문인가 — 커서 위치는 비교하지 않는다(화살표로 옮겼을 뿐이면 같은 물음). */
  function promptSignature(p) {
    return [p.question, p.body, ...p.options.map((o) => `${o.number}.${o.isText ? '' : o.label}`)].join('␞');
  }

  /**
   * 고르는 키. 9 이하는 숫자 한 글자, 10 이상은 커서를 옮겨 Enter.
   * 글 입력 선택지는 자리만 옮기고(확정은 글을 친 뒤) 돌려준다.
   */
  function keysToSelect(prompt, number, forText) {
    if (number <= 9) return [String(number)];
    const cur = (prompt.options.find((o) => o.selected) || prompt.options[0]).number;
    const d = number - cur;
    const move = Array(Math.abs(d)).fill(d > 0 ? '\x1b[B' : '\x1b[A');
    return forText ? move : [...move, '\r'];
  }

  const api = { parsePrompt, promptSignature, keysToSelect };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PromptScan = api;
})(typeof window !== 'undefined' ? window : globalThis);

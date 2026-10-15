'use strict';
/**
 * 패널 화면에서 Claude 질문을 읽고, 고른 답을 그 패널에 키로 쳐 준다.
 * 펫(pet-bridge.js)과 데스크톱 뷰(desk-view.js)가 같이 쓴다.
 *
 * 화면은 xterm 버퍼에서 읽는다 — 셸 종류(PowerShell / tmux)와 무관하고,
 * 최소화·다른 탭에 숨겨진 패널도 버퍼는 계속 갱신된다.
 */
(function () {
  if (!window.PromptScan) return;

  // 자리 이동과 글자를 한 번에 보내면 Claude 가 같은 화면 상태로 처리해 글자가 사라진다(외부 위젯 실측 2026-09-22).
  const STEP_PAUSE_MS = 400;
  const WORKING_RE = /esc to interrupt/i;
  const WORKING_WINDOW = 8;   // 화면 맨 아래 몇 줄 안에서만 찾는다(지난 출력 오탐 방지)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 스크롤해 올려 둔 패널이어도 지금 화면(맨 아래)을 읽는다.
  function screenOf(term) {
    const b = term.buffer.active;
    const out = [];
    for (let y = b.baseY; y < b.baseY + term.rows; y++) {
      const line = b.getLine(y);
      out.push(line ? line.translateToString(true) : '');
    }
    return out;
  }
  function promptOf(p) {
    if (!p || !p.term) return null;
    try { return PromptScan.parsePrompt(screenOf(p.term)); } catch { return null; }
  }
  /** Claude 가 일하는 중인가 — 상태줄의 «esc to interrupt». */
  function isWorking(p) {
    if (!p || !p.term) return false;
    try {
      const lines = screenOf(p.term).filter((l) => l.trim());
      return lines.slice(-WORKING_WINDOW).some((l) => WORKING_RE.test(l));
    } catch { return false; }
  }

  function sendKeys(p, data) {
    if (!p.ws || p.ws.readyState !== WebSocket.OPEN) return false;
    p.ws.send(JSON.stringify({ type: 'input', data }));
    return true;
  }
  async function sendSeq(p, keys) {
    for (let i = 0; i < keys.length; i++) {
      if (!sendKeys(p, keys[i])) return false;
      if (i < keys.length - 1) await sleep(keys[i + 1] === '\r' ? STEP_PAUSE_MS : 60);
    }
    return true;
  }

  /**
   * @param p 패널 객체   @param sig 카드를 띄울 때의 질문 서명
   * @param action {type:'select'|'text'|'cancel', number?, text?}
   * @returns {Promise<{ok:boolean, message:string}>}
   */
  async function answer(p, sig, action) {
    const fail = (message) => ({ ok: false, message });
    if (!p || !action) return fail('세션을 찾을 수 없습니다');
    // 카드를 띄운 뒤 터미널에서 먼저 답했을 수 있다. 그때 키를 보내면 다음 질문에 꽂힌다.
    const prompt = promptOf(p);
    if (!prompt || PromptScan.promptSignature(prompt) !== sig) return fail('질문이 바뀌었습니다 — 터미널을 확인하세요');

    const LOST = '연결이 끊겨 보내지 못했습니다';
    if (action.type === 'cancel') return sendKeys(p, '\x1b') ? { ok: true, message: '' } : fail(LOST);
    const opt = prompt.options.find((o) => o.number === action.number);
    if (!opt) return fail('없는 선택지입니다');

    let ok;
    if (action.type === 'text') {
      // 줄바꿈은 Enter 로 먹혀 중간에 확정되므로 공백으로 바꾼다.
      const text = String(action.text || '').replace(/\r?\n/g, ' ').trim();
      if (!text) return fail('보낼 내용이 없습니다');
      ok = await sendSeq(p, PromptScan.keysToSelect(prompt, opt.number, true));
      if (ok) { await sleep(STEP_PAUSE_MS); ok = sendKeys(p, text); }
      if (ok) { await sleep(STEP_PAUSE_MS); ok = sendKeys(p, '\r'); }
    } else {
      ok = await sendSeq(p, PromptScan.keysToSelect(prompt, opt.number, false));
    }
    return ok ? { ok: true, message: '' } : fail(LOST);
  }

  window.PromptAnswer = { promptOf, isWorking, answer, signature: (pr) => PromptScan.promptSignature(pr) };
})();

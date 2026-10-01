'use strict';
/**
 * 펫 연동 (데스크톱 앱 전용) — 패널 화면에서 Claude 질문을 찾아 펫에 넘기고,
 * 펫에서 고른 답을 그 패널에 키로 쳐 준다.
 *
 * app.js 의 전역(columns · minimized · profileWorkspaces · profiles · activeProfileId ·
 * switchProfile · restorePane · setActive)을 쓴다 — app.js 다음에 로드한다.
 *
 * 화면은 xterm 버퍼에서 읽는다. 최소화·다른 프로필에 숨겨진 패널도 버퍼는 계속 갱신되므로
 * 보이지 않는 세션의 질문도 잡힌다.
 */
(function initPetBridge() {
  const hub = window.claudeHub;
  if (!hub || !hub.petState || !window.PromptScan) return;

  const SCAN_MS = 700;
  // 자리 이동과 글자를 한 번에 보내면 Claude 가 같은 화면 상태로 처리해 글자가 사라진다(외부 위젯 실측 2026-09-22).
  const STEP_PAUSE_MS = 400;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shortName = (p) => (p ? (String(p).split(/[\\/]/).filter(Boolean).pop() || p) : '');

  function allPanes() {
    const set = new Set();
    columns.forEach((c) => c.panes.forEach((p) => set.add(p)));
    for (const [pid, w] of Object.entries(profileWorkspaces)) {
      if (pid !== activeProfileId && w && Array.isArray(w.columns)) w.columns.forEach((c) => c.panes.forEach((p) => set.add(p)));
    }
    minimized.forEach((p) => set.add(p));
    return [...set].filter((p) => p && p.term && p.cfg && !p.cfg.viewer && !p.cfg.preview);
  }
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
    try { return PromptScan.parsePrompt(screenOf(p.term)); } catch { return null; }
  }
  function profileName(id) {
    const f = (typeof profiles !== 'undefined' ? profiles : []).find((x) => x.id === id);
    return f && f.id !== 'default' ? f.name : '';
  }

  let lastJson = '';
  function scan() {
    const list = [];
    for (const p of allPanes()) {
      const prompt = promptOf(p);
      if (!prompt) continue;
      list.push({
        key: p.cfg.key,
        sig: PromptScan.promptSignature(prompt),
        title: p.cfg.title || 'claude',
        cwd: shortName(p.cfg.cwd),
        profile: profileName(p.cfg.profile),
        prompt,
      });
    }
    const json = JSON.stringify(list);
    if (json !== lastJson) { lastJson = json; hub.petState(list); }
  }
  setInterval(scan, SCAN_MS);

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
  function focusPane(p) {
    if (p.cfg.profile && p.cfg.profile !== activeProfileId) switchProfile(p.cfg.profile);
    if (minimized.includes(p)) restorePane(p);
    setActive(p);
  }

  hub.onPetAnswer(async (msg) => {
    const { key, sig, action } = msg || {};
    const reply = (ok, message) => hub.petResult({ key, sig, ok, message: message || '' });
    const p = allPanes().find((x) => x.cfg.key === key);
    if (!p || !action) return reply(false, '세션을 찾을 수 없습니다');
    if (action.type === 'focus') { focusPane(p); return reply(true); }

    // 카드를 띄운 뒤 터미널에서 먼저 답했을 수 있다. 그때 키를 보내면 다음 질문에 꽂힌다.
    const prompt = promptOf(p);
    if (!prompt || PromptScan.promptSignature(prompt) !== sig) return reply(false, '질문이 바뀌었습니다 — 터미널을 확인하세요');

    if (action.type === 'cancel') return reply(sendKeys(p, '\x1b'), '연결이 끊겨 보내지 못했습니다');
    const opt = prompt.options.find((o) => o.number === action.number);
    if (!opt) return reply(false, '없는 선택지입니다');

    let ok;
    if (action.type === 'text') {
      // 줄바꿈은 Enter 로 먹혀 중간에 확정되므로 공백으로 바꾼다.
      const text = String(action.text || '').replace(/\r?\n/g, ' ').trim();
      if (!text) return reply(false, '보낼 내용이 없습니다');
      ok = await sendSeq(p, PromptScan.keysToSelect(prompt, opt.number, true));
      if (ok) { await sleep(STEP_PAUSE_MS); ok = sendKeys(p, text); }
      if (ok) { await sleep(STEP_PAUSE_MS); ok = sendKeys(p, '\r'); }
    } else {
      ok = await sendSeq(p, PromptScan.keysToSelect(prompt, opt.number, false));
    }
    reply(ok, ok ? '' : '연결이 끊겨 보내지 못했습니다');
    setTimeout(scan, 300); // 카드를 빨리 걷어 낸다
  });

  // 헤더 버튼 — 펫 꺼내기/숨기기
  const btn = document.getElementById('petBtn');
  if (btn) {
    btn.style.display = '';
    const mark = (v) => btn.classList.toggle('on', !!v);
    btn.addEventListener('click', (e) => { e.stopPropagation(); hub.petToggle(); });
    if (hub.onPetVisible) hub.onPetVisible(mark);
    if (hub.petVisible) hub.petVisible().then(mark).catch(() => {});
  }
})();

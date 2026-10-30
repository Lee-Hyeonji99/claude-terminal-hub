'use strict';
/**
 * claude 화면에 사용 한도 도달 문구가 나왔는지 — 패널에 «다른 계정으로 이어가기» 를 제안할 때 쓴다.
 *
 * Claude Code 가 실제로 쓰는 문구 (2026-10 기록에서 확인):
 *   "You've hit your 5-hour limit · resets 9:50pm (Asia/Seoul)"
 *   "You've hit your individual spend limit · run /usage-credits to ask your admin for a higher …"  (팀 계정)
 *   "Usage limit reached · continuing automatically at 7:20pm · esc to cancel"
 *   예전: "Claude usage limit reached. Your limit will reset at 3pm", "5-hour limit reached ∙ resets 3pm"
 * 대화 내용에 같은 단어가 나와도 걸리지 않도록 «한도 문구 + 그다음 안내(초기화 시각 · 자동 재개 · 한도 명령)» 가
 * 같은 줄에 있을 때만 본다.
 */

// 단어 사이는 공백 1칸 이상, 한도 문구 바로 뒤에 구분점(· ∙ .)이 오고, 같은 줄에 그다음 안내가 있어야 한다.
// 코드(`if (limitReached) reset()`)나 다른 오류 문구("rate limit reached, contact your administrator")는 걸리지 않는다.
const LIMIT_RE = new RegExp(
  '(hit\\s+your\\s+(?:[\\w-]+\\s+){0,3}limit|limit\\s+reached|reached\\s+your\\s+usage\\s+limit)\\s*[·∙.]'
  + '[^\\n]{0,100}?(\\bresets?\\b|continuing\\s+automatically|\\/usage\\b|\\/upgrade\\b|\\/extra-usage\\b|\\badmin\\b)',
  'i');
const TAIL_MAX = 600;

// 글자 꾸밈(SGR, …m)은 단어 중간에도 끼므로 지우고, 커서 이동 같은 나머지 제어 코드는 칸 띄움 대신 쓰이기도 해 공백으로 바꾼다
function stripAnsi(s) {
  return String(s)
    .replace(/\x1b[\]P][\s\S]*?(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ' ')
    .replace(/\r/g, '\n');
}

// 화면 전체를 지우고 다시 그리는 출력인가 — 크기 변경 · 화면 갱신 때 TUI 가 지난 대화를 통째로 다시 출력한다
function isRepaint(chunk) {
  return /\x1b\[[23]J|\x1bc/.test(String(chunk || ''));
}

/**
 * 출력 조각을 이어 붙이며 한도 문구를 찾는다(문구가 조각 사이에 걸쳐 와도 잡는다).
 * @returns {{ tail: string, hit: boolean }}
 */
function scan(prevTail, chunk) {
  const tail = (String(prevTail || '') + stripAnsi(chunk)).slice(-TAIL_MAX);
  const m = LIMIT_RE.exec(tail);
  // 찾았으면 그 부분까지 비워 같은 문구로 또 걸리지 않게 한다
  return m ? { tail: tail.slice(m.index + m[0].length), hit: true } : { tail, hit: false };
}

/**
 * 대화 기록에 새로 붙은 줄 중 한도 때문에 멈춘 응답이 있는가. 화면 문구보다 확실하다 —
 * Claude Code 는 그때 { type:'assistant', isApiErrorMessage:true, error:'rate_limit' } 줄을 남긴다.
 */
function transcriptHitLimit(delta) {
  for (const line of String(delta || '').split('\n')) {
    if (line.indexOf('rate_limit') < 0) continue;
    try {
      const o = JSON.parse(line);
      if (o && o.type === 'assistant' && o.error === 'rate_limit' && !o.isSidechain) return true;
    } catch { /* 잘린 줄 */ }
  }
  return false;
}

/**
 * 지금 claude 가 일하는 중인가 — 대화 기록 끝을 보고 판단한다(서브에이전트 · 셸 아닌 메인 대화).
 *   마지막 사용자 메시지에 아직 답이 없거나, 마지막 응답이 도구를 쓰는 중이면 true. 모르면 null.
 */
function turnInProgress(tail) {
  const lines = String(tail || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.indexOf('"user"') < 0 && l.indexOf('"assistant"') < 0) continue;
    let o;
    try { o = JSON.parse(l); } catch { if (i === 0) return null; continue; }
    // 압축 요약 · 명령 기록 같은 메타 줄은 대화 차례가 아니다
    if (o.isSidechain || o.isMeta || o.isCompactSummary || !o.message) continue;
    if (o.type === 'assistant') {
      const content = Array.isArray(o.message.content) ? o.message.content : [];
      return !o.message.stop_reason || content.some((c) => c && c.type === 'tool_use');
    }
    if (o.type === 'user') {
      // Esc 로 멈춘 차례는 끝난 것 — 기록에 "[Request interrupted by user…]" 가 남는다
      const c = o.message.content;
      const text = typeof c === 'string' ? c : (Array.isArray(c) ? c.map((b) => (b && (b.text || (typeof b.content === 'string' ? b.content : ''))) || '').join(' ') : '');
      if (/^\s*\[Request interrupted by user/.test(text)) return false;
      // /clear · /usage · /model 같은 명령과 그 출력도 사용자 줄로 남는다 — 대화 차례가 아니므로 더 앞을 본다
      if (/^\s*<(command-name|command-message|local-command-)/.test(text)) continue;
      return true; // 질문했거나 도구 결과를 넘긴 뒤 아직 답이 없다
    }
  }
  return null;
}

module.exports = { scan, stripAnsi, isRepaint, transcriptHitLimit, turnInProgress };

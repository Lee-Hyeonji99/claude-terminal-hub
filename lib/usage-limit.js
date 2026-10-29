'use strict';
/**
 * claude 화면에 사용 한도 도달 문구가 나왔는지 — 패널에 «다른 계정으로 이어가기» 를 제안할 때 쓴다.
 *
 * Claude Code 가 쓰는 문구 예:
 *   "Claude usage limit reached. Your limit will reset at 3pm"
 *   "5-hour limit reached ∙ resets 3pm"
 *   "You've hit your limit · resets 3pm"
 * 대화 내용에 같은 단어가 나와도 걸리지 않도록 «한도 문구 + 초기화(reset) 안내» 가 같은 줄에 있을 때만 본다.
 */

const LIMIT_RE = /(usage limit reached|limit reached|hit your (?:usage )?limit|reached your usage limit)[^\n]{0,80}\breset/i;
const TAIL_MAX = 600;

function stripAnsi(s) {
  return String(s)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[\]P][\s\S]*?(\x07|\x1b\\)/g, '')
    .replace(/\r/g, '\n');
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

module.exports = { scan, stripAnsi };

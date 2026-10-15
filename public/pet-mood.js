'use strict';
/**
 * 펫 팩의 동작 고르기 — 지금 상태에 맞는 동작 이름을 돌려준다.
 *   끄는 중 → run · 질문 대기 → pose · 작업 완료 → happy · Claude 일하는 중 → walk
 *   오래 조용함 → sleepy · 평소 → idle (가끔 look-around)
 * 팩에 그 동작이 없으면 비슷한 것으로 대신한다.
 */
(function (root) {
  const SLEEPY_AFTER_MS = 5 * 60 * 1000;
  const LOOK_AROUND_CHANCE = 0.15;

  const FALLBACK = {
    run: ['walk', 'idle'],
    pose: ['happy', 'look-around', 'idle'],
    happy: ['pose', 'idle'],
    walk: ['run', 'idle'],
    sleepy: ['idle'],
    'look-around': ['idle'],
    idle: [],
  };

  function want(s) {
    if (s.dragging) return 'run';
    if (s.questions > 0) return 'pose';
    if (s.done > 0) return 'happy';
    if (s.working > 0) return 'walk';
    if (s.idleMs >= SLEEPY_AFTER_MS) return 'sleepy';
    return s.roll < LOOK_AROUND_CHANCE ? 'look-around' : 'idle';
  }

  /**
   * @param s {actions:string[], questions, done, working, dragging, idleMs, roll(0~1 난수)}
   * @returns 동작 이름 또는 null(쓸 동작 없음)
   */
  function pickAction(s) {
    const have = new Set(s.actions || []);
    if (!have.size) return null;
    const w = want(s);
    for (const a of [w, ...(FALLBACK[w] || []), 'idle']) if (have.has(a)) return a;
    return s.actions[0];
  }

  const api = { pickAction, SLEEPY_AFTER_MS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetMood = api;
})(typeof window !== 'undefined' ? window : globalThis);

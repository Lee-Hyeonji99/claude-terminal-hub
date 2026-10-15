'use strict';
/**
 * 펫 창 배치 계산 (순수 함수 — electron/pet.js 가 쓰고 test/ 에서 검증한다).
 *
 * 기준점은 «펫 상자의 왼쪽 위». 펫은 화면 어디든(작업표시줄 위 포함) 놓을 수 있고,
 * 카드는 펫을 밀어내지 않고 자리가 있는 쪽으로 펼친다:
 *   위·왼쪽 → 위·오른쪽 → 아래·왼쪽 → 아래·오른쪽 → 옆(왼/오) → (모두 안 되면) 첫 후보를 작업영역 안으로.
 * 예전에는 카드를 늘 왼쪽 위로 펼치고 창 전체를 화면 안으로 밀어 넣어서,
 * 모니터 왼쪽 끝에서는 펫이 카드에 밀려 그 자리에 놓이지 않았다.
 */
const PET_BOX = 100;   // 캐릭터 84px + 여백 8px*2

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** 펫 상자가 화면(bounds) 밖으로 나가지 않게 — 작업영역이 아니라 화면 전체 기준. */
function clampPet(anchor, bounds) {
  return {
    x: Math.round(clamp(anchor.x, bounds.x, bounds.x + bounds.width - PET_BOX)),
    y: Math.round(clamp(anchor.y, bounds.y, bounds.y + bounds.height - PET_BOX)),
  };
}

function candidates(pet, cw, ch, wa) {
  const above = pet.y - ch;
  const below = pet.y + PET_BOX;
  const alignRight = pet.x + PET_BOX - cw;   // 카드 오른쪽 끝 = 펫 오른쪽 끝 → 왼쪽으로 펼침
  const alignLeft = pet.x;                    // 카드 왼쪽 끝 = 펫 왼쪽 끝 → 오른쪽으로 펼침
  const sideY = clamp(pet.y + PET_BOX - ch, wa.y, wa.y + wa.height - ch);
  return [
    { side: 'above-left', x: alignRight, y: above },
    { side: 'above-right', x: alignLeft, y: above },
    { side: 'below-left', x: alignRight, y: below },
    { side: 'below-right', x: alignLeft, y: below },
    { side: 'side-left', x: pet.x - cw, y: sideY },
    { side: 'side-right', x: pet.x + PET_BOX, y: sideY },
  ];
}

function fits(c, cw, ch, wa) {
  return c.x >= wa.x && c.y >= wa.y && c.x + cw <= wa.x + wa.width && c.y + ch <= wa.y + wa.height;
}

/**
 * @param {{anchor:{x,y}, card:{w,h}|null, workArea:{x,y,width,height}, bounds:{x,y,width,height}}} o
 * @returns {{ pet:{x,y}, side:string|null, window:{x,y,width,height}, local:{pet:{x,y}, card:{x,y}|null} }}
 */
function computeLayout({ anchor, card, workArea, bounds }) {
  const pet = clampPet(anchor, bounds);
  if (!card || !(card.w > 0) || !(card.h > 0)) {
    return {
      pet, side: null,
      window: { x: pet.x, y: pet.y, width: PET_BOX, height: PET_BOX },
      local: { pet: { x: 0, y: 0 }, card: null },
    };
  }
  const cw = Math.min(Math.ceil(card.w), workArea.width);
  const ch = Math.min(Math.ceil(card.h), workArea.height);
  const list = candidates(pet, cw, ch, workArea);
  let pick = list.find((c) => fits(c, cw, ch, workArea));
  if (!pick) {
    const f = list[0];
    pick = {
      side: f.side,
      x: clamp(f.x, workArea.x, workArea.x + workArea.width - cw),
      y: clamp(f.y, workArea.y, workArea.y + workArea.height - ch),
    };
  }
  const cx = Math.round(pick.x), cy = Math.round(pick.y);
  const left = Math.min(pet.x, cx), top = Math.min(pet.y, cy);
  const right = Math.max(pet.x + PET_BOX, cx + cw), bottom = Math.max(pet.y + PET_BOX, cy + ch);
  return {
    pet, side: pick.side,
    window: { x: left, y: top, width: right - left, height: bottom - top },
    local: { pet: { x: pet.x - left, y: pet.y - top }, card: { x: cx - left, y: cy - top } },
  };
}

module.exports = { computeLayout, clampPet, PET_BOX };

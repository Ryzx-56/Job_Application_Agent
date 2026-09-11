/* ========================================================================
   ONBOARDING TOUR — GEOMETRY

   Pure maths, kept out of the component so it can be exercised without a
   DOM: where the callout goes relative to the element it describes, and
   where its arrow sits on the callout's edge.
======================================================================== */
export type Rect = { top: number; left: number; width: number; height: number };
export type Side = "top" | "bottom" | "left" | "right";

export const BOX_W = 328;
/** Clearance between the highlighted element and the callout. */
const GAP = 16;
/** Smallest distance the callout may sit from a viewport edge. */
export const MARGIN = 12;
/** Padding of the spotlight cut-out around the element. */
export const PAD = 8;
export const ARROW = 14;

export function sameRect(a: Rect | null, b: Rect | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

/**
 * Where to put the callout relative to the highlighted element.
 *
 * Sides are physical, derived from measured pixels, so this is already
 * correct in RTL without a mirrored code path: in Arabic the sidebar is
 * on the right, so "the side with more room" resolves to left on its own.
 *
 * Wide elements get a preference for above/below — a 328px box beside a
 * full-width panel would be squeezed into a column — and narrow ones,
 * like a single menu row, get a preference for beside.
 */
export function placeCallout(target: Rect, boxH: number, vw: number, vh: number) {
  const space: Record<Side, number> = {
    top: target.top,
    bottom: vh - (target.top + target.height),
    left: target.left,
    right: vw - (target.left + target.width),
  };
  const needV = boxH + GAP + MARGIN;
  const needH = BOX_W + GAP + MARGIN;

  const wide = target.width > vw * 0.4;
  const order: Side[] = wide
    ? ["bottom", "top", "right", "left"]
    : ["right", "left", "bottom", "top"];

  let side = order.find((s) => space[s] >= (s === "top" || s === "bottom" ? needV : needH));
  if (!side) {
    // Nothing fits outright; take the roomiest side and clamp into view.
    side = order.reduce((best, s) => {
      const scale = (x: Side) => space[x] / (x === "top" || x === "bottom" ? needV : needH);
      return scale(s) > scale(best) ? s : best;
    }, order[0]);
  }

  const boxW = Math.min(BOX_W, vw - MARGIN * 2);
  let left: number;
  let top: number;

  if (side === "bottom" || side === "top") {
    left = target.left + target.width / 2 - boxW / 2;
    top = side === "bottom" ? target.top + target.height + GAP : target.top - GAP - boxH;
  } else {
    left = side === "right" ? target.left + target.width + GAP : target.left - GAP - boxW;
    top = target.top + target.height / 2 - boxH / 2;
  }

  left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, vw - boxW - MARGIN));
  top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, vh - boxH - MARGIN));

  // The arrow tracks the element's centre along the box edge it sits on,
  // pulled in far enough not to poke out of a rounded corner.
  const INSET = 20;
  const arrow =
    side === "bottom" || side === "top"
      ? Math.min(Math.max(target.left + target.width / 2 - left, INSET), boxW - INSET)
      : Math.min(Math.max(target.top + target.height / 2 - top, INSET), boxH - INSET);

  return { side, left, top, boxW, arrow };
}

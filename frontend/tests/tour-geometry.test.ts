import { test } from "node:test";
import assert from "node:assert/strict";

import { placeCallout, sameRect, BOX_W, MARGIN, type Rect, type Side } from "../src/lib/tour-geometry.ts";

/* Run with `npm test`.

   THE ONBOARDING TOUR CANNOT BE EYEBALLED IN CI, and its one job is to put
   a box beside a thing and point an arrow at it. These cases are measured
   from the real dashboard chrome — the desktop rail is w-64 (256px) with
   px-3 padding, the mobile drawer is w-72 (288px), a nav row is py-2.5 on
   text-sm — so a regression in the placement maths fails here rather than
   on a user's phone.

   RTL IS COVERED BY MIRRORING THE RECTS, not by a flag: placeCallout works
   in measured pixels and has no direction of its own, which is the property
   worth protecting. In Arabic the sidebar is on the right, so the same
   function must choose "left" without being told. */

type Case = { name: string; target: Rect; boxH: number; vw: number; vh: number; side: Side };

const CASES: Case[] = [
  { name: "desktop LTR, one menu row", target: { top: 210, left: 12, width: 232, height: 42 }, boxH: 170, vw: 1440, vh: 900, side: "right" },
  { name: "desktop RTL, one menu row", target: { top: 210, left: 1196, width: 232, height: 42 }, boxH: 170, vw: 1440, vh: 900, side: "left" },
  { name: "desktop LTR, the whole menu", target: { top: 120, left: 12, width: 232, height: 400 }, boxH: 150, vw: 1440, vh: 900, side: "right" },
  { name: "desktop RTL, the whole menu", target: { top: 120, left: 1196, width: 232, height: 400 }, boxH: 150, vw: 1440, vh: 900, side: "left" },
  { name: "desktop, the upload/create panel", target: { top: 300, left: 300, width: 880, height: 108 }, boxH: 160, vw: 1440, vh: 900, side: "bottom" },
  { name: "laptop 1024, one menu row", target: { top: 210, left: 12, width: 232, height: 42 }, boxH: 170, vw: 1024, vh: 700, side: "right" },
  { name: "tablet 768, one menu row", target: { top: 210, left: 12, width: 232, height: 42 }, boxH: 170, vw: 768, vh: 1024, side: "right" },
  // Below lg the menu is a 288px drawer on a 375px screen: no room beside
  // it, so these must fall back to above/below rather than squeezing.
  { name: "mobile drawer LTR, one row", target: { top: 200, left: 12, width: 264, height: 42 }, boxH: 190, vw: 375, vh: 812, side: "bottom" },
  { name: "mobile drawer RTL, one row", target: { top: 200, left: 99, width: 264, height: 42 }, boxH: 190, vw: 375, vh: 812, side: "bottom" },
  { name: "mobile drawer, a row near the bottom", target: { top: 620, left: 12, width: 264, height: 42 }, boxH: 190, vw: 375, vh: 812, side: "top" },
  { name: "mobile, the upload/create panel", target: { top: 300, left: 16, width: 343, height: 176 }, boxH: 200, vw: 375, vh: 812, side: "bottom" },
];

for (const c of CASES) {
  test(`${c.name} — callout goes ${c.side}`, () => {
    const p = placeCallout(c.target, c.boxH, c.vw, c.vh);
    assert.equal(p.side, c.side);
  });
}

test("the callout is always fully on screen", () => {
  for (const c of CASES) {
    const p = placeCallout(c.target, c.boxH, c.vw, c.vh);
    const boxW = Math.min(BOX_W, c.vw - MARGIN * 2);
    assert.ok(p.left >= MARGIN - 0.01, `${c.name}: left edge off screen`);
    assert.ok(p.left + boxW <= c.vw - MARGIN + 0.01, `${c.name}: right edge off screen`);
    assert.ok(p.top >= MARGIN - 0.01, `${c.name}: top edge off screen`);
    assert.ok(p.top + c.boxH <= c.vh - MARGIN + 0.01, `${c.name}: bottom edge off screen`);
  }
});

test("the callout never covers the thing it is describing", () => {
  for (const c of CASES) {
    const p = placeCallout(c.target, c.boxH, c.vw, c.vh);
    const boxW = Math.min(BOX_W, c.vw - MARGIN * 2);
    const clear =
      p.side === "bottom" ? p.top >= c.target.top + c.target.height
      : p.side === "top" ? p.top + c.boxH <= c.target.top
      : p.side === "right" ? p.left >= c.target.left + c.target.width
      : p.left + boxW <= c.target.left;
    assert.ok(clear, `${c.name}: the box sits on top of the element`);
  }
});

test("the arrow stays on the edge it is drawn on, clear of the rounded corners", () => {
  for (const c of CASES) {
    const p = placeCallout(c.target, c.boxH, c.vw, c.vh);
    const boxW = Math.min(BOX_W, c.vw - MARGIN * 2);
    const along = p.side === "top" || p.side === "bottom" ? boxW : c.boxH;
    assert.ok(p.arrow >= 20 - 0.01, `${c.name}: arrow off the near corner`);
    assert.ok(p.arrow <= along - 20 + 0.01, `${c.name}: arrow off the far corner`);
  }
});

test("the arrow tracks the element's centre, so it points at it", () => {
  for (const c of CASES) {
    const p = placeCallout(c.target, c.boxH, c.vw, c.vh);
    const boxW = Math.min(BOX_W, c.vw - MARGIN * 2);
    const along = p.side === "top" || p.side === "bottom" ? boxW : c.boxH;
    const centre =
      p.side === "top" || p.side === "bottom"
        ? c.target.left + c.target.width / 2 - p.left
        : c.target.top + c.target.height / 2 - p.top;
    assert.ok(
      Math.abs(p.arrow - Math.min(Math.max(centre, 20), along - 20)) < 0.01,
      `${c.name}: arrow is not aimed at the element`
    );
  }
});

test("a screen too small for the box anywhere still keeps it on screen", () => {
  // A short landscape phone with a tall element: nothing fits, so the
  // roomiest side wins and the result is clamped rather than negative.
  const p = placeCallout({ top: 40, left: 20, width: 600, height: 260 }, 200, 700, 340);
  const boxW = Math.min(BOX_W, 700 - MARGIN * 2);
  assert.ok(p.left >= MARGIN && p.left + boxW <= 700 - MARGIN);
  assert.ok(p.top >= MARGIN && p.top + 200 <= 340 - MARGIN);
});

test("sameRect tells a moved element from a still one, ignoring sub-pixel drift", () => {
  const a: Rect = { top: 10, left: 10, width: 100, height: 40 };
  assert.ok(sameRect(a, { ...a }));
  assert.ok(sameRect(a, { ...a, top: 10.4 }), "sub-pixel drift must not thrash React state");
  assert.ok(!sameRect(a, { ...a, top: 12 }));
  assert.ok(sameRect(null, null));
  assert.ok(!sameRect(a, null), "an element that disappeared is not the same as one that moved");
  assert.ok(!sameRect(null, a));
});

"use client";

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { useLang } from "@/lib/language";
import { placeCallout, sameRect, BOX_W, MARGIN, PAD, ARROW, type Rect } from "@/lib/tour-geometry";

/* ========================================================================
   ONBOARDING TOUR

   The first thing a brand-new account sees, before the free-tier badge
   popup. It walks through the dashboard and the menu, anchoring a callout
   to the real element it is describing and pointing an arrow at it.

   WHO SEES IT. Only accounts created on or after TOUR_LIVE_FROM. Anyone
   who was already using Tarshih before the tour existed has learned the
   product the hard way and does not need a tour of it — and gating on the
   account's own creation timestamp is exact, needs no migration, and
   cannot misfire the way "have they done anything yet?" heuristics do.
   Append ?tour=1 to any dashboard URL to replay it on any account.

   ONCE. Dismissal is recorded in localStorage under the user's id, so it
   is per-device: someone who signs up on their phone and later opens a
   laptop sees it once more there. That is the price of not adding a
   column to `profiles`, and it errs in the harmless direction.

   If localStorage cannot be read (private mode, blocked site data) we do
   NOT fall back to showing it — an un-dismissable tour that returns on
   every navigation is worse than a tour nobody sees. A session-scoped
   in-memory set backs it up so a dismissal always sticks for that tab.
======================================================================== */

/**
 * Accounts created before this instant never see the tour.
 * 2026-09-11, the day it shipped.
 */
const TOUR_LIVE_FROM = Date.parse("2026-09-11T00:00:00Z");

const STORAGE_PREFIX = "tarshih.tour.v1:";

/** Backs up localStorage for the tab, so dismissal sticks even if storage throws. */
const dismissedThisSession = new Set<string>();

function hasSeenTour(userId: string): boolean {
  if (dismissedThisSession.has(userId)) return true;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + userId) === "1";
  } catch {
    // Unknown, not false. Treat it as seen: see the header for why.
    return true;
  }
}

function markTourSeen(userId: string) {
  dismissedThisSession.add(userId);
  try {
    window.localStorage.setItem(STORAGE_PREFIX + userId, "1");
  } catch {
    // Session-scoped fallback already applied above.
  }
}

/* ------------------------------------------------------------------
   "Is the tour on screen right now?" — published so the dashboard can
   hold back the badge popup instead of stacking it underneath.
------------------------------------------------------------------ */
let tourActive = false;
const tourListeners = new Set<() => void>();

function setTourActive(next: boolean) {
  if (tourActive === next) return;
  tourActive = next;
  tourListeners.forEach((fn) => fn());
}

/** True while the onboarding tour is being shown. */
export function useTourActive(): boolean {
  return useSyncExternalStore(
    (fn) => {
      tourListeners.add(fn);
      return () => tourListeners.delete(fn);
    },
    () => tourActive,
    () => false
  );
}

/* ------------------------------------------------------------------
   STEPS

   `selector` is the element the callout points at. A step whose element
   is not on the current page still runs — it just renders centred with
   no arrow, which is honest rather than broken.

   `inSidebar` steps need the mobile drawer open to have anything to
   point at, since the rail is desktop-only.
------------------------------------------------------------------ */
type StepKey = "welcome" | "cv" | "menu" | "resumes" | "jobs" | "interview" | "linkedin" | "pricing";

const STEPS: { key: StepKey; selector: string | null; inSidebar?: boolean }[] = [
  { key: "welcome", selector: null },
  { key: "cv", selector: '[data-tour="cv-start"]' },
  { key: "menu", selector: '[data-tour="nav"]', inSidebar: true },
  { key: "resumes", selector: '[data-tour="nav/dashboard/resumes"]', inSidebar: true },
  { key: "jobs", selector: '[data-tour="nav/dashboard/job-search"]', inSidebar: true },
  { key: "interview", selector: '[data-tour="nav/dashboard/interview"]', inSidebar: true },
  { key: "linkedin", selector: '[data-tour="nav/dashboard/linkedin"]', inSidebar: true },
  { key: "pricing", selector: '[data-tour="nav/dashboard/upgrade"]', inSidebar: true },
];

/**
 * The first element matching `selector` that is actually rendered.
 *
 * The sidebar exists twice in the DOM — the desktop rail and the mobile
 * drawer — and only one of them has a size at any given width. Picking
 * the first match blindly would point the arrow at a `display:none`
 * element sitting at 0,0.
 */
function visibleTarget(selector: string): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(selector));
  return all.find((el) => el.getBoundingClientRect().width > 0) ?? null;
}

/* ------------------------------------------------------------------
   COMPONENT
------------------------------------------------------------------ */
export function OnboardingTour({
  userId,
  accountCreatedAt,
  onSidebarNeeded,
}: {
  /** Supabase auth user id — the tour is remembered per account. */
  userId: string;
  /** ISO timestamp of the account's creation. */
  accountCreatedAt?: string | null;
  /** Asks the shell to open or close the mobile drawer. */
  onSidebarNeeded: (open: boolean) => void;
}) {
  const { t, lang, isRTL } = useLang();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<Rect | null>(null);
  const [boxH, setBoxH] = useState(180);
  const [viewport, setViewport] = useState({ w: 1024, h: 768 });
  const [entered, setEntered] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const isAr = lang === "ar";

  const step = STEPS[index];
  const isLast = index >= STEPS.length - 1;

  /* -- Should it run at all? Decided once, on mount. ------------------ */
  useEffect(() => {
    if (!userId) return;
    const forced = new URLSearchParams(window.location.search).get("tour") === "1";
    if (!forced) {
      const created = accountCreatedAt ? Date.parse(accountCreatedAt) : NaN;
      if (!Number.isFinite(created) || created < TOUR_LIVE_FROM) return;
      if (hasSeenTour(userId)) return;
    }
    setOpen(true);
    // Mount-only by design: the tour must not restart because a prop moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    setTourActive(open);
    return () => setTourActive(false);
  }, [open]);

  const finish = useCallback(() => {
    markTourSeen(userId);
    setOpen(false);
    onSidebarNeeded(false);
  }, [userId, onSidebarNeeded]);

  /* -- The mobile drawer, opened only for the steps that need it. ----- */
  useEffect(() => {
    if (!open) return;
    const wantsDrawer = !!step.inSidebar && window.matchMedia("(max-width: 1023px)").matches;
    onSidebarNeeded(wantsDrawer);
  }, [open, step, onSidebarNeeded]);

  /* -- Bring the element into view when the step changes. ------------- */
  useEffect(() => {
    if (!open || !step.selector) {
      setTarget(null);
      return;
    }
    setEntered(false);
    const id = window.setTimeout(() => {
      const el = visibleTarget(step.selector!);
      if (!el) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
    }, 60); // lets the drawer mount before we measure or scroll to it
    return () => window.clearTimeout(id);
  }, [open, step]);

  /* -- Track the element every frame. --------------------------------
     Cheaper than it looks (one getBoundingClientRect per frame) and it
     makes scrolling, resizing, the drawer sliding in and any late layout
     shift correct for free, with none of the listener edge cases. */
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let last: Rect | null = null;
    const tick = () => {
      const el = step.selector ? visibleTarget(step.selector) : null;
      const next: Rect | null = el
        ? (() => {
            const r = el.getBoundingClientRect();
            return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
          })()
        : null;
      if (!sameRect(last, next)) {
        last = next;
        setTarget(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, step]);

  /* -- Measure the callout so it can be placed against its own height.
     useEffect rather than useLayoutEffect: the latter warns on the server,
     and the box fades in over 260ms, so the single frame it spends at the
     estimated height is never visible. */
  useEffect(() => {
    if (!open) return;
    const h = boxRef.current?.offsetHeight;
    if (h && Math.abs(h - boxH) > 1) setBoxH(h);
  });

  /* -- Re-place on resize. The frame loop already covers this whenever
     there is an element to track, but the centred steps have no rect to
     change, so they need telling. */
  useEffect(() => {
    if (!open) return;
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  /* -- One frame before animating in, so there is a state to move from. */
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [open, index]);

  /* -- Move focus to the callout so it is announced and Tab starts here. */
  useEffect(() => {
    if (!open) return;
    boxRef.current?.focus({ preventScroll: true });
  }, [open, index]);

  const next = useCallback(() => {
    if (isLast) finish();
    else setIndex((i) => i + 1);
  }, [isLast, finish]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        // Reading direction decides which arrow means "onward".
        const forward = isRTL ? e.key === "ArrowLeft" : e.key === "ArrowRight";
        if (forward) {
          e.preventDefault();
          next();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish, next, isRTL]);

  if (!open) return null;

  const copy = t.dashboard.tour;
  const stepCopy = copy.steps[step.key];

  const { w: vw, h: vh } = viewport;
  const placed = target ? placeCallout(target, boxH, vw, vh) : null;
  const boxW = Math.min(BOX_W, vw - MARGIN * 2);

  // Centred when there is nothing to point at: the welcome step, and any
  // step whose element is not on the page the user happens to be on.
  const boxStyle: React.CSSProperties = placed
    ? { top: placed.top, left: placed.left, width: placed.boxW }
    : { top: Math.max(MARGIN, vh / 2 - boxH / 2), left: Math.max(MARGIN, vw / 2 - boxW / 2), width: boxW };

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[120]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
    >
      {/* Swallows every click that is not on the card. A box-shadow is
          paint only, so without this the page under the dim is still
          live and one stray tap on a menu row would navigate out of the
          tour. The three controls on the card are the only way out. */}
      <div className="pointer-events-auto fixed inset-0" aria-hidden />

      {/* Dimmed everywhere except the element being described. With no
          element, it is a plain scrim. */}
      {target ? (
        <div
          className={`pointer-events-none fixed rounded-xl ring-2 ring-blue-400/80 ${
            entered ? "opacity-100" : "opacity-0"
          } jbaa-tour-fade`}
          style={{
            top: target.top,
            left: target.left,
            width: target.width,
            height: target.height,
            boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.62), 0 0 0 6px rgba(59, 130, 246, 0.22)",
          }}
          aria-hidden
        />
      ) : (
        <div
          className={`pointer-events-none fixed inset-0 bg-slate-950/60 ${entered ? "opacity-100" : "opacity-0"} jbaa-tour-fade`}
          aria-hidden
        />
      )}

      <div
        ref={boxRef}
        tabIndex={-1}
        style={boxStyle}
        className={`pointer-events-auto fixed rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl outline-none jbaa-tour-move ${
          entered ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-[0.98] opacity-0"
        }`}
      >
        {/* The pointer at the element. A rotated square with only its two
            outward borders drawn, so it reads as a continuation of the
            card's own edge. */}
        {placed && (
          <span
            aria-hidden
            className="absolute bg-white"
            style={{
              width: ARROW,
              height: ARROW,
              transform: "rotate(45deg)",
              ...(placed.side === "bottom"
                ? { top: -ARROW / 2, left: placed.arrow - ARROW / 2, borderTop: "1px solid rgb(226 232 240)", borderLeft: "1px solid rgb(226 232 240)" }
                : placed.side === "top"
                ? { bottom: -ARROW / 2, left: placed.arrow - ARROW / 2, borderBottom: "1px solid rgb(226 232 240)", borderRight: "1px solid rgb(226 232 240)" }
                : placed.side === "right"
                ? { left: -ARROW / 2, top: placed.arrow - ARROW / 2, borderLeft: "1px solid rgb(226 232 240)", borderBottom: "1px solid rgb(226 232 240)" }
                : { right: -ARROW / 2, top: placed.arrow - ARROW / 2, borderRight: "1px solid rgb(226 232 240)", borderTop: "1px solid rgb(226 232 240)" }),
            }}
          />
        )}

        <button
          type="button"
          onClick={finish}
          aria-label={copy.close}
          className="absolute end-3 top-3 rounded-lg p-1 text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
        >
          <X className="size-4" aria-hidden />
        </button>

        <h2
          id="tour-title"
          className={`pe-8 text-base font-semibold text-slate-900 ${isAr ? "leading-[1.7]" : ""}`}
        >
          {stepCopy.title}
        </h2>
        <p className={`mt-2 text-sm text-slate-500 ${isAr ? "leading-[1.9]" : "leading-relaxed"}`}>
          {stepCopy.body}
        </p>

        <div className="mt-5 flex items-center justify-between gap-3">
          {/* Progress as dots rather than a worded label: Arabic has no
              uppercase and no letter-spaced small-caps convention, so a
              styled "STEP 3 OF 8" only ever looks right in one language. */}
          <div
            className="flex items-center gap-1.5"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={STEPS.length}
            aria-valuenow={index + 1}
            aria-label={copy.progress
              .replace("{current}", String(index + 1))
              .replace("{total}", String(STEPS.length))}
          >
            {STEPS.map((s, i) => (
              <span
                key={s.key}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === index ? "w-4 bg-blue-600" : i < index ? "w-1.5 bg-blue-200" : "w-1.5 bg-slate-200"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={finish}
              className="rounded-lg px-2.5 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40"
            >
              {copy.skip}
            </button>
            <button
              type="button"
              onClick={next}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
            >
              {isLast ? copy.done : copy.next}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .jbaa-tour-fade { transition: opacity 260ms ease; }
        .jbaa-tour-move {
          transition: opacity 260ms ease, transform 260ms ease,
                      top 320ms cubic-bezier(0.22, 1, 0.36, 1),
                      left 320ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @media (prefers-reduced-motion: reduce) {
          .jbaa-tour-fade, .jbaa-tour-move { transition: none; }
        }
      `}</style>
    </div>
  );
}

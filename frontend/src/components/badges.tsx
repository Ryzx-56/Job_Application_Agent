"use client";

import React from "react";

/* ========================================================================
   ROLE BADGES

   Two self-contained chips. Both ship their own <style> block with
   uniquely-prefixed class names rather than relying on Tailwind config, so
   they can be dropped anywhere without touching global CSS.

   Both honour prefers-reduced-motion: every animation is confined to a
   media query so a user who asked the OS to stop moving things gets the
   same badge, just still.

   NEITHER BADGE GRANTS ANYTHING. They render from flags the backend
   reports; every privileged route re-checks server-side. Showing a badge
   is cosmetic, and faking one in devtools gets you a nicer-looking chip
   and nothing else.
======================================================================== */

type BadgeSize = "sm" | "md";

const SIZES: Record<BadgeSize, { pad: string; text: string; icon: string; gap: string }> = {
  sm: { pad: "px-2 py-0.5", text: "text-[10px]", icon: "9px", gap: "gap-1" },
  md: { pad: "px-2.5 py-1", text: "text-xs", icon: "11px", gap: "gap-1.5" },
};

/* ------------------------------------------------------------------------
   ADMIN — glitched terminal chip.

   The glitch is three stacked copies of the same text: a cyan one nudged
   left, a magenta one nudged right, and the crisp white original on top.
   That's the chromatic-aberration look you get from a misaligned signal.
   The copies are clipped to changing horizontal slices on each animation
   step, so it reads as tearing rather than a blur, and they sit behind the
   original so the label always stays legible.

   aria-hidden on the decorative layers: a screen reader should hear
   "Admin" once, not three times.
------------------------------------------------------------------------ */
export function AdminBadge({ size = "md", className = "" }: { size?: BadgeSize; className?: string }) {
  const s = SIZES[size];
  return (
    <>
      <style>{`
        .jbaa-admin {
          position: relative;
          isolation: isolate;
          background: linear-gradient(180deg, #0b1020 0%, #05070f 100%);
          border: 1px solid rgba(34, 211, 238, 0.45);
          box-shadow:
            0 0 0 1px rgba(0, 0, 0, 0.6),
            0 0 12px -2px rgba(34, 211, 238, 0.55),
            inset 0 1px 0 rgba(255, 255, 255, 0.07);
          overflow: hidden;
        }
        /* Scanlines. Very low contrast on purpose — enough to read as a CRT,
           not enough to fight the text. */
        .jbaa-admin::after {
          content: "";
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            0deg,
            rgba(255, 255, 255, 0.05) 0px,
            rgba(255, 255, 255, 0.05) 1px,
            transparent 1px,
            transparent 3px
          );
          pointer-events: none;
          z-index: 2;
        }
        .jbaa-admin__label { position: relative; display: inline-block; z-index: 1; }
        .jbaa-admin__ghost {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          pointer-events: none;
          z-index: -1;
          opacity: 0.85;
        }
        .jbaa-admin__ghost--cyan { color: #22d3ee; }
        .jbaa-admin__ghost--magenta { color: #f472b6; }

        @media (prefers-reduced-motion: no-preference) {
          .jbaa-admin__ghost--cyan { animation: jbaa-glitch-cyan 3.2s infinite steps(1); }
          .jbaa-admin__ghost--magenta { animation: jbaa-glitch-magenta 3.2s infinite steps(1); }
          .jbaa-admin__label { animation: jbaa-glitch-jitter 3.2s infinite steps(1); }
          .jbaa-admin::before {
            content: "";
            position: absolute;
            inset: 0;
            background: linear-gradient(180deg, transparent 0%, rgba(34, 211, 238, 0.18) 50%, transparent 100%);
            transform: translateY(-100%);
            animation: jbaa-scan 3.2s linear infinite;
            pointer-events: none;
            z-index: 2;
          }
        }

        /* Idle most of the cycle, then two short bursts. Constant glitching
           looks broken; intermittent glitching looks deliberate. */
        @keyframes jbaa-glitch-cyan {
          0%, 88%, 100% { transform: translate(0, 0); clip-path: inset(0 0 0 0); }
          89% { transform: translate(-2px, -1px); clip-path: inset(0 0 62% 0); }
          91% { transform: translate(-3px, 1px); clip-path: inset(58% 0 0 0); }
          93% { transform: translate(2px, 0); clip-path: inset(30% 0 40% 0); }
          95% { transform: translate(-1px, 0); clip-path: inset(0 0 0 0); }
        }
        @keyframes jbaa-glitch-magenta {
          0%, 88%, 100% { transform: translate(0, 0); clip-path: inset(0 0 0 0); }
          89% { transform: translate(2px, 1px); clip-path: inset(0 0 55% 0); }
          91% { transform: translate(3px, -1px); clip-path: inset(64% 0 0 0); }
          93% { transform: translate(-2px, 0); clip-path: inset(25% 0 45% 0); }
          95% { transform: translate(1px, 0); clip-path: inset(0 0 0 0); }
        }
        @keyframes jbaa-glitch-jitter {
          0%, 88%, 100% { transform: translate(0, 0); }
          89% { transform: translate(1px, 0); }
          91% { transform: translate(-1px, 0); }
          93% { transform: translate(1px, 0); }
        }
        @keyframes jbaa-scan {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
      `}</style>

      <span
        className={`jbaa-admin inline-flex items-center rounded-md font-mono font-bold uppercase tracking-[0.14em] text-white ${s.pad} ${s.text} ${s.gap} ${className}`}
      >
        {/* Terminal-style caret. Purely decorative. */}
        <svg width={s.icon} height={s.icon} viewBox="0 0 12 12" fill="none" aria-hidden className="shrink-0">
          <path d="M1.5 2.5 4.5 6l-3 3.5" stroke="#22d3ee" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6.5 9.5h4" stroke="#f472b6" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span className="jbaa-admin__label">
          <span className="jbaa-admin__ghost jbaa-admin__ghost--cyan" aria-hidden>Admin</span>
          <span className="jbaa-admin__ghost jbaa-admin__ghost--magenta" aria-hidden>Admin</span>
          Admin
        </span>
      </span>
    </>
  );
}

/* ------------------------------------------------------------------------
   OWNER — regalia chip.

   Gold on near-black, because gold on white reads as mustard. The shine is
   a narrow white gradient swept diagonally across the text via
   background-clip, which looks like light moving over metal rather than
   the whole chip blinking. Slow (5s) and mostly idle so it reads as
   expensive instead of attention-seeking.
------------------------------------------------------------------------ */
export function OwnerBadge({ size = "md", className = "" }: { size?: BadgeSize; className?: string }) {
  const s = SIZES[size];
  return (
    <>
      <style>{`
        .jbaa-owner {
          position: relative;
          isolation: isolate;
          background:
            linear-gradient(180deg, #1c1408 0%, #0a0703 100%);
          border: 1px solid transparent;
          /* Two backgrounds + border-box clipping paints a true gradient
             border, which a plain border-color can't do. */
          background-image:
            linear-gradient(180deg, #1c1408 0%, #0a0703 100%),
            linear-gradient(135deg, #f5d17a 0%, #b8860b 35%, #fff3c4 50%, #b8860b 65%, #f5d17a 100%);
          background-origin: border-box;
          background-clip: padding-box, border-box;
          box-shadow:
            0 1px 2px rgba(0, 0, 0, 0.5),
            0 0 14px -4px rgba(245, 209, 122, 0.65),
            inset 0 1px 0 rgba(255, 240, 190, 0.16);
        }
        .jbaa-owner__text {
          background: linear-gradient(180deg, #fff6d5 0%, #f0c96a 45%, #c8912e 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        @media (prefers-reduced-motion: no-preference) {
          .jbaa-owner__text {
            background: linear-gradient(
              100deg,
              #f0c96a 0%, #f0c96a 40%,
              #fffdf2 48%, #ffffff 50%, #fffdf2 52%,
              #f0c96a 60%, #f0c96a 100%
            );
            background-size: 250% 100%;
            -webkit-background-clip: text;
            background-clip: text;
            animation: jbaa-shine 5s ease-in-out infinite;
          }
          .jbaa-owner__crown { animation: jbaa-crown-glow 5s ease-in-out infinite; }
        }
        @keyframes jbaa-shine {
          0%, 55%, 100% { background-position: 130% 0; }
          80% { background-position: -30% 0; }
        }
        @keyframes jbaa-crown-glow {
          0%, 55%, 100% { filter: drop-shadow(0 0 0 rgba(255, 231, 163, 0)); }
          72% { filter: drop-shadow(0 0 3px rgba(255, 231, 163, 0.95)); }
        }
      `}</style>

      <span
        className={`jbaa-owner inline-flex items-center rounded-md font-semibold uppercase tracking-[0.18em] ${s.pad} ${s.text} ${s.gap} ${className}`}
      >
        <svg width={s.icon} height={s.icon} viewBox="0 0 14 14" fill="none" aria-hidden className="jbaa-owner__crown shrink-0">
          <path
            d="M1.6 4.4 3.9 7 7 2.2 10.1 7l2.3-2.6-1 6.6H2.6l-1-6.6Z"
            fill="url(#jbaa-crown-fill)"
            stroke="#8a6212"
            strokeWidth="0.5"
            strokeLinejoin="round"
          />
          <circle cx="7" cy="12.4" r="0.75" fill="#f5d17a" />
          <defs>
            <linearGradient id="jbaa-crown-fill" x1="7" y1="2" x2="7" y2="12" gradientUnits="userSpaceOnUse">
              <stop stopColor="#fff3c4" />
              <stop offset="0.5" stopColor="#f0c96a" />
              <stop offset="1" stopColor="#c8912e" />
            </linearGradient>
          </defs>
        </svg>
        <span className="jbaa-owner__text">Owner</span>
      </span>
    </>
  );
}

/* ------------------------------------------------------------------------
   Convenience wrapper. Renders whichever badges apply, in rank order
   (Owner first), or nothing at all for a normal account.
------------------------------------------------------------------------ */
export function RoleBadges({
  isOwner,
  isAdmin,
  size = "md",
  className = "",
}: {
  isOwner?: boolean;
  isAdmin?: boolean;
  size?: BadgeSize;
  className?: string;
}) {
  if (!isOwner && !isAdmin) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      {isOwner && <OwnerBadge size={size} />}
      {isAdmin && <AdminBadge size={size} />}
    </span>
  );
}

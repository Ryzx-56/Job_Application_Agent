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

type BadgeSize = "sm" | "md" | "lg";

/* ------------------------------------------------------------------------
   Tooltip.

   A native `title` attribute would be simpler, but it can't be styled, it
   takes ~1s to appear, and it never shows on touch. This is a styled
   bubble on hover AND keyboard focus, with the same text also exposed as
   the element's accessible name so screen readers get the explanation
   rather than just the word "Owner".

   Positioned above and centred; `pointer-events-none` so it can never sit
   between the cursor and whatever is underneath.
------------------------------------------------------------------------ */
function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="group/tip relative inline-flex" tabIndex={0} aria-label={text}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium normal-case tracking-normal text-white shadow-lg group-hover/tip:block group-focus/tip:block"
      >
        {text}
        <span
          className="absolute left-1/2 top-full -ml-1 border-4 border-transparent border-t-slate-900"
          aria-hidden
        />
      </span>
    </span>
  );
}

/** One short line each. Kept here so both the Dashboard and Settings show
 *  identical wording. */
export const BADGE_TOOLTIPS = {
  owner: {
    en: "Given to the owner of Tarshih.",
    ar: "تُمنح لمالك ترشيح.",
  },
  admin: {
    en: "Given to an admin of Tarshih.",
    ar: "تُمنح لمشرف في ترشيح.",
  },
  founder: {
    en: "Given to Tarshih's earliest subscribers.",
    ar: "تُمنح لأوائل المشتركين في ترشيح.",
  },
  alpha: {
    en: "Given to early testers who helped shape Tarshih.",
    ar: "تُمنح للمختبرين الأوائل الذين ساهموا في تطوير ترشيح.",
  },
};

const SIZES: Record<BadgeSize, { pad: string; text: string; icon: string; gap: string }> = {
  sm: { pad: "px-2 py-0.5", text: "text-[10px]", icon: "9px", gap: "gap-1" },
  md: { pad: "px-2.5 py-1", text: "text-xs", icon: "11px", gap: "gap-1.5" },
  // For the Dashboard badge row, where these are the thing you're meant to
  // notice rather than a label tucked beside a heading. A step down from
  // the original lg (px-3.5/text-sm/15px) — still clearly the emphasis
  // size, just no longer overpowering the heading beneath it.
  lg: { pad: "px-3 py-1", text: "text-[13px]", icon: "13px", gap: "gap-1.5" },
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
export function AdminBadge({ size = "md", className = "", tooltip }: { size?: BadgeSize; className?: string; tooltip?: string }) {
  const s = SIZES[size];
  const chip = (
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
          .jbaa-admin__ghost--cyan { animation: jbaa-glitch-cyan 2.2s infinite steps(1); }
          .jbaa-admin__ghost--magenta { animation: jbaa-glitch-magenta 2.2s infinite steps(1); }
          .jbaa-admin__label { animation: jbaa-glitch-jitter 2.2s infinite steps(1); }
          .jbaa-admin::before {
            content: "";
            position: absolute;
            inset: 0;
            background: linear-gradient(180deg, transparent 0%, rgba(34, 211, 238, 0.18) 50%, transparent 100%);
            transform: translateY(-100%);
            animation: jbaa-scan 2.2s linear infinite;
            pointer-events: none;
            z-index: 2;
          }
        }

        /* Idle most of the cycle, then two short bursts. Constant glitching
           looks broken; intermittent glitching looks deliberate. Cycle is
           2.2s (was 3.2s) so the bursts come round noticeably more often
           while each burst stays the same length — the keyframe percentages
           are unchanged, only the period shortened. */
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
  return tooltip ? <Tooltip text={tooltip}>{chip}</Tooltip> : chip;
}

/* ------------------------------------------------------------------------
   OWNER — regalia chip.

   Gold on near-black, because gold on white reads as mustard. The shine is
   a narrow white gradient swept diagonally across the text via
   background-clip, which looks like light moving over metal rather than
   the whole chip blinking. Slow (5s) and mostly idle so it reads as
   expensive instead of attention-seeking.
------------------------------------------------------------------------ */
export function OwnerBadge({ size = "md", className = "", tooltip }: { size?: BadgeSize; className?: string; tooltip?: string }) {
  const s = SIZES[size];
  const chip = (
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
  return tooltip ? <Tooltip text={tooltip}>{chip}</Tooltip> : chip;
}

/* ------------------------------------------------------------------------
   FOUNDING MEMBER — iridescent seal.

   Deliberately shares NONE of Owner's vocabulary. Owner owns gold and the
   crown; reusing either here would make the two read as ranks of the same
   thing rather than different things. This one is amethyst-to-teal
   iridescence with a faceted gem, which is premium without being regal.

   The iridescence is a wide multi-stop gradient drifting slowly across
   both the border and the text, so the colour you see depends on where you
   look, like a hologram. Slow (7s) and continuous rather than the Owner
   badge's discrete shine, so the two never look like they're animating in
   sync when they sit side by side.
------------------------------------------------------------------------ */
export function FoundingMemberBadge({
  number,
  label,
  size = "md",
  className = "",
  tooltip,
}: {
  number?: number | null;
  /** Full display text. Defaults to English; pass the Arabic string for RTL. */
  label?: string;
  size?: BadgeSize;
  className?: string;
  tooltip?: string;
}) {
  const s = SIZES[size];
  const text = label ?? `Founding Member${number ? ` #${number}` : ""}`;
  const chip = (
    <>
      <style>{`
        .jbaa-founder {
          position: relative;
          isolation: isolate;
          border: 1px solid transparent;
          background-image:
            linear-gradient(180deg, #191233 0%, #0d0a1c 100%),
            linear-gradient(115deg, #c084fc 0%, #7dd3fc 25%, #f0abfc 50%, #5eead4 75%, #c084fc 100%);
          background-size: 100% 100%, 300% 100%;
          background-origin: border-box;
          background-clip: padding-box, border-box;
          box-shadow:
            0 1px 2px rgba(0, 0, 0, 0.45),
            0 0 16px -5px rgba(192, 132, 252, 0.75),
            inset 0 1px 0 rgba(226, 214, 255, 0.14);
        }
        .jbaa-founder__text {
          position: relative;
          background: linear-gradient(115deg, #e9d5ff 0%, #a5f3fc 30%, #f5d0fe 55%, #99f6e4 80%, #e9d5ff 100%);
          background-size: 300% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          white-space: nowrap;
        }
        @media (prefers-reduced-motion: no-preference) {
          .jbaa-founder { animation: jbaa-iris 7s linear infinite; }
          .jbaa-founder__text { animation: jbaa-iris-text 7s linear infinite; }
          /* The iridescent drift alone reads as static at a glance, since
             the hue shift is subtle. These two add the same kind of
             punctuated moment the other badges have: a bright sweep across
             the text and a matching flare on the gem, on a 4.5s cycle so it
             never lands in step with Owner's 5s shine or Admin's 2.2s
             glitch. Same vocabulary as Owner (a travelling highlight),
             different colour and rhythm. */
          .jbaa-founder__text::after {
            content: attr(data-text);
            position: absolute;
            inset: 0;
            background: linear-gradient(
              100deg,
              transparent 0%, transparent 42%,
              rgba(255, 255, 255, 0.95) 50%,
              transparent 58%, transparent 100%
            );
            background-size: 250% 100%;
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            animation: jbaa-founder-sweep 4.5s ease-in-out infinite;
            pointer-events: none;
          }
          .jbaa-founder__gem { animation: jbaa-gem-flare 4.5s ease-in-out infinite; }
        }
        @keyframes jbaa-founder-sweep {
          0%, 60%, 100% { background-position: 140% 0; }
          85% { background-position: -40% 0; }
        }
        @keyframes jbaa-gem-flare {
          0%, 60%, 100% { filter: drop-shadow(0 0 0 rgba(196, 181, 253, 0)); }
          78% { filter: drop-shadow(0 0 3.5px rgba(216, 202, 255, 0.95)); }
        }
        /* Only the BORDER layer moves. The first background-position keeps
           the solid fill pinned, otherwise the chip's interior would slide
           around underneath the text. */
        @keyframes jbaa-iris {
          0% { background-position: 0 0, 0% 50%; }
          100% { background-position: 0 0, 300% 50%; }
        }
        @keyframes jbaa-iris-text {
          0% { background-position: 0% 50%; }
          100% { background-position: 300% 50%; }
        }
      `}</style>

      <span
        className={`jbaa-founder inline-flex items-center rounded-md font-semibold uppercase tracking-[0.12em] ${s.pad} ${s.text} ${s.gap} ${className}`}
      >
        {/* Faceted gem. Deliberately not a crown, not a star — those read as
            rank and rating respectively; a cut stone reads as "rare". */}
        <svg width={s.icon} height={s.icon} viewBox="0 0 14 14" fill="none" aria-hidden className="jbaa-founder__gem shrink-0">
          <path d="M3.4 1.8h7.2l2.2 3.3L7 12.4 1.2 5.1l2.2-3.3Z" fill="url(#jbaa-gem-fill)" stroke="#a78bfa" strokeWidth="0.5" strokeLinejoin="round" />
          <path d="M1.2 5.1h11.6M5 1.8 7 5.1l2-3.3M7 5.1v7.3" stroke="#f5f3ff" strokeWidth="0.45" strokeOpacity="0.75" strokeLinejoin="round" />
          <defs>
            <linearGradient id="jbaa-gem-fill" x1="1" y1="2" x2="13" y2="12" gradientUnits="userSpaceOnUse">
              <stop stopColor="#e9d5ff" />
              <stop offset="0.45" stopColor="#a5f3fc" />
              <stop offset="1" stopColor="#5eead4" />
            </linearGradient>
          </defs>
        </svg>
        {/* data-text feeds the ::after sweep overlay, which re-renders the
            same string clipped to a moving highlight. */}
        <span className="jbaa-founder__text" data-text={text}>
          {text}
        </span>
      </span>
    </>
  );
  return tooltip ? <Tooltip text={tooltip}>{chip}</Tooltip> : chip;
}

/* ------------------------------------------------------------------------
   ALPHA TESTER — telemetry chip.

   Fourth badge, so it had to stay clear of three taken visual languages:
   Owner owns gold + crown + a discrete shine, Admin owns cyan/magenta +
   glitch, Founding Member owns violet/teal iridescence + a gem. This takes
   crimson-to-coral with an alpha glyph and a sonar-style pulse ring, which
   collides with none of them.

   Crimson also carries the right meaning: alpha software is the unstable,
   pre-release thing you were let in early to break. It reads as a live
   instrument, not a reward.

   3.5s cycle. Still coprime enough with Owner's 5s, Admin's 2.2s and
   Founding Member's 4.5s that the four never visibly fall into step —
   four badges pulsing together would read as one animation rather than
   four separate marks.
------------------------------------------------------------------------ */
export function AlphaTesterBadge({
  size = "md",
  className = "",
  tooltip,
  label,
}: {
  size?: BadgeSize;
  className?: string;
  tooltip?: string;
  label?: string;
}) {
  const s = SIZES[size];
  const chip = (
    <>
      <style>{`
        .jbaa-alpha {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          border: 1px solid transparent;
          background-image:
            linear-gradient(180deg, #241016 0%, #14080c 100%),
            linear-gradient(120deg, #fb7185 0%, #e11d48 40%, #fda4af 60%, #e11d48 100%);
          background-origin: border-box;
          background-clip: padding-box, border-box;
          box-shadow:
            0 1px 2px rgba(0, 0, 0, 0.45),
            0 0 14px -4px rgba(244, 63, 94, 0.7),
            inset 0 1px 0 rgba(255, 228, 230, 0.13);
        }
        .jbaa-alpha__text {
          background: linear-gradient(180deg, #ffe4e6 0%, #fda4af 55%, #fb7185 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          white-space: nowrap;
        }
        @media (prefers-reduced-motion: no-preference) {
          /* Sonar ping: a ring expanding out from the glyph, fading as it
             goes. Sits behind the content (z-index -1) so it never washes
             out the label. */
          .jbaa-alpha::before {
            content: "";
            position: absolute;
            top: 50%;
            inset-inline-start: 0.55em;
            width: 0.7em;
            height: 0.7em;
            margin-top: -0.35em;
            border-radius: 9999px;
            border: 1px solid rgba(251, 113, 133, 0.85);
            transform: scale(0.4);
            opacity: 0;
            z-index: -1;
            animation: jbaa-alpha-ping 3.5s ease-out infinite;
          }
          .jbaa-alpha__glyph { animation: jbaa-alpha-beat 3.5s ease-out infinite; }
        }
        @keyframes jbaa-alpha-ping {
          0%, 70% { transform: scale(0.4); opacity: 0; }
          78% { opacity: 0.9; }
          100% { transform: scale(4.2); opacity: 0; }
        }
        @keyframes jbaa-alpha-beat {
          0%, 70%, 100% { filter: drop-shadow(0 0 0 rgba(253, 164, 175, 0)); }
          78% { filter: drop-shadow(0 0 3px rgba(255, 228, 230, 0.95)); }
        }
      `}</style>

      <span
        className={`jbaa-alpha inline-flex items-center rounded-md font-semibold uppercase tracking-[0.14em] ${s.pad} ${s.text} ${s.gap} ${className}`}
      >
        {/* Greek alpha in a ring — the universal mark for a pre-release
            build, and nothing like the other three icons. */}
        <svg width={s.icon} height={s.icon} viewBox="0 0 14 14" fill="none" aria-hidden className="jbaa-alpha__glyph shrink-0">
          <circle cx="7" cy="7" r="6" stroke="url(#jbaa-alpha-ring)" strokeWidth="1.1" />
          <path
            d="M9.1 4.6c-2.6 0-3.9 1.3-3.9 2.6 0 1 .7 1.8 1.7 1.8 1.5 0 2.2-1.8 2.2-3.1 0 1.7.2 3.1 1.1 3.5"
            stroke="#ffe4e6"
            strokeWidth="1.05"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <defs>
            <linearGradient id="jbaa-alpha-ring" x1="1" y1="1" x2="13" y2="13" gradientUnits="userSpaceOnUse">
              <stop stopColor="#fda4af" />
              <stop offset="1" stopColor="#e11d48" />
            </linearGradient>
          </defs>
        </svg>
        <span className="jbaa-alpha__text">{label ?? "Alpha Tester"}</span>
      </span>
    </>
  );
  return tooltip ? <Tooltip text={tooltip}>{chip}</Tooltip> : chip;
}

/* ------------------------------------------------------------------------
   Convenience wrapper. Renders whichever badges apply, in rank order
   (Owner, Admin, Founding Member), or nothing at all for a plain account.
------------------------------------------------------------------------ */
export function RoleBadges({
  isOwner,
  isAdmin,
  isFoundingMember,
  isAlphaTester,
  foundingMemberNumber,
  foundingMemberLabel,
  alphaTesterLabel,
  lang = "en",
  size = "md",
  className = "",
}: {
  isOwner?: boolean;
  isAdmin?: boolean;
  isFoundingMember?: boolean;
  isAlphaTester?: boolean;
  foundingMemberNumber?: number | null;
  foundingMemberLabel?: string;
  alphaTesterLabel?: string;
  /** Picks the tooltip language. Defaults to English. */
  lang?: "en" | "ar";
  size?: BadgeSize;
  className?: string;
}) {
  if (!isOwner && !isAdmin && !isFoundingMember && !isAlphaTester) return null;
  const tip = (k: keyof typeof BADGE_TOOLTIPS) => BADGE_TOOLTIPS[k][lang === "ar" ? "ar" : "en"];
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      {isOwner && <OwnerBadge size={size} tooltip={tip("owner")} />}
      {isAdmin && <AdminBadge size={size} tooltip={tip("admin")} />}
      {isFoundingMember && (
        <FoundingMemberBadge
          size={size}
          number={foundingMemberNumber}
          label={foundingMemberLabel}
          tooltip={tip("founder")}
        />
      )}
      {isAlphaTester && (
        <AlphaTesterBadge size={size} label={alphaTesterLabel} tooltip={tip("alpha")} />
      )}
    </span>
  );
}

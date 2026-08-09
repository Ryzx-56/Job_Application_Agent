"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Lock, Sparkles } from "lucide-react";

/* ========================================================================
   LINKEDIN ADD-ON — SHARED UI

   Palette: LinkedIn's own brand blue (#0A66C2) for actions and accents, on a
   pale tint of it for the page ground. Deliberately different from the rest
   of the dashboard's blue-600, because this page is about a different
   product's surface and the resemblance is the point. Everything else
   (radii, borders, type scale, slate text) follows the existing design
   system so it still reads as Tarshih.

   Mobile-first throughout: most Tarshih users are on a phone, and this page
   in particular gets used with LinkedIn open in another tab.
======================================================================== */

export const LI_BLUE = "#0A66C2";
export const LI_TINT = "#EAF4FB";

/** Filled primary action, LinkedIn blue. */
export const liPrimaryButton =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-[#0A66C2] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#095196] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A66C2]/40 disabled:cursor-not-allowed disabled:opacity-50";

/** Quiet secondary action. */
export const liOutlineButton =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-[#0A66C2]/30 bg-white px-4 py-2.5 text-sm font-medium text-[#0A66C2] transition-colors hover:bg-[#EAF4FB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A66C2]/40 disabled:cursor-not-allowed disabled:opacity-50";

/* ========================================================================
   LINKEDIN GLYPH — lucide-react v1 dropped its brand icons, so the "in" mark
   is inlined here. Drawn with currentColor and a 24x24 box so it drops into
   the same slots a lucide icon would (sidebar nav, section headers) and
   inherits size/color from className exactly like one.
======================================================================== */
export function LinkedInGlyph({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden {...props}>
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V8.99h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12Zm1.78 13.02H3.56V8.99h3.56v11.46ZM22.22 0H1.77C.8 0 0 .78 0 1.75v20.5C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.75V1.75C24 .78 23.2 0 22.22 0Z" />
    </svg>
  );
}

/** Prices for this add-on are set in SAR (see PRICING in
 *  backend/core/linkedin.py), not converted from USD like the subscription
 *  plans — so there's no peg maths here, just the currency word in the
 *  reader's language. */
export function formatSar(amount: number, lang: string): string {
  const value = Number(amount ?? 0).toLocaleString(lang === "ar" ? "ar-EG" : "en-US", {
    maximumFractionDigits: Number.isInteger(Number(amount)) ? 0 : 2,
  });
  return lang === "ar" ? `${value} ريال` : `${value} SAR`;
}

/* ========================================================================
   PAGE SHELL — paints the baby-blue ground across the whole content area.
   The negative margins cancel the dashboard <main>'s padding so the tint
   goes edge to edge instead of sitting in a floating box.
======================================================================== */
export function LinkedInPageShell({ children, dir }: { children: React.ReactNode; dir?: "ltr" | "rtl" }) {
  return (
    <div
      dir={dir}
      className="-mx-4 -my-6 min-h-[calc(100vh-57px)] bg-[#EAF4FB] px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-8 lg:-my-8 lg:px-8 lg:py-8"
    >
      <div className="mx-auto max-w-3xl space-y-5">{children}</div>
    </div>
  );
}

/* ========================================================================
   COPY BUTTON — copies exactly the string it's given: no label, no quotes,
   no trailing whitespace decoration (§4). Shows a brief "Copied" state.
======================================================================== */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Falls through to the legacy path below — clipboard access can be
    // refused (permissions, non-secure context) rather than unavailable.
  }

  // Legacy fallback: a hidden textarea + execCommand. Still the only thing
  // that works in a non-secure context or an old in-app browser, which is a
  // real share of mobile traffic here.
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  value,
  copyLabel,
  copiedLabel,
  compact = false,
}: {
  value: string;
  copyLabel: string;
  copiedLabel: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clearing the timeout on unmount matters here: these buttons live inside
  // sections that get swapped out (opening a history item), and a pending
  // setState on an unmounted component is a warning nobody can act on.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onCopy = useCallback(async () => {
    const ok = await writeToClipboard(value);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }, [value]);

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? copiedLabel : copyLabel}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border text-xs font-medium transition-colors ${
        compact ? "px-1.5 py-1" : "px-2 py-1.5"
      } ${
        copied
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-white text-slate-500 hover:border-[#0A66C2]/40 hover:text-[#0A66C2]"
      }`}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      <span aria-live="polite">{copied ? copiedLabel : copyLabel}</span>
    </button>
  );
}

/* ========================================================================
   COPY FIELD — one labeled block of paste-ready English text.

   dir="ltr" + text-left on the VALUE, always: the surrounding page can be
   Arabic/RTL, but the content is English by design and English inside an RTL
   container renders with its punctuation in the wrong place unless the
   direction is set explicitly on the text itself.
======================================================================== */
export function CopyField({
  label,
  value,
  copyLabel,
  copiedLabel,
  hint,
  charCount,
  multiline = false,
  emptyLabel,
}: {
  label: string;
  value: string;
  copyLabel: string;
  copiedLabel: string;
  hint?: string;
  charCount?: string;
  multiline?: boolean;
  emptyLabel?: string;
}) {
  const empty = !value?.trim();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="mb-1.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          {charCount && <p className="mt-0.5 text-[11px] text-slate-400">{charCount}</p>}
        </div>
        {!empty && <CopyButton value={value} copyLabel={copyLabel} copiedLabel={copiedLabel} />}
      </div>

      {empty ? (
        <p className="text-sm text-slate-400">{emptyLabel ?? "—"}</p>
      ) : (
        <p
          dir="ltr"
          className={`text-left text-sm leading-relaxed text-slate-800 ${
            multiline ? "whitespace-pre-wrap break-words" : "break-words"
          }`}
        >
          {value}
        </p>
      )}

      {hint && <p className="mt-2 text-xs leading-relaxed text-slate-400">{hint}</p>}
    </div>
  );
}

/** Compact variant for a list of short items (skills, tags) where each entry
 *  is individually pasteable. */
export function CopyChip({
  value,
  copyLabel,
  copiedLabel,
}: {
  value: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pe-1 ps-3">
      <span dir="ltr" className="truncate text-left text-sm text-slate-800">
        {value}
      </span>
      <CopyButton value={value} copyLabel={copyLabel} copiedLabel={copiedLabel} compact />
    </span>
  );
}

/* ========================================================================
   PANEL — one numbered section of the results page, or a plain card
   elsewhere. The step number is what makes the page usable as a checklist
   against LinkedIn's own layout.
======================================================================== */
export function LinkedInPanel({
  step,
  stepLabel,
  title,
  note,
  children,
  action,
}: {
  step?: number;
  stepLabel?: string;
  title: string;
  note?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          {step !== undefined && (
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#0A66C2] text-xs font-semibold text-white">
              {step}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-900">{title}</h2>
            {stepLabel && <p className="text-[11px] text-slate-400">{stepLabel}</p>}
          </div>
        </div>
        {action}
      </header>
      <div className="space-y-3 p-4 sm:p-5">
        {note && <p className="text-xs leading-relaxed text-slate-500">{note}</p>}
        {children}
      </div>
    </section>
  );
}

/* ========================================================================
   TIER CARD — normal vs premium. Feature lists come from the language file
   so the exact deliverables per tier are stated where the price is, and
   nobody can later say they were misled about which tier does what (§4).
======================================================================== */
export function TierCard({
  name,
  tagline,
  price,
  oneTimeLabel,
  includedLabel,
  features,
  cta,
  badge,
  featured = false,
  selected = false,
  onSelect,
}: {
  name: string;
  tagline: string;
  price: string;
  oneTimeLabel: string;
  includedLabel: string;
  features: readonly string[];
  cta: string;
  badge?: string;
  featured?: boolean;
  selected?: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`relative flex flex-col rounded-2xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${
        selected
          ? "border-[#0A66C2] ring-2 ring-[#0A66C2]/25"
          : featured
          ? "border-[#0A66C2]/40 ring-1 ring-[#0A66C2]/15"
          : "border-slate-200"
      }`}
    >
      {badge && (
        <span className="absolute -top-2.5 start-5 rounded-full bg-[#0A66C2] px-2.5 py-0.5 text-[11px] font-semibold text-white">
          {badge}
        </span>
      )}

      <h3 className="text-base font-semibold text-slate-900">{name}</h3>
      <p className="mt-0.5 text-xs text-slate-500">{tagline}</p>

      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold text-slate-900">{price}</span>
        <span className="text-xs text-slate-500">{oneTimeLabel}</span>
      </div>

      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{includedLabel}</p>
      <ul className="mt-2 flex-1 space-y-2">
        {features.map((feature) => (
          <li key={feature} className="flex gap-2 text-sm leading-relaxed text-slate-600">
            <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <button type="button" onClick={onSelect} className={`mt-5 w-full ${featured ? liPrimaryButton : liOutlineButton}`}>
        {cta}
      </button>
    </div>
  );
}

/* ========================================================================
   LOCKED TEASER — the heading is visible, the guidance is not (§4). The
   detail genuinely isn't in this bundle: it's generated per person and
   arrives with the paid content, so "locked" here means locked, not
   hidden-but-shipped.
======================================================================== */
export function LockedTeaser({ heading, body, lockedLabel }: { heading: string; body: string; lockedLabel: string }) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-[#0A66C2]/20 bg-white p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#EAF4FB] text-[#0A66C2]">
          <Sparkles className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{heading}</h3>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
              <Lock className="size-3" aria-hidden />
              {lockedLabel}
            </span>
          </div>
          <p className="mt-2 select-none text-sm leading-relaxed text-slate-400 blur-[3px]" aria-hidden>
            {body}
          </p>
        </div>
      </div>
    </section>
  );
}

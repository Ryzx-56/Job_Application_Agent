"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  Sparkles,
  FileCheck2,
  Gauge,
  PenLine,
  Layers,
  Zap,
  ShieldCheck,
  FileUp,
  Download,
  Check,
  Menu,
  X,
  Lock,
  ScanSearch,
  BadgeCheck,
  User,
} from "lucide-react";
import { useLang } from "@/lib/language";
import { formatSar, formatShortDate, sarPerCredit, usdApprox } from "@/lib/pricing";
import { FaqRow } from "@/components/faq";
import { LinkedInGlyph } from "@/components/linkedin-ui";
import { Button, Logo, LangSwitcher } from "@/components/brand";
import { useAuth } from "@/lib/auth";
import { fetchCredits, Tier } from "@/lib/supabase/credits";
import { cancelSubscription, resumeSubscription } from "@/lib/subscription";
import { LegalModal } from "@/components/legal-modal";
import { legalContent, LegalDocKey } from "@/lib/legal-content";
import { Hero } from "./hero";
import { CompanyMarquee } from "./marquee";

/* Smooth-scrolls to a section by id, respecting that section's scroll-mt-*
   class so the heading never ends up hidden behind the fixed navbar. */
function scrollToSection(event: React.MouseEvent, id: string) {
  event.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function SectionHeading({
  eyebrow,
  title,
  description,
  className = "",
}: {
  eyebrow: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={`mx-auto max-w-2xl text-center ${className}`}>
      <span className="text-sm font-medium text-blue-400">{eyebrow}</span>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h2>
      {description && <p className="mt-4 text-lg leading-relaxed text-zinc-400">{description}</p>}
    </div>
  );
}

/* ========================================================================
   HEADER
======================================================================== */
function SiteHeader({ onOpenAbout }: { onOpenAbout: () => void }) {
  const { t, isRTL } = useLang();
  const { isLoggedIn } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const NAV_LINKS = [
    { label: t.nav.features, href: "#features" },
    { label: t.nav.howItWorks, href: "#how-it-works" },
    { label: t.nav.pricing, href: "#pricing" },
    { label: t.nav.linkedin, href: "#linkedin" },
    { label: t.nav.faq, href: "#faq" },
  ];

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        {isRTL ? "تخطَّ إلى المحتوى" : "Skip to content"}
      </a>
      <div
        className={`mx-auto flex h-16 max-w-6xl items-center justify-between px-4 transition-all duration-300 sm:px-6 ${
          scrolled ? "mt-2 max-w-5xl rounded-2xl border border-white/10 bg-zinc-950/70 px-4 shadow-lg shadow-black/20 backdrop-blur-xl" : ""
        }`}
      >
        <a href="#" className="rounded-md" aria-label="Tarshih home">
          <Logo />
        </a>

        {/* WHY lg AND NOT md, AND WHY whitespace-nowrap.
            The horizontal bar used to switch on at 768px, where its contents
            need roughly 1,100. Two things broke at once: every label wrapped
            inside its own px-3 py-2 box, so the text spilled out of its own
            hover and focus highlight and collided with the row above and
            below; and the Log in / Get started buttons were pushed clean off
            the right edge. Both languages, worst in Arabic, where the labels
            are longer and the app-wide RTL scale sets text-sm to 20px.

            nowrap makes a label physically unable to break inside its box, and
            the editorial scale keeps the nav off the app-wide RTL bump, which
            exists for reading body copy and not for a navigation bar.

            flex-1 + justify-evenly, because the first fix overcorrected: the
            links clustered in the middle with dead space against the logo on
            one side and the language toggle on the other. The nav now takes
            the whole gap between those two and distributes it, which is space
            that was being paid for and not used. Measured at 1024 — the
            tightest case, since the scrolled bar narrows to max-w-5xl and
            lands on the same inner width — the row still has ~50px spare in
            Arabic, so this cannot reintroduce the wrap it just fixed. */}
        <nav className="hidden min-w-0 flex-1 items-center justify-evenly px-2 lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => scrollToSection(e, link.href.replace("#", ""))}
              className="t-nav whitespace-nowrap rounded-lg px-2 py-2 text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
            >
              {link.label}
            </a>
          ))}
          <button
            type="button"
            onClick={onOpenAbout}
            className="t-nav whitespace-nowrap rounded-lg px-2 py-2 text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
          >
            {t.nav.about}
          </button>
        </nav>

        {/* t-body on the buttons is the other half of the size fix. Without it
            they keep the app-wide scale, which puts Arabic button text at
            20.25px next to a 15.6px link. */}
        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          <LangSwitcher compact />
          {!isLoggedIn && (
            <Button variant="ghost" size="md" className="t-body" as={Link} href="/login">
              {t.nav.login}
            </Button>
          )}
          <Button size="md" className="t-body" as={Link} href={isLoggedIn ? "/dashboard" : "/signup"}>
            {isLoggedIn ? t.nav.dashboard : t.nav.getStarted}
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="grid size-11 place-items-center rounded-lg border border-white/10 text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 lg:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        </button>
      </div>

      <div
        id="mobile-menu"
        className={`mx-4 grid transition-all duration-300 ease-out lg:hidden ${
          open ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden rounded-2xl">
          <div className="rounded-2xl border border-white/10 bg-zinc-900/95 p-3 shadow-xl shadow-black/30 backdrop-blur-xl">
            <div className="mb-2 flex justify-center">
              <LangSwitcher />
            </div>
            <nav className="flex flex-col">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={(e) => {
                    scrollToSection(e, link.href.replace("#", ""));
                    setOpen(false);
                  }}
                  className="rounded-lg px-3 py-3 text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                >
                  {link.label}
                </a>
              ))}
              <button
                type="button"
                onClick={() => {
                  onOpenAbout();
                  setOpen(false);
                }}
                className="rounded-lg px-3 py-3 text-start text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
              >
                {t.nav.about}
              </button>
              <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-3">
                {!isLoggedIn && (
                  <Button variant="outline" as={Link} href="/login">{t.nav.login}</Button>
                )}
                <Button as={Link} href={isLoggedIn ? "/dashboard" : "/signup"}>
                  {isLoggedIn ? t.nav.dashboard : t.nav.getStarted}
                </Button>
              </div>
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}

/* ========================================================================
   TRUST BAR
======================================================================== */
function TrustBar() {
  const { t } = useLang();
  // Fourth icon covers the humanizer line: core/humanizer.py's rules run on
  // every generation that produces prose.
  const icons = [Lock, ScanSearch, BadgeCheck, PenLine];
  return (
    // max-w-4xl is ~78% of the max-w-6xl the rest of the page uses. The
    // marquee directly above is full-bleed, and going straight from that to
    // another edge-to-edge row made the two read as one undifferentiated band.
    // Pulling this in gives the eye a step down out of the full-width strip.
    <section className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-16">
      {/* ALL FOUR ON ONE LINE FROM lg UP. Wrapping turned a row of four claims
          into a stack that read as a list of features, which is not what a
          trust row is for. nowrap on each item plus flex-nowrap and
          justify-between at lg holds the line; below that they stack, which is
          correct on a phone. The copy in language.tsx is kept short enough for
          this to fit in both scripts rather than relying on shrinking type.

          SET AT READING SIZE, NOT CAPTION SIZE. At t-meta with tight padding
          this was a hairline of small grey text that read as a footer stuck to
          the bottom of the hero. These are four load-bearing claims about what
          the product will and will not do, so they get body size, a full-size
          icon and enough air on both sides to be a section of the page. */}
      <div className="flex flex-col items-start gap-6 border-y border-white/10 py-9 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-10 sm:gap-y-5 sm:py-10 lg:flex-nowrap lg:justify-between lg:gap-x-8">
        {t.trustBar.map((label, i) => {
          const Icon = icons[i];
          return (
            <div
              key={label}
              className="t-body flex items-center gap-3 lg:whitespace-nowrap"
              style={{ color: "var(--ink-2)" }}
            >
              <Icon className="size-5 shrink-0" style={{ color: "var(--accent-quiet)" }} aria-hidden />
              {label}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ========================================================================
   FEATURES
======================================================================== */
function Features() {
  const { t } = useLang();
  const icons = [FileCheck2, Gauge, PenLine, Layers, Zap, ShieldCheck];
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-20 sm:px-6 sm:py-28">
      <SectionHeading eyebrow={t.features.eyebrow} title={t.features.title} description={t.features.description} />
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {t.features.items.map((feature, i) => {
          const Icon = icons[i];
          return (
            <div key={feature.title} className="group rounded-2xl border border-white/10 bg-zinc-900/60 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-blue-400/40 hover:shadow-xl hover:shadow-blue-950/20">
              <div className="grid size-11 place-items-center rounded-xl border border-white/10 bg-white/5 text-blue-400 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                <Icon className="size-5" aria-hidden />
              </div>
              <h3 className="mt-5 text-base font-semibold text-white">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{feature.description}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ========================================================================
   LINKEDIN ADD-ON

   A real section, directly after "everything you need", because that's the
   section that frames the whole journey and this is the last step of it: CV,
   tailoring, job matching, then the profile recruiters actually search.

   Both tiers and both prices are on the page. Nothing about what it costs is
   hidden behind a click, since the objection this section exists to answer is
   "why would I pay for this when a chatbot is free" and the price is half of
   that conversation.
======================================================================== */
function LinkedInAddOn() {
  const { t, lang, isRTL } = useLang();
  const { isLoggedIn } = useAuth();
  const copy = t.linkedinPromo;
  const ForwardIcon = isRTL ? ArrowLeft : ArrowRight;
  // Signed-out visitors have no dashboard to land on, so they go to signup.
  // Signed-in ones go straight to the tab.
  const buyHref = isLoggedIn ? "/dashboard/linkedin" : "/signup?plan=free";

  const tiers = [
    { key: "essential" as const, data: copy.essential, premium: false },
    { key: "premium" as const, data: copy.premium, premium: true },
  ];

  return (
    <section id="linkedin" className="scroll-mt-24 border-y border-white/10 bg-zinc-900/30">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-[#4DA3E8]">
            <LinkedInGlyph className="size-4" />
            {copy.eyebrow}
          </span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{copy.title}</h2>
          <p className="mt-4 text-lg leading-relaxed text-zinc-400">{copy.description}</p>
        </div>

        {/* ── The four reasons this isn't a chatbot prompt ── */}
        <h3 className="mt-14 text-center text-sm font-medium uppercase tracking-wide text-zinc-500">
          {copy.whyTitle}
        </h3>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {copy.reasons.map((reason) => (
            <div
              key={reason.title}
              className="rounded-2xl border border-white/10 bg-zinc-900/60 p-6 transition-colors duration-300 hover:border-[#0A66C2]/50"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-[#4DA3E8]">
                  <Check className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h4 className="text-base font-semibold text-white">{reason.title}</h4>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{reason.body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-sm leading-relaxed text-zinc-500">
          {copy.alwaysEnglish}
        </p>

        {/* ── Both tiers, both prices, on the page ──
            Premium in ink and gold rather than a second blue card, matching
            the dashboard so the two surfaces read as one product. */}
        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          {tiers.map(({ key, data, premium }) => (
            <div
              key={key}
              className={`relative flex flex-col overflow-hidden rounded-2xl border p-6 sm:p-7 ${
                premium
                  ? "border-[#D4AF37]/40 bg-gradient-to-b from-[#141d31] to-[#0b1220]"
                  : "border-white/10 bg-zinc-900/60"
              }`}
            >
              {premium && (
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent" />
              )}

              <span
                className={`self-start rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                  premium ? "bg-[#D4AF37] text-[#0B1220]" : "bg-[#0A66C2]/15 text-[#4DA3E8]"
                }`}
              >
                {data.badge}
              </span>

              <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h4 className="text-xl font-semibold text-white">{data.name}</h4>
                  <p className={`mt-0.5 text-sm ${premium ? "text-[#E4CE86]" : "text-zinc-400"}`}>{data.tagline}</p>
                </div>
                {/* Essential has no price of its own: it comes with Pro and
                    Elite, so it states that instead. Premium is still a
                    one-time purchase and keeps its price and its checkout. */}
                <div className="text-end">
                  {"sar" in data ? (
                    <>
                      <div className="text-3xl font-semibold tracking-tight text-white">
                        {formatSar(data.sar, lang)}
                      </div>
                      {usdApprox(data.sar) && <div className="text-xs text-zinc-500">{usdApprox(data.sar)}</div>}
                      <div className="text-xs text-zinc-500">{copy.oneTime}</div>
                    </>
                  ) : (
                    <div className="max-w-[11rem] text-sm font-semibold leading-snug text-[#4DA3E8]">
                      {data.includedLabel}
                    </div>
                  )}
                </div>
              </div>

              <ul className="mt-6 flex-1 space-y-2.5">
                {data.bullets.map((bullet) => (
                  <li key={bullet} className="flex gap-2.5 text-sm leading-relaxed text-zinc-300">
                    <Check
                      className={`mt-0.5 size-4 shrink-0 ${premium ? "text-[#D4AF37]" : "text-[#4DA3E8]"}`}
                      aria-hidden
                    />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={premium ? buyHref : "#pricing"}
                className={`mt-7 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition-colors ${
                  premium
                    ? "bg-[#D4AF37] text-[#0B1220] hover:bg-[#E0BF54]"
                    : "bg-[#0A66C2] text-white hover:bg-[#0b74dc]"
                }`}
              >
                {data.cta}
                <ForwardIcon className="size-4" aria-hidden />
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-zinc-500">{copy.footnote}</p>
      </div>
    </section>
  );
}

/* ========================================================================
   HOW IT WORKS
======================================================================== */
function HowItWorks() {
  const { t } = useLang();
  const icons = [FileUp, PenLine, ScanSearch, Download];
  return (
    <section id="how-it-works" className="scroll-mt-24 border-y border-white/10 bg-zinc-900/30">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <SectionHeading eyebrow={t.howItWorks.eyebrow} title={t.howItWorks.title} description={t.howItWorks.description} />
        <div className="relative mt-16 grid gap-8 md:grid-cols-4">
          <div className="pointer-events-none absolute top-6 start-0 end-0 hidden h-px bg-white/10 md:block" />
          {t.howItWorks.steps.map((step, i) => {
            const Icon = icons[i];
            return (
              <div key={step.step} className="relative">
                <div className="flex items-center gap-4">
                  <div className="grid size-12 shrink-0 place-items-center rounded-2xl border border-white/10 bg-zinc-950 text-blue-400 shadow-sm">
                    <Icon className="size-5" aria-hidden />
                  </div>
                  <span className="font-mono text-sm text-zinc-500">{step.step}</span>
                </div>
                <h3 className="mt-5 text-lg font-semibold text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{step.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ========================================================================
   TRUST SECTION
======================================================================== */
function TrustSection() {
  const { t } = useLang();
  const icons = [Lock, ScanSearch, BadgeCheck];
  return (
    <section className="border-y border-white/10 bg-zinc-900/30">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <SectionHeading eyebrow={t.trustSection.eyebrow} title={t.trustSection.title} description={t.trustSection.description} />
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {t.trustSection.pillars.map((pillar, i) => {
            const Icon = icons[i];
            return (
              <div key={pillar.title} className="flex flex-col rounded-2xl border border-white/10 bg-zinc-900/60 p-6">
                <div className="grid size-11 place-items-center rounded-xl border border-white/10 bg-white/5 text-blue-400">
                  <Icon className="size-5" aria-hidden />
                </div>
                <h3 className="mt-5 text-base font-semibold text-white">{pillar.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{pillar.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ========================================================================
   PRICING
======================================================================== */
const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, elite: 2 };

/* ========================================================================
   CONFIRM DIALOG — shared by "Cancel subscription" and "Switch to Free".
   Both hit the same backend action (cancelSubscription), just triggered
   from different buttons with different copy.
======================================================================== */
function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy,
  error,
  onConfirm,
  onDismiss,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onDismiss}>
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">{body}</p>
        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:opacity-60"
          >
            {busy ? "…" : confirmLabel}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="flex-1 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Pricing({ onOpenAbout }: { onOpenAbout: () => void }) {
  const { t, lang } = useLang();
  const { isLoggedIn } = useAuth();
  const isAr = lang === "ar";

  const [tier, setTier] = useState<Tier | null>(null);
  const [pendingTier, setPendingTier] = useState<Tier | null>(null);
  const [resetAt, setResetAt] = useState<string | null>(null);
  const [tierLoaded, setTierLoaded] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<"cancel" | "downgrade" | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadCredits = () => {
    fetchCredits()
      .then((c) => {
        setTier(c.tier);
        setPendingTier(c.pendingTier);
        setResetAt(c.creditsResetAt);
      })
      .catch((err) => console.error("fetchCredits failed:", err))
      .finally(() => setTierLoaded(true));
  };

  useEffect(() => {
    if (!isLoggedIn) {
      setTierLoaded(true);
      return;
    }
    loadCredits();
  }, [isLoggedIn]);

  async function handleConfirm() {
    setBusy(true);
    setActionError(null);
    try {
      await cancelSubscription();
      setPendingTier("free");
      setConfirmTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo() {
    setBusy(true);
    setActionError(null);
    try {
      await resumeSubscription();
      setPendingTier(null);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  const resetDateLabel = resetAt ? formatShortDate(resetAt, lang) : "";

  const PENDING_TIER_LABEL: Record<Tier, string> = {
    free: isAr ? "المجانية" : "Free",
    pro: "Pro",
    elite: "Elite",
  };

  const copy = {
    subscribed: isAr ? "مفعّل" : "Active",
    currentPlan: isAr ? "خطتك الحالية" : "Current plan",
    switchToFree: isAr ? "التبديل إلى المجانية" : "Switch to Free",
    cancelSub: isAr ? "إلغاء الاشتراك" : "Cancel subscription",
    undo: isAr ? "تراجع عن الإلغاء" : "Undo",
    switchesOn: (target: string, date: string) =>
      isAr ? `سيتحول إلى ${target} في ${date}` : `Switching to ${target} on ${date}`,
    cancelTitle: isAr ? "تأكيد إلغاء الاشتراك" : "Confirm cancellation",
    cancelBody: isAr
      ? "ستحتفظ بخطتك الحالية ورصيدك الحالي حتى نهاية دورة الفوترة الحالية. بعدها ستنتقل إلى الخطة المجانية."
      : "You'll keep your current plan and credits until the end of this billing cycle. After that, you'll move to the Free plan.",
    downgradeTitle: isAr ? "تأكيد التبديل إلى المجانية" : "Confirm switch to Free",
    downgradeBody: isAr
      ? "ستحتفظ بخطتك الحالية ورصيدك الحالي حتى نهاية الدورة الحالية، ثم تنتقل إلى المجانية."
      : "You'll keep your current plan and credits until the end of this cycle, then move to Free.",
    confirm: isAr ? "نعم، تأكيد" : "Yes, confirm",
    dismiss: isAr ? "تراجع" : "Never mind",
  };

  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-20 sm:px-6 sm:py-28">
      <SectionHeading eyebrow={t.pricing.eyebrow} title={t.pricing.title} description={t.pricing.description} />
      {t.pricing.creditNote && (
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-zinc-500">{t.pricing.creditNote}</p>
      )}
      {t.pricing.founderNote && (
        <div className="mx-auto mt-8 flex max-w-2xl flex-col items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-blue-400">
            <User className="size-4" aria-hidden />
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">{t.pricing.founderNote.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">
              {t.pricing.founderNote.body}{" "}
              <button
                type="button"
                onClick={onOpenAbout}
                className="font-medium text-blue-400 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
              >
                {t.pricing.founderNote.cta}
              </button>
            </p>
          </div>
        </div>
      )}
      <div className="mt-14 grid gap-4 lg:grid-cols-3">
        {t.pricing.plans.map((plan) => {
          const planSlug = plan.slug as Tier;
          const showTierState = isLoggedIn && tierLoaded && tier !== null;
          const isCurrent = showTierState && tier === planSlug;
          const hasPendingChange = showTierState && pendingTier !== null;
          const isDowngradeTarget = showTierState && planSlug === "free" && tier !== "free" && !hasPendingChange;
          const isUpgrade = showTierState && TIER_RANK[planSlug] > TIER_RANK[tier as Tier];

          return (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-2xl border bg-zinc-900/60 p-7 transition-all duration-300 ${
                plan.featured
                  ? "border-blue-400/50 shadow-xl shadow-blue-950/20 lg:-translate-y-2"
                  : plan.premium
                  ? "border-white/20 bg-gradient-to-b from-zinc-900/80 to-zinc-900/40 shadow-lg shadow-black/30"
                  : "border-white/10 hover:border-blue-400/30"
              }`}
            >
              {/* NO OFFER BANNER AND NO DISCOUNT FLASH. The founding offer is
                  a badge and a 50-seat cap, not money off, so a plan card
                  carries its plain price and nothing that implies a markdown.
                  See the note on the plans data in src/lib/language.tsx. */}
              {plan.badge && (
                <span className="absolute -top-3 start-7 rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white">
                  {plan.badge}
                </span>
              )}
              {plan.premium && (
                <span className="absolute -top-3 start-7 inline-flex items-center gap-1 rounded-full border border-white/20 bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-200">
                  <Sparkles className="size-3 text-blue-400" aria-hidden />
                  {t.pricing.premiumBadgeLabel}
                </span>
              )}

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-white">{plan.name}</h3>
                </div>
                {isCurrent && planSlug !== "free" && !hasPendingChange && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-400/25 bg-blue-400/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-blue-300">
                    <span className="size-1.5 rounded-full bg-blue-400" aria-hidden />
                    {copy.subscribed}
                  </span>
                )}
              </div>

              {/* SAR large, because SAR is what gets charged. The dollar line
                  underneath is a reference for readers who think in USD, and
                  it is derived from the same number at the peg, so the two can
                  never disagree. See src/lib/pricing.ts. */}
              <div className="mt-3 flex flex-wrap items-baseline gap-1.5">
                <span className="text-4xl font-semibold tracking-tight text-white">
                  {formatSar(plan.sar, lang)}
                </span>
                <span className="text-sm text-zinc-500">{plan.period}</span>
              </div>
              {usdApprox(plan.sar) && <p className="mt-1 text-xs text-zinc-500">{usdApprox(plan.sar)}</p>}
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">{plan.description}</p>
              {plan.limitedOffer && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2.5">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-amber-400" aria-hidden />
                  <p className="text-xs leading-relaxed text-amber-200/90">{plan.limitedOffer}</p>
                </div>
              )}

              {!showTierState && (
                <Button
                  variant={plan.featured ? "default" : "outline"}
                  as={Link}
                  href={isLoggedIn ? `/dashboard/checkout?plan=${plan.slug}` : `/signup?plan=${plan.slug}`}
                  className="mt-6 w-full"
                >
                  {plan.cta}
                </Button>
              )}

              {isCurrent && planSlug === "free" && (
                <div className="mt-6 w-full rounded-lg border border-white/10 bg-white/5 py-2.5 text-center text-sm font-medium text-zinc-400">
                  {copy.currentPlan}
                </div>
              )}

              {isCurrent && planSlug !== "free" && !hasPendingChange && (
                <button
                  type="button"
                  onClick={() => {
                    setActionError(null);
                    setConfirmTarget("cancel");
                  }}
                  className="mt-6 text-xs font-medium text-rose-400/80 underline decoration-rose-400/30 underline-offset-4 transition-colors hover:text-rose-400"
                >
                  {copy.cancelSub}
                </button>
              )}

              {isCurrent && planSlug !== "free" && hasPendingChange && (
                <div className="mt-6 space-y-1.5">
                  <p className="text-xs text-zinc-500">
                    {copy.switchesOn(PENDING_TIER_LABEL[pendingTier as Tier], resetDateLabel)}
                  </p>
                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={busy}
                    className="text-xs font-medium text-blue-400/90 underline decoration-blue-400/30 underline-offset-4 transition-colors hover:text-blue-400 disabled:opacity-60"
                  >
                    {copy.undo}
                  </button>
                </div>
              )}

              {isDowngradeTarget && (
                <button
                  type="button"
                  onClick={() => {
                    setActionError(null);
                    setConfirmTarget("downgrade");
                  }}
                  className="mt-6 w-full rounded-lg border border-white/15 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/5"
                >
                  {copy.switchToFree}
                </button>
              )}

              {isUpgrade && (
                <Button
                  variant={plan.featured ? "default" : "outline"}
                  as={Link}
                  href={`/dashboard/checkout?plan=${plan.slug}`}
                  className="mt-6 w-full"
                >
                  {plan.cta}
                </Button>
              )}

              <ul className="mt-7 space-y-3 border-t border-white/10 pt-6">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-white/5 text-blue-400">
                      <Check className="size-2.5" aria-hidden />
                    </span>
                    <span className="text-zinc-300">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {t.pricing.currencyNote && (
        <p className="mt-6 text-center text-xs text-zinc-500">{t.pricing.currencyNote}</p>
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        title={confirmTarget === "cancel" ? copy.cancelTitle : copy.downgradeTitle}
        body={confirmTarget === "cancel" ? copy.cancelBody : copy.downgradeBody}
        confirmLabel={copy.confirm}
        cancelLabel={copy.dismiss}
        busy={busy}
        error={actionError}
        onConfirm={handleConfirm}
        onDismiss={() => (busy ? null : setConfirmTarget(null))}
      />
    </section>
  );
}

/* ========================================================================
   PAY AS YOU GO
======================================================================== */
function PayAsYouGo() {
  const { t, lang } = useLang();
  const packIcons = [Zap, Sparkles, Gauge];
  return (
    <section className="border-y border-white/10 bg-zinc-900/30">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <SectionHeading eyebrow={t.payg.eyebrow} title={t.payg.title} description={t.payg.description} />
        {t.pricing.creditNote && (
          <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-zinc-500">{t.pricing.creditNote}</p>
        )}
        <div className="mt-14 grid gap-4 sm:grid-cols-3">
          {t.payg.packs.map((pack, i) => {
            const PackIcon = packIcons[i] ?? Zap;
            return (
            <div
              key={pack.name}
              className={`relative flex flex-col rounded-2xl border bg-zinc-900/60 p-6 transition-all duration-300 ${
                pack.featured ? "border-blue-400/50 shadow-xl shadow-blue-950/20 sm:-translate-y-2" : "border-white/10 hover:border-blue-400/30"
              }`}
            >
              {pack.badge && (
                <span
                  className={`absolute -top-3 start-6 rounded-full px-3 py-1 text-xs font-medium text-white ${
                    pack.featured ? "bg-blue-600" : "bg-zinc-700"
                  }`}
                >
                  {pack.badge}
                </span>
              )}
              <div className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-blue-400">
                <PackIcon className="size-5" aria-hidden />
              </div>
              <h3 className="mt-4 text-sm font-medium text-white">{pack.name}</h3>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight text-white">
                  {formatSar(pack.sar, lang)}
                </span>
              </div>
              {usdApprox(pack.sar) && <p className="mt-1 text-xs text-zinc-500">{usdApprox(pack.sar)}</p>}
              <p className="mt-3 text-sm text-zinc-300">{pack.credits}</p>
              {pack.blurb && <p className="mt-1 text-xs text-zinc-500">{pack.blurb}</p>}
              <p className="mt-1 text-xs text-zinc-500">
                {sarPerCredit(pack.sar, pack.creditCount, lang)} {t.payg.perApp}
              </p>
              <Button
                variant={pack.featured ? "default" : "outline"}
                as={Link}
                href={`/dashboard/checkout?pack=${pack.slug}`}
                size="md"
                className="mt-5 w-full"
              >
                {t.payg.cta}
              </Button>
            </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ========================================================================
   FAQ
======================================================================== */
function Faq() {
  const { t, isRTL } = useLang();
  const [open, setOpen] = useState<string | null>(null);
  const ForwardIcon = isRTL ? ArrowLeft : ArrowRight;

  // Only the high-impact questions live here now, selected by id in
  // language.tsx rather than by slicing the array, so reordering the full list
  // can't silently change what the landing page promotes. Everything else is a
  // click away on /questions.
  const featured = t.faq.landing
    .map((id) => t.faq.items.find((item) => item.id === id))
    .filter((item): item is (typeof t.faq.items)[number] => Boolean(item));

  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-4 py-20 sm:px-6 sm:py-28">
      <SectionHeading eyebrow={t.faq.eyebrow} title={t.faq.title} description={t.faq.description} />

      {/* Separate cards rather than one divided block: each question gets its
          own surface, the open one lifts with a blue edge, and the number rail
          gives the eye something to follow. Same dark palette and blue accent
          as the rest of the page. */}
      <div className="mt-12 space-y-2.5">
        {featured.map((item, i) => (
          <FaqRow
            key={item.id}
            index={i + 1}
            item={item}
            isOpen={open === item.id}
            onToggle={() => setOpen(open === item.id ? null : item.id)}
          />
        ))}
      </div>

      <div className="mt-8 flex justify-center">
        <Button as={Link} href="/questions" variant="outline" size="lg">
          {t.faq.seeAll}
          <ForwardIcon className="size-4" aria-hidden />
        </Button>
      </div>
    </section>
  );
}

/* ========================================================================
   FINAL CTA
======================================================================== */
function FinalCta() {
  const { t, isRTL } = useLang();
  const ForwardIcon = isRTL ? ArrowLeft : ArrowRight;
  return (
    <section id="get-started" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-20 sm:px-6 sm:py-24">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-zinc-900/60 px-6 py-16 text-center sm:px-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,black,transparent)]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />
        {/* left-1/2 for the same reason as the hero glow above. */}
        <div className="pointer-events-none absolute -bottom-32 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-blue-600/20 blur-[110px]" />
        <div className="relative">
          <h2 className="mx-auto max-w-xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">{t.finalCta.title}</h2>
          <p className="mx-auto mt-4 max-w-md text-lg leading-relaxed text-zinc-400">{t.finalCta.description}</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button as={Link} href="/signup?plan=free" size="lg">
              {t.finalCta.ctaPrimary}
              <ForwardIcon className="size-4" aria-hidden />
            </Button>
            <Button
              variant="outline"
              as="a"
              href="#how-it-works"
              onClick={(e: React.MouseEvent) => scrollToSection(e, "how-it-works")}
              size="lg"
            >
              {t.finalCta.ctaSecondary}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ========================================================================
   FOOTER
======================================================================== */
function SiteFooter({ setOpenDoc }: { setOpenDoc: (key: LegalDocKey | null) => void }) {
  const { t } = useLang();
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.5fr_2fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-zinc-400">{t.footer.description}</p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {t.footer.columns.map((col) => (
              <div key={col.title}>
                <h3 className="text-sm font-medium text-white">{col.title}</h3>
                <ul className="mt-4 space-y-3">
                  {col.links.map((link) =>
                    link.doc ? (
                      <li key={link.label}>
                        <button
                          type="button"
                          onClick={() => setOpenDoc(link.doc as LegalDocKey)}
                          className="rounded text-sm text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                        >
                          {link.label}
                        </button>
                      </li>
                    ) : (
                      <li key={link.label}>
                        <a
                          href={link.href}
                          onClick={
                            link.href.startsWith("#") && link.href.length > 1
                              ? (e) => scrollToSection(e, link.href.replace("#", ""))
                              : undefined
                          }
                          className="rounded text-sm text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
                        >
                          {link.label}
                        </a>
                      </li>
                    )
                  )}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 sm:flex-row">
          <p className="text-sm text-zinc-500">{t.footer.rights(new Date().getFullYear())}</p>
          <div className="flex items-center gap-6 text-sm text-zinc-400">
            <Link href="/terms" className="rounded transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">{t.footer.terms}</Link>
            <Link href="/privacy" className="rounded transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">{t.footer.privacy}</Link>
            <Link href="/security" className="rounded transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">{t.footer.security}</Link>
            <Link href="/refund-policy" className="rounded transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">{t.footer.returnPolicy}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ========================================================================
   PAGE — route: "/"
======================================================================== */
export function LandingPage() {
  const { lang, isRTL } = useLang();
  const router = useRouter();
  const [openDoc, setOpenDoc] = useState<LegalDocKey | null>(null);
  return (
    <>
      {/* About is a real page now (linkable, shareable), not a modal.
          The legal docs below still use the modal — they are reference
          text you glance at, not a story you send someone. */}
      <SiteHeader onOpenAbout={() => router.push("/about")} />
      <main id="main">
        <Hero />
        <CompanyMarquee />
        <TrustBar />
        <Features />
        <HowItWorks />
        <TrustSection />
        <Pricing onOpenAbout={() => router.push("/about")} />
        <PayAsYouGo />
        <LinkedInAddOn />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter setOpenDoc={setOpenDoc} />
      <LegalModal
        doc={openDoc ? legalContent[lang][openDoc] : null}
        open={openDoc !== null}
        onClose={() => setOpenDoc(null)}
        isRTL={isRTL}
      />
    </>
  );
}

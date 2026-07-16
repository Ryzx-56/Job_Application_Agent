"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
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
  Plus,
  Menu,
  X,
  FileText,
  LayoutDashboard,
  Settings,
  Lock,
  ScanSearch,
  BadgeCheck,
  Flame,
} from "lucide-react";
import { useLang } from "@/lib/language";
import { Button, Logo, LangSwitcher } from "@/components/brand";
import { useAuth } from "@/lib/auth";
import { fetchCredits, Tier } from "@/lib/supabase/credits";
import { cancelSubscription, resumeSubscription } from "@/lib/subscription";
import { LegalModal } from "@/components/legal-modal";
import { legalContent, LegalDocKey } from "@/lib/legal-content";

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

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => scrollToSection(e, link.href.replace("#", ""))}
              className="rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
            >
              {link.label}
            </a>
          ))}
          <button
            type="button"
            onClick={onOpenAbout}
            className="rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
          >
            {t.nav.about}
          </button>
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <LangSwitcher />
          {!isLoggedIn && (
            <Button variant="ghost" as={Link} href="/login">{t.nav.login}</Button>
          )}
          <Button as={Link} href={isLoggedIn ? "/dashboard" : "/signup"}>
            {isLoggedIn ? t.nav.dashboard : t.nav.getStarted}
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="grid size-11 place-items-center rounded-lg border border-white/10 text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        </button>
      </div>

      <div
        id="mobile-menu"
        className={`mx-4 grid transition-all duration-300 ease-out md:hidden ${
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
   HERO MOCKUP
======================================================================== */
function ScoreRing({ score, label }: { score: number; label: string }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  return (
    <div className="relative grid size-32 shrink-0 place-items-center">
      <svg className="size-32 -rotate-90" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={radius} fill="none" stroke="#e4e4e7" strokeWidth="7" />
        <circle cx="44" cy="44" r={radius} fill="none" stroke="#2563eb" strokeWidth="7" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <div className="absolute flex flex-col items-center gap-1">
        <span className="text-3xl font-bold text-zinc-900">{score}</span>
        <span className="text-xs font-medium text-zinc-500">{label}</span>
      </div>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-zinc-500">{label}</span>
        <span className="shrink-0 font-semibold text-zinc-900">{value}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
        <div className="h-full rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function StatusBadge({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "green" }) {
  const tones = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-emerald-50 text-emerald-600",
  };
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>
      <Check className="size-3" aria-hidden />
      {children}
    </span>
  );
}

function DashboardPreview() {
  const { t } = useLang();
  const d = t.dashboardPreview;

  const [progress, setProgress] = useState(100);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    let value = 100;
    let holding = true;
    let holdTicks = 0;
    const id = setInterval(() => {
      if (holding) {
        holdTicks += 1;
        if (holdTicks > 22) {
          holding = false;
          value = 0;
        }
        return;
      }
      value = Math.min(100, value + 6);
      setProgress(value);
      setGenerating(value < 100);
      if (value >= 100) {
        holding = true;
        holdTicks = 0;
      }
    }, 70);
    return () => clearInterval(id);
  }, []);

  const sidebarItems = [
    { icon: LayoutDashboard, label: d.sidebar.dashboard, active: true },
    { icon: FileText, label: d.sidebar.myResumes, active: false },
    { icon: Settings, label: d.sidebar.settings, active: false },
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-100 p-3 shadow-2xl shadow-black/40 sm:p-4">
      <div className="flex items-center gap-2 px-1.5 pb-3">
        <span className="size-2.5 rounded-full bg-red-300" />
        <span className="size-2.5 rounded-full bg-amber-300" />
        <span className="size-2.5 rounded-full bg-emerald-300" />
        <div className="ms-2 flex items-center gap-1.5 rounded-md bg-zinc-200 px-2.5 py-1 text-xs text-zinc-500">
          <FileText className="size-3" />
          {d.urlLabel}
        </div>
      </div>

      <div className="flex overflow-hidden rounded-xl bg-white">
        <aside aria-hidden className="hidden w-12 shrink-0 flex-col items-center gap-1 border-e border-zinc-200 bg-zinc-50 py-3 sm:flex">
          {sidebarItems.map((item) => (
            <span
              key={item.label}
              title={item.label}
              className={`grid size-8 place-items-center rounded-lg ${
                item.active ? "bg-blue-50 text-blue-600" : "text-zinc-400"
              }`}
            >
              <item.icon className="size-4" />
            </span>
          ))}
        </aside>

        <div className="min-w-0 flex-1 space-y-3 p-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-white p-3.5">
              <p className="text-sm font-semibold text-zinc-900">{d.uploadLabel}</p>
              <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-blue-50 text-blue-600">
                  <FileText className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-700">{d.fileName}</span>
                <StatusBadge>{d.parsed}</StatusBadge>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-3.5">
              <p className="text-sm font-semibold text-zinc-900">{d.jdLabel}</p>
              <div className="mt-2.5 space-y-1.5 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5">
                <div className="h-2 w-1/2 rounded-full bg-zinc-300" />
                <div className="h-2 w-full rounded-full bg-zinc-200" />
                <div className="h-2 w-2/3 rounded-full bg-zinc-200" />
              </div>
              <p className="mt-2 truncate text-xs text-zinc-500">{d.role}</p>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white">
                <Sparkles className="size-4" />
                {d.generate}
              </span>
              <StatusBadge tone={generating ? "blue" : "green"}>
                {generating ? d.generating : d.optimized}
              </StatusBadge>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
              <div className="h-full rounded-full bg-blue-600 transition-all duration-150" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {/* ATS score — its own full-width card so labels always have room */}
          <div className="rounded-xl border border-zinc-200 bg-white p-3.5">
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <ScoreRing score={92} label={d.atsLabel} />
              <div className="grid w-full min-w-0 flex-1 gap-3 sm:grid-cols-2">
                <ScoreBar label={d.keywordMatch} value={94} />
                <ScoreBar label={d.formatting} value={88} />
              </div>
            </div>
          </div>

          {/* Suggestions — full width, no more squeezing next to the score */}
          <div className="rounded-xl border border-zinc-200 bg-white p-3.5">
            <p className="mb-2.5 text-sm font-semibold text-zinc-900">{d.suggestionsLabel}</p>
            <div className="space-y-2">
              {d.improvements.map((item) => (
                <div key={item} className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-blue-600 text-white">
                    <Check className="size-2.5" aria-hidden />
                  </span>
                  <span className="text-sm leading-snug text-zinc-700">{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-white p-3.5">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-900">{d.resumeLabel}</p>
                <StatusBadge tone="green">{d.ready}</StatusBadge>
              </div>
              <div className="space-y-2">
                <div className="h-2 w-3/4 rounded-full bg-zinc-800" />
                <div className="h-2 w-full rounded-full bg-zinc-100" />
                <div className="h-2 w-full rounded-full bg-zinc-100" />
                <div className="h-2 w-2/3 rounded-full bg-blue-300" />
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-3.5">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-900">{d.coverLetterLabel}</p>
                <StatusBadge tone="green">{d.ready}</StatusBadge>
              </div>
              <div className="space-y-2">
                <div className="h-2 w-1/2 rounded-full bg-zinc-800" />
                <div className="h-2 w-full rounded-full bg-zinc-100" />
                <div className="h-2 w-full rounded-full bg-zinc-100" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================
   HERO
======================================================================== */
function Hero() {
  const { t, isRTL } = useLang();
  const ForwardIcon = isRTL ? ArrowLeft : ArrowRight;

  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
      <div className="pointer-events-none absolute -top-40 start-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-blue-600/20 blur-[120px]" />

      <div className="relative mx-auto max-w-6xl px-4 pt-32 pb-16 sm:px-6 sm:pt-40 lg:pt-44">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-10">
          <div>
            <a
              href="#features"
              onClick={(e) => scrollToSection(e, "features")}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-400 backdrop-blur transition-colors hover:text-white"
            >
              <span className="inline-flex items-center gap-1.5 text-blue-400">
                <Sparkles className="size-3.5" />
                {t.hero.badge}
              </span>
              <span className="h-3 w-px bg-white/10" />
              {t.hero.badgeText}
            </a>

            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
              {t.hero.headline}
            </h1>

            <p className="mt-5 max-w-md text-lg leading-relaxed text-zinc-400">{t.hero.sub}</p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button as={Link} href="/signup?plan=free" size="lg">
                {t.hero.ctaPrimary}
                <ForwardIcon className="size-4" aria-hidden />
              </Button>
              <Button
                variant="outline"
                as="a"
                href="#how-it-works"
                onClick={(e: React.MouseEvent) => scrollToSection(e, "how-it-works")}
                size="lg"
              >
                {t.hero.ctaSecondary}
              </Button>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-zinc-400">
              <div className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-blue-400" />
                {t.hero.noCard}
              </div>
              <div className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-blue-400" />
                {t.hero.freeForever}
              </div>
            </div>
          </div>

          <div>
            <DashboardPreview />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ========================================================================
   TRUST BAR
======================================================================== */
function TrustBar() {
  const { t } = useLang();
  const icons = [Lock, ScanSearch, BadgeCheck];
  return (
    <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-col items-center gap-6 border-y border-white/10 py-6 sm:flex-row sm:justify-center sm:gap-10 sm:py-5">
        {t.trustBar.map((label, i) => {
          const Icon = icons[i];
          return (
            <div key={label} className="flex items-center gap-2.5 text-sm text-zinc-400">
              <Icon className="size-4 text-blue-400" aria-hidden />
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

function Pricing() {
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

  const resetDateLabel = resetAt
    ? new Date(resetAt).toLocaleDateString(isAr ? "ar-SA" : "en-US", { month: "short", day: "numeric" })
    : "";

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
                plan.offerBanner
                  ? "overflow-hidden border-amber-400/60 shadow-2xl shadow-amber-500/10 ring-1 ring-amber-400/30 lg:-translate-y-3 lg:scale-[1.03]"
                  : plan.featured
                  ? "border-blue-400/50 shadow-xl shadow-blue-950/20 lg:-translate-y-2"
                  : plan.premium
                  ? "border-white/20 bg-gradient-to-b from-zinc-900/80 to-zinc-900/40 shadow-lg shadow-black/30"
                  : "border-white/10 hover:border-blue-400/30"
              }`}
            >
              {plan.offerBanner ? (
                <div className="-mx-7 -mt-7 mb-5 flex items-center justify-center gap-1.5 bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-center text-xs font-bold uppercase tracking-wide text-zinc-950">
                  <Flame className="size-3.5 shrink-0" aria-hidden />
                  {plan.offerBanner}
                </div>
              ) : (
                <>
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
                </>
              )}

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-white">{plan.name}</h3>
                  {plan.offerBanner && plan.badge && (
                    <span className="rounded-full bg-blue-600/90 px-2 py-0.5 text-[10px] font-medium text-white">
                      {plan.badge}
                    </span>
                  )}
                </div>
                {isCurrent && planSlug !== "free" && !hasPendingChange && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-400/25 bg-blue-400/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-blue-300">
                    <span className="size-1.5 rounded-full bg-blue-400" aria-hidden />
                    {copy.subscribed}
                  </span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-baseline gap-1.5">
                {plan.originalPrice && (
                  <span className="text-lg font-medium text-zinc-600 line-through">{plan.originalPrice}</span>
                )}
                <span className="text-4xl font-semibold tracking-tight text-white">{plan.price}</span>
                <span className="text-sm text-zinc-500">{plan.period}</span>
                {plan.discountLabel && (
                  <span className="ms-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-300">
                    {plan.discountLabel}
                  </span>
                )}
              </div>
              {plan.priceSar && <p className="mt-1 text-xs text-zinc-500">{plan.priceSar}</p>}
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
  const { t } = useLang();
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
                <span className="text-3xl font-semibold tracking-tight text-white">{pack.price}</span>
              </div>
              {pack.priceSar && <p className="mt-1 text-xs text-zinc-500">{pack.priceSar}</p>}
              <p className="mt-3 text-sm text-zinc-300">{pack.credits}</p>
              {pack.blurb && <p className="mt-1 text-xs text-zinc-500">{pack.blurb}</p>}
              <p className="mt-1 text-xs text-zinc-500">
                {pack.perAppValue} {t.payg.perApp}
              </p>
              <Button
                variant={pack.featured ? "default" : "outline"}
                as={Link}
                href={`/checkout?pack=${pack.slug}`}
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
  const { t } = useLang();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-4 py-20 sm:px-6 sm:py-28">
      <SectionHeading eyebrow={t.faq.eyebrow} title={t.faq.title} description={t.faq.description} />
      <div className="mt-12 divide-y divide-white/10 rounded-2xl border border-white/10 bg-zinc-900/60">
        {t.faq.items.map((item, i) => {
          const isOpen = open === i;
          const panelId = `faq-panel-${i}`;
          return (
            <div key={item.q}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 focus-visible:ring-inset"
                aria-expanded={isOpen}
                aria-controls={panelId}
              >
                <span className="text-sm font-medium text-white">{item.q}</span>
                <Plus className={`size-4 shrink-0 text-zinc-500 transition-transform duration-300 ${isOpen ? "rotate-45 text-blue-400" : ""}`} aria-hidden />
              </button>
              <div
                id={panelId}
                role="region"
                className={`grid overflow-hidden transition-all duration-300 ease-out ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
              >
                <div className="overflow-hidden">
                  <p className="px-6 pb-5 text-sm leading-relaxed text-zinc-400">{item.a}</p>
                </div>
              </div>
            </div>
          );
        })}
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
        <div className="pointer-events-none absolute -bottom-32 start-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-blue-600/20 blur-[110px]" />
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
function SiteFooter({ openDoc, setOpenDoc }: { openDoc: LegalDocKey | null; setOpenDoc: (key: LegalDocKey | null) => void }) {
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
            <button type="button" onClick={() => setOpenDoc("terms")} className="rounded transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">{t.footer.terms}</button>
            <button type="button" onClick={() => setOpenDoc("privacy")} className="rounded transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">{t.footer.privacy}</button>
            <button type="button" onClick={() => setOpenDoc("security")} className="rounded transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">{t.footer.security}</button>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ========================================================================
   PAGE — route: "/"
======================================================================== */
export default function LandingPage() {
  const { lang, isRTL } = useLang();
  const [openDoc, setOpenDoc] = useState<LegalDocKey | null>(null);
  return (
    <>
      <SiteHeader onOpenAbout={() => setOpenDoc("about")} />
      <main id="main">
        <Hero />
        <TrustBar />
        <Features />
        <HowItWorks />
        <TrustSection />
        <Pricing />
        <PayAsYouGo />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter openDoc={openDoc} setOpenDoc={setOpenDoc} />
      <LegalModal
        doc={openDoc ? legalContent[lang][openDoc] : null}
        open={openDoc !== null}
        onClose={() => setOpenDoc(null)}
        isRTL={isRTL}
      />
    </>
  );
}

"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Settings,
  LogOut,
  Menu,
  X,
  UploadCloud,
  CheckCircle2,
  FileX2,
  Eye,
  Download,
  Loader2,
} from "lucide-react";
import { Globe } from "lucide-react";
import { useLang, useSyncLanguageFromAccount } from "@/lib/language";
import { Logo } from "@/components/brand";
import { signOut } from "@/lib/auth";

/* ========================================================================
   LANGUAGE SWITCHER (light) — brand.tsx's LangSwitcher is styled for the
   dark marketing theme; the dashboard topbar needs a light counterpart.
======================================================================== */
function DashboardLangSwitcher() {
  const { lang, setLang } = useLang();
  return (
    <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs font-medium">
      <Globe className="ms-1 size-3.5 text-slate-400" aria-hidden />
      <button
        type="button"
        onClick={() => setLang("en")}
        aria-pressed={lang === "en"}
        lang="en"
        className={`rounded-md px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
          lang === "en" ? "bg-blue-600 text-white" : "text-slate-500 hover:text-slate-900"
        }`}
      >
        English
      </button>
      <span className="text-slate-300">|</span>
      <button
        type="button"
        onClick={() => setLang("ar")}
        aria-pressed={lang === "ar"}
        lang="ar"
        className={`rounded-md px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
          lang === "ar" ? "bg-blue-600 text-white" : "text-slate-500 hover:text-slate-900"
        }`}
      >
        العربية
      </button>
    </div>
  );
}

/* ========================================================================
   DASHBOARD BUTTON — now shares the landing page's blue-600 accent so the
   two surfaces read as one product instead of two different apps.
======================================================================== */
type DashboardButtonProps = React.ComponentPropsWithoutRef<"button"> & {
  as?: React.ElementType;
  variant?: "primary" | "outline" | "ghost";
  size?: "lg" | "md" | "sm";
  href?: string;
};

export function DashboardButton({
  as: Tag = "button",
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: DashboardButtonProps) {
  const base =
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-150 outline-none select-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px";
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-500 shadow-sm shadow-blue-900/15 hover:shadow-md hover:shadow-blue-900/20",
    outline: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300",
    ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  };
  const sizes = { lg: "h-11 px-5", md: "h-9 px-4", sm: "h-8 px-3 text-xs" };
  return (
    <Tag className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </Tag>
  );
}

/* ========================================================================
   SCORE RING — circular progress used for the ATS match score
======================================================================== */
export function ScoreRing({ score, label, size = 128 }: { score: number; label?: string; size?: number }) {
  const stroke = size * 0.08;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(Math.max(score, 0), 100) / 100);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#eef2f7" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#2563eb"
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-[stroke-dashoffset] duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-2xl font-semibold tracking-tight text-slate-900">{score}%</span>
        </div>
      </div>
      {label && <span className="text-sm font-medium text-slate-500">{label}</span>}
    </div>
  );
}

/* ========================================================================
   SCORE BAR — a labeled horizontal progress bar for score breakdowns
   (keyword match, formatting, skills, education, experience, etc).
======================================================================== */
export function ScoreBar({ label, value }: { label: string; value: number }) {
  const clamped = Math.min(Math.max(value, 0), 100);
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
        <span className="min-w-0 truncate text-slate-500">{label}</span>
        <span className="shrink-0 font-semibold text-slate-900">{clamped}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-blue-600 transition-all duration-700 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

/* ========================================================================
   UPLOAD ZONE — drag-and-drop / click-to-browse CV upload
======================================================================== */
export function UploadZone({
  file,
  onFileSelect,
  onRemove,
  label,
  hint,
  parsedLabel,
  removeLabel,
}: {
  file: File | null;
  onFileSelect: (file: File) => void;
  onRemove: () => void;
  label: string;
  hint: string;
  parsedLabel: string;
  removeLabel: string;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const inputId = "cv-upload-input";

  if (file) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">{file.name}</p>
            <p className="text-xs text-emerald-600">{parsedLabel}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        >
          <FileX2 className="size-4" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) onFileSelect(dropped);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed px-5 py-10 text-center transition-colors ${
        isDragging ? "border-blue-400 bg-blue-50/60" : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100/60"
      }`}
    >
      <span className="grid size-10 place-items-center rounded-full bg-white text-blue-600 shadow-sm ring-1 ring-slate-100">
        <UploadCloud className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <p className="text-xs text-slate-500">{hint}</p>
      <input
        id={inputId}
        type="file"
        accept=".pdf,.docx"
        className="sr-only"
        onChange={(e) => {
          const selected = e.target.files?.[0];
          if (selected) onFileSelect(selected);
        }}
      />
    </label>
  );
}

/* ========================================================================
   FILE RESULT CARD — the "Resume" / "Cover letter" output cards, with
   working Preview (opens the PDF inline in a new tab) and Download
   (saves via Content-Disposition: attachment) actions.
======================================================================== */
export function FileResultCard({
  icon: Icon = FileText,
  title,
  readyLabel,
  previewLabel,
  downloadLabel,
  previewHref,
  downloadHref,
  disabled = false,
}: {
  icon?: React.ElementType;
  title: string;
  readyLabel: string;
  previewLabel: string;
  downloadLabel: string;
  previewHref: string;
  downloadHref: string;
  disabled?: boolean;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-blue-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600">
            <Icon className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
            <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle2 className="size-3" aria-hidden />
              {readyLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3.5 flex items-center gap-2">
        <a
          href={disabled ? undefined : previewHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={disabled}
          className={`inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 transition-colors ${
            disabled ? "pointer-events-none opacity-40" : "hover:bg-slate-50 hover:border-slate-300"
          }`}
        >
          <Eye className="size-3.5" aria-hidden />
          {previewLabel}
        </a>
        <a
          href={disabled ? undefined : downloadHref}
          download
          aria-disabled={disabled}
          className={`inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 text-xs font-medium text-white transition-colors ${
            disabled ? "pointer-events-none opacity-40" : "hover:bg-blue-500"
          }`}
        >
          <Download className="size-3.5" aria-hidden />
          {downloadLabel}
        </a>
      </div>
    </div>
  );
}

/* ========================================================================
   EMPTY STATE — used by My Resumes / Applications when there's no data
======================================================================== */
export function EmptyState({
  icon: Icon,
  title,
  body,
  ctaLabel,
  ctaHref,
}: {
  icon: React.ElementType;
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-16 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-white text-slate-400 shadow-sm">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-base font-medium text-slate-900">{title}</p>
      <p className="max-w-sm text-sm leading-relaxed text-slate-500">{body}</p>
      <DashboardButton as={Link} href={ctaHref} variant="outline" size="sm" className="mt-1">
        {ctaLabel}
      </DashboardButton>
    </div>
  );
}

/* ========================================================================
   STATUS BADGE — Applications table status pill / generic status pill
======================================================================== */
const statusStyles: Record<string, string> = {
  applied: "bg-blue-50 text-blue-700",
  interview: "bg-violet-50 text-violet-700",
  rejected: "bg-rose-50 text-rose-700",
  ready: "bg-emerald-50 text-emerald-700",
  generating: "bg-blue-50 text-blue-700",
};

export function StatusBadge({
  status,
  label,
}: {
  status: "applied" | "interview" | "rejected" | "ready" | "generating";
  label: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${statusStyles[status]}`}>
      {status === "generating" && <Loader2 className="size-3 animate-spin" aria-hidden />}
      {label}
    </span>
  );
}

/* ========================================================================
   DASHBOARD SHELL — sidebar + topbar wrapper around every /dashboard/* page.
   Collapses to a hamburger drawer on mobile.
======================================================================== */
type DashboardUser = { name: string | null; email: string; preferredLanguage?: string | null };

function useNavItems() {
  const { t } = useLang();
  return [
    { href: "/dashboard", label: t.dashboard.sidebar.dashboard, icon: LayoutDashboard },
    { href: "/dashboard/resumes", label: t.dashboard.sidebar.myResumes, icon: FileText },
    { href: "/dashboard/settings", label: t.dashboard.sidebar.settings, icon: Settings },
  ];
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLang();
  const pathname = usePathname();
  const navItems = useNavItems();

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-6 pt-1">
        <Link href="/dashboard" aria-label="Tarshih dashboard">
          {/* Forces light-mode theme inversion for the desktop sidebar layout */}
          <Logo variant="light" />
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Icon className="size-4.5 shrink-0" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 px-3 pb-4 pt-3">
        <button
          type="button"
          onClick={() => signOut()}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <LogOut className="size-4.5 shrink-0" aria-hidden />
          {t.dashboard.sidebar.logout}
        </button>
      </div>
    </div>
  );
}

export function DashboardShell({ user, children }: { user: DashboardUser; children: React.ReactNode }) {
  const { isRTL } = useLang();
  useSyncLanguageFromAccount(user.preferredLanguage);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const displayName = user.name?.trim() || user.email;

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-e border-slate-200 bg-white lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setDrawerOpen(false)} />
          <div className={`absolute top-0 h-full w-72 bg-white shadow-xl ${isRTL ? "end-0" : "start-0"}`}>
            <div className="flex items-center justify-end px-3 pt-3">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="size-4.5" aria-hidden />
              </button>
            </div>
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-h-screen flex-1 flex-col">
        {/* Topbar */}
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="size-5" aria-hidden />
            </button>
            <div className="lg:hidden">
              {/* Forces light-mode theme inversion for the mobile top header layout */}
              <Logo variant="light" showWordmark={false} />
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <span className="hidden text-sm font-medium text-slate-700 sm:block">{displayName}</span>
            <DashboardLangSwitcher />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Files,
  Settings,
  LogOut,
  Menu,
  X,
  UploadCloud,
  CheckCircle2,
  FileX2,
} from "lucide-react";
import { Globe } from "lucide-react";
import { useLang } from "@/lib/language";
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
        className={`rounded-md px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 ${
          lang === "en" ? "bg-sky-600 text-white" : "text-slate-500 hover:text-slate-900"
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
        className={`rounded-md px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 ${
          lang === "ar" ? "bg-sky-600 text-white" : "text-slate-500 hover:text-slate-900"
        }`}
      >
        العربية
      </button>
    </div>
  );
}

/* ========================================================================
   DASHBOARD BUTTON — the marketing Button in components/brand.tsx is
   styled for the dark landing/login/signup theme. The dashboard is a
   separate light theme (Linear/Notion-style), so it gets its own button
   rather than overloading Button's variants with theme-switching logic.
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
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-sky-500/40 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px";
  const variants = {
    primary: "bg-sky-600 text-white hover:bg-sky-500 shadow-sm shadow-sky-900/10",
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
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#0284c7"
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
          className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
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
        isDragging ? "border-sky-400 bg-sky-50" : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100/60"
      }`}
    >
      <span className="grid size-10 place-items-center rounded-full bg-white text-sky-600 shadow-sm">
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
   STATUS BADGE — Applications table status pill
======================================================================== */
const statusStyles: Record<string, string> = {
  applied: "bg-sky-50 text-sky-700",
  interview: "bg-violet-50 text-violet-700",
  rejected: "bg-rose-50 text-rose-700",
};

export function StatusBadge({ status, label }: { status: "applied" | "interview" | "rejected"; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusStyles[status]}`}>
      {label}
    </span>
  );
}

/* ========================================================================
   DASHBOARD SHELL — sidebar + topbar wrapper around every /dashboard/* page.
   Collapses to a hamburger drawer on mobile.
======================================================================== */
type DashboardUser = { name: string | null; email: string };

function useNavItems() {
  const { t } = useLang();
  return [
    { href: "/dashboard", label: t.dashboard.sidebar.dashboard, icon: LayoutDashboard },
    { href: "/dashboard/resumes", label: t.dashboard.sidebar.myResumes, icon: FileText },
    { href: "/dashboard/applications", label: t.dashboard.sidebar.applications, icon: Files },
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
                active ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
"use client";

import React from "react";
import { Globe } from "lucide-react";
import { useLang } from "@/lib/language";

/* ========================================================================
   BUTTON
======================================================================== */
type ButtonProps = React.ComponentPropsWithoutRef<"button"> & {
  as?: React.ElementType;
  variant?: "default" | "outline" | "ghost";
  size?: "lg" | "md" | "sm";
  href?: string;
};

export function Button({
  as: Tag = "button",
  variant = "default",
  size = "lg",
  className = "",
  children,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-blue-400/60 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px";
  const variants = {
    default: "bg-blue-600 text-white hover:bg-blue-500 shadow-sm shadow-blue-950/40",
    outline: "border border-white/10 bg-transparent text-zinc-100 hover:bg-white/5 hover:border-white/20",
    ghost: "text-zinc-300 hover:bg-white/5 hover:text-white",
  };
  const sizes = { lg: "h-11 px-5", md: "h-9 px-4", sm: "h-8 px-3 text-xs" };
  return (
    <Tag className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </Tag>
  );
}

/* ========================================================================
   LOGO
======================================================================== */
export function Logo({ showWordmark = true }: { showWordmark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden className="grid size-8 place-items-center rounded-[0.6rem] bg-blue-600 text-white shadow-sm">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 3.5h9l5 5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
          <path d="M13.5 3.5V9h5" />
          <path d="m8.5 14 2.2 2.2L15 12" />
        </svg>
      </span>
      {showWordmark && (
        <span className="flex items-baseline gap-1.5">
          <span className="text-[1.05rem] font-semibold tracking-tight text-white">Tarshih</span>
          <span dir="rtl" className="text-xs text-zinc-500">ترشيح</span>
        </span>
      )}
    </span>
  );
}

/* ========================================================================
   LANGUAGE SWITCHER — reads/writes the shared LangProvider from layout.tsx
======================================================================== */
export function LangSwitcher() {
  const { lang, setLang } = useLang();
  return (
    <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1 text-xs font-medium">
      <Globe className="ms-1 size-3.5 text-zinc-500" aria-hidden />
      <button
        type="button"
        onClick={() => setLang("en")}
        aria-pressed={lang === "en"}
        lang="en"
        className={`rounded-md px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 ${
          lang === "en" ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-white"
        }`}
      >
        English
      </button>
      <span className="text-zinc-600">|</span>
      <button
        type="button"
        onClick={() => setLang("ar")}
        aria-pressed={lang === "ar"}
        lang="ar"
        className={`rounded-md px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 ${
          lang === "ar" ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-white"
        }`}
      >
        العربية
      </button>
    </div>
  );
}

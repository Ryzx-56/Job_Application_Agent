"use client";

import React from "react";
import Image from "next/image";
import { Globe } from "lucide-react";
import { useLang } from "@/lib/language";
import LogoAsset from "./Logo_2.svg"; // Static import of your new geometric logo

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

import LogoAssetEN from "./Logo_2.svg";     // Original (White Text)
import LogoAssetAR from "./Logo_2_A.svg";   // Original Arabic (White Text)
import LogoDarkEN from "./Logo_2_dark.svg";   // Your new edit (Dark Text)
import LogoDarkAR from "./Logo_2_A_dark.svg"; // Your new Arabic edit (Dark Text)

/* ========================================================================
   LOGO
======================================================================== */
interface LogoProps {
  showWordmark?: boolean; // Kept for compatibility
  className?: string;
  variant?: "light" | "dark"; 
}

export function Logo({ className = "", variant = "dark" }: LogoProps) {
  const { lang } = useLang();

  // 1. Choose the correct theme dictionary based on the layout variant
  const logoTheme = variant === "light" 
    ? { en: LogoDarkEN, ar: LogoDarkAR } 
    : { en: LogoAssetEN, ar: LogoAssetAR };

  // 2. Extract the exact file based on the language selection
  const currentLogo = lang === "ar" ? logoTheme.ar : logoTheme.en;

  return (
    <span className={`flex items-center select-none ${className}`}>
      <Image
        src={currentLogo}
        alt={lang === "ar" ? "شعار ترشيح" : "Tarshih Logo"}
        className="w-36 h-auto object-contain shrink-0"
        priority
      />
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
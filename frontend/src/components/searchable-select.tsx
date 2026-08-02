"use client";

// components/searchable-select.tsx
//
// A type-to-filter dropdown for long option lists (countries, cities) —
// a plain <select> has no real search, and jump-to-letter on a 195-country
// or even a curated ~23-city list is still painful to scan by eye. No new
// npm dependency — self-contained, matches the two visual themes already
// used across the app (dark: register page; light: Settings, manual CV
// form) via the `theme` prop.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

export type SearchableSelectOption = { value: string; label: string };

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  noResultsLabel,
  disabled,
  dir,
  theme = "light",
}: {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  noResultsLabel: string;
  disabled?: boolean;
  dir?: "ltr" | "rtl";
  theme?: "dark" | "light";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const selected = options.find((o) => o.value === value);
  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  const isDark = theme === "dark";
  const triggerClass = isDark
    ? "flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-base text-white outline-none transition-colors focus:border-blue-400/60 focus:bg-white/[0.07] focus:ring-2 focus:ring-blue-400/30"
    : "flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20";
  const panelClass = isDark
    ? "absolute z-20 mt-1.5 w-full overflow-hidden rounded-lg border border-white/10 bg-zinc-900 shadow-xl"
    : "absolute z-20 mt-1.5 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg";
  const searchBarClass = isDark
    ? "flex items-center gap-2 border-b border-white/10 px-3 py-2"
    : "flex items-center gap-2 border-b border-slate-200 px-3 py-2";
  const searchInputClass = isDark
    ? "w-full bg-transparent text-sm text-white placeholder:text-zinc-600 outline-none"
    : "w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 outline-none";
  const optionClass = (isSelected: boolean) =>
    isDark
      ? `block w-full px-4 py-2.5 text-start text-sm hover:bg-white/5 ${isSelected ? "bg-blue-500/10 text-blue-400" : "text-white"}`
      : `block w-full px-4 py-2.5 text-start text-sm hover:bg-slate-50 ${isSelected ? "bg-sky-50 text-sky-700" : "text-slate-900"}`;

  return (
    <div ref={rootRef} className="relative" dir={dir}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={triggerClass}
      >
        <span className={`truncate ${selected ? "" : isDark ? "text-zinc-600" : "text-slate-400"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden />
      </button>

      {open && (
        <div className={panelClass}>
          <div className={searchBarClass}>
            <Search className="size-4 shrink-0 opacity-50" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className={searchInputClass}
            />
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className={`px-4 py-2.5 text-sm ${isDark ? "text-zinc-500" : "text-slate-400"}`}>
                {noResultsLabel}
              </div>
            )}
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                  setQuery("");
                }}
                className={optionClass(o.value === value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

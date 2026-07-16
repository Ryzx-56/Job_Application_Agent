"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";
import type { LegalDoc } from "@/lib/legal-content";

/* ========================================================================
   LEGAL MODAL
   A single reusable dialog for Terms, Privacy, Security, About, the
   Resume Guide, ATS Tips, and Contact. Pass the LegalDoc for the language
   currently active. The caller (page.tsx, login/signup) owns the
   open/closed state and picks the right language before handing it in.
======================================================================== */
export function LegalModal({
  doc,
  open,
  onClose,
  isRTL,
}: {
  doc: LegalDoc | null;
  open: boolean;
  onClose: () => void;
  isRTL?: boolean;
}) {
  // Escape to close, and lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || !doc) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-title"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <div
        className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-zinc-900 shadow-2xl shadow-black/50 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5 sm:px-8">
          <div>
            <h2 id="legal-modal-title" className="text-lg font-semibold text-white sm:text-xl">
              {doc.title}
            </h2>
            {doc.updated && <p className="mt-1 text-xs text-zinc-500">{doc.updated}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-6 sm:px-8">
          {doc.intro && <p className="mb-6 text-sm leading-relaxed text-zinc-400">{doc.intro}</p>}
          <div className="space-y-6">
            {doc.sections.map((section) => (
              <div key={section.heading}>
                <h3 className="text-sm font-semibold text-white">{section.heading}</h3>
                <div className="mt-2 space-y-2.5">
                  {section.body.map((paragraph, i) => (
                    <p key={i} className="text-sm leading-relaxed text-zinc-400">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

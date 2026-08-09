"use client";

import React from "react";
import { Plus } from "lucide-react";

/* ========================================================================
   FAQ ROW

   Shared by the landing page's short FAQ section and the full /questions
   page, so the two can't drift apart in look or behaviour. Lives here rather
   than in either page for that reason.

   Design notes: separate cards instead of one divided block, so each question
   owns a surface; the open card lifts with a blue edge; a numbered rail gives
   the eye a line to follow down the list. Dark canvas, blue accent, same type
   scale as the rest of the marketing pages.
======================================================================== */

export type FaqItem = { id: string; q: string; a: string };

export function FaqRow({
  item,
  index,
  isOpen,
  onToggle,
}: {
  item: FaqItem;
  /** Position in the visible list. Omit to hide the number rail. */
  index?: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const panelId = `faq-panel-${item.id}`;
  return (
    <div
      className={`overflow-hidden rounded-2xl border transition-colors duration-200 ${
        isOpen
          ? "border-blue-400/35 bg-zinc-900/80"
          : "border-white/10 bg-zinc-900/50 hover:border-white/20 hover:bg-zinc-900/70"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-4 px-5 py-4 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 focus-visible:ring-inset sm:px-6 sm:py-5"
        aria-expanded={isOpen}
        aria-controls={panelId}
      >
        {index !== undefined && (
          <span
            className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg border text-[11px] font-semibold tabular-nums transition-colors ${
              isOpen
                ? "border-blue-400/40 bg-blue-400/15 text-blue-300"
                : "border-white/10 bg-white/5 text-zinc-500"
            }`}
            aria-hidden
          >
            {index}
          </span>
        )}
        <span className="min-w-0 flex-1 text-sm font-medium text-white sm:text-[15px]">{item.q}</span>
        <Plus
          className={`mt-0.5 size-4 shrink-0 transition-transform duration-300 ${
            isOpen ? "rotate-45 text-blue-400" : "text-zinc-500"
          }`}
          aria-hidden
        />
      </button>
      <div
        id={panelId}
        role="region"
        className={`grid overflow-hidden transition-all duration-300 ease-out ${
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          {/* Indented to line up with the question text, not the number rail. */}
          <p className="px-5 pb-5 text-sm leading-relaxed text-zinc-400 sm:px-6 sm:ps-16">{item.a}</p>
        </div>
      </div>
    </div>
  );
}

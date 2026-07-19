"use client";

import { Check, Loader2 } from "lucide-react";
import type { AgentStep } from "@/lib/useOptimizeStream";

/**
 * Live "Agent N" progress display for the dashboard's generating panel.
 * Two modes, controlled by `expanded`:
 *
 *  - expanded=true (while generating): full checklist, one row per agent,
 *    with label text. Sits below the existing sliding progress bar.
 *  - expanded=false (once done): collapses into a compact one-line strip
 *    of small checkmark dots — stays permanently next to the "Optimized"
 *    badge as a lightweight "proof of work" trail instead of disappearing.
 *    Hover a dot to see which step it was.
 *
 * Colors lean on the dashboard's slate/blue/emerald palette, with a
 * blue-to-cyan gradient ring (borrowed from the landing page's hero accent)
 * on the active spinner and the completed dots, so it doesn't read as
 * flat/generic.
 */
export function AgentProgress({ steps, expanded }: { steps: AgentStep[]; expanded: boolean }) {
  if (expanded) {
    return (
      <ul className="mt-4 space-y-3" role="status" aria-live="polite">
        {steps.map((step) => (
          <li
            key={step.agent}
            className={`flex items-center gap-3 transition-opacity duration-300 ${
              step.status === "pending" ? "opacity-40" : "opacity-100"
            }`}
          >
            <span className="grid size-6 shrink-0 place-items-center">
              {step.status === "done" && (
                <span className="grid size-6 place-items-center rounded-full bg-emerald-50 ring-1 ring-inset ring-emerald-200">
                  <Check className="size-3.5 text-emerald-600" strokeWidth={3} aria-hidden />
                </span>
              )}
              {step.status === "running" && (
                <span className="grid size-6 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 p-px">
                  <span className="grid size-full place-items-center rounded-full bg-blue-50">
                    <Loader2 className="size-3.5 animate-spin text-blue-600" aria-hidden />
                  </span>
                </span>
              )}
              {step.status === "pending" && <span className="size-2 rounded-full bg-slate-300" aria-hidden />}
            </span>

            <span className={`text-sm ${step.status === "pending" ? "text-slate-400" : "text-slate-700"}`}>
              {step.label}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  const doneCount = steps.filter((s) => s.status === "done").length;

  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="text-[11px] font-medium text-slate-400">
        {doneCount}/{steps.length}
      </span>
      <div className="flex items-center gap-1">
        {steps.map((step) => (
          <span
            key={step.agent}
            title={step.label}
            className="grid size-5 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 p-px"
          >
            <span className="grid size-full place-items-center rounded-full bg-white">
              <Check className="size-2.5 text-blue-600" strokeWidth={3} aria-hidden />
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

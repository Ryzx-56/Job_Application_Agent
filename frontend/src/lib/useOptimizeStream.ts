"use client";

import { useCallback, useState } from "react";

export type AgentStepStatus = "pending" | "running" | "done";

export interface AgentStep {
  agent: number;
  label: string;
  status: AgentStepStatus;
}

// Matches core/main.py's _STEP_NODE_TO_AGENT — the `step` field on each SSE
// `step` event is one of these keys, in this fixed display order. Order
// here is "conceptual pipeline order", not "guaranteed completion order" —
// ats_scorer / coverLetter / similarJobs run in true parallel on the
// backend and can finish in any order; each still lands on its own fixed
// row the moment its `step` event arrives, regardless of arrival order.
const STEP_ORDER: { agent: number; key: string }[] = [
  { agent: 1, key: "cvParse" },
  { agent: 2, key: "jdAnalyze" },
  { agent: 3, key: "tailor" },
  { agent: 4, key: "factCheck" },
  { agent: 5, key: "atsScore" },
  { agent: 6, key: "coverLetter" },
  { agent: 7, key: "matchScore" },
  { agent: 8, key: "similarJobs" },
];

function initialSteps(stepLabels: Record<string, string>): AgentStep[] {
  return STEP_ORDER.map((s) => ({ agent: s.agent, label: stepLabels[s.key] ?? s.key, status: "pending" as const }));
}

/**
 * Drives the dashboard's live "Agent N" progress list from the backend's
 * SSE streaming endpoints (/api/v1/optimize/stream, /optimize-manual/stream).
 *
 * Uses `fetch()` with a manually-parsed streaming body rather than the
 * native `EventSource` API, because EventSource only supports GET —
 * it can't send the multipart FormData an uploaded CV needs.
 *
 * `run()` mirrors the shape of the old generateFromUpload/generateFromManual
 * functions in page.tsx: it's awaitable, resolves with the raw backend JSON
 * (pass it through the existing mapBackendResponse), and throws on failure
 * — including a `.status` property on the thrown Error so callers can still
 * distinguish a 402 "insufficient credits" response exactly like before.
 */
export function useOptimizeStream(stepLabels: Record<string, string>) {
  const [steps, setSteps] = useState<AgentStep[]>(() => initialSteps(stepLabels));

  const run = useCallback(
    async (endpoint: string, body: FormData | string, accessToken: string): Promise<any> => {
      setSteps(
        initialSteps(stepLabels).map((s, i) => (i === 0 ? { ...s, status: "running" as const } : s))
      );

      const isJsonBody = typeof body === "string";
      const res = await fetch(endpoint, {
        method: "POST",
        body,
        headers: {
          ...(isJsonBody ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => null);
        const err = new Error(errBody?.detail?.message ?? errBody?.detail ?? `Request failed: ${res.status}`);
        (err as Error & { status?: number }).status = res.status;
        throw err;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: any = null;
      let streamError: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const eventMatch = frame.match(/^event:\s*(.+)$/m);
          const dataMatch = frame.match(/^data:\s*(.+)$/m);
          if (!dataMatch) continue;

          const eventType = eventMatch?.[1]?.trim() ?? "message";
          const data = JSON.parse(dataMatch[1]);

          if (eventType === "step") {
            setSteps((prev) => {
              const idx = prev.findIndex((s) => s.agent === data.agent);
              if (idx === -1) return prev;
              const next = [...prev];
              next[idx] = { ...next[idx], status: "done" };
              const nextPendingIdx = next.findIndex((s) => s.status === "pending");
              if (nextPendingIdx !== -1) {
                next[nextPendingIdx] = { ...next[nextPendingIdx], status: "running" };
              }
              return next;
            });
          } else if (eventType === "complete") {
            finalResult = data;
            setSteps((prev) => prev.map((s) => ({ ...s, status: "done" as const })));
          } else if (eventType === "error") {
            streamError = data.detail ?? "Something went wrong.";
          }
        }
      }

      if (streamError) throw new Error(streamError);
      if (!finalResult) throw new Error("Stream ended without a result.");
      return finalResult;
    },
    [stepLabels]
  );

  return { steps, run };
}

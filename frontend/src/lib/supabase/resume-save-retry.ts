import type { saveResumeResult } from "./resumes";

/* ========================================================================
   DURABLE SAVE ENGINE — the retry/localStorage logic behind
   saveResumeResultDurable and flushPendingResumeSaves (see resumes.ts's
   DURABLE SAVE comment for why this exists).

   Deliberately has NO import of the real Supabase client: `save` is always
   passed in by the caller (resumes.ts supplies the real saveResumeResult in
   production; tests supply a fake). That keeps this module free of the
   `@/` path-alias imports that only Next.js's build resolves — plain Node
   (the test runner) can't — so the actual retry/backoff/persistence logic
   is directly testable rather than only checkable by build+eyeball.
======================================================================== */

export type SaveResumeResultFn = typeof saveResumeResult;
export type SaveResumeResultParams = Parameters<SaveResumeResultFn>[0];

const PENDING_SAVES_KEY = "tarshih:pending-resume-saves";
// Bounds on how long/how hard a stuck entry is retried, so a permanently
// broken payload (not just a transient network blip) doesn't sit in
// localStorage forever.
const MAX_PENDING_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 20;
// In-tab backoff, tried right after generation while the tab is (probably)
// still open. Anything left unsaved after this falls back to a
// flushPendingSaves() call on the next dashboard load — which is what
// actually saves a CV whose tab closed mid-retry.
export const DEFAULT_RETRY_DELAYS_MS = [2000, 5000, 15000, 30000];

type PendingResumeSave = {
  id: string;
  createdAt: number;
  attempts: number;
  params: SaveResumeResultParams;
};

// Every localStorage access is wrapped: private browsing, a full quota, or
// a blocked site data setting can all throw, and none of that should ever
// break CV generation itself.
function readPendingSaves(): PendingResumeSave[] {
  try {
    const raw = localStorage.getItem(PENDING_SAVES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingSaves(entries: PendingResumeSave[]) {
  try {
    localStorage.setItem(PENDING_SAVES_KEY, JSON.stringify(entries));
  } catch {
    // Nothing more we can do — the in-tab retries below still run.
  }
}

function removePendingSave(id: string) {
  writePendingSaves(readPendingSaves().filter((e) => e.id !== id));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Never throws. `save` and `delaysMs` are required here (this is the
 *  low-level engine); resumes.ts's saveResumeResultDurable wraps this with
 *  the real save function and real delays as defaults. */
export async function saveDurable(
  params: SaveResumeResultParams,
  save: SaveResumeResultFn,
  delaysMs: number[]
): Promise<void> {
  const entry: PendingResumeSave = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    attempts: 0,
    params,
  };
  // Written BEFORE the first attempt: if the tab closes mid-retry, the
  // payload is already safe in localStorage for flushPendingSaves() to
  // pick up later — that's the scenario that was actually losing CVs.
  writePendingSaves([...readPendingSaves(), entry]);

  for (const delay of [0, ...delaysMs]) {
    if (delay) await sleep(delay);
    entry.attempts += 1;
    try {
      await save(entry.params);
      removePendingSave(entry.id);
      return;
    } catch (err) {
      console.error(`saveDurable: attempt ${entry.attempts} failed`, err);
      writePendingSaves(readPendingSaves().map((e) => (e.id === entry.id ? entry : e)));
    }
  }
  // In-tab retries exhausted — it stays in localStorage. The next flush
  // (this session or a future one) retries it.
}

/** Retries every save that never made it through. `save` is required here
 *  for the same reason as saveDurable. */
export async function flushPendingSaves(save: SaveResumeResultFn): Promise<void> {
  const now = Date.now();
  const pending = readPendingSaves().filter(
    (e) => now - e.createdAt < MAX_PENDING_AGE_MS && e.attempts < MAX_ATTEMPTS
  );
  // Anything too old or already over the attempt cap is dropped here
  // instead of retried forever.
  writePendingSaves(pending);

  for (const entry of pending) {
    entry.attempts += 1;
    try {
      await save(entry.params);
      removePendingSave(entry.id);
    } catch (err) {
      console.error(`flushPendingSaves: attempt ${entry.attempts} failed for ${entry.id}`, err);
      writePendingSaves(readPendingSaves().map((e) => (e.id === entry.id ? entry : e)));
    }
  }
}

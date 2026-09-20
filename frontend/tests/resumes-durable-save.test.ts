import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { saveDurable as saveResumeResultDurable, flushPendingSaves as flushPendingResumeSaves } from "../src/lib/supabase/resume-save-retry.ts";

/* Run with `npm test`.

   Covers the fix for the bug that was silently losing generated CVs: a
   fire-and-forget insert whose only failure signal was a console line
   nobody read (see resumes.ts's DURABLE SAVE comment). These tests drive
   the actual shipped retry/persistence engine (resume-save-retry.ts) with a
   fake save function and zero real delay, so this exercises the real logic
   the production code calls — resumes.ts's saveResumeResultDurable and
   flushPendingResumeSaves are thin wrappers around exactly this — without
   taking ~52 real seconds per failing-then-succeeding case, and without
   needing the `@/` path alias that only Next.js's build resolves (plain
   Node, which runs this test, doesn't). */

const PENDING_KEY = "tarshih:pending-resume-saves";

// Minimal in-memory localStorage — Node has no browser storage by default,
// and the module's read/write helpers are already try/catch-wrapped around
// whatever global is present, so this just needs to behave like the real
// thing for get/set/removeItem.
function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

beforeEach(() => {
  (globalThis as any).localStorage = makeMemoryStorage();
});

function readPending(): any[] {
  const raw = (globalThis as any).localStorage.getItem(PENDING_KEY);
  return raw ? JSON.parse(raw) : [];
}

const PARAMS = {
  role: "Backend Engineer",
  company: "Acme",
  cvLanguage: "en" as const,
  jobDescription: "desc",
  result: {
    atsScore: 80,
    atsBreakdown: {},
    jobMatchScore: 70,
    jobMatchReason: "",
    overallRecommendation: "",
    factCheckPassed: true,
    tailoredSummary: "",
    tailoredBullets: [],
    gapAnalysis: [],
    similarJobs: [],
    coverLetterText: "",
    generationSnapshot: {},
  },
};

test("succeeds on the first attempt: saved once, nothing left pending", async () => {
  let calls = 0;
  const fakeSave = async () => {
    calls += 1;
    return {} as any;
  };
  await saveResumeResultDurable(PARAMS, fakeSave, []);
  assert.equal(calls, 1);
  assert.deepEqual(readPending(), []);
});

test("fails twice then succeeds: retried, and ends up removed from storage", async () => {
  let calls = 0;
  const fakeSave = async () => {
    calls += 1;
    if (calls < 3) throw new Error("transient network blip");
    return {} as any;
  };
  await saveResumeResultDurable(PARAMS, fakeSave, [0, 0, 0]); // zero delay — this is the point of injecting delaysMs
  assert.equal(calls, 3);
  assert.deepEqual(readPending(), []);
});

test("the payload is in localStorage BEFORE the first attempt resolves — survives a tab closing mid-save", async () => {
  // A save function that never resolves during this test, simulating the
  // exact real-world scenario: the tab closes before the network call
  // finishes. The entry must already be durable by then.
  const fakeSave = () => new Promise<any>(() => {});
  const promise = saveResumeResultDurable(PARAMS, fakeSave, []);
  // Give the synchronous "write before first attempt" part a microtask to run.
  await Promise.resolve();
  await Promise.resolve();
  const pending = readPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].params.role, "Backend Engineer");
  assert.equal(pending[0].attempts, 0);
  void promise; // never resolves in this test — deliberately left hanging
});

test("permanently failing save: exhausts in-tab retries, stays in storage with the right attempt count", async () => {
  let calls = 0;
  const fakeSave = async () => {
    calls += 1;
    throw new Error("permanent failure (e.g. malformed payload)");
  };
  await saveResumeResultDurable(PARAMS, fakeSave, [0, 0, 0, 0]); // 1 immediate + 4 backoff = 5 attempts
  assert.equal(calls, 5);
  const pending = readPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].attempts, 5);
});

test("flushPendingResumeSaves recovers an entry left over from a closed tab", async () => {
  // Simulate exactly what a closed tab leaves behind: an entry written by
  // saveResumeResultDurable's pre-attempt persist, never removed because
  // the tab died before any attempt completed.
  (globalThis as any).localStorage.setItem(
    PENDING_KEY,
    JSON.stringify([{ id: "abc", createdAt: Date.now(), attempts: 0, params: PARAMS }])
  );
  let calls = 0;
  const fakeSave = async () => {
    calls += 1;
    return {} as any;
  };
  await flushPendingResumeSaves(fakeSave);
  assert.equal(calls, 1);
  assert.deepEqual(readPending(), []);
});

test("flushPendingResumeSaves drops an entry older than the give-up window without attempting it", async () => {
  const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000; // window is 7 days
  (globalThis as any).localStorage.setItem(
    PENDING_KEY,
    JSON.stringify([{ id: "stale", createdAt: eightDaysAgo, attempts: 1, params: PARAMS }])
  );
  let calls = 0;
  const fakeSave = async () => {
    calls += 1;
    return {} as any;
  };
  await flushPendingResumeSaves(fakeSave);
  assert.equal(calls, 0, "a week-old entry should be given up on, not retried forever");
  assert.deepEqual(readPending(), []);
});

test("flushPendingResumeSaves drops an entry that already hit the attempt cap", async () => {
  (globalThis as any).localStorage.setItem(
    PENDING_KEY,
    JSON.stringify([{ id: "exhausted", createdAt: Date.now(), attempts: 20, params: PARAMS }])
  );
  let calls = 0;
  const fakeSave = async () => {
    calls += 1;
    return {} as any;
  };
  await flushPendingResumeSaves(fakeSave);
  assert.equal(calls, 0, "20 prior attempts is the cap — must not retry a 21st time");
});

test("flushPendingResumeSaves leaves a still-failing entry in storage for next time, with attempts incremented", async () => {
  (globalThis as any).localStorage.setItem(
    PENDING_KEY,
    JSON.stringify([{ id: "still-broken", createdAt: Date.now(), attempts: 2, params: PARAMS }])
  );
  const fakeSave = async () => {
    throw new Error("still down");
  };
  await flushPendingResumeSaves(fakeSave);
  const pending = readPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].attempts, 3);
});

test("multiple independent pending entries: one recovers, the other is left alone", async () => {
  (globalThis as any).localStorage.setItem(
    PENDING_KEY,
    JSON.stringify([
      { id: "good", createdAt: Date.now(), attempts: 0, params: { ...PARAMS, role: "Good One" } },
      { id: "bad", createdAt: Date.now(), attempts: 0, params: { ...PARAMS, role: "Bad One" } },
    ])
  );
  const fakeSave = async (p: typeof PARAMS) => {
    if (p.role === "Bad One") throw new Error("still failing");
    return {} as any;
  };
  await flushPendingResumeSaves(fakeSave);
  const pending = readPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].params.role, "Bad One");
  assert.equal(pending[0].attempts, 1);
});

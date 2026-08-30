import { Redis } from "@upstash/redis";

/**
 * Sliding-window rate limiter for the login route.
 *
 * TWO BACKENDS, CHOSEN AT RUNTIME
 *   · Upstash Redis, when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
 *     are both set. Shared across instances and survives cold starts, so the
 *     limit is a real limit.
 *   · In-process Map, when they are not. Each serverless instance counts
 *     separately and a cold start resets it, so it only raises the cost of
 *     credential stuffing from one source rather than capping it.
 *
 * THE FALLBACK IS LOAD-BEARING, NOT A LEFTOVER. If Upstash is unreachable, or
 * its env vars are missing, this must still answer — a rate limiter that
 * throws would take the login page down with it. Every Redis path below is
 * wrapped so that a failure degrades to the in-memory counter instead of
 * propagating. Supabase Auth's own server-side limits remain the backstop
 * underneath both.
 *
 * Only FAILURES are counted. Someone signing in repeatedly from an office NAT
 * must never be locked out, and a successful sign-in clears their counter.
 */

export type RateLimitRule = {
  /** Failures permitted inside the window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export type RateLimitVerdict = {
  ok: boolean;
  /** Seconds until the caller may retry. Only meaningful when ok is false. */
  retryAfter: number;
  /** Which backend answered — surfaced for logging, not for logic. */
  backend: "redis" | "memory";
};

/** Per-IP: catches one source spraying many accounts. */
export const IP_RULE: RateLimitRule = { max: 10, windowMs: 15 * 60_000 };

/** Per-account: catches many sources targeting one account. Tighter, because
 *  a real person mistyping their own password ten times is already unusual. */
export const EMAIL_RULE: RateLimitRule = { max: 5, windowMs: 15 * 60_000 };

/* ───────────────────────── Redis backend ────────────────────────────────── */

let redis: Redis | null = null;
let redisChecked = false;

function getRedis(): Redis | null {
  if (redisChecked) return redis;
  redisChecked = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn(
      "[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN not set — falling back to the " +
        "in-process limiter. Counts are per-instance and reset on cold start."
    );
    return null;
  }
  try {
    redis = new Redis({ url, token });
  } catch (err) {
    console.error("[rate-limit] Could not construct the Redis client:", err);
    redis = null;
  }
  return redis;
}

const rkey = (key: string) => `rl:${key}`;

/* ───────────────────────── in-memory backend ────────────────────────────── */

/** key -> failure timestamps (ms), oldest first. */
const hits = new Map<string, number[]>();

let lastSweep = 0;
const SWEEP_INTERVAL_MS = 5 * 60_000;

function sweep(now: number, longestWindow: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, times] of hits) {
    const live = times.filter((t) => now - t < longestWindow);
    if (live.length === 0) hits.delete(key);
    else hits.set(key, live);
  }
}

function windowFor(key: string, rule: RateLimitRule, now: number): number[] {
  const times = hits.get(key) ?? [];
  const live = times.filter((t) => now - t < rule.windowMs);
  if (live.length !== times.length) hits.set(key, live);
  return live;
}

function retryAfterFrom(oldest: number, rule: RateLimitRule, now: number): number {
  return Math.max(1, Math.ceil((rule.windowMs - (now - oldest)) / 1000));
}

/** Synchronous in-memory check. Exported for tests and used as the fallback. */
export function checkMemory(key: string, rule: RateLimitRule, now = Date.now()): RateLimitVerdict {
  sweep(now, Math.max(IP_RULE.windowMs, EMAIL_RULE.windowMs));
  const live = windowFor(key, rule, now);
  if (live.length < rule.max) return { ok: true, retryAfter: 0, backend: "memory" };
  return { ok: false, retryAfter: retryAfterFrom(live[0], rule, now), backend: "memory" };
}

/** Synchronous in-memory record. Exported for tests and used as the fallback. */
export function recordFailureMemory(key: string, rule: RateLimitRule, now = Date.now()): void {
  const live = windowFor(key, rule, now);
  live.push(now);
  hits.set(key, live);
}

/* ───────────────────────── public API ───────────────────────────────────── */

/**
 * Whether this identity may attempt a login right now. Read-only — it does not
 * count the attempt. Call `recordFailure()` only if the attempt actually fails.
 */
export async function check(
  key: string,
  rule: RateLimitRule,
  now = Date.now()
): Promise<RateLimitVerdict> {
  const r = getRedis();
  if (!r) return checkMemory(key, rule, now);

  try {
    const k = rkey(key);
    // Drop everything that has aged out, then count what is left.
    await r.zremrangebyscore(k, 0, now - rule.windowMs);
    const count = await r.zcard(k);
    if (count < rule.max) return { ok: true, retryAfter: 0, backend: "redis" };

    const oldest = (await r.zrange(k, 0, 0, { withScores: true })) as (string | number)[];
    // zrange withScores returns [member, score]; fall back to a full window if
    // the shape is ever unexpected rather than throwing.
    const score = typeof oldest?.[1] === "number" ? (oldest[1] as number) : now;
    return { ok: false, retryAfter: retryAfterFrom(score, rule, now), backend: "redis" };
  } catch (err) {
    console.error("[rate-limit] Redis check failed, using in-memory:", err);
    return checkMemory(key, rule, now);
  }
}

/** Records one failed attempt against this identity. */
export async function recordFailure(
  key: string,
  rule: RateLimitRule,
  now = Date.now()
): Promise<void> {
  const r = getRedis();
  if (!r) return recordFailureMemory(key, rule, now);

  try {
    const k = rkey(key);
    // Member must be unique or repeated failures in the same millisecond would
    // collapse into one ZSET entry and undercount.
    await r.zadd(k, { score: now, member: `${now}:${Math.random().toString(36).slice(2)}` });
    // Expire slightly past the window so an idle key cleans itself up.
    await r.pexpire(k, rule.windowMs + 60_000);
  } catch (err) {
    console.error("[rate-limit] Redis record failed, using in-memory:", err);
    recordFailureMemory(key, rule, now);
  }
}

/** Clears an identity's failures. Called on a successful sign-in. */
export async function clear(key: string): Promise<void> {
  hits.delete(key);
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(rkey(key));
  } catch (err) {
    console.error("[rate-limit] Redis clear failed:", err);
  }
}

/** Test-only: drops in-memory state so cases cannot leak into each other. */
export function __resetAll(): void {
  hits.clear();
  lastSweep = 0;
}

/**
 * Best-effort client IP.
 *
 * x-forwarded-for is client-controllable in general, but on a managed host the
 * platform proxy overwrites it, so the LEFTMOST entry is the real client. This
 * is the standard read for that setup. If this ever runs somewhere without a
 * trusted proxy in front, the per-email rule is the one still doing real work.
 */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

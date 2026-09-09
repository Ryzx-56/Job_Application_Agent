import { createClient } from "@/lib/supabase/client";

/* ========================================================================
   PAYMENTS API CLIENT + the Moyasar hosted-form loader.

   THIS FILE NEVER DECIDES THAT SOMETHING WAS PAID FOR. It mounts a form,
   sends the buyer to Moyasar, and afterwards asks the backend what happened.
   Credits are granted server-side, by backend/core/payments.py, driven by
   Moyasar's webhook. Nothing here can unlock anything, by design — see the
   note at the top of core/payments.py for why both paths exist.

   THE AMOUNT IS NOT CHOSEN HERE EITHER. The catalog comes from the backend,
   so the integer posted to Moyasar is the same integer the backend will
   verify. The browser sends a `reference` slug and never a price.
======================================================================== */

const API_URL = process.env.NEXT_PUBLIC_API_URL;

/** Pinned deliberately. Verified 2026-09-01 as the newest build on their CDN
 *  (1.19.0, published 2025-07-26; 1.19.1+ and 1.20.x return 403). Never use
 *  a floating "latest" URL for the script that renders a card form — an
 *  upstream change would ship to production without review. */
const MOYASAR_VERSION = "1.19.0";
const MOYASAR_JS = `https://cdn.moyasar.com/mpf/${MOYASAR_VERSION}/moyasar.js`;
const MOYASAR_CSS = `https://cdn.moyasar.com/mpf/${MOYASAR_VERSION}/moyasar.css`;

export type PaymentProduct = {
  reference: string;
  kind: "plan" | "pack" | "addon";
  amount_halalas: number;
  amount_sar: number;
  currency: string;
  credits: number | null;
  tier: string | null;
  pack_slug: string | null;
  label_en: string;
  label_ar: string;
};

export type PaymentCatalog = {
  currency: string;
  products: PaymentProduct[];
  /** "test" | "live" | "unknown". The form shows a test-mode banner so a
   *  real card is never entered into a test-mode form by mistake. */
  mode: string;
};

export type VerifyResult = {
  status: "paid" | "failed" | "pending";
  reference: string | null;
  credits_granted: number | null;
  already_processed?: boolean;
  code?: string;
};

export type ApiError = Error & { status?: number; code?: string };

async function accessToken(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return session.access_token;
}

/** The signed-in user's id, for stamping onto a payment's metadata. */
async function currentUserId(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) throw new Error("payment-user-unknown");
  return user.id;
}

async function request<T>(path: string, init?: RequestInit & { auth?: boolean }): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init?.auth !== false) headers.Authorization = `Bearer ${await accessToken()}`;

  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    const err: ApiError = new Error(
      typeof detail === "string" ? detail : detail?.message ?? `Request failed: ${res.status}`
    );
    err.status = res.status;
    if (detail && typeof detail === "object") err.code = detail.code;
    throw err;
  }
  return res.json() as Promise<T>;
}

/** The price list. Public — same figures the pricing page shows. */
export async function fetchPaymentCatalog(): Promise<PaymentCatalog> {
  return request<PaymentCatalog>("/api/v1/payments/catalog", { auth: false });
}

/**
 * Ask the backend what became of a payment.
 *
 * UX ONLY. If this never runs — the buyer closed the tab, the network
 * dropped — Moyasar's webhook still tells the backend and the credits are
 * still granted. Calling it twice is safe.
 */
export async function verifyPayment(paymentId: string): Promise<VerifyResult> {
  return request<VerifyResult>(`/api/v1/payments/verify/${encodeURIComponent(paymentId)}`, {
    method: "POST",
  });
}

/* ── The hosted form ─────────────────────────────────────────────────── */

declare global {
  interface Window {
    Moyasar?: { init: (config: Record<string, unknown>) => void };
  }
}

let scriptPromise: Promise<void> | null = null;

/**
 * Load moyasar.js and its stylesheet once per page load.
 *
 * Memoised on the module: React StrictMode mounts effects twice in
 * development, and two concurrent loads would define the form twice and
 * render two card fields into the same container.
 */
export function loadMoyasarForm(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Moyasar) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    if (!document.querySelector(`link[href="${MOYASAR_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = MOYASAR_CSS;
      document.head.appendChild(link);
    }

    // A tag left over from a FAILED load is removed rather than reused: its
    // "load" event has already been missed, so attaching a listener to it
    // would wait forever and the checkout would sit on its spinner. (A tag
    // from a SUCCESSFUL load never reaches here — window.Moyasar is set, and
    // the check above already returned.)
    document.querySelector(`script[src="${MOYASAR_JS}"]`)?.remove();

    const script = document.createElement("script");
    script.src = MOYASAR_JS;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever —
      // a card form that never loads because of one dropped request is a
      // sale lost for no reason.
      scriptPromise = null;
      script.remove();
      reject(new Error("moyasar-script-failed"));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/**
 * Arabic overrides for the form's own strings.
 *
 * MOYASAR SHIPS AN ARABIC TABLE WITH `button.pay` SET TO THE EMPTY STRING.
 * Their lookup treats an empty value as missing and falls back to English, so
 * an Arabic checkout renders its primary call to action as "Pay" — the one
 * button on the page, in the wrong language, for the majority of this
 * product's users. Verified by decoding the Arabic translation table out of
 * moyasar.js 1.19.0.
 *
 * `translations` is merged over the built-in table with Object.assign, keyed
 * by two-letter language code, so only the keys named here are replaced.
 */
const AR_OVERRIDES: Record<string, string> = {
  "button.pay": "ادفع",
};

export type CheckoutFormOptions = {
  /** A CSS selector for the container.
   *
   *  MUST NOT BE AN ID SELECTOR. Moyasar's form rewrites the container's id
   *  to its own ("mysr-form-form-el") during init and then re-queries the
   *  selector it was given — so an id selector resolves to null on that
   *  second lookup, the form throws "Element: null is not a valid element",
   *  and NO CARD FIELDS EVER RENDER. Verified in a real browser against
   *  moyasar.js 1.19.0: `#some-id` renders 0 inputs, `.mysr-form` renders 4.
   *
   *  Their own documentation uses the class, which is why the class survives
   *  init untouched. */
  element: string;
  amountHalalas: number;
  currency: string;
  description: string;
  callbackUrl: string;
  metadata: Record<string, string>;
  lang: string;
  /** Tokenize the card alongside this charge, for recurring billing (§5).
   *  Off for one-time purchases: keeping a card nobody asked us to keep is
   *  not something a credit-pack buyer agreed to. */
  saveCard?: boolean;
  /** What the BACKEND says it is running as, from the catalog response.
   *  Compared against this bundle's own publishable key — see the check in
   *  mountCheckoutForm. Optional so an older caller still works. */
  backendMode?: string;
  onCompleted?: (payment: { id?: string; status?: string }) => void | Promise<void>;
  onFailure?: (error: unknown) => void;
};

/**
 * Mount the Moyasar card form into `options.element`.
 *
 * `amountHalalas` must come from the backend catalog, never from a local
 * constant — see the header note.
 */
export async function mountCheckoutForm(options: CheckoutFormOptions): Promise<void> {
  if (!window.Moyasar) throw new Error("moyasar-not-loaded");

  const publishableKey = process.env.NEXT_PUBLIC_MOYASAR_PUBLISHABLE_KEY;
  if (!publishableKey) throw new Error("moyasar-key-missing");

  /* THE TWO HALVES OF THE GO-LIVE SWITCH, CHECKED AGAINST EACH OTHER.
   *
   * The publishable key lives in Vercel and the secret key lives in Render.
   * They are set by hand, in two different dashboards, and nothing has ever
   * compared them. Get it half-right — flip Render to live, forget Vercel —
   * and the browser tokenizes a card against TEST while the server charges
   * against LIVE. Every payment fails, with a decline that is not
   * reproducible from either side on its own.
   *
   * The catalog already tells us which mode the backend is in. Refusing to
   * mount is the right response: a form that would take a card and certainly
   * fail should not be shown at all. The backend makes the same check at
   * startup (core/moyasar_client.config_problems) — this is the half that
   * can see the browser's key. */
  const keyMode = publishableKey.startsWith("pk_live_")
    ? "live"
    : publishableKey.startsWith("pk_test_")
      ? "test"
      : "unknown";
  if (
    options.backendMode &&
    options.backendMode !== "unknown" &&
    keyMode !== "unknown" &&
    keyMode !== options.backendMode
  ) {
    console.error(
      `Moyasar key mismatch: this build has a ${keyMode} publishable key but the ` +
        `backend is in ${options.backendMode} mode. Update ` +
        `NEXT_PUBLIC_MOYASAR_PUBLISHABLE_KEY in Vercel to match Render's ` +
        `MOYASAR_SECRET_KEY, then redeploy.`
    );
    throw new Error("moyasar-key-mode-mismatch");
  }

  /* WHO IS BUYING, RESOLVED HERE RATHER THAN ASKED OF THE CALLER.
   *
   * record_and_grant() reads the buyer from the PAYMENT'S METADATA and from
   * nowhere else, because the webhook that grants the credits arrives with no
   * session attached — Moyasar is not logged in as anybody. The checkout page
   * never stamped one, so every real purchase reached the backend as a paid
   * payment belonging to nobody, was recorded with credits_granted NULL, and
   * returned "no_user_id". The buyer was charged and told the payment did not
   * go through. Confirmed against a real paid payment whose metadata read
   * exactly {"reference": "best_value_pack"}.
   *
   * Resolved inside this function, not passed in, so that a second caller
   * cannot reintroduce the same bug by forgetting the field. Throwing when it
   * is unknown is deliberate: a form that cannot say who is paying must not
   * be able to take money. */
  const buyerId = await currentUserId();

  const isAr = options.lang === "ar";

  /* AN OPTIONAL KEY IS OMITTED, NEVER SET TO undefined.
   *
   * This is not style. `on_completed: undefined` is not the same as no
   * `on_completed` at all: moyasar.js validates the key when it is PRESENT,
   * and an undefined value fails that validation with
   *
   *     Error: Invalid handler undefined
   *
   * thrown from inside the promise chain that runs AFTER the payment has
   * already been created. POST /v1/payments returns 201, the payment exists
   * at Moyasar, and then the success handler throws into the same catch that
   * handles a dropped connection — which renders "Network Error" and calls
   * on_failure. The buyer is told the payment did not go through while a real
   * payment sits at Moyasar in `initiated`, and the 3-D Secure redirect that
   * should have followed never happens.
   *
   * It cost a full misdiagnosis: the symptom is indistinguishable from a
   * blocked request unless you read the console.log() in moyasar.js's
   * catch-all branch, which is the only place the real exception surfaces.
   * Verified on the live origin: identical config, on_completed present ->
   * full 3DS flow; absent-but-declared -> 201 then "Network Error".
   *
   * The same shape applies to every optional key below, so none of them are
   * passed unless they have a real value. */
  const config: Record<string, unknown> = {
    element: options.element,
    amount: options.amountHalalas,
    currency: options.currency,
    description: options.description,
    publishable_api_key: publishableKey,
    callback_url: options.callbackUrl,
    // Cards only. Apple Pay and STC Pay are separate integrations with their
    // own merchant setup; enabling them here would render buttons that fail.
    methods: ["creditcard"],
    // mada first: it is the Saudi domestic scheme and the card most buyers
    // here will reach for.
    supported_networks: ["mada", "visa", "mastercard"],
    language: isAr ? "ar" : "en",
    // Carried through Moyasar and echoed back on the payment object and every
    // webhook. THE BACKEND PRICES THE PAYMENT FROM `reference`, so this is
    // the only thing that decides what was bought.
    // user_id is stamped here and cannot be overridden by the caller's
    // metadata — the value that decides who gets the credits comes from the
    // session, not from whatever a page happened to pass in.
    metadata: { ...options.metadata, user_id: buyerId },
  };

  if (isAr) config.translations = { ar: AR_OVERRIDES };
  if (options.saveCard) config.credit_card = { save_card: true };
  if (options.onCompleted) config.on_completed = options.onCompleted;
  if (options.onFailure) config.on_failure = options.onFailure;

  window.Moyasar.init(config);
}

export const MOYASAR_FORM_VERSION = MOYASAR_VERSION;

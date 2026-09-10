"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleSlash, RefreshCw } from "lucide-react";
import {
  AdminPage, Panel, Loading, ErrorNote, ADMIN_MONO,
} from "@/components/admin-ui";
import { fetchPaymentConfig, AdminPaymentConfig } from "@/lib/supabase/admin";

/**
 * Payment configuration.
 *
 * WHY THIS PAGE EXISTS AT ALL. Going live is environment variables set by
 * hand in two dashboards — the secret key in Render, the publishable key in
 * Vercel — and every way of getting it half-right is silent. The first real
 * payment attempt failed with "Payments are unavailable right now because of
 * a configuration error on our side", which is the correct thing to tell a
 * customer and tells whoever has to fix it nothing at all.
 *
 * GET /api/v1/admin/payments/config answers it, but it is admin-gated, so
 * opening it in a browser tab returns 401 — there is no session token on a
 * plain tab. A check you cannot run is not a check. This is the page.
 *
 * NOTHING SECRET IS RENDERED. The endpoint returns booleans, a mode string
 * and a list of problems; it never returns a key or a fragment of one, and
 * this page cannot display what it is not given.
 */

/** One environment variable, and whether it is set. */
function Flag({ label, ok, hint }: { label: string; ok: boolean; hint?: string }) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
      ) : (
        <CircleSlash className="mt-0.5 size-4 shrink-0 text-rose-500" aria-hidden />
      )}
      <div className="min-w-0">
        <p className={`${ADMIN_MONO} text-sm text-slate-900`}>{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{hint}</p>}
      </div>
      <span
        className={`${ADMIN_MONO} ms-auto shrink-0 text-xs ${
          ok ? "text-emerald-700" : "text-rose-600"
        }`}
      >
        {ok ? "set" : "not set"}
      </span>
    </div>
  );
}

export default function AdminConfigPage() {
  const [data, setData] = useState<AdminPaymentConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetchPaymentConfig()
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e?.message ?? "Failed to load the payment configuration."));
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const refresh = (
    <button
      type="button"
      onClick={() => setNonce((n) => n + 1)}
      className={`${ADMIN_MONO} inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500`}
    >
      <RefreshCw className="size-3.5" aria-hidden /> re-check
    </button>
  );

  return (
    <AdminPage
      title="Configuration"
      subtitle="Whether this deployment can take a payment, and what is wrong if it cannot. Read live from the running backend — never shows a key."
      actions={refresh}
    >
      {error && <ErrorNote message={error} />}
      {!data && !error && <Loading />}

      {data && (
        <div className="space-y-4">
          {/* The headline: can it charge, or not. */}
          <div
            className={`rounded-xl border p-4 ${
              data.ready_to_charge
                ? "border-emerald-300 bg-emerald-50"
                : "border-amber-300 bg-amber-50"
            }`}
          >
            <div className="flex items-center gap-2">
              {data.ready_to_charge ? (
                <CheckCircle2 className="size-5 shrink-0 text-emerald-700" aria-hidden />
              ) : (
                <AlertTriangle className="size-5 shrink-0 text-amber-700" aria-hidden />
              )}
              <p
                className={`text-sm font-semibold ${
                  data.ready_to_charge ? "text-emerald-900" : "text-amber-900"
                }`}
              >
                {data.ready_to_charge
                  ? data.mode === "live"
                    ? "Ready to charge — LIVE, real money"
                    : `Ready to charge — ${data.mode} mode`
                  : "Not ready to charge"}
              </p>
            </div>

            {/* The specific problems, which is the whole point. Each one names
                the variable to change. */}
            {data.problems.length > 0 && (
              <ul className="mt-3 space-y-2">
                {data.problems.map((p, i) => (
                  <li key={i} className="text-sm leading-relaxed text-amber-900">
                    • {p}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Panel title="Render — backend">
            <div className="divide-y divide-slate-100">
              <Flag
                label="MOYASAR_SECRET_KEY"
                ok={data.secret_key_set}
                hint="Decides whether real money moves. sk_test_ or sk_live_ — there is no other switch."
              />
              <Flag
                label="MOYASAR_PUBLISHABLE_KEY"
                ok={data.publishable_key_set}
                hint="The backend's own copy, used to report the mode. The browser reads Vercel's."
              />
              <Flag
                label="MOYASAR_WEBHOOK_SECRET"
                ok={data.webhook_secret_set}
                hint="Must be the LIVE webhook's secret in live mode — it is a different value from the test webhook's. Reusing the test one makes every live webhook 403 while payments keep succeeding: buyers charged, nobody credited."
              />
              <Flag
                label="CRON_SECRET"
                ok={data.cron_secret_set}
                hint="Without it the renewal job returns 503 and no subscription ever renews — silently."
              />
            </div>
            <dl className={`${ADMIN_MONO} mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500`}>
              <div className="flex justify-between gap-3">
                <dt>mode</dt>
                <dd className={data.mode === "live" ? "text-emerald-700" : "text-slate-700"}>{data.mode}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>api_base</dt>
                <dd className="truncate text-slate-700">{data.api_base}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>PUBLIC_APP_URL</dt>
                <dd className="truncate text-slate-700">{data.public_app_url ?? "not set"}</dd>
              </div>
            </dl>
          </Panel>

          {/* The half the backend genuinely cannot see. */}
          <Panel title="Vercel — browser">
            <p className="text-sm leading-relaxed text-slate-600">{data.frontend_hint}</p>
            <p className={`${ADMIN_MONO} mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600`}>
              NEXT_PUBLIC_MOYASAR_PUBLISHABLE_KEY ={" "}
              {process.env.NEXT_PUBLIC_MOYASAR_PUBLISHABLE_KEY
                ? `${process.env.NEXT_PUBLIC_MOYASAR_PUBLISHABLE_KEY.slice(0, 8)}… (${
                    process.env.NEXT_PUBLIC_MOYASAR_PUBLISHABLE_KEY.startsWith("pk_live_")
                      ? "live"
                      : process.env.NEXT_PUBLIC_MOYASAR_PUBLISHABLE_KEY.startsWith("pk_test_")
                        ? "test"
                        : "unrecognised prefix"
                  })`
                : "not set — the card form cannot mount"}
            </p>
            {/* Only the PREFIX is shown, and only of a pk_ key, which is public
                by design — it is compiled into every browser bundle already.
                The mode is what matters here: a pk_test_ key against an
                sk_live_ server makes every payment fail. */}
            {process.env.NEXT_PUBLIC_MOYASAR_PUBLISHABLE_KEY &&
              data.mode !== "unknown" &&
              !process.env.NEXT_PUBLIC_MOYASAR_PUBLISHABLE_KEY.startsWith(`pk_${data.mode}_`) && (
                <p className="mt-2 text-sm leading-relaxed text-rose-700">
                  This build&apos;s publishable key does not match the backend&apos;s {data.mode} mode.
                  The card form will refuse to mount. Update it in Vercel and redeploy.
                </p>
              )}
          </Panel>
        </div>
      )}
    </AdminPage>
  );
}

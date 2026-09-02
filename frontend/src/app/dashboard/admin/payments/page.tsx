"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AdminPage, Panel, Loading, ErrorNote, Empty, Table, Row, Cell, ADMIN_MONO,
} from "@/components/admin-ui";
import {
  fetchAdminPayments, refundAdminPayment,
  type AdminPaymentRow,
} from "@/lib/supabase/admin";

/**
 * Every payment, so a billing question can be answered without opening the
 * database (§7).
 *
 * REFUNDING IS HERE AND NOWHERE ELSE. There is no customer-facing refund
 * flow: credits and generated documents are delivered the moment a payment
 * clears, so the policy is that payment is final, and the checkout says so
 * before the button. What remains is billing errors and disputes, which a
 * person handles — so the control lives behind the admin flag, re-checked
 * server-side on every request.
 *
 * A table rather than cards, unlike Accounts: this page is scanned down a
 * column ("what came in today", "what failed"), not read one record at a
 * time.
 */

const STATUS_TONE: Record<string, string> = {
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  captured: "border-emerald-200 bg-emerald-50 text-emerald-700",
  refunded: "border-violet-200 bg-violet-50 text-violet-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  voided: "border-red-200 bg-red-50 text-red-700",
  initiated: "border-amber-200 bg-amber-50 text-amber-700",
  authorized: "border-amber-200 bg-amber-50 text-amber-700",
};

const FILTERS = ["all", "paid", "failed", "refunded", "initiated"] as const;

function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${tone}`}>
      {status}
    </span>
  );
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function AdminPaymentsPage() {
  const [rows, setRows] = useState<AdminPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchAdminPayments({ status: filter === "all" ? undefined : filter, limit: 200 })
      .then((d) => setRows(d.payments))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load payments."))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(load, [load]);

  async function handleRefund(row: AdminPaymentRow) {
    // A refund moves real money and cannot be undone from here, so it asks
    // once — and says what will happen to the credits, because that is the
    // part that is easy to forget.
    const granted = row.credits_granted ?? 0;
    const confirmed = window.confirm(
      `Refund ${row.amount_sar} ${row.currency} to ${row.buyer_email ?? row.user_id ?? "this user"}?\n\n` +
      (granted
        ? `Up to ${granted} credit(s) will be taken back — only the ones they haven't spent.\n\n`
        : "No credits were granted by this payment.\n\n") +
      "This cannot be undone here."
    );
    if (!confirmed) return;

    setBusyId(row.moyasar_payment_id);
    setNote(null);
    try {
      const result = await refundAdminPayment(row.moyasar_payment_id);
      setNote(
        result.already_refunded
          ? "That payment was already refunded."
          : `Refunded. Clawed back ${result.credits_clawed_back} credit(s)` +
            (result.credits_already_spent > 0
              ? `; ${result.credits_already_spent} had already been spent and were left alone.`
              : ".")
      );
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The refund failed.");
    } finally {
      setBusyId(null);
    }
  }

  const refundable = (r: AdminPaymentRow) => r.status === "paid" || r.status === "captured";

  return (
    <AdminPage
      title="Payments"
      subtitle="Every Moyasar payment, newest first. Refunds are issued here — there is no customer-facing refund flow, because credits and documents are delivered the moment a payment clears."
    >
      <Panel title="Payments">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`rounded border px-2.5 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
                filter === f
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {note && (
          <p className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {note}
          </p>
        )}
        {error && <ErrorNote message={error} />}

        {loading ? (
          <Loading label="loading payments" />
        ) : rows.length === 0 ? (
          <Empty message={filter === "all" ? "No payments yet." : `No ${filter} payments.`} />
        ) : (
          <Table head={["When", "Buyer", "For", "Amount", "Credits", "Status", ""]}>
            {rows.map((r) => (
              <Row key={r.id}>
                <Cell mono>{fmtDate(r.created_at)}</Cell>
                <Cell>
                  {/* dir=ltr: an email is Latin text and reverses badly if the
                      admin is browsing with an RTL locale. */}
                  <span dir="ltr">{r.buyer_email ?? r.user_id?.slice(0, 8) ?? "unknown"}</span>
                </Cell>
                <Cell>
                  <span className="text-slate-900">{r.reference}</span>
                  <span className="ms-1.5 text-[11px] text-slate-400">{r.type}</span>
                </Cell>
                <Cell mono>
                  {r.amount_sar} {r.currency}
                </Cell>
                <Cell mono>{r.credits_granted ?? "—"}</Cell>
                <Cell>
                  <StatusPill status={r.status} />
                </Cell>
                <Cell>
                  {refundable(r) ? (
                    <button
                      type="button"
                      disabled={busyId === r.moyasar_payment_id}
                      onClick={() => handleRefund(r)}
                      className={`${ADMIN_MONO} rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-700 transition-colors hover:border-red-300 hover:text-red-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900`}
                    >
                      {busyId === r.moyasar_payment_id ? "refunding…" : "refund"}
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-300">—</span>
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Panel>
    </AdminPage>
  );
}

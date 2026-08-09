"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AdminPage, ADMIN_MONO, Cell, Empty, ErrorNote, Loading, Notice, Panel, Row, Stat, StatGrid, Table } from "@/components/admin-ui";
import { fetchPremiumOrders, PremiumOrder, updatePremiumOrder } from "@/lib/supabase/linkedin";

/**
 * PREMIUM LINKEDIN FULFILLMENT QUEUE.
 *
 * Premium is a manual service — a person builds the buyer's profile — so this
 * is the work-owed list: who paid, how to reach them, which CV to build from,
 * and a way to mark it done. An email goes out on every premium purchase too
 * (see backend/core/linkedin_notify.py); this page is the copy that can't get
 * lost in an inbox.
 *
 * Deliberately not a ticketing system: three states and a table. Nothing more
 * until the volume actually asks for it.
 *
 * Only PAID orders appear — an abandoned checkout isn't work owed. Gated
 * server-side on profiles.is_admin like every other admin route, plus the
 * layout's server-side guard.
 */

const STATUS_STYLES: Record<PremiumOrder["fulfillment_status"], string> = {
  pending: "text-amber-600",
  in_progress: "text-violet-600",
  done: "text-emerald-600",
};

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function AdminLinkedInOrdersPage() {
  const [orders, setOrders] = useState<PremiumOrder[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [includeDone, setIncludeDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (withDone: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPremiumOrders(withDone);
      setOrders(data.orders);
      setPendingCount(data.pending_count);
    } catch (err) {
      console.error("fetchPremiumOrders failed:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(includeDone);
  }, [includeDone, load]);

  async function setStatus(order: PremiumOrder, status: PremiumOrder["fulfillment_status"]) {
    setBusyId(order.id);
    try {
      await updatePremiumOrder(order.id, status);
      await load(includeDone);
    } catch (err) {
      console.error("updatePremiumOrder failed:", err);
      setError(err instanceof Error ? err.message : "Could not update the order.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminPage
      title="LinkedIn Orders"
      subtitle="Paid premium LinkedIn purchases, which are fulfilled by hand. Contact the buyer, build their profile, then mark it done."
      actions={
        <label className={`${ADMIN_MONO} flex items-center gap-2 text-xs text-slate-500`}>
          <input
            type="checkbox"
            checked={includeDone}
            onChange={(e) => setIncludeDone(e.target.checked)}
            className="size-3.5 rounded border-slate-300"
          />
          include done
        </label>
      }
    >
      <StatGrid cols={2}>
        <Stat label="work owed" value={pendingCount} accent={pendingCount > 0 ? "amber" : "emerald"} sub="pending + in progress" />
        <Stat label="orders listed" value={orders.length} sub={includeDone ? "including done" : "open only"} />
      </StatGrid>

      {error && <ErrorNote message={error} />}

      <Notice title="normal tier isn't here">
        Normal-tier purchases need nothing from you — they generate themselves. This queue is only the premium
        orders where someone is owed a hand-built profile.
      </Notice>

      <Panel title="premium queue" hint="newest first">
        {loading ? (
          <Loading label="loading orders" />
        ) : orders.length === 0 ? (
          <Empty message={includeDone ? "no premium orders yet" : "nothing owed — queue is clear"} />
        ) : (
          <Table head={["paid", "buyer", "contact", "based on CV", "amount", "status", ""]}>
            {orders.map((order) => (
              <Row key={order.id}>
                <Cell mono className="whitespace-nowrap text-xs text-slate-500">
                  {formatDateTime(order.paid_at ?? order.created_at)}
                </Cell>

                <Cell>
                  <div className="font-medium text-slate-900">
                    {order.buyer?.name_en || order.buyer?.name_ar || "—"}
                  </div>
                  <div className={`${ADMIN_MONO} text-[11px] text-slate-500`}>{order.buyer?.email ?? "—"}</div>
                </Cell>

                <Cell>
                  <div className={`${ADMIN_MONO} text-slate-900`} dir="ltr">
                    {order.contact_phone || "—"}
                  </div>
                  <div className={`text-[11px] ${order.contact_consent ? "text-emerald-600" : "text-rose-600"}`}>
                    {order.contact_consent ? "consented to contact" : "NO consent — do not call"}
                  </div>
                </Cell>

                <Cell>
                  <div className="text-slate-900">{order.source_cv?.role ?? "—"}</div>
                  <div className="text-[11px] text-slate-500">
                    {order.source_cv?.company ?? "—"}
                    {order.source_cv?.cv_language ? ` · ${order.source_cv.cv_language}` : ""}
                  </div>
                </Cell>

                <Cell mono className="whitespace-nowrap">
                  {Number(order.price_paid).toLocaleString()} {order.currency}
                </Cell>

                <Cell mono className={`whitespace-nowrap text-xs ${STATUS_STYLES[order.fulfillment_status]}`}>
                  {order.fulfillment_status}
                  {order.fulfilled_at && (
                    <div className="text-[10px] text-slate-400">{formatDateTime(order.fulfilled_at)}</div>
                  )}
                  {!order.notified_at && <div className="text-[10px] text-amber-600">alert not sent</div>}
                </Cell>

                <Cell className="whitespace-nowrap text-end">
                  <div className="flex justify-end gap-1.5">
                    {order.fulfillment_status !== "in_progress" && order.fulfillment_status !== "done" && (
                      <button
                        type="button"
                        disabled={busyId === order.id}
                        onClick={() => setStatus(order, "in_progress")}
                        className={`${ADMIN_MONO} rounded-md border border-violet-200 px-2 py-1 text-[11px] text-violet-700 hover:bg-violet-50 disabled:opacity-50`}
                      >
                        start
                      </button>
                    )}
                    {order.fulfillment_status !== "done" ? (
                      <button
                        type="button"
                        disabled={busyId === order.id}
                        onClick={() => setStatus(order, "done")}
                        className={`${ADMIN_MONO} rounded-md border border-emerald-200 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:opacity-50`}
                      >
                        done
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === order.id}
                        onClick={() => setStatus(order, "pending")}
                        className={`${ADMIN_MONO} rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50`}
                      >
                        reopen
                      </button>
                    )}
                  </div>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Panel>
    </AdminPage>
  );
}

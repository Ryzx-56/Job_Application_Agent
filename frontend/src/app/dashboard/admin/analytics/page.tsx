"use client";

import React, { useEffect, useState } from "react";
import {
  AdminPage, Panel, Stat, StatGrid, Money, Table, Row, Cell,
  Loading, ErrorNote, Notice, Empty, ADMIN_MONO,
} from "@/components/admin-ui";
import { fetchAdminAnalytics, AdminAnalytics } from "@/lib/supabase/admin";

const TIER_LABEL: Record<string, string> = { free: "Free", pro: "Pro", elite: "Elite" };

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminAnalytics()
      .then(setData)
      .catch((e) => setError(e?.message ?? "Failed to load analytics."));
  }, []);

  if (error) {
    return (
      <AdminPage title="Analytics">
        <ErrorNote message={error} />
      </AdminPage>
    );
  }
  if (!data) {
    return (
      <AdminPage title="Analytics">
        <Loading label="querying" />
      </AdminPage>
    );
  }

  const month = data.current_month_label;
  // Revenue and purchase history are unknowable until payment_events has
  // rows — not zero. Every affected tile is marked rather than showing a
  // figure that would read as a real measurement.
  const pending = !data.payments_wired;

  return (
    <AdminPage
      title="Analytics"
      subtitle="Live platform figures."
      actions={
        <span className={`${ADMIN_MONO} text-xs text-slate-400`}>
          {new Date(data.generated_at).toLocaleString()}
        </span>
      }
    >
      {pending && (
        <Notice title="payment integration pending">
          Revenue, pay-as-you-go packs and subscription history all read from the{" "}
          <code className={ADMIN_MONO}>payment_events</code> ledger, which has no rows yet. These tiles will populate
          on their own once the payment provider writes to it — no further changes needed here.
        </Notice>
      )}

      <Panel title="signups">
        <StatGrid cols={3}>
          <Stat label="all time" value={data.signups.total} accent="emerald" />
          <Stat label={month} value={data.signups.this_month} sub="new accounts this month" />
          <Stat label="founding members" value={data.founding_members} accent="violet" />
        </StatGrid>
      </Panel>

      <Panel title="cv generations" hint="from cv_generation_events">
        <StatGrid>
          <Stat label="all time" value={data.generations.total} accent="emerald" />
          <Stat label="arabic · all time" value={data.generations.arabic_total} />
          <Stat label="english · all time" value={data.generations.english_total} />
          <Stat label="failed runs" value={data.generations.failed_total} accent="rose" sub="see Pipeline Health" />
        </StatGrid>
        <div className="mt-3">
          <StatGrid cols={3}>
            <Stat label={month} value={data.generations.this_month} accent="emerald" />
            <Stat label={`arabic · ${month}`} value={data.generations.arabic_this_month} />
            <Stat label={`english · ${month}`} value={data.generations.english_this_month} />
          </StatGrid>
        </div>
      </Panel>

      <Panel title="subscriptions" hint="current state from profiles · history from payment_events">
        <Table head={["Tier", "Price", "On tier", "Active", "Ever", `${month}`, "Revenue / month"]}>
          {data.tiers.map((t) => (
            <Row key={t.tier}>
              <Cell className="font-medium text-slate-900">
                {t.label}
                {t.founding_count > 0 && (
                  <span className={`${ADMIN_MONO} ms-2 text-[10px] text-violet-500`}>
                    {t.founding_count} founding
                  </span>
                )}
              </Cell>
              <Cell mono className="text-slate-500">
                {t.price_usd === 0 ? "free" : `$${t.price_usd?.toFixed(2)}`}
              </Cell>
              <Cell mono>{t.current_count?.toLocaleString() ?? "—"}</Cell>
              <Cell mono>{t.active_count?.toLocaleString() ?? "—"}</Cell>
              <Cell mono className="text-slate-300">—</Cell>
              <Cell mono className="text-slate-300">—</Cell>
              <Cell>
                <span className={t.is_cost ? "text-rose-600" : "text-emerald-700"}>
                  {t.is_cost && <span className={ADMIN_MONO}>−</span>}
                  <Money
                    usd={Math.abs(t.estimated_monthly.usd)}
                    sar={Math.abs(t.estimated_monthly.sar)}
                  />
                </span>
              </Cell>
            </Row>
          ))}
        </Table>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Stat
            label="subscription revenue · all time"
            value={<Money usd={data.revenue.all_time.usd} sar={data.revenue.all_time.sar} />}
            pending={pending}
            accent="emerald"
          />
          <Stat
            label={`subscription revenue · ${month}`}
            value={
              <Money
                usd={data.subscription_revenue.this_month_estimated.usd}
                sar={data.subscription_revenue.this_month_estimated.sar}
              />
            }
            sub="projected from who is subscribed now"
            accent="emerald"
          />
        </div>

        <p className="mt-3 text-xs leading-relaxed text-slate-400">
          Revenue per tier is a <strong className="text-slate-500">projection</strong>: current subscribers at the
          price each actually pays, using{" "}
          <code className={ADMIN_MONO}>locked_price</code> for founding members rather than list. It is not money
          received — that needs the payment ledger. Free is negative because those users cost{" "}
          <span className={ADMIN_MONO}>$0.60</span> each per month at full credit usage and generate no income.
          &ldquo;Ever&rdquo; and per-month counts also need the ledger:{" "}
          <code className={ADMIN_MONO}>profiles.tier</code> is a snapshot, so someone who subscribed and later
          cancelled is indistinguishable from someone who never did.
        </p>
      </Panel>

      <Panel title="pay-as-you-go packs">
        <Table head={["Pack", "Price", "Credits", "Sold · all time", `Sold · ${month}`, "Revenue"]}>
          {data.packs_catalogue.map((p) => (
            <Row key={p.slug}>
              <Cell className="font-medium text-slate-900">{p.label}</Cell>
              <Cell mono className="text-slate-500">${p.price_usd.toFixed(2)}</Cell>
              <Cell mono className="text-slate-500">{p.credits}</Cell>
              <Cell mono className={pending ? "text-slate-300" : ""}>
                {pending ? "—" : p.sold_ever.toLocaleString()}
              </Cell>
              <Cell mono className={pending ? "text-slate-300" : ""}>
                {pending ? "—" : p.sold_this_month.toLocaleString()}
              </Cell>
              <Cell>
                {pending ? (
                  <span className="text-slate-300">—</span>
                ) : (
                  <span className="text-emerald-700">
                    <Money usd={p.revenue.usd} sar={p.revenue.sar} />
                  </span>
                )}
              </Cell>
            </Row>
          ))}
        </Table>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Stat
            label="pack revenue · all time"
            value={<Money usd={data.packs_revenue.all_time.usd} sar={data.packs_revenue.all_time.sar} />}
            pending={pending}
            accent="emerald"
          />
          <Stat
            label={`pack revenue · ${month}`}
            value={<Money usd={data.packs_revenue.this_month.usd} sar={data.packs_revenue.this_month.sar} />}
            pending={pending}
            accent="emerald"
          />
        </div>
      </Panel>

      <Panel title="total revenue" hint="subscriptions + packs">
        <StatGrid cols={3}>
          <Stat
            label="projected mrr"
            value={<Money usd={data.estimated_mrr.usd} sar={data.estimated_mrr.sar} />}
            sub="net of free-tier cost"
            accent={data.estimated_mrr.usd >= 0 ? "emerald" : "rose"}
          />
          <Stat
            label="all time"
            value={<Money usd={data.revenue.all_time.usd} sar={data.revenue.all_time.sar} />}
            pending={pending}
            accent="emerald"
          />
          <Stat
            label={month}
            value={<Money usd={data.revenue.this_month.usd} sar={data.revenue.this_month.sar} />}
            pending={pending}
            accent="emerald"
          />
        </StatGrid>
      </Panel>

    </AdminPage>
  );
}

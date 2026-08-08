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
      subtitle={`Live platform figures. Dollar amounts show their SAR equivalent at the fixed ${data.usd_to_sar} peg.`}
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
        <Table head={["Tier", "Currently on tier", "Active subscription", "Ever subscribed", `Subscribed ${month}`]}>
          {data.tiers.map((t) => (
            <Row key={t.tier}>
              <Cell className="font-medium text-slate-900">{TIER_LABEL[t.tier] ?? t.tier}</Cell>
              <Cell mono>{t.current_count?.toLocaleString() ?? "—"}</Cell>
              <Cell mono>{t.active_count?.toLocaleString() ?? "—"}</Cell>
              <Cell mono className="text-slate-300">—</Cell>
              <Cell mono className="text-slate-300">—</Cell>
            </Row>
          ))}
        </Table>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          &ldquo;Ever subscribed&rdquo; and per-month counts need the payment ledger:{" "}
          <code className={ADMIN_MONO}>profiles.tier</code> is a snapshot, so someone who subscribed and later
          cancelled is indistinguishable from someone who never subscribed.
        </p>
      </Panel>

      <Panel title="pay-as-you-go packs">
        <StatGrid cols={2}>
          <Stat label="packs sold · all time" value={data.packs.ever} pending={pending} />
          <Stat label={`packs sold · ${month}`} value={data.packs.this_month} pending={pending} />
        </StatGrid>
      </Panel>

      <Panel title="revenue">
        <StatGrid cols={2}>
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

      <Panel title="by product" hint="populates as payments land">
        {data.by_product.length === 0 ? (
          <Empty message="no purchases recorded yet" />
        ) : (
          <Table head={["Kind", "Product", "Ever", month, "Revenue"]}>
            {data.by_product.map((p) => (
              <Row key={`${p.kind}:${p.product_slug}`}>
                <Cell mono className="text-slate-500">{p.kind}</Cell>
                <Cell className="font-medium text-slate-900">{p.product_slug}</Cell>
                <Cell mono>{p.count_ever}</Cell>
                <Cell mono>{p.count_month}</Cell>
                <Cell><Money usd={p.revenue.usd} sar={p.revenue.sar} /></Cell>
              </Row>
            ))}
          </Table>
        )}
      </Panel>
    </AdminPage>
  );
}

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
          on their own once the payment provider writes to it, with no further changes needed here.
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
        <Table
          head={["Tier", "Price", "On tier", "Active", "Revenue / month", "Worst-case cost", "Worst-case profit", "Margin"]}
        >
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
              <Cell mono className="whitespace-nowrap text-slate-500">
                {/* One price per tier. The founding offer is a badge with no
                    discount attached, so there is no second figure to show
                    here any more. */}
                {t.price_sar === 0 ? "free" : `${t.price_sar?.toFixed(2)} SAR`}
              </Cell>
              <Cell mono>{t.current_count?.toLocaleString() ?? "n/a"}</Cell>
              <Cell mono>{t.active_count?.toLocaleString() ?? "n/a"}</Cell>
              <Cell>
                <span className={t.is_cost ? "text-rose-600" : "text-emerald-700"}>
                  {t.is_cost && <span className={ADMIN_MONO}>−</span>}
                  <Money usd={Math.abs(t.estimated_monthly.usd)} sar={Math.abs(t.estimated_monthly.sar)} />
                </span>
              </Cell>
              <Cell>
                <span className="text-rose-600">
                  <Money usd={t.worst_case_cost.usd} sar={t.worst_case_cost.sar} />
                </span>
                <div className={`${ADMIN_MONO} text-[10px] text-slate-400`}>
                  {t.credits} cr × {data.worst_case.cost_per_credit.sar.toFixed(2)}
                </div>
              </Cell>
              <Cell>
                <span className={t.worst_case_profit.sar < 0 ? "text-rose-600" : "text-emerald-700"}>
                  <Money usd={t.worst_case_profit.usd} sar={t.worst_case_profit.sar} />
                </span>
              </Cell>
              <Cell mono className="whitespace-nowrap">
                {t.worst_case_margin_pct === null ? (
                  <span className="text-slate-300">n/a</span>
                ) : (
                  <span className={t.worst_case_margin_pct < 0 ? "text-rose-600" : "text-slate-700"}>
                    {t.worst_case_margin_pct}%
                  </span>
                )}
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
          Revenue per tier is a <strong className="text-slate-500">projection</strong>: active subscribers &times; that
          tier&rsquo;s price. Every subscriber on a tier pays the same price, so nothing reads{" "}
          <code className={ADMIN_MONO}>locked_price</code> any more &mdash; it was a leftover of the withdrawn
          founding discount and was pricing some rows at a figure the product no longer charges. It is not money
          received, which needs the payment ledger. Free is negative because those users cost{" "}
          <span className={ADMIN_MONO}>2.25 SAR</span> each per month at full credit usage and generate no income.
          &ldquo;Ever&rdquo; and per-month counts also need the ledger:{" "}
          <code className={ADMIN_MONO}>profiles.tier</code> is a snapshot, so someone who subscribed and later
          cancelled is indistinguishable from someone who never did.
        </p>
      </Panel>

      <Panel title="pay-as-you-go packs">
        <Table
          head={["Pack", "Price", "Credits", "Sold · all time", `Sold · ${month}`, "Revenue", "Worst-case cost", "Worst-case profit", "Margin"]}
        >
          {data.packs_catalogue.map((p) => (
            <Row key={p.slug}>
              <Cell className="font-medium text-slate-900">{p.label}</Cell>
              <Cell mono className="whitespace-nowrap text-slate-500">{p.price_sar.toFixed(2)} SAR</Cell>
              <Cell mono className="text-slate-500">{p.credits}</Cell>
              <Cell mono className={pending ? "text-slate-300" : ""}>
                {pending ? "n/a" : p.sold_ever.toLocaleString()}
              </Cell>
              <Cell mono className={pending ? "text-slate-300" : ""}>
                {pending ? "n/a" : p.sold_this_month.toLocaleString()}
              </Cell>
              <Cell>
                {pending ? (
                  <span className="text-slate-300">n/a</span>
                ) : (
                  <span className="text-emerald-700">
                    <Money usd={p.revenue.usd} sar={p.revenue.sar} />
                  </span>
                )}
              </Cell>
              <Cell>
                {pending ? (
                  <span className="text-slate-300">n/a</span>
                ) : (
                  <span className="text-rose-600">
                    <Money usd={p.worst_case_cost.usd} sar={p.worst_case_cost.sar} />
                  </span>
                )}
                <div className={`${ADMIN_MONO} text-[10px] text-slate-400`}>
                  {p.unit_worst_case_cost.sar.toFixed(2)} / pack
                </div>
              </Cell>
              <Cell>
                {pending ? (
                  <span className="text-slate-300">n/a</span>
                ) : (
                  <span className={p.worst_case_profit.sar < 0 ? "text-rose-600" : "text-emerald-700"}>
                    <Money usd={p.worst_case_profit.usd} sar={p.worst_case_profit.sar} />
                  </span>
                )}
              </Cell>
              <Cell mono className="whitespace-nowrap">
                {p.worst_case_margin_pct === null ? (
                  <span className="text-slate-300">n/a</span>
                ) : (
                  `${p.worst_case_margin_pct}%`
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

      {/* ── LinkedIn add-on ──
          Real money, not a projection: linkedin_purchases records what was
          actually paid, so this is measured rather than estimated. Premium is
          split out because its cost is manual time, not compute. */}
      <Panel title="linkedin add-on" hint="from linkedin_purchases · actual, not projected">
        {!data.linkedin.available ? (
          <Empty message="linkedin tables not readable on this environment" />
        ) : (
          <>
            <Table head={["Tier", "Sold", "Revenue", "Worst-case cost", "Worst-case profit", "Margin"]}>
              <Row>
                <Cell className="font-medium text-slate-900">{data.linkedin.essential.label}</Cell>
                <Cell mono>{data.linkedin.essential.sold.toLocaleString()}</Cell>
                <Cell>
                  <span className="text-emerald-700">
                    <Money usd={data.linkedin.essential.revenue.usd} sar={data.linkedin.essential.revenue.sar} />
                  </span>
                </Cell>
                <Cell>
                  <span className="text-rose-600">
                    <Money
                      usd={data.linkedin.essential.worst_case_cost?.usd}
                      sar={data.linkedin.essential.worst_case_cost?.sar}
                    />
                  </span>
                </Cell>
                <Cell>
                  <span className="text-emerald-700">
                    <Money
                      usd={data.linkedin.essential.worst_case_profit?.usd}
                      sar={data.linkedin.essential.worst_case_profit?.sar}
                    />
                  </span>
                </Cell>
                <Cell mono>
                  {data.linkedin.essential.worst_case_margin_pct === null
                    ? "n/a"
                    : `${data.linkedin.essential.worst_case_margin_pct}%`}
                </Cell>
              </Row>
              <Row>
                <Cell className="font-medium text-slate-900">{data.linkedin.premium.label}</Cell>
                <Cell mono>{data.linkedin.premium.sold.toLocaleString()}</Cell>
                <Cell>
                  <span className="text-emerald-700">
                    <Money usd={data.linkedin.premium.revenue.usd} sar={data.linkedin.premium.revenue.sar} />
                  </span>
                </Cell>
                <Cell mono className="text-amber-600">cost not tracked</Cell>
                <Cell mono className="text-slate-300">n/a</Cell>
                <Cell mono className="text-slate-300">n/a</Cell>
              </Row>
            </Table>

            <Notice title="why premium has no cost figure">
              Premium is fulfilled by hand, so its cost is your time rather than a fixed API charge. Assuming zero
              would overstate profit and inventing a labour rate would be arbitrary, so premium revenue is shown on
              its own and left out of the worst-case totals below.
            </Notice>
          </>
        )}
      </Panel>

      <Panel title="total revenue" hint="subscriptions + packs">
        <StatGrid cols={3}>
          <Stat
            label="projected mrr"
            value={<Money usd={data.estimated_mrr.usd} sar={data.estimated_mrr.sar} />}
            sub="net of free-tier cost"
            accent={data.estimated_mrr.sar >= 0 ? "emerald" : "rose"}
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

      {/* ── Worst-case profit, running total (pricing reference §7) ── */}
      <Panel title="worst-case profit" hint="every granted credit burned on the most expensive generation">
        <StatGrid>
          <Stat
            label="revenue"
            value={<Money usd={data.worst_case.revenue.usd} sar={data.worst_case.revenue.sar} />}
            accent="emerald"
            sub="paid tiers, packs, LinkedIn Essential"
          />
          <Stat
            label="worst-case cost"
            value={<Money usd={data.worst_case.cost.usd} sar={data.worst_case.cost.sar} />}
            accent="rose"
            sub="includes the free tier's cost"
          />
          <Stat
            label="worst-case profit"
            value={<Money usd={data.worst_case.profit.usd} sar={data.worst_case.profit.sar} />}
            accent={data.worst_case.profit.sar >= 0 ? "emerald" : "rose"}
          />
          <Stat
            label="worst-case margin"
            value={data.worst_case.margin_pct === null ? null : `${data.worst_case.margin_pct}%`}
            accent={
              data.worst_case.margin_pct !== null && data.worst_case.margin_pct < 0 ? "rose" : "slate"
            }
          />
        </StatGrid>

        <p className="mt-3 text-xs leading-relaxed text-slate-400">
          Cost is <span className={ADMIN_MONO}>credits × {data.worst_case.cost_per_credit.sar.toFixed(2)} SAR</span>,
          the price of a credit spent on the most expensive generation. It is a ceiling, not an average, so real profit
          should sit above this. The free tier contributes cost and no revenue, which is intended: those users are an
          acquisition cost. LinkedIn Premium is excluded entirely, since its cost is manual time.
        </p>
      </Panel>

    </AdminPage>
  );
}

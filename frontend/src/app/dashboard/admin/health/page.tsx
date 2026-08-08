"use client";

import React, { useEffect, useState } from "react";
import {
  AdminPage, Panel, Stat, StatGrid, Table, Row, Cell,
  Loading, ErrorNote, Empty, ADMIN_MONO,
} from "@/components/admin-ui";
import { fetchPipelineHealth, AdminPipelineHealth } from "@/lib/supabase/admin";

/**
 * Pipeline Health.
 *
 * cv_generation_events has been recording pipeline_succeeded,
 * error_message, hit_max_retries, arabic_purity_pass_fired,
 * arabic_purity_still_bad, name_fallback_used and token totals on every
 * single run, and none of it was surfaced anywhere. Diagnosing a failure
 * meant reading raw Render logs by hand.
 *
 * This is that data as a page: what share of runs succeed, which errors are
 * actually happening, whether Arabic localization is still leaving Latin
 * text behind, how many users land on the legacy name path, and what the
 * token spend looks like.
 */

const WINDOWS = [7, 30, 90];

export default function AdminHealthPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AdminPipelineHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetchPipelineHealth(days)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e?.message ?? "Failed to load pipeline health."));
    return () => {
      cancelled = true;
    };
  }, [days]);

  const windowPicker = (
    <div className={`${ADMIN_MONO} inline-flex rounded-lg border border-slate-200 bg-white p-0.5`}>
      {WINDOWS.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => setDays(d)}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            days === d ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          {d}d
        </button>
      ))}
    </div>
  );

  return (
    <AdminPage
      title="Pipeline Health"
      subtitle="Generation outcomes from cv_generation_events. This data was already being recorded on every run and had no surface until now."
      actions={windowPicker}
    >
      {error && <ErrorNote message={error} />}
      {!data && !error ? (
        <Loading label="aggregating" />
      ) : data ? (
        <>
          <Panel title={`runs · last ${data.window_days} days`}>
            <StatGrid>
              <Stat label="total runs" value={data.runs} />
              <Stat
                label="success rate"
                value={data.success_rate === null ? undefined : `${data.success_rate}%`}
                accent={
                  data.success_rate === null ? "slate" : data.success_rate >= 95 ? "emerald" : data.success_rate >= 85 ? "amber" : "rose"
                }
                sub={`${data.succeeded.toLocaleString()} succeeded`}
              />
              <Stat label="failed" value={data.failed} accent={data.failed ? "rose" : "slate"} />
              <Stat
                label="hit max retries"
                value={data.hit_max_retries}
                accent={data.hit_max_retries ? "amber" : "slate"}
                sub="gave up after retrying"
              />
            </StatGrid>
          </Panel>

          <Panel title="arabic localization" hint="quality of the glossary pass">
            <StatGrid>
              <Stat label="arabic runs" value={data.arabic.runs} />
              <Stat label="needed a pass" value={data.arabic.purity_pass_fired} sub="had Latin text to fix" />
              <Stat
                label="still latin after"
                value={data.arabic.still_latin_after_pass}
                accent={data.arabic.still_latin_after_pass ? "rose" : "emerald"}
              />
              <Stat
                label="leak rate"
                value={data.arabic.still_latin_rate === null ? undefined : `${data.arabic.still_latin_rate}%`}
                accent={
                  data.arabic.still_latin_rate === null
                    ? "slate"
                    : data.arabic.still_latin_rate <= 10
                    ? "emerald"
                    : data.arabic.still_latin_rate <= 30
                    ? "amber"
                    : "rose"
                }
                sub="of runs that needed a pass"
              />
            </StatGrid>
          </Panel>

          <Panel title="cost + fallbacks">
            <StatGrid>
              <Stat label="input tokens" value={data.tokens.input} />
              <Stat label="output tokens" value={data.tokens.output} />
              <Stat label="claude calls" value={data.tokens.calls} />
              <Stat
                label="legacy name path"
                value={data.name_fallback_used}
                accent={data.name_fallback_used ? "amber" : "slate"}
                sub="generated without a saved name"
              />
            </StatGrid>
            <p className="mt-3 text-xs leading-relaxed text-slate-400">
              Average tailoring attempts per run:{" "}
              <span className={`${ADMIN_MONO} text-slate-600`}>{data.avg_tailoring_attempts}</span>. Above 1.0 means
              the fact checker is sending work back for a rewrite.
            </p>
          </Panel>

          <Panel title="top errors" hint={`last ${data.window_days} days`}>
            {data.top_errors.length === 0 ? (
              <Empty message="no failures recorded in this window" />
            ) : (
              <Table head={["Count", "Error", "Last seen"]}>
                {data.top_errors.map((e, i) => (
                  <Row key={i}>
                    <Cell mono className="w-16 text-rose-600">{e.count}</Cell>
                    <Cell mono className="text-xs text-slate-700">{e.message}</Cell>
                    <Cell mono className="w-40 whitespace-nowrap text-xs text-slate-400">
                      {e.last_seen ? new Date(e.last_seen).toLocaleString() : "—"}
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Panel>
        </>
      ) : null}
    </AdminPage>
  );
}

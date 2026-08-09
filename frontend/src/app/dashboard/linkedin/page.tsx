"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  Loader2,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useLang } from "@/lib/language";
import { fetchResumes, ResumeRecord } from "@/lib/supabase/resumes";
import { updateProfileNames } from "@/lib/supabase/profile-names";
import {
  ApiError,
  fetchLinkedInGeneration,
  fetchLinkedInOverview,
  generateLinkedInProfile,
  LinkedInGeneration,
  LinkedInOverview,
  LinkedInTier,
} from "@/lib/supabase/linkedin";
import {
  formatSar,
  liOutlineButton,
  liPrimaryButton,
  LinkedInGlyph,
  LinkedInPageShell,
  LinkedInPanel,
  LockedTeaser,
  TierCard,
} from "@/components/linkedin-ui";
import { LinkedInResults } from "@/components/linkedin-results";

/* ========================================================================
   /dashboard/linkedin — the LinkedIn add-on.

   Two faces, decided by whether the user has ever paid (overview.has_purchased):
     · Never bought  -> the sales page: explainer, tiers, locked teaser, and a
                        CV picker that appears once a tier is chosen.
     · Has bought    -> their stuff: any paid purchase waiting to be generated,
                        their history, and a way to buy another.
   Opening a generation swaps the whole page for the results view, so the
   content gets the full width on a phone.

   Nothing here can unlock content: generation is refused server-side without
   a paid purchase, and payment is confirmed by the gateway, not by this page.
======================================================================== */

/** How many saved CVs to offer in the picker. Deliberately more than the
 *  "My Resumes" page size — this is a one-screen choice, not a browsing list. */
const CV_FETCH_LIMIT = 50;

function formatDate(iso: string | null | undefined, lang: "en" | "ar") {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function LinkedInPage() {
  const { t, lang, dir } = useLang();
  const copy = t.dashboard.linkedin;
  const router = useRouter();
  const params = useSearchParams();

  const [overview, setOverview] = useState<LinkedInOverview | null>(null);
  const [resumes, setResumes] = useState<ResumeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The underlying failure, shown in mono under the friendly line — same as
  // My Resumes. A bare "please try again" on a page whose backend isn't
  // deployed (or whose tables don't exist yet) is undebuggable from a
  // screenshot, which is exactly when someone sends you one.
  const [loadErrorDetail, setLoadErrorDetail] = useState<string | null>(null);

  const [tier, setTier] = useState<LinkedInTier | null>(null);
  const [cvId, setCvId] = useState<string | null>(null);
  const [selectorError, setSelectorError] = useState<string | null>(null);
  const [showBuyAgain, setShowBuyAgain] = useState(false);

  const [openGeneration, setOpenGeneration] = useState<LinkedInGeneration | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [busyPurchaseId, setBusyPurchaseId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Shown when the profile has no English name yet. Asked rather than
  // transliterated — the generated profile carries this name publicly, and
  // only its owner knows the spelling they use. Same rule the CV flow follows.
  const [nameNeededFor, setNameNeededFor] = useState<{ purchaseId: string; cvId?: string } | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    const data = await fetchLinkedInOverview();
    setOverview(data);
    return data;
  }, []);

  /**
   * Loads the two independent things this page needs.
   *
   * allSettled, not all: the explainer, the tiers' feature lists and the
   * teaser are static copy that need no backend at all, and the CV list and
   * the account's purchase data come from different places. One of them
   * failing must not blank the page — a visitor who can't reach the API
   * should still be able to read what the product IS. Whatever did load
   * renders; what didn't gets a retry banner.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setLoadErrorDetail(null);

    const [overviewResult, resumesResult] = await Promise.allSettled([
      fetchLinkedInOverview(),
      fetchResumes(0, CV_FETCH_LIMIT),
    ]);

    if (overviewResult.status === "fulfilled") {
      setOverview(overviewResult.value);
    } else {
      const apiError = overviewResult.reason as ApiError;
      console.error("LinkedIn overview failed:", apiError);
      setOverview(null);
      setLoadError(copy.errors.load);
      setLoadErrorDetail(
        [apiError?.status ? `HTTP ${apiError.status}` : null, apiError?.code, apiError?.message]
          .filter(Boolean)
          .join(" · ")
      );
    }

    if (resumesResult.status === "fulfilled") {
      setResumes(resumesResult.value.resumes);
    } else {
      console.error("fetchResumes failed on the LinkedIn page:", resumesResult.reason);
    }

    setLoading(false);
    // copy.errors.load is stable per language; re-running on a language switch
    // would pointlessly refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Arriving from /dashboard/upgrade#linkedin-tiers with a tier already
  // chosen (?tier=normal). The tier cards live on both surfaces; the CV
  // picker only lives here, so a preselected tier just opens the picker.
  const preselectedTier = params.get("tier");
  useEffect(() => {
    if (preselectedTier === "normal" || preselectedTier === "premium") {
      setTier(preselectedTier);
    }
  }, [preselectedTier]);

  // Deep link from the checkout redirect (?generation=…) so a finished
  // generation can be reopened directly.
  const deepLinkedGeneration = params.get("generation");
  useEffect(() => {
    if (!deepLinkedGeneration) return;
    void openGeneration_(deepLinkedGeneration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkedGeneration]);

  /** CVs we can actually build from: a row saved before generation_snapshot
   *  existed has no facts_json, so the backend would refuse it — better to say
   *  so in the picker than to fail after payment. */
  const usableResumes = useMemo(() => resumes.filter((r) => Boolean(r.generation_snapshot)), [resumes]);

  const pricing = overview?.pricing;
  const normalPrice = pricing ? formatSar(pricing.normal.price, lang) : "";
  const premiumPrice = pricing ? formatSar(pricing.premium.price, lang) : "";

  async function openGeneration_(generationId: string) {
    setOpeningId(generationId);
    setActionError(null);
    try {
      const generation = await fetchLinkedInGeneration(generationId);
      setOpenGeneration(generation);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      console.error("fetchLinkedInGeneration failed:", err);
      setActionError(copy.errors.load);
    } finally {
      setOpeningId(null);
    }
  }

  function messageForError(err: ApiError): string {
    switch (err.code) {
      case "already_generated":
        return copy.errors.alreadyGenerated;
      case "generation_in_progress":
        return copy.errors.inProgress;
      case "purchase_not_paid":
        return copy.errors.notPaid;
      case "cv_deleted":
        return copy.errors.cvDeleted;
      case "cv_not_supported":
        return copy.errors.cvNotSupported;
      case "generation_failed":
        return copy.errors.generationFailed;
      default:
        return err.message || copy.errors.load;
    }
  }

  async function handleGenerate(purchaseId: string, sourceCvId?: string) {
    setBusyPurchaseId(purchaseId);
    setActionError(null);
    try {
      const result = await generateLinkedInProfile({ purchaseId, sourceCvId });
      await loadOverview();
      setOpenGeneration({
        generation_id: result.generation_id,
        purchase_id: result.purchase_id,
        status: "ready",
        created_at: new Date().toISOString(),
        tier: result.tier,
        source_cv: null,
        content: result.content,
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      const err = error as ApiError;
      console.error("generateLinkedInProfile failed:", err);

      if (err.code === "missing_profile_name") {
        setNameNeededFor({ purchaseId, cvId: sourceCvId });
        setBusyPurchaseId(null);
        return;
      }
      // Already used: open what they already have rather than telling them off.
      const existingId = err.detail?.generation_id;
      if (err.code === "already_generated" && typeof existingId === "string") {
        await loadOverview();
        await openGeneration_(existingId);
        setBusyPurchaseId(null);
        return;
      }
      setActionError(messageForError(err));
      await loadOverview().catch(() => undefined);
    } finally {
      setBusyPurchaseId(null);
    }
  }

  async function handleSaveName() {
    if (!nameNeededFor || !nameValue.trim()) return;
    setNameSaving(true);
    setNameError(null);
    try {
      await updateProfileNames({ nameEn: nameValue.trim() });
      const target = nameNeededFor;
      setNameNeededFor(null);
      setNameValue("");
      await handleGenerate(target.purchaseId, target.cvId);
    } catch (err) {
      console.error("updateProfileNames failed:", err);
      setNameError(copy.nameNeeded.error);
    } finally {
      setNameSaving(false);
    }
  }

  function chooseTier(next: LinkedInTier) {
    setTier(next);
    setSelectorError(null);
    // The picker only exists once a tier is chosen, so it needs bringing into
    // view — on a phone it renders below the fold.
    requestAnimationFrame(() => {
      document.getElementById("linkedin-cv-picker")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function goToCheckout() {
    if (!tier) return;
    if (!cvId) {
      setSelectorError(copy.cvSelector.selectFirst);
      return;
    }
    router.push(`/dashboard/linkedin/checkout?tier=${tier}&cv=${cvId}`);
  }

  /* ── Loading / error ─────────────────────────────────────────────── */

  if (loading) {
    return (
      <LinkedInPageShell dir={dir}>
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-20 text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {copy.cvSelector.loading}
        </div>
      </LinkedInPageShell>
    );
  }

  /* ── Results view ────────────────────────────────────────────────── */

  if (openGeneration?.content) {
    const isPremium = openGeneration.tier === "premium";
    return (
      <LinkedInPageShell dir={dir}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setOpenGeneration(null)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0A66C2] hover:underline"
          >
            {dir === "rtl" ? <ArrowRight className="size-4" aria-hidden /> : <ArrowLeft className="size-4" aria-hidden />}
            {copy.results.backToLinkedin}
          </button>
          <p className="text-xs text-slate-500">
            {copy.results.generatedOn}: {formatDate(openGeneration.created_at, lang)}
          </p>
        </div>

        <header className="rounded-2xl border border-slate-200 bg-white p-5">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{copy.results.title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">{copy.results.sub}</p>
          <p className="mt-3 rounded-lg bg-[#EAF4FB] px-3 py-2 text-xs leading-relaxed text-slate-600">
            {copy.englishOnlyNote}
            {openGeneration.content.source_cv_language === "ar" && ` ${copy.results.translatedNote}`}
          </p>
        </header>

        {isPremium && (
          <div className="flex gap-3 rounded-2xl border border-[#0A66C2]/25 bg-white p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#EAF4FB] text-[#0A66C2]">
              <UserRound className="size-4.5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{copy.premiumPending.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{copy.premiumPending.body}</p>
            </div>
          </div>
        )}

        <LinkedInResults data={openGeneration.content} copy={copy} />
      </LinkedInPageShell>
    );
  }

  /* ── Main view ───────────────────────────────────────────────────── */

  // A returning buyer normally sees their own stuff, not the sales pitch —
  // unless they asked to buy again, or arrived from the plans page with a tier
  // already picked, in which case hiding the CV picker would dead-end them.
  // When the account data couldn't load at all, the sales content is the only
  // thing there is to show, and it's worth showing.
  const showSales = !overview || !overview.has_purchased || showBuyAgain || Boolean(tier);
  // Prices and buying both need the backend. Without it the tiers still
  // explain what each one includes, but nothing is purchasable and no price is
  // shown — a wrong or blank price on a buy button is worse than no button.
  const canBuy = Boolean(overview);

  return (
    <LinkedInPageShell dir={dir}>
      <header>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#0A66C2]">
          <LinkedInGlyph className="size-3.5" />
          {copy.eyebrow}
        </span>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{copy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">{copy.sub}</p>
      </header>

      {actionError && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{actionError}</span>
        </div>
      )}

      {/* Account data unreachable. A banner, not a blank page: everything
          below that doesn't need the backend still renders. */}
      {loadError && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-700">
          <div className="flex min-w-0 items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0">
              <span>{loadError}</span>
              {loadErrorDetail && (
                <p dir="ltr" className="mt-0.5 break-words text-left font-mono text-xs text-rose-400">
                  {loadErrorDetail}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="shrink-0 rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
          >
            {copy.generateBox.retry}
          </button>
        </div>
      )}

      {/* ── Paid and waiting to be generated ── */}
      {(overview?.pending_generations ?? []).map((pending) => {
        const cv = pending.source_cv;
        const needsReplacementCv = !pending.source_cv_id;
        const busy = busyPurchaseId === pending.purchase_id;

        return (
          <LinkedInPanel
            key={pending.purchase_id}
            title={copy.generateBox.title}
            action={
              <span className="rounded-full bg-[#EAF4FB] px-2.5 py-0.5 text-[11px] font-semibold text-[#0A66C2]">
                {pending.tier === "premium" ? copy.tiers.premiumName : copy.tiers.normalName}
              </span>
            }
          >
            <p className="text-sm leading-relaxed text-slate-600">
              {pending.tier === "premium" ? copy.generateBox.bodyPremium : copy.generateBox.bodyNormal}
            </p>

            {cv && (
              <p className="text-xs text-slate-500">
                {copy.generateBox.basedOn}: {cv.role || copy.cvSelector.untitled}
                {cv.company ? ` · ${cv.company}` : ""}
              </p>
            )}

            {needsReplacementCv ? (
              <div className="space-y-3">
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                  {copy.generateBox.pickReplacementCv}
                </p>
                <CvPicker
                  resumes={usableResumes}
                  allResumes={resumes}
                  selectedId={cvId}
                  onSelect={setCvId}
                  copy={copy}
                  lang={lang}
                  compact
                />
                <button
                  type="button"
                  disabled={busy || !cvId}
                  onClick={() => cvId && handleGenerate(pending.purchase_id, cvId)}
                  className={liPrimaryButton}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                  {busy ? copy.generateBox.running : copy.generateBox.cta}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleGenerate(pending.purchase_id)}
                  className={liPrimaryButton}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                  {busy ? copy.generateBox.running : copy.generateBox.cta}
                </button>
                {busy && <p className="text-xs text-slate-500">{copy.generateBox.runningHint}</p>}
              </div>
            )}

            {/* The name prompt only ever appears for the purchase it belongs
                to, so two pending purchases can't confuse each other. */}
            {nameNeededFor?.purchaseId === pending.purchase_id && (
              <div className="space-y-2 rounded-xl border border-[#0A66C2]/25 bg-[#EAF4FB]/60 p-4">
                <p className="text-sm font-semibold text-slate-900">{copy.nameNeeded.title}</p>
                <p className="text-xs leading-relaxed text-slate-600">{copy.nameNeeded.body}</p>
                <input
                  type="text"
                  dir="ltr"
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-900 outline-none focus:border-[#0A66C2] focus:ring-2 focus:ring-[#0A66C2]/20"
                />
                {nameError && <p className="text-xs text-rose-600">{nameError}</p>}
                <button
                  type="button"
                  disabled={nameSaving || !nameValue.trim()}
                  onClick={handleSaveName}
                  className={liPrimaryButton}
                >
                  {nameSaving && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {copy.nameNeeded.save}
                </button>
              </div>
            )}
          </LinkedInPanel>
        );
      })}

      {/* ── History (only once they own something) ── */}
      {overview?.has_purchased && (
        <LinkedInPanel title={copy.history.title} note={copy.history.sub}>
          {overview.history.length === 0 ? (
            <p className="text-sm text-slate-400">{copy.history.empty}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {overview.history.map((item) => {
                const statusLabel =
                  item.status === "ready"
                    ? copy.history.status.ready
                    : item.status === "generating"
                    ? copy.history.status.generating
                    : copy.history.status.failed;
                const cvLabel = item.source_cv?.role || copy.cvSelector.untitled;

                return (
                  <li key={item.generation_id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {cvLabel}
                        {item.source_cv?.company ? <span className="text-slate-400"> · {item.source_cv.company}</span> : null}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatDate(item.created_at, lang)} ·{" "}
                        {item.tier === "premium" ? copy.tiers.premiumName : copy.tiers.normalName} · {statusLabel}
                      </p>
                    </div>
                    {item.status === "ready" ? (
                      <button
                        type="button"
                        onClick={() => openGeneration_(item.generation_id)}
                        disabled={openingId === item.generation_id}
                        className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[#0A66C2] hover:underline disabled:opacity-50"
                      >
                        {openingId === item.generation_id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : (
                          <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden />
                        )}
                        {copy.history.open}
                      </button>
                    ) : (
                      <span className="shrink-0 text-xs text-slate-400">{statusLabel}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {!showBuyAgain && (
            <div className="mt-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
              <p className="text-sm font-semibold text-slate-900">{copy.history.buyAgainTitle}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{copy.history.buyAgainBody}</p>
              <button type="button" onClick={() => setShowBuyAgain(true)} className={`mt-3 ${liOutlineButton}`}>
                {copy.history.buyAgainCta}
              </button>
            </div>
          )}
        </LinkedInPanel>
      )}

      {/* ── Sales: explainer -> tiers -> teaser -> CV picker ── */}
      {showSales && (
        <>
          <LinkedInPanel title={copy.explainer.title} note={copy.explainer.body}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">{copy.explainer.normalTitle}</p>
                <ul className="mt-2 space-y-1.5">
                  {copy.explainer.normalItems.map((item) => (
                    <li key={item} className="flex gap-2 text-sm leading-relaxed text-slate-600">
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">{copy.explainer.premiumTitle}</p>
                <ul className="mt-2 space-y-1.5">
                  {copy.explainer.premiumItems.map((item) => (
                    <li key={item} className="flex gap-2 text-sm leading-relaxed text-slate-600">
                      <Check className="mt-0.5 size-4 shrink-0 text-[#0A66C2]" aria-hidden />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="rounded-lg bg-[#EAF4FB] px-3 py-2 text-xs leading-relaxed text-slate-600">
              {copy.explainer.honest}
            </p>
            <p className="text-xs leading-relaxed text-slate-500">{copy.englishOnlyNote}</p>
          </LinkedInPanel>

          {/* The expectations note also lives on the checkout screen itself,
              where it can't be missed before paying. This is the short form. */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-900">{copy.refundNote.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{copy.refundNote.oneTime}</p>
            <Link
              href="/refund-policy"
              className="mt-2 inline-block text-xs font-medium text-[#0A66C2] underline underline-offset-2"
            >
              {copy.refundNote.policyLink}
            </Link>
          </div>

          <section id="linkedin-tiers" className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{copy.tiers.sectionTitle}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <TierCard
                name={copy.tiers.normalName}
                tagline={copy.tiers.normalTagline}
                price={canBuy ? normalPrice : "—"}
                oneTimeLabel={copy.tiers.oneTime}
                includedLabel={copy.tiers.included}
                features={copy.explainer.normalItems}
                cta={copy.tiers.normalCta}
                featured
                selected={tier === "normal"}
                onSelect={() => chooseTier("normal")}
                disabled={!canBuy}
                disabledHint={copy.errors.load}
              />
              <TierCard
                name={copy.tiers.premiumName}
                tagline={copy.tiers.premiumTagline}
                price={canBuy ? premiumPrice : "—"}
                oneTimeLabel={copy.tiers.oneTime}
                includedLabel={copy.tiers.included}
                features={copy.explainer.premiumItems}
                cta={copy.tiers.premiumCta}
                badge={copy.tiers.premiumBadge}
                selected={tier === "premium"}
                onSelect={() => chooseTier("premium")}
                disabled={!canBuy}
                disabledHint={copy.errors.load}
              />
            </div>
            <Link
              href="/dashboard/upgrade#linkedin-tiers"
              className="inline-block text-xs font-medium text-[#0A66C2] underline underline-offset-2"
            >
              {copy.tiers.seeOnPlans}
            </Link>
          </section>

          <LockedTeaser heading={copy.teaser.heading} body={copy.teaser.body} lockedLabel={copy.teaser.locked} />

          {/* CV picker: only after a tier is chosen, and before checkout. */}
          {tier && (
            <div id="linkedin-cv-picker">
              <LinkedInPanel title={copy.cvSelector.title} note={copy.cvSelector.sub}>
                <CvPicker
                  resumes={usableResumes}
                  allResumes={resumes}
                  selectedId={cvId}
                  onSelect={(id) => {
                    setCvId(id);
                    setSelectorError(null);
                  }}
                  copy={copy}
                  lang={lang}
                />

                {selectorError && <p className="text-xs text-rose-600">{selectorError}</p>}

                {usableResumes.length > 0 && (
                  <button type="button" onClick={goToCheckout} className={liPrimaryButton}>
                    {copy.cvSelector.continue}
                    {dir === "rtl" ? <ArrowLeft className="size-4" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}
                  </button>
                )}
              </LinkedInPanel>
            </div>
          )}

          {showBuyAgain && (
            <button type="button" onClick={() => setShowBuyAgain(false)} className="text-xs font-medium text-slate-500 underline">
              {copy.history.hideBuyAgain}
            </button>
          )}
        </>
      )}
    </LinkedInPageShell>
  );
}

/* ========================================================================
   CV PICKER — which existing CV to build from.

   Rows without a generation_snapshot are listed but disabled with the reason
   shown: the facts_json a profile is built from lives in that snapshot, so a
   pre-snapshot row genuinely can't be used. Saying so beats hiding CVs the
   user can see on their My Resumes page.
======================================================================== */
function CvPicker({
  resumes,
  allResumes,
  selectedId,
  onSelect,
  copy,
  lang,
  compact = false,
}: {
  resumes: ResumeRecord[];
  allResumes: ResumeRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  copy: ReturnType<typeof useLang>["t"]["dashboard"]["linkedin"];
  lang: "en" | "ar";
  compact?: boolean;
}) {
  const unusable = allResumes.filter((r) => !r.generation_snapshot);

  if (allResumes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-5 text-center">
        <FileText className="mx-auto size-5 text-slate-400" aria-hidden />
        <p className="mt-2 text-sm text-slate-600">{copy.cvSelector.empty}</p>
        <Link href="/dashboard" className={`mt-3 ${liOutlineButton}`}>
          {copy.cvSelector.emptyCta}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ul className={`space-y-2 ${compact ? "max-h-64 overflow-y-auto" : ""}`}>
        {resumes.map((resume) => {
          const selected = selectedId === resume.id;
          return (
            <li key={resume.id}>
              <button
                type="button"
                onClick={() => onSelect(resume.id)}
                aria-pressed={selected}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-start transition-colors ${
                  selected
                    ? "border-[#0A66C2] bg-[#EAF4FB]"
                    : "border-slate-200 bg-white hover:border-[#0A66C2]/40 hover:bg-[#EAF4FB]/50"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">
                    {resume.role || copy.cvSelector.untitled}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {resume.company || copy.cvSelector.unknownCompany} ·{" "}
                    {new Date(resume.created_at).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </span>
                <span
                  className={`grid size-5 shrink-0 place-items-center rounded-full border ${
                    selected ? "border-[#0A66C2] bg-[#0A66C2] text-white" : "border-slate-300 bg-white"
                  }`}
                >
                  {selected && <Check className="size-3" aria-hidden />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {unusable.length > 0 && (
        <ul className="space-y-1.5">
          {unusable.map((resume) => (
            <li
              key={resume.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 opacity-70"
            >
              <span className="min-w-0 truncate text-sm text-slate-500">{resume.role || copy.cvSelector.untitled}</span>
              <span className="shrink-0 text-[11px] text-slate-400">{copy.cvSelector.unsupported}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

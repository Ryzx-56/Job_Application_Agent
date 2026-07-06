"use client";

import React, { useState } from "react";
import { Download, Eye, Sparkles } from "lucide-react";
import { useLang } from "@/lib/language";
import { DashboardButton, ScoreRing, UploadZone } from "@/components/dashboard";

type GenerateResult = {
  atsScore: number;
  keywordMatch: number;
  formatting: number;
  suggestions: string[];
};

/**
 * TODO — real backend integration point.
 * Replace this with a call to your actual pipeline (upload CV + JD text,
 * get back a tailored resume, cover letter, and scoring breakdown). For
 * now it just waits a couple seconds and returns fixed mock numbers so the
 * UI has something real to render.
 */
async function generateApplicationPlaceholder(_cv: File, _jobDescription: string): Promise<GenerateResult> {
  await new Promise((resolve) => setTimeout(resolve, 2200));
  return {
    atsScore: 87,
    keywordMatch: 82,
    formatting: 94,
    suggestions: [
      "Matched 14 of 16 key requirements",
      "Added 9 role specific keywords",
      "Quantified 5 achievements",
    ],
  };
}

export default function DashboardHomePage() {
  const { t } = useLang();
  const copy = t.dashboard.generate;

  const [cvFile, setCvFile] = useState<File | null>(null);
  const [jobDescription, setJobDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState("");

  const canGenerate = !!cvFile && jobDescription.trim().length > 0 && !generating;

  async function handleGenerate() {
    setError("");
    if (!cvFile || !jobDescription.trim()) {
      setError(copy.missingFields);
      return;
    }
    setGenerating(true);
    setResult(null);
    const data = await generateApplicationPlaceholder(cvFile, jobDescription);
    setResult(data);
    setGenerating(false);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <span className="text-sm font-medium text-sky-600">{copy.eyebrow}</span>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{copy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 sm:text-base">{copy.sub}</p>
      </div>

      <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">{copy.uploadLabel}</label>
          <UploadZone
            file={cvFile}
            onFileSelect={setCvFile}
            onRemove={() => setCvFile(null)}
            label={copy.uploadLabel}
            hint={copy.uploadHint}
            parsedLabel={copy.uploadedLabel}
            removeLabel={copy.removeFile}
          />
        </div>

        <div>
          <label htmlFor="jobDescription" className="mb-2 block text-sm font-medium text-slate-700">
            {copy.jdLabel}
          </label>
          <textarea
            id="jobDescription"
            rows={7}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder={copy.jdPlaceholder}
            className="block w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-500/20"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-600">
            {error}
          </p>
        )}

        <DashboardButton
          type="button"
          size="lg"
          disabled={!canGenerate}
          onClick={handleGenerate}
          className="w-full sm:w-auto"
        >
          <Sparkles className="size-4" aria-hidden />
          {generating ? copy.generatingCta : copy.generateCta}
        </DashboardButton>
      </div>

      {result && (
        <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-lg font-semibold text-slate-900">{copy.resultsTitle}</h2>

          <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
            <ScoreRing score={result.atsScore} label={copy.atsLabel} />

            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700">{copy.keywordMatch}</span>
                  <span className="text-slate-500">{result.keywordMatch}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-sky-600" style={{ width: `${result.keywordMatch}%` }} />
                </div>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700">{copy.formatting}</span>
                  <span className="text-slate-500">{result.formatting}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-sky-600" style={{ width: `${result.formatting}%` }} />
                </div>
              </div>
            </div>
          </div>

          <div>
            <p className="mb-2.5 text-sm font-medium text-slate-700">{copy.suggestionsLabel}</p>
            <ul className="space-y-2">
              {result.suggestions.map((suggestion) => (
                <li key={suggestion} className="flex items-start gap-2.5 text-sm text-slate-600">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-sky-500" />
                  {suggestion}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[copy.resumeCardTitle, copy.coverLetterCardTitle].map((title) => (
              <div key={title} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5">
                <span className="text-sm font-medium text-slate-800">{title}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={copy.preview}
                    className="grid size-8 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-white hover:text-slate-700"
                  >
                    <Eye className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={copy.download}
                    className="grid size-8 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-white hover:text-slate-700"
                  >
                    <Download className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

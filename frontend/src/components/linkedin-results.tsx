"use client";

import React from "react";
import { ExternalLink, Info } from "lucide-react";
import type { content } from "@/lib/language";
import type { LinkedInContent } from "@/lib/supabase/linkedin";
import { CopyButton, CopyChip, CopyField, LinkedInPanel } from "@/components/linkedin-ui";

/* ========================================================================
   LINKEDIN RESULTS: the paid output.

   Laid out in the order a person actually fills LinkedIn in: Intro, About +
   Skills, Featured, Experience, Post ideas, Education & certifications,
   Projects, then the unlocked visibility playbook. Each section is numbered
   so the page works as a checklist against LinkedIn's own layout.

   Every block of text meant for LinkedIn carries its own copy button, and
   copies only that field's plain English text (see CopyField / CopyChip).
======================================================================== */

type LinkedInCopy = (typeof content)["en"]["dashboard"]["linkedin"];

/** Mirrors CONTENT_LIMITS in backend/schemas/linkedin_schema.py, used only
 *  for the "x / y characters" counters, since the backend has already clamped
 *  the values themselves. If the limits change there, change them here. */
const LINKEDIN_LIMITS = {
  headline: 220,
  about: 2600,
  experienceDescription: 2000,
} as const;

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-lg bg-[#EAF4FB] px-3 py-2 text-xs leading-relaxed text-slate-600">
      <Info className="mt-0.5 size-3.5 shrink-0 text-[#0A66C2]" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** A read-only value that isn't for pasting (a URL to click, a suggestion to
 *  read). Still direction-locked to LTR because the text is English. */
function PlainRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <span dir="ltr" className="text-left text-slate-700">
        {value}
      </span>
    </div>
  );
}

export function LinkedInResults({ data, copy }: { data: LinkedInContent; copy: LinkedInCopy }) {
  const c = copy.results;
  const { labels, notes, sections } = c;
  const copyProps = { copyLabel: c.copy, copiedLabel: c.copied };

  const hasFeatured = Boolean(data.featured && data.featured.length);
  const certs = data.education_and_certifications;
  const projects = data.projects;

  // Built as a list rather than inline JSX so the step numbers stay correct
  // when a section is skipped (Featured is absent whenever the CV had no
  // links to feature).
  const panels: { key: string; title: string; note?: string; body: React.ReactNode }[] = [];

  /* ── 1. Intro ── */
  panels.push({
    key: "intro",
    title: sections.intro,
    note: notes.intro,
    body: (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <CopyField label={labels.firstName} value={data.intro.first_name} {...copyProps} />
          <CopyField label={labels.lastName} value={data.intro.last_name} {...copyProps} />
        </div>
        <CopyField
          label={labels.headline}
          value={data.intro.headline}
          charCount={c.charCount(data.intro.headline.length, LINKEDIN_LIMITS.headline)}
          multiline
          {...copyProps}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <CopyField label={labels.currentPosition} value={data.intro.current_position} {...copyProps} />
          <CopyField label={labels.industry} value={data.intro.industry} {...copyProps} />
          <CopyField label={labels.education} value={data.intro.education} {...copyProps} />
          <CopyField label={labels.location} value={data.intro.location} {...copyProps} />
        </div>
      </div>
    ),
  });

  /* ── 2. About + the 5 skills ── */
  panels.push({
    key: "about",
    title: sections.about,
    body: (
      <div className="space-y-3">
        <CopyField
          label={labels.aboutText}
          value={data.about.text}
          charCount={c.charCount(data.about.text.length, LINKEDIN_LIMITS.about)}
          multiline
          {...copyProps}
        />
        <Note>{notes.aboutFirstLine}</Note>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{sections.skills}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">{notes.skills}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {data.about.skills.length ? (
              data.about.skills.map((skill) => <CopyChip key={skill} value={skill} {...copyProps} />)
            ) : (
              <span className="text-sm text-slate-400">{c.empty}</span>
            )}
          </div>
        </div>
      </div>
    ),
  });

  /* ── 3. Featured, omitted entirely when there's nothing to feature ── */
  if (hasFeatured) {
    panels.push({
      key: "featured",
      title: sections.featured,
      note: notes.featured,
      body: (
        <div className="space-y-3">
          {data.featured!.map((item) => (
            <div key={`${item.label}-${item.url}`} className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[#0A66C2] hover:underline"
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                  {labels.link}
                </a>
              </div>
              <p dir="ltr" className="mt-1 break-all text-left text-xs text-slate-500">
                {item.url}
              </p>
              {item.instruction && (
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.instruction}</p>
              )}
            </div>
          ))}
        </div>
      ),
    });
  }

  /* ── 4. Experience, one block per role ── */
  panels.push({
    key: "experience",
    title: sections.experience,
    note: notes.experienceNa,
    body: data.experience.length ? (
      <div className="space-y-4">
        {data.experience.map((role, index) => (
          <div key={`${role.organization}-${role.job_title}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <CopyField label={labels.jobTitle} value={role.job_title} {...copyProps} />
              <CopyField label={labels.organization} value={role.organization} {...copyProps} />
              <CopyField label={labels.location2} value={role.location} {...copyProps} />
              <CopyField label={labels.locationType} value={role.location_type} {...copyProps} />
              <CopyField label={labels.employmentType} value={role.employment_type} {...copyProps} />
              <div className="grid grid-cols-2 gap-3">
                <CopyField label={labels.startDate} value={role.start_date} {...copyProps} />
                <CopyField label={labels.endDate} value={role.end_date} {...copyProps} />
              </div>
            </div>

            <div className="mt-3">
              <CopyField
                label={labels.description}
                value={role.description}
                charCount={c.charCount(role.description.length, LINKEDIN_LIMITS.experienceDescription)}
                multiline
                {...copyProps}
              />
            </div>

            {role.highlights.length > 0 && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{labels.highlights}</p>
                <ul className="mt-2 space-y-2">
                  {role.highlights.map((line, lineIndex) => (
                    <li key={lineIndex} className="flex items-start justify-between gap-3">
                      <span dir="ltr" className="text-left text-sm leading-relaxed text-slate-700">
                        {line}
                      </span>
                      <CopyButton value={line} {...copyProps} compact />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {role.skills.length > 0 && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{labels.roleSkills}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {role.skills.map((skill) => (
                    <CopyChip key={skill} value={skill} {...copyProps} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    ) : (
      <p className="text-sm text-slate-400">{c.empty}</p>
    ),
  });

  /* ── 5. Post ideas ── */
  panels.push({
    key: "posts",
    title: sections.posts,
    note: notes.posts,
    body: (
      <div className="space-y-3">
        {data.post_ideas.map((idea, index) => (
          <div key={`${idea.title}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3.5">
            <p dir="ltr" className="text-left text-sm font-semibold text-slate-900">
              {idea.title}
            </p>
            {idea.angle && (
              <>
                <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{labels.angle}</p>
                <p dir="ltr" className="mt-0.5 text-left text-sm leading-relaxed text-slate-600">
                  {idea.angle}
                </p>
              </>
            )}
            {idea.draft_hook && (
              <div className="mt-3">
                <CopyField label={labels.hook} value={idea.draft_hook} multiline {...copyProps} />
              </div>
            )}
          </div>
        ))}
      </div>
    ),
  });

  /* ── 6. Education & certifications, typed in, not pasted ── */
  panels.push({
    key: "education",
    title: sections.education,
    note: notes.manualEntry,
    body: (
      <div className="space-y-3">
        {certs.instruction && <p className="text-sm leading-relaxed text-slate-600">{certs.instruction}</p>}

        {certs.education_entries.length > 0 && (
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3.5">
            {certs.education_entries.map((entry, index) => (
              <div key={index} className="space-y-0.5 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                <PlainRow label={labels.education} value={entry.degree || "N/A"} />
                <PlainRow label={labels.organization} value={entry.school || "N/A"} />
                <PlainRow label={labels.startDate} value={entry.dates || "N/A"} />
              </div>
            ))}
          </div>
        )}

        {certs.certifications_note && (
          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{notes.existingCerts}</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{certs.certifications_note}</p>
          </div>
        )}

        {certs.recommended_certifications.length > 0 && (
          <div className="space-y-2">
            <Note>{notes.recommendedCerts}</Note>
            {certs.recommended_certifications.map((cert, index) => (
              <div key={index} className="rounded-xl border border-dashed border-slate-300 bg-white p-3.5">
                <p dir="ltr" className="text-left text-sm font-semibold text-slate-900">
                  {cert.name}
                </p>
                {cert.issuer && <PlainRow label={labels.issuer} value={cert.issuer} />}
                {cert.why && <p className="mt-1 text-sm leading-relaxed text-slate-600">{cert.why}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    ),
  });

  /* ── 7. Projects ── */
  panels.push({
    key: "projects",
    title: sections.projects,
    note: projects.entries.length ? notes.projectEntries : undefined,
    body: (
      <div className="space-y-3">
        {projects.instruction && <p className="text-sm leading-relaxed text-slate-600">{projects.instruction}</p>}

        {projects.entries.map((project, index) => (
          <div key={`${project.name}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3.5">
            <p dir="ltr" className="text-left text-sm font-semibold text-slate-900">
              {project.name}
            </p>
            <div className="mt-2">
              <CopyField label={labels.description} value={project.description} multiline {...copyProps} />
            </div>
          </div>
        ))}

        {projects.recommended.length > 0 && (
          <div className="space-y-2">
            <Note>{notes.recommendedProjects}</Note>
            {projects.recommended.map((idea, index) => (
              <div key={`${idea.name}-${index}`} className="rounded-xl border border-dashed border-slate-300 bg-white p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p dir="ltr" className="text-left text-sm font-semibold text-slate-900">
                    {idea.name}
                  </p>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                    {labels.suggestion}
                  </span>
                </div>
                {idea.why && <p className="mt-1 text-sm leading-relaxed text-slate-600">{idea.why}</p>}
                {idea.description && (
                  <p dir="ltr" className="mt-2 text-left text-sm leading-relaxed text-slate-500">
                    {idea.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {!projects.entries.length && !projects.recommended.length && !projects.instruction && (
          <p className="text-sm text-slate-400">{c.empty}</p>
        )}
      </div>
    ),
  });

  /* ── 8. The unlocked visibility playbook ── */
  panels.push({
    key: "growth",
    title: data.growth_playbook.title || sections.growth,
    note: notes.growth,
    body: (
      <ol className="space-y-2.5">
        {data.growth_playbook.steps.map((step, index) => (
          <li key={index} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#EAF4FB] text-xs font-semibold text-[#0A66C2]">
              {index + 1}
            </span>
            <span dir="ltr" className="text-left text-sm leading-relaxed text-slate-700">
              {step}
            </span>
          </li>
        ))}
      </ol>
    ),
  });

  return (
    <div className="space-y-4">
      {panels.map((panel, index) => (
        <LinkedInPanel
          key={panel.key}
          step={index + 1}
          stepLabel={c.step(index + 1)}
          title={panel.title}
          note={panel.note}
        >
          {panel.body}
        </LinkedInPanel>
      ))}
    </div>
  );
}

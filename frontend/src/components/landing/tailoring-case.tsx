"use client";

import { useLang } from "@/lib/language";
import { Figure } from "./figure";

/* ========================================================================
   THE TAILORING ARGUMENT (brief §3.4, messaging pillar 1)

   "One CV for every job is why applications fail." The brief gives this its
   own section and places it BEFORE the feature detail, which is right: a
   reader who does not yet believe tailoring matters has no reason to care
   what the features are.

   THE VISUAL CARRIES IT, THE COPY FRAMES IT — three sentences, as specified.
   The panel shows one CV read against two postings with THE SAME SIX SKILLS
   in both columns, inverted. That inversion is the argument: nothing was
   added and nothing was deleted, the order changed, and the score changed
   with it. A list of different skills per column would have implied the
   product writes in whatever the posting asks for, which is the exact thing
   core/fact_checker.py exists to prevent.

   WHAT THIS CLAIMS IS WHAT agents/tailoring_engine.py DOES. Its prompt:
   "Reorder freely, both bullets within a section and which facts lead a
   sentence, to put the strongest, most relevant material first", and every
   bullet it emits carries a relevance_score. Re-ordering and re-weighting,
   not invention.

   RHYTHM: this is the one recessed band on the page. The sections around it
   sit on --surface-base; this drops to --surface-sunken between two
   hairlines, so the argument reads as an aside from the product tour rather
   than as another feature. No new colour, one step down the same ramp.

   NOT THE HERO'S FIXED-POSITION EXCEPTION. The hero pins its boxes to
   physical sides in both languages for reasons local to the hero. This
   section mirrors normally: in Arabic the first posting column is the
   right-hand one, which is correct, because the two columns are a sequence
   the reader moves through.
======================================================================== */

/* THE SKILLS ARE NOT IN THE DICTIONARY, and that is deliberate — they are
   tool names, identical in both languages (see utils/arabic_localizer.py,
   which keeps a widely-used tool name in its original form inside an Arabic
   phrase). Two dictionary copies of the same six Latin strings is two copies
   that can drift. The marquee's company list is held the same way.

   Note the two arrays are the same six values in opposite order, and the
   component slices the first three as "brought forward". */
const POSTINGS = [
  {
    /** Match score, not the ATS composite: two postings, two answers. */
    score: 89,
    skills: ["React", "TypeScript", "Figma", "Node.js", "PostgreSQL", "Docker"],
  },
  {
    score: 72,
    skills: ["Node.js", "PostgreSQL", "Docker", "React", "TypeScript", "Figma"],
  },
];

/** How many of each column's rows are the ones that rose. */
const LEAD_COUNT = 3;

/** Rules on paper, matching the hero's sheets rather than a second set. */
const PAPER_RULE = "#e2e2de";
const PAPER_MUTED_MARK = "#d8d8d4";

/** A skill row's mark. Filled accent when the posting pulled it forward,
 *  flat grey when it moved down. Weight and colour together, because weight
 *  alone is too quiet at this size and colour alone fails for a reader who
 *  cannot separate the two hues. */
function SkillMark({ lead }: { lead: boolean }) {
  return (
    <span
      className="block h-4 w-[3px] shrink-0 rounded-full"
      style={{ backgroundColor: lead ? "var(--accent)" : PAPER_MUTED_MARK }}
      aria-hidden
    />
  );
}

function PostingColumn({
  role,
  score,
  skills,
  matchLabel,
  delay,
}: {
  role: string;
  score: number;
  skills: string[];
  matchLabel: string;
  delay: number;
}) {
  return (
    <div className="flex flex-col px-6 py-6 sm:px-8 sm:py-7">
      <p className="t-title font-semibold" style={{ color: "var(--ink-paper)" }}>
        {role}
      </p>

      <ul className="m-0 mt-5 flex-1 list-none space-y-[0.6rem] p-0">
        {skills.map((skill, i) => {
          const lead = i < LEAD_COUNT;
          return (
            <li key={skill} className="flex items-center gap-3">
              <SkillMark lead={lead} />
              {/* <bdi> isolates the Latin tool name from the Arabic line it
                  sits in. Plain text would usually be fine for a single
                  token, but "Node.js" carries a full stop, and a neutral
                  character at the edge of a bidi run is precisely what has
                  reordered text in this product before. */}
              <bdi
                className="min-w-0 truncate text-[0.9375rem]"
                style={{
                  color: lead ? "var(--ink-paper)" : "var(--ink-paper-soft)",
                  fontWeight: lead ? 500 : 400,
                }}
              >
                {skill}
              </bdi>
            </li>
          );
        })}
      </ul>

      {/* The reading this column produced. Same construction as the hero's
          leader rules: a full-width track, a fill scaled to the value. */}
      <div className="mt-6 flex items-center gap-3 border-t pt-5" style={{ borderColor: PAPER_RULE }}>
        <span className="t-meta shrink-0 text-[0.8125rem]" style={{ color: "var(--ink-paper-soft)" }}>
          {matchLabel}
        </span>
        <span
          className="relative h-[5px] min-w-0 flex-1 overflow-hidden rounded-full"
          style={{ backgroundColor: "#e7e7e3" }}
        >
          <span
            className="leader-fill absolute inset-0 rounded-full"
            style={{
              backgroundColor: "var(--accent)",
              ["--leader-to" as string]: score / 100,
              ["--rise-delay" as string]: `${delay}s`,
            }}
          />
        </span>
        <Figure
          value={score}
          delay={delay}
          className="w-8 shrink-0 text-end text-[1.125rem] font-semibold"
          style={{ color: "var(--ink-paper)" }}
        />
      </div>
    </div>
  );
}

function ComparePanel() {
  const { t } = useLang();
  const copy = t.tailoringCase;

  return (
    <figure
      className="relative m-0 overflow-hidden rounded-[0.875rem]"
      style={{
        backgroundColor: "var(--surface-paper)",
        boxShadow:
          "0 1px 0 0 rgb(255 255 255 / 0.5) inset, 0 1px 2px 0 rgb(0 0 0 / 0.28), 0 12px 24px -10px rgb(0 0 0 / 0.4), 0 32px 64px -24px rgb(0 0 0 / 0.55)",
      }}
      aria-label={copy.alt}
    >
      {/* THE KEY LIVES IN THE HEADER BAND, ONCE. Labelling each column's two
          groups would have put four captions on a six-row panel; stated once
          as a key, the marks below need no explaining twice. */}
      <div
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b px-6 py-4 sm:px-8"
        style={{ borderColor: PAPER_RULE }}
      >
        <p className="t-meta font-semibold text-[0.8125rem]" style={{ color: "var(--ink-paper)" }}>
          {copy.panelTitle}
        </p>
        <div className="flex items-center gap-5">
          <span className="t-meta inline-flex items-center gap-2 text-[0.8125rem]" style={{ color: "var(--ink-paper-soft)" }}>
            <SkillMark lead />
            {copy.keyLead}
          </span>
          <span className="t-meta inline-flex items-center gap-2 text-[0.8125rem]" style={{ color: "var(--ink-paper-soft)" }}>
            <SkillMark lead={false} />
            {copy.keyRest}
          </span>
        </div>
      </div>

      {/* Two columns from sm up, stacked below it. The divider is a logical
          border (border-s), so it lands between the columns in both
          directions without a second rule. */}
      <div className="grid sm:grid-cols-2">
        {POSTINGS.map((posting, i) => (
          <div
            key={copy.roles[i]}
            className={i === 0 ? "" : "border-t sm:border-s sm:border-t-0"}
            style={{ borderColor: PAPER_RULE }}
          >
            <PostingColumn
              role={copy.roles[i]}
              score={posting.score}
              skills={posting.skills}
              matchLabel={copy.matchLabel}
              delay={0.2 + i * 0.15}
            />
          </div>
        ))}
      </div>
    </figure>
  );
}

export function TailoringCase() {
  const { t } = useLang();
  const copy = t.tailoringCase;

  return (
    <section
      id="why-tailoring"
      className="scroll-mt-24 border-y"
      style={{ borderColor: "var(--line-hairline)", backgroundColor: "var(--surface-sunken)" }}
    >
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        {/* Standing head, the same treatment as the marquee's and how it
            works': an accent tick and real weight. No pill, no letter-spacing
            — Arabic has neither uppercase nor tracking to spare. */}
        <div className="flex items-center gap-3">
          <span
            className="h-3.5 w-0.5 shrink-0 rounded-full"
            style={{ backgroundColor: "var(--accent)" }}
            aria-hidden
          />
          <p className="t-body font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
            {copy.label}
          </p>
        </div>

        {/* 26ch, not 22: at 22 the English headline broke to three lines with
            "thing" alone on the last one. Checked in both scripts. */}
        <h2 className="t-display-l mt-6 max-w-[26ch] font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
          {copy.title}
        </h2>
        <p className="t-body-l mt-5 max-w-[62ch]" style={{ color: "var(--ink-2)" }}>
          {copy.description}
        </p>

        <div className="mt-12 sm:mt-14">
          <ComparePanel />
        </div>

        <p className="t-meta mt-5" style={{ color: "var(--ink-3)" }}>
          {copy.footnote}
        </p>
      </div>
    </section>
  );
}

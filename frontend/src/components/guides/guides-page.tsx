"use client";

import { useRouter } from "next/navigation";
import { useLang } from "@/lib/language";
import { legalContent } from "@/lib/legal-content";
import { SiteHeader, SiteFooter } from "@/components/landing/site-chrome";
import { FinalCta } from "@/components/landing/faq-cta";

/* ========================================================================
   /guides (brief §8.2)

   ONE PAGE, TWO ENTRY POINTS. The footer's "Resume guide" and "ATS tips"
   both used to open a modal, which meant neither had a URL, neither could be
   linked or shared, and neither was reachable by a crawler — on a site whose
   whole SEO problem is that nothing but the bare URL reaches it. They are now
   two anchored sections on this route: /guides#resume-guide and
   /guides#ats-tips, so each footer link lands the reader directly on the part
   they asked for.

   THE CONTENT IS NOT NEW. Both documents already existed in
   lib/legal-content.ts and were being rendered into the modal from there.
   This reads the same source, so there is one copy of each guide rather than
   two that drift. Nothing here was written for the page.

   The section headings in the Resume Guide already carry their own numbers
   ("1. Start from the job description…") because they are a genuine sequence
   in the source text. No number is added by this component — §2.1 rules out
   numbering things that are not sequences, and inventing a second numbering
   scheme on top of an existing one would be exactly that.
======================================================================== */

type Section = { heading: string; body: string[] };

function GuideSection({
  id,
  title,
  intro,
  sections,
  first,
}: {
  id: string;
  title: string;
  intro?: string;
  sections: readonly Section[];
  first: boolean;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-28 ${first ? "" : "mt-20 border-t pt-20 sm:mt-24 sm:pt-24"}`}
      style={first ? undefined : { borderColor: "var(--line-hairline)" }}
    >
      <div className="flex items-center gap-3">
        <span
          className="h-3.5 w-0.5 shrink-0 rounded-full"
          style={{ backgroundColor: "var(--accent)" }}
          aria-hidden
        />
        <p className="t-body font-semibold tracking-tight" style={{ color: "var(--ink-1)" }}>
          {title}
        </p>
      </div>

      {intro && (
        <p className="t-body-l mt-6 max-w-[62ch]" style={{ color: "var(--ink-2)" }}>
          {intro}
        </p>
      )}

      {/* A ruled list rather than cards. Each entry is a heading and its
          paragraph at a reading measure — the page is long-form, so it is set
          like a document and not like a dashboard. */}
      <div className="mt-12">
        {sections.map((section) => (
          <article
            key={section.heading}
            className="border-t py-7 sm:py-8"
            style={{ borderColor: "var(--line-hairline)" }}
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,34fr)_minmax(0,66fr)] lg:gap-12">
              <h3 className="t-title max-w-[26ch] font-semibold" style={{ color: "var(--ink-1)" }}>
                {section.heading}
              </h3>
              <div className="min-w-0">
                {section.body.map((paragraph, i) => (
                  <p
                    key={i}
                    className={`t-body max-w-[68ch] ${i === 0 ? "" : "mt-4"}`}
                    style={{ color: "var(--ink-2)" }}
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function GuidesPage() {
  const { lang } = useLang();
  const router = useRouter();
  const docs = legalContent[lang];
  const resumeGuide = docs.resumeGuide;
  const atsTips = docs.atsTips;

  const isAr = lang === "ar";

  return (
    <>
      <SiteHeader onOpenAbout={() => router.push("/about")} />
      <main id="main">
        <div className="mx-auto max-w-6xl px-5 pb-16 pt-28 sm:px-8 sm:pt-36">
          <h1
            className="t-display-xl max-w-[18ch] font-semibold tracking-tight"
            style={{ color: "var(--ink-1)" }}
          >
            {isAr ? "دليل السيرة الذاتية وأنظمة التتبع" : "Writing a CV that gets read"}
          </h1>
          <p className="t-body-l mt-5 max-w-[58ch]" style={{ color: "var(--ink-2)" }}>
            {isAr
              ? "دليلان قصيران: كيف تُكتب سيرة ذاتية تُقرأ، وكيف تمرّ عبر أنظمة تتبّع المتقدّمين. ينطبق ما فيهما سواء استخدمت ترشيح أو لم تستخدمه."
              : "Two short guides: how to write a CV a person will actually read, and how to get it through the software that reads it first. Both apply whether or not you use Tarshih."}
          </p>

          {/* An in-page index. Two entries is a small thing to index, but it
              is what makes the two anchors visible to a reader who arrived on
              one of them from the footer and does not know the other exists. */}
          <nav
            aria-label={isAr ? "أقسام الصفحة" : "On this page"}
            className="mt-8 flex flex-wrap gap-x-6 gap-y-2"
          >
            {[
              { href: "#resume-guide", label: resumeGuide.title },
              { href: "#ats-tips", label: atsTips.title },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="t-meta rounded-[0.2rem] font-medium underline-offset-[6px] transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2"
                style={{
                  color: "var(--accent-quiet)",
                  ["--tw-ring-color" as string]: "var(--accent-quiet)",
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="mx-auto max-w-6xl px-5 pb-20 sm:px-8 sm:pb-24">
          <GuideSection
            id="resume-guide"
            title={resumeGuide.title}
            intro={resumeGuide.intro}
            sections={resumeGuide.sections}
            first
          />
          <GuideSection
            id="ats-tips"
            title={atsTips.title}
            intro={atsTips.intro}
            sections={atsTips.sections}
            first={false}
          />
        </div>

        <FinalCta surface="guides" />
      </main>
      <SiteFooter />
    </>
  );
}

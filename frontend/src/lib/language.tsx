"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
// Neutral module, not a client one — the server reads the same cookie name.
// See the note in lib/lang-cookie.ts for why it cannot live in this file.
import { LANG_COOKIE, localePath, splitLocale } from "@/lib/lang-cookie";
import { useRouter } from "next/navigation";
import {
  ADDON_CAPS,
  CREDIT_COST,
  LINKEDIN_PREMIUM_SAR,
  PACKS,
  SAR_PER_USD,
  TIERS,
  arCount,
  enCount,
} from "@/lib/pricing";

/* ========================================================================
   ARABIC COUNTED NOUNS

   Every allowance the Arabic dictionary quotes is interpolated from
   lib/pricing.ts, and Arabic changes the counted noun with the number — a
   dual form at 2, a plural at 3-10, back to a singular at 11 and up. These
   are the four forms of each noun the pricing copy counts, handed to
   arCount() so a changed allowance can't produce "٢ نقاط". Defined once
   here rather than at each call site, since the same nouns recur across the
   plan cards, the packs, the FAQ and the dashboard.
======================================================================== */
const AR_POINTS = { one: "نقطة واحدة", two: "نقطتان", few: "نقاط", many: "نقطة" };
const AR_CVS = { one: "سيرة ذاتية واحدة", two: "سيرتان ذاتيتان", few: "سير ذاتية", many: "سيرة ذاتية" };
const AR_PROFILES = { one: "ملف واحد", two: "ملفان", few: "ملفات", many: "ملفًا" };
const AR_JOBS = { one: "وظيفة واحدة", two: "وظيفتان", few: "وظائف", many: "وظيفة" };

/* ========================================================================
   CONTENT — one dictionary per language, shared by every page. Add new
   top-level keys here (e.g. `signup: {...}`) as you build more pages.
======================================================================== */
export const content = {
  en: {
    nav: {
      features: "Features",
      howItWorks: "How it works",
      pricing: "Pricing",
      linkedin: "LinkedIn",
      faq: "FAQ",
      about: "About",
      login: "Log in",
      getStarted: "Get started",
      dashboard: "Dashboard",
    },
    /* ── HERO (§3.1) ──────────────────────────────────────────────────────
       ONE PROMISE, STATED ONCE. The old headline named an outcome nobody
       can promise ("land more interviews") and the sub-line was a feature
       list. This states what the product does and what you get.

       The free line is the third messaging pillar and sits with the CTA
       because it removes the last objection before signup. It has to be
       exact: an Arabic CV costs two credits, so the free allowance yields
       fewer Arabic CVs than English ones and the copy says so rather than
       rounding in our favour. Numbers come from lib/pricing.ts. */
    hero: {
      /* THE H1 NAMES THE CATEGORY NOW. "Every job gets its own CV" was the
         better sentence and it carried none of the words anyone types into a
         search box — the page's one h1 said nothing about a CV maker, an ATS
         score or a cover letter. It names the thing and then makes the same
         promise, so the search term and the argument are in one line. */
      headline: "An AI CV maker that rewrites your CV for every job",
      sub: "Paste the job description and get a CV and cover letter written for it, in Arabic or English. Each one comes with an ATS score, the gaps behind it, and live job openings matched to your CV.",
      ctaPrimary: "Start free",
      ctaSecondary: "See how it works",
      freeLine: `${enCount(TIERS.free.credits, "credit")} free every month, no card. That is ${TIERS.free.credits} CVs in English, or one in Arabic and one in English.`,
      // Alt text. The visuals carry real information, so they get described
      // rather than labelled "product screenshot".
      scoreAlt: "An ATS score of 92, broken into skills, keywords, job title, experience and education",
      matchesAlt: "Five matched job openings, each labelled strong, partial or stretch",
    },
    /* ── HERO VISUAL 1 (§3.1) ─────────────────────────────────────────────
       Labels are the same strings the dashboard's ATS card uses, because they
       name the factors utils/ats_scorer.py actually computes. There is no
       "formatting" score anywhere in the product; an earlier version of this
       panel showed one. */
    heroScore: {
      title: "ATS Score",
      sub: "The same breakdown you get after every generation, and the weight each factor carries.",
      factors: {
        skills: "Skills",
        keywords: "Keywords",
        title: "Job title",
        experience: "Experience",
        education: "Education",
      },
      // atsBreakdown.missing_skills. A score that only ever flatters is not a
      // score, so the panel shows what the CV did not cover.
      missingLabel: "Still missing:",
      missing: ["Terraform", "GraphQL"],
    },
    heroMatches: {
      /* ── HERO VISUAL 2 (§3.1) ───────────────────────────────────────────
         Five is RESULT_CAP in agents/jobs_finder.py, not a number picked for
         the page. The subtext says "up to" because the cap is a target the
         search fills from what is genuinely posted — on a narrow role it can
         come back with fewer, and the code logs exactly that. */
      headline: "Real jobs you can apply to today",
      sub: "As soon as your CV is ready we search what is actually posted right now, and return up to five roles ranked by how well you fit. Every one opens the real listing, so you can apply in the same sitting.",
      countLabel: "live jobs matched",
      // Sits in the panel's header band and again on every row, not as a
      // closing caption. That each match opens the real posting is the feature
      // this visual exists to show.
      linkNote: "Each one opens the real posting",
      viewListing: "View listing",
      // Roles and cities only. No employer names: a mockup that pairs real
      // companies with "matched openings" implies those companies are hiring
      // through us, which is a claim we cannot make.
      items: [
        { role: "Frontend Engineer", city: "Riyadh", rank: "strong" as const },
        { role: "Product Engineer", city: "Jeddah", rank: "strong" as const },
        { role: "Full-stack Developer", city: "Riyadh", rank: "partial" as const },
        { role: "UI Engineer", city: "Remote", rank: "partial" as const },
        { role: "Engineering Lead", city: "Riyadh", rank: "stretch" as const },
      ],
      ranks: { strong: "Strong match", partial: "Partial match", stretch: "Stretch role" },
    },
    /* ── COMPANY MARQUEE (§3.2) ───────────────────────────────────────────
       THE LABEL IS NOT A HIRING CLAIM. "Land jobs at companies like" would
       assert an outcome that has not happened and imply endorsement by every
       company named. This says what is actually true: paste any posting from
       any of them and the CV is written for it.

       Names are set in type, not as logos. No official monochrome wordmark
       assets are licensed for this repo, and an unofficial logo is worse
       than type on both the legal and the design side. */
    marquee: {
      label: "Tailor your CV for roles at",
    },
    dashboardPreview: {
      urlLabel: "app.tarshih.ai / dashboard",
      sidebar: {
        dashboard: "Dashboard",
        myResumes: "My resumes",
        applications: "Applications",
        settings: "Settings",
      },
      uploadLabel: "Your CV",
      fileName: "your-resume.pdf",
      parsed: "Parsed",
      jdLabel: "Job description",
      role: "Senior Frontend Engineer · Linear",
      generate: "Generate",
      generating: "Generating",
      optimized: "Optimized",
      atsLabel: "ATS score",
      keywordMatch: "Keyword match",
      formatting: "Formatting",
      suggestionsLabel: "AI suggestions",
      improvements: [
        "Matched 14 of 16 key requirements",
        "Added 9 role specific keywords",
        "Quantified 5 achievements",
      ],
      resumeLabel: "Resume",
      coverLetterLabel: "Cover letter",
      ready: "Ready",
    },
    /* Four short claims, each of which the code actually backs. The third and
       fourth used to be "Never invents your experience" and "Reads like a
       person wrote it" — both true, but neither told a non-technical reader
       what was being promised. They now name the two things people are
       actually wary of in an AI writing tool: made-up facts, and output that
       reads like a machine wrote it. The full explanation is in trustSection
       and the FAQ; these are the headlines. */
    /* Four short claims, each of which the code actually backs. Kept SHORT on
       purpose: they sit on one line at desktop width, and a phrase that wraps
       turns a row of four into a block of eight.

       The fourth names the humanizer, which is a real, specific thing:
       core/humanizer.py is a block of "do not write like an LLM" rules spliced
       into every prompt that produces prose a person will sign their name to —
       the tailored CV, the cover letter and the LinkedIn profile. It is not a
       separate rewriting pass, and the copy does not claim one. */
    trustBar: [
      "Encrypted uploads",
      "Transparent ATS scoring",
      "Every line checked against your CV",
      "Humanizer strips AI phrasing",
    ],
    /* ── THE TAILORING ARGUMENT (§3.4, messaging pillar 1) ────────────────
       "One CV for every job is why applications fail" is the educational
       argument, and the brief gives it its own section BEFORE the feature
       detail: a reader who does not yet believe tailoring matters has no
       reason to care what the features are.

       Kept to three sentences on purpose. The panel carries the argument;
       this only has to frame it.

       WHAT IT CLAIMS IS WHAT tailoring_engine.py DOES. Its prompt says
       "Reorder freely, both bullets within a section and which facts lead a
       sentence, to put the strongest, most relevant material first", and
       every bullet carries a relevance_score. So the claim is re-ordering
       and re-weighting, not deletion, and not addition — the fact checker
       exists precisely to stop the last one. */
    tailoringCase: {
      label: "One CV, sent everywhere",
      title: "Two postings for the same job do not screen for the same thing",
      description:
        "Sent unchanged, a CV puts the same order in front of every employer, and the experience one of them is actually screening for ends up near the bottom of page two. Tarshih reads each posting and rebuilds the order around what that employer asked for. Nothing is added. It is the same record, read twice.",
      panelTitle: "One CV, read against two postings",
      // The key for the panel's two states, so neither column needs its own
      // pair of labels.
      keyLead: "brought forward",
      keyRest: "moved down",
      matchLabel: "Match",
      // Same two roles the hero's matched-openings list uses, so the page
      // reads as one continuous example rather than a set of unrelated ones.
      roles: ["Frontend Engineer", "Full-stack Developer"],
      footnote: "The same CV both times. Nothing added, nothing invented.",
      alt: "One CV read against two postings, with the same six skills ordered differently for each and a different match score",
    },
    /* ── FEATURES (§3.5) ──────────────────────────────────────────────────
       HIERARCHY, NOT A FLAT GRID. Three primary features, each with its own
       visual, then a compact secondary list. The previous version of this
       section was a six-up grid of rounded cards with an icon in a coloured
       square — the single loudest template tell in §2.1 — and one of its six
       cards advertised "6 AI agents working together", which is both an
       internal implementation detail and the wrong number (the pipeline runs
       eight).

       EVERY LINE BELOW IS TRACED TO CODE. Interview prep in particular is
       described as what agents/interview_prep.py returns — a set of likely
       questions with an answer for each — and never as practice, simulation
       or a mock interview, none of which the product does. LinkedIn and
       interview prep both carry their plan requirement in `note`, because
       core/entitlements.py caps both at zero on Free. */
    features: {
      label: "What you get",
      title: "A tailored CV, the scores behind it, and the jobs to send it to",
      description:
        "One run produces all three: the documents, the scoring that explains them, and the openings they are aimed at.",
      primary: [
        {
          lead: "A CV rewritten for the posting, and a cover letter to match",
          body: "Both are written against the job description you paste, in Arabic or English, and typeset properly in either. Every line traces back to something already in your CV.",
        },
        {
          lead: "See what is missing before a recruiter does",
          body: "An ATS score with the weighted factors behind it, a separate match score for the role, and the specific gaps that cost you the rest. Each gap comes with an honest way to close it, never a way to claim it.",
        },
        {
          lead: "Ranked openings, each one a click from the posting",
          body: "Once the CV is ready we search what is posted right now and return up to five roles, labelled by how much of what they ask for your CV already shows. Every row opens the original listing.",
        },
      ],
      secondaryTitle: "The rest of it",
      secondary: [
        {
          title: "Start without a CV",
          body: "No file to upload? Fill in a form instead and the same pipeline runs on what you entered.",
          note: "",
        },
        {
          title: "Or upgrade the one you have",
          body: "Upload a PDF or Word file. It is read as it stands, so nothing has to be retyped.",
          note: "",
        },
        {
          title: "PDF and Word",
          body: "The CV downloads as a PDF or a .docx file. The cover letter comes as a PDF.",
          note: "",
        },
        {
          title: "Every version, kept",
          body: "Each CV you generate stays in your account with its role, its scores and its files.",
          note: "",
        },
        {
          title: "LinkedIn profile content",
          body: "A headline, an About section and a paste-ready block for every role, written from a CV you tailored here. In English, because that is how recruiters search.",
          note: "Included with Pro and Elite",
        },
        {
          title: "Interview questions, answered",
          body: "The questions that specific role is likely to open with, each one with how to answer it from your own experience.",
          note: "Included with Pro and Elite",
        },
      ],
    },
    /* Panel copy for the three primary features. The specimen documents
       themselves live in the component, not here: the CV sheet is Arabic and
       the letter sheet is English in BOTH site languages, on purpose, since
       the claim being made is that the product typesets both. */
    featureDocs: {
      cvLabel: "Tailored CV",
      letterLabel: "Cover letter",
      caption: "One generation, both scripts, each set in its own direction.",
      alt: "An Arabic CV page in joined script, with an English cover letter behind it",
    },
    /* The three fields are exactly GapItem in schemas/output_schema.py:
       skill, importance ("required" | "preferred"), how_to_close. The
       how-to-close lines follow match_scorer.py's own rule — if a gap cannot
       honestly be closed, point at real experience or a truthful
       alternative, never at a way to claim the requirement is met. */
    featureGaps: {
      atsLabel: "ATS score",
      matchLabel: "Job match",
      gapsLabel: "What is missing",
      importance: { required: "Required", preferred: "Preferred" },
      items: [
        {
          skill: "Terraform",
          importance: "required" as const,
          how: "You have provisioned infrastructure by hand. Say which parts you automated, and with what.",
        },
        {
          skill: "GraphQL",
          importance: "preferred" as const,
          how: "The API layer in your second role is close enough to name. Say what it served.",
        },
        {
          skill: "Team leadership",
          importance: "required" as const,
          how: "You mentored two engineers last year. That belongs inside the role, not in a list of skills.",
        },
      ],
      alt: "An ATS score and a job match score, with three named gaps and how to close each one",
    },
    /* The labels come from t.heroMatches.ranks so they cannot drift from the
       hero's panel. Only what each one MEANS is written here — which the hero
       panel never says, so this adds to it rather than repeating it. */
    featureRanks: {
      title: "How each opening is labelled",
      meanings: {
        strong: "Your CV already shows most of what the posting asks for.",
        partial: "Part of what it asks for is in your CV, and part of it is not.",
        stretch: "Past what your CV currently shows. Listed rather than hidden from you.",
      },
      alt: "The three labels a matched opening can carry, and what each one means",
    },
    /* ── HOW IT WORKS (§3.3) ──────────────────────────────────────────────
       THREE steps, not four, and no agent count. The previous version opened
       with "Six AI agents work behind the scenes", which was wrong on the
       number (the pipeline runs eight) and wrong on the substance: how many
       agents there are is not something the reader gets.

       The description carries messaging pillar 2, the time saving, as a plain
       claim rather than a red-versus-green comparison block (§3.4). */
    howItWorks: {
      label: "How it works",
      title: "Three steps, and the work is done",
      description:
        "Tailoring a CV properly takes 30 to 45 minutes per application. Here it takes a couple of minutes, and you enter your information once rather than once per job.",
      steps: [
        {
          title: "Add your CV",
          description: "Upload a PDF or Word file. If you do not have one yet, fill in a form instead.",
        },
        {
          title: "Paste the job posting",
          description: "The whole advert. We read what the role actually asks for, in Arabic or English.",
        },
        {
          title: "Get everything you need",
          description:
            "A tailored CV and cover letter, your ATS score and what it is missing, and up to five live jobs to send it to.",
        },
      ],
    },
    /* ── TRUST ────────────────────────────────────────────────────────────
       REBUILT AROUND A DEMONSTRATION rather than three claims in three
       cards. "Nothing invented" is the single most load-bearing promise on
       this site — it is the objection every candidate has about an AI writing
       tool — and asserting it in a paragraph is the weakest possible way to
       make it. The panel shows the check running instead.

       EVERY DETAIL BELOW IS READ OUT OF core/fact_checker.py:
         · The check runs against facts_json, extracted from the uploaded CV.
         · Its own prompt draws exactly this line: renaming and reframing are
           ALLOWED ("reception work" -> "front-of-house operations" is one of
           the examples in the prompt itself); a new number, name, tool, date,
           scope, headcount or outcome is NOT.
         · MAX_RETRIES = 2, and a failed bullet is regenerated and re-checked,
           which is where "rewritten and checked again, up to twice" comes
           from. Not "reviewed" and not "flagged" — regenerated.

       The three pillars beneath it keep the data promise verbatim (it was
       already reviewed copy), replace the vague scoring sentence with the
       real weights from utils/ats_scorer.py, and name the humanizer, which
       core/humanizer.py describes as prompt-level rules rather than a second
       rewriting pass — so the copy says that rather than implying a pass. */
    trustSection: {
      label: "What it will not do",
      title: "The rewrite is checked against your own CV before you see it",
      description:
        "A model that writes well will also, given the chance, write something that is not true. That chance is taken away here: every rewritten line is read back against the facts extracted from your document, and a line that adds anything is sent back.",
      proof: {
        caption: "One line, checked",
        sourceLabel: "In your CV",
        source: "Managed the reception desk at a dental clinic.",
        allowedLabel: "Allowed",
        allowed: "Ran front-of-house operations for a dental practice.",
        allowedNote: "A better name for the same work. Nothing new is claimed.",
        rejectedLabel: "Sent back",
        rejected: "Ran front-of-house operations for a 12-chair dental practice.",
        rejectedNote: "Twelve chairs is not in your CV, so this line never reaches your document.",
        outcome: "A rejected line is rewritten and checked again, up to twice, before the CV is built.",
        alt: "A CV line, the reworded version the fact checker allows, and an invented version it sends back",
      },
      pillars: [
        {
          title: "Your documents stay yours",
          description:
            "Uploads are encrypted in transit and at rest. Tarshih never trains models on your resume or shares it with third parties, and you can delete everything permanently at any time.",
        },
        {
          title: "The score shows its working",
          description:
            "One number, and the weighted factors behind it: skills at 40 percent, keywords at 25, job title at 15, experience at 12, education at 8. Then the gaps that cost you the rest, each with an honest way to close it rather than a way to claim it.",
        },
        {
          title: "It has to read like you wrote it",
          description:
            "The same rules run on every CV, cover letter and LinkedIn profile: no dash punctuation, no \"moreover\" or \"furthermore\", no inflated significance. They are part of how the text is written rather than a second pass over it afterwards.",
        },
      ],
    },
    pricing: {
      eyebrow: "Pricing",
      title: "Simple pricing that grows with your search",
      description: "Start free and upgrade only when you need more credits. Cancel anytime.",
      creditNote: `${enCount(CREDIT_COST.en, "credit")} = 1 English CV + cover letter · ${enCount(CREDIT_COST.ar, "credit")} = 1 Arabic CV + cover letter.`,
      founderNote: {
        title: "One person, paying for every plan you see",
        body: "Tarshih is built and run solo, and every generation, on every tier, costs real AI-processing money. Free isn't just unprofitable, it's a loss covered on purpose so you can try Tarshih before paying anything. Pro and Elite subscribers are what keep the whole thing running.",
        cta: "Read the full story",
      },
      mostPopular: "Most popular",
      premiumBadgeLabel: "Premium tier",
      currencyNote: `All prices are charged in Saudi riyals. The dollar figure under each price is an approximate reference at ${SAR_PER_USD} SAR to the dollar, not a payment option.` as string | null,
      plans: [
        {
          name: "Free",
          slug: "free",
          // SAR is the amount actually charged; the dollar line shown under it
          // is a reference only, derived at the 3.75 peg in src/lib/pricing.ts
          // rather than stored a second time where it could drift.
          //
          // THERE IS NO ANCHOR PRICE FIELD ON ANY PLAN, deliberately. Every
          // listed price is the only price that plan has ever had, so there is
          // nothing to strike through. Do not reintroduce an `originalSar` or
          // a `discountLabel`: a struck-through price the product never
          // charged is a fabricated reference price, which is exactly what
          // consumer-protection rules on "was/now" pricing exist to stop.
          sar: TIERS.free.sar,
          period: "/ month",
          description: "Everything you need to try Tarshih on your next application.",
          features: [
            `${enCount(TIERS.free.credits, "credit")} / month: ${TIERS.free.credits} English CVs, or mix in Arabic`,
            "Full ATS & job match scoring",
            "Tailored CV + matching cover letter",
            "Resume history, last 10 kept",
          ],
          cta: "Get started free",
          badge: null as string | null,
          limitedOffer: null as string | null,
          featured: false,
          premium: false,
        },
        {
          name: "Pro",
          slug: "pro",
          // ONE PRICE FOR EVERY PRO SUBSCRIBER, founding or not. There is no
          // founding discount and no prior price: 29 SAR has never been
          // anything else, so nothing here may present it as reduced. See
          // the note on `originalSar` in the Free plan above.
          sar: TIERS.pro.sar,
          period: "/ month",
          description: "For active job seekers who want serious volume, every time.",
          features: [
            `${enCount(TIERS.pro.credits, "credit")} / month: ${TIERS.pro.credits} English CVs, or mix in Arabic`,
            "Tailored CV + personalized cover letter",
            "Full ATS & job match scoring",
            "Shows exactly what you're missing",
            "5 similar jobs, ranked, per application",
            "Fact-check pass on every generation",
            `LinkedIn Essential, ${ADDON_CAPS.pro.linkedinEssential} profiles / month`,
            `Interview Prep, ${ADDON_CAPS.pro.interviewPrep} jobs / month`,
            "Pro badge on your profile",
            "Resume history, last 100 kept",
            "Priority processing",
          ],
          cta: "Start Pro",
          badge: "Most Popular",
          // The founding offer is a BADGE and a scarcity claim. It is not a
          // discount, so it carries no banner price and no percentage.
          limitedOffer: "The first 50 people to subscribe to Pro keep a permanent Founding Member badge on their profile.",
          featured: true,
          premium: false,
        },
        {
          name: "Elite",
          slug: "elite",
          sar: TIERS.elite.sar,
          period: "/ month",
          description: "The premium tier for candidates who want every advantage.",
          features: [
            `${enCount(TIERS.elite.credits, "credit")} / month: ${TIERS.elite.credits} English CVs, or mix in Arabic`,
            "Tailored CV + personalized cover letter",
            "Full ATS & job match scoring",
            "Shows exactly what you're missing",
            "5 similar jobs, ranked, per application",
            "Fact-check pass on every generation",
            `LinkedIn Essential, ${ADDON_CAPS.elite.linkedinEssential} profiles / month`,
            `Interview Prep, ${ADDON_CAPS.elite.interviewPrep} jobs / month`,
            "Unlimited resume history",
            "Highest AI processing priority",
            "Exclusive Elite badge on your profile",
            "Everything included in Pro",
          ],
          cta: "Go Elite",
          badge: null as string | null,
          limitedOffer: null as string | null,
          featured: false,
          premium: true,
        },
      ],
    },
    payg: {
      eyebrow: "Pay as you go",
      title: "Pay as you go",
      description: "Perfect for users who only need a few credits, no subscription required.",
      perApp: "per credit",
      cta: "Buy pack",
      packs: [
        { name: "Starter", slug: "starter", sar: PACKS.starter.sar, creditCount: PACKS.starter.credits, credits: enCount(PACKS.starter.credits, "credit"), blurb: "A couple of applications to test the waters.", badge: null as string | null, featured: false },
        { name: "Best Value", slug: "best-value", sar: PACKS["best-value"].sar, creditCount: PACKS["best-value"].credits, credits: enCount(PACKS["best-value"].credits, "credit"), blurb: "The sweet spot for an active search.", badge: "Best Value", featured: true },
        { name: "Power", slug: "power", sar: PACKS.power.sar, creditCount: PACKS.power.credits, credits: enCount(PACKS.power.credits, "credit"), blurb: "For a serious, high volume job hunt.", badge: "Max Savings", featured: false },
      ],
    },
    /* ── /pricing (§4) ────────────────────────────────────────────────────
       PAGE FRAMING ONLY. Every plan, pack and add-on on that route reuses the
       entries that already exist above (t.pricing, t.payg, t.linkedinPromo),
       so the pricing page, the landing page and the dashboard's upgrade
       screen cannot end up quoting three different numbers. Nothing in this
       block states a figure; the ones that appear are interpolated from
       lib/pricing.ts at the point of use.

       NO PAYMENT-METHODS SECTION. The brief asks for one "once the gateway is
       live". Moyasar is not integrated, so there is nothing true to put there
       and an empty promise on a pricing page is worse than a missing one.

       FOUNDING MEMBER IS A BADGE. There is no founding price, no discount and
       no "was X SAR" anchor anywhere — see TIER_PRICING in
       backend/core/admin_stats.py, which carries the same note and is what
       the admin revenue panel prices from. */
    pricingPage: {
      label: "Pricing",
      title: "What it costs, and what a credit buys",
      description:
        "Three plans, or credits bought on their own. The free plan needs no card, and nothing renews unless you subscribe.",
      plansTitle: "Plans",
      plansBody: "Every plan runs the same pipeline. What changes is how much of it you get each month.",

      creditsTitle: "One credit, one application",
      creditsBody:
        "A credit covers one CV rewritten for a posting and the cover letter that goes with it. Arabic spends two, because an Arabic generation runs a localisation and script pass that an English one does not.",
      // Values interpolated from CREDIT_COST, never typed. The last two are
      // "included" because scoring and the job search run inside the SAME
      // generation — see core/orchestrator.py, where document_generator,
      // scoring and jobs_finder all hang off one graph — so they cost nothing
      // beyond the credit already spent.
      creditsRows: [
        { label: "CV and cover letter, in English", value: enCount(CREDIT_COST.en, "credit") },
        { label: "CV and cover letter, in Arabic", value: enCount(CREDIT_COST.ar, "credit") },
        { label: "ATS score, match score and the gap list", value: "Included" },
        { label: "Up to five matched openings, each linking to its posting", value: "Included" },
      ],

      packsTitle: "Or buy credits on their own",
      packsBody: "A one-off purchase rather than a subscription, for a search that comes in bursts.",

      foundingTitle: "Founding members",
      foundingBody:
        "The first 50 people to subscribe to Pro keep a Founding Member badge on their profile permanently. It is a badge and nothing else: the price is the ordinary Pro price, there is no founding discount, and no rate is being locked in.",

      linkedinTitle: "The LinkedIn add-on",

      faqTitle: "Questions about billing",
      // Shown under the plan a signed-in reader is already on.
      backToProduct: "See what the product does",
    },
    /* ── LinkedIn add-on, featured section on the landing page ──
       PRICES ARE REPEATED HERE as numbers because this section renders for
       signed-out visitors, and /api/v1/linkedin/overview (the normal source)
       requires a session. They must match PRICING in backend/core/linkedin.py,
       which is what actually gets charged. Two places, both stated. */
    linkedinPromo: {
      eyebrow: "LinkedIn add-on",
      title: "Your CV gets you past the filter. Your LinkedIn gets you found.",
      description:
        "Recruiters search LinkedIn before they ever open a CV. Turn a CV you have already generated here into a complete, paste-ready LinkedIn profile, or have a specialist on our team build the whole thing for you.",
      whyTitle: "Why not just ask a chatbot?",
      reasons: [
        {
          title: "It starts from a fact-checked CV",
          body: "Not from a blank chat box. It builds on the facts already extracted from your CV and put through a dedicated fact-check pass, so nothing is retyped, nothing is guessed, and nothing is invented. A chatbot only knows what you paste into it that minute.",
        },
        {
          title: "Built to LinkedIn's real field limits",
          body: "220 characters for the headline, 2,600 for About, 2,000 per role. Every field is written inside its limit and checked again after generation, so nothing arrives cut off halfway through a sentence when you paste it in.",
        },
        {
          title: "Tied to the job you tailored for",
          body: "You choose which of your tailored CVs it works from, so the headline, the About section and the skills all point at the roles you are actually applying to, instead of a generic summary of your whole career.",
        },
        {
          title: "Written to read like a professional, not a model",
          body: "The same rules that govern your CV apply here: no dash-heavy punctuation, no moreover and furthermore, no padded triples, no inflated significance. It reads like you described your own work, because it is built from what you did.",
        },
      ],
      alwaysEnglish:
        "Always written in English, whatever language your CV is in, because that is how recruiters across Saudi Arabia and the region search.",
      // ESSENTIAL IS NOT SOLD SEPARATELY. It comes with a Pro or Elite
      // subscription, so this card carries no price and its CTA goes to the
      // plans rather than to a checkout. `sar` is deliberately absent: a
      // number here would get rendered as a price by the shared card layout.
      essential: {
        name: "Essential",
        includedLabel: "Included with Pro & Elite",
        badge: "Self-directed",
        tagline: "Written for you, placed by you",
        bullets: [
          "Headline, About section and your five strongest skills",
          "A paste-ready block for every role in your experience",
          "Three post ideas from your real projects",
          "A copy button on every field",
          `${ADDON_CAPS.pro.linkedinEssential} profiles a month on Pro, ${ADDON_CAPS.elite.linkedinEssential} on Elite`,
        ],
        cta: "See plans",
      },
      premium: {
        name: "Premium",
        sar: LINKEDIN_PREMIUM_SAR,
        badge: "Fully managed",
        tagline: "Created for you by a specialist",
        bullets: [
          "Everything in Essential, generated instantly",
          "A specialist contacts you and builds the profile with you",
          "A custom cover photo designed for your profile",
          "A full review plus one round of refinements after it is live",
        ],
        cta: "Get Premium",
      },
      oneTime: "one-time",
      footnote: "One-time purchases, not subscriptions. Requires a CV generated on Tarshih, which the free plan covers.",
      seeDetails: "See full details",
    },
    faq: {
      eyebrow: "FAQ",
      title: "Questions, answered",
      description: "Everything you need to know before you start your next application.",
      // The landing page shows only these, by id, and links to /questions for
      // the rest. Chosen for impact rather than order: money, refunds, trust,
      // privacy, and what the LinkedIn add-on is. Ids are language-neutral, so
      // this list is identical in both dictionaries.
      // FIVE, which is the top of the brief's 4-5 range (§3.7). It was seven.
      // "refunds" and "linkedin-what-is-it" left for /pricing, where the rest
      // of the commerce questions now live; nothing was rewritten to make the
      // cut, these are the same entries shown verbatim.
      landing: ["credits", "need-existing-cv", "never-invents", "ai-sounding", "data-safe"],
      // The billing set, shown on /pricing under the plans. Same mechanism:
      // ids, not a slice, so reordering the master list is safe.
      pricingPage: ["credits", "no-card", "refunds", "linkedin-what-is-it", "linkedin-tiers", "linkedin-refunds"],
      seeAll: "See all questions",
      allTitle: "All questions",
      allDescription: "Everything about how Tarshih works, what it costs, and what happens to your data.",
      searchLabel: "Search questions",
      searchPlaceholder: "Search for a question…",
      searchEmpty: "Nothing matches that. Try a different word, or contact us below.",
      resultCount: (shown: number, total: number) => `${shown} of ${total} questions`,
      contactTitle: "Didn't find your answer?",
      contactBody: "Send us your question and a member of our support team will get back to you.",
      supportEmail: "support@tarshih.com",
      backToHome: "Back to home",
      // Answers that quote a price, an allowance or a cap interpolate it from
      // lib/pricing.ts rather than stating it. They used to state it, which is
      // how this FAQ came to claim Pro included 40 credits (it includes 24)
      // and that LinkedIn Essential cost 49 SAR a year after it stopped being
      // sold separately. Do not re-type a number into an answer.
      items: [
        {
          id: "ats-what-is-it",
          q: "What is an ATS and why does it matter?",
          a: "An Applicant Tracking System is software companies use to filter resumes before a human reads them. Tarshih analyzes each job description and optimizes your resume so it reads clearly for both the ATS and the recruiter behind it.",
        },
        {
          id: "arabic-quality",
          q: "Does Tarshih actually produce good Arabic CVs?",
          a: "Yes. Arabic resumes are notoriously hard to format correctly, broken letters, wrong direction, misplaced diacritics. Tarshih generates properly structured, right to left Arabic CVs and cover letters, not the jumbled output most tools produce.",
        },
        {
          id: "need-existing-cv",
          q: "Do I need an existing CV to use Tarshih?",
          a: "No. You can upload an existing resume to upgrade it, or build a brand new one from scratch. Either way, the output is tailored to the specific job you're applying for.",
        },
        {
          id: "job-matching",
          q: "How does the job matching work?",
          a: "Paste a job description and Tarshih returns 5 similar openings, each ranked Strong Match, Partial Match, or Stretch Role, so you always have more roles worth applying to.",
        },
        {
          id: "score-meaning",
          q: "What exactly does the ATS and match score tell me?",
          a: "It breaks your resume down by keyword match, skills, education, and experience against the job description, then lists exactly what's missing, a certificate, a skill, a keyword, so you know what to add.",
        },
        {
          id: "never-invents",
          q: "Will Tarshih invent experience I don't have?",
          a: "No. AI models can state things that sound plausible but aren't true, and on a CV that is the risk that matters, because it is your name on the document and you are the one who has to answer for it in the interview. Every fact is extracted from your real CV first, and every generated bullet is then checked back against those facts in a dedicated fact-check pass before you see it. Tarshih reframes and professionalizes what's true; it never fabricates.",
        },
        {
          id: "how-many-agents",
          q: "How many AI agents are working on my application?",
          a: "Eight stages run on every application, each handled by its own step rather than one prompt trying to do everything at once: CV parsing, job description analysis, tailoring, fact-checking, ATS scoring, cover letter writing, match scoring, and job search. You can watch them run while your CV generates. ATS scoring itself is deterministic code rather than a model.",
        },
        {
          id: "credits",
          q: "What's a credit and how many do I get?",
          a: `A credit is what you spend generating one tailored CV and cover letter. English applications cost ${enCount(CREDIT_COST.en, "credit")}, Arabic applications cost ${CREDIT_COST.ar}, since they take more processing. Free includes ${enCount(TIERS.free.credits, "credit")} a month, Pro includes ${TIERS.pro.credits}, and Elite includes ${TIERS.elite.credits}.`,
        },
        {
          id: "sounds-like-me",
          q: "Will my resume still sound like me?",
          a: "Yes. Tarshih enhances and reframes your real experience; it never invents jobs or credentials. You can review and edit every suggestion before you export.",
        },
        {
          id: "file-formats",
          q: "What file formats can I upload and download?",
          a: "You can upload PDF or DOCX files, and export your optimized resume and cover letter in either format, ready to submit anywhere.",
        },
        {
          id: "data-safe",
          q: "Is my personal data safe?",
          a: "Your documents are encrypted in transit and at rest. We never sell your data or use it to train models, and you can permanently delete your files at any time.",
        },
        {
          id: "no-card",
          q: "Do I need a credit card to start?",
          a: "No. The Free plan is available forever with no card required. Upgrade to Pro or Elite only when you want more credits each month.",
        },
        {
          id: "refunds",
          q: "Can I get a refund?",
          a: "Once a credit has been used, that charge is final, because the document is delivered the moment it's generated. If a technical failure on our side takes a credit without producing anything, email support and we'll restore the credit or refund that specific charge. Subscriptions can be cancelled any time and stay active until the end of the cycle you've already paid for.",
        },
        {
          id: "ai-sounding",
          q: "Will it be obvious that AI wrote it?",
          a: "It shouldn't be. Every generation follows an explicit set of rules against the habits that give AI writing away: dash-heavy punctuation, signposting words like moreover and furthermore, inflated phrases such as plays a vital role, padded lists of three adjectives, and the uniform sentence rhythm people notice without being able to name it. What comes out reads like a competent professional describing their own work, which is what it's built from.",
        },
        {
          id: "linkedin-what-is-it",
          q: "What is the LinkedIn add-on?",
          a: `It turns a CV you've already generated here into ready-to-paste LinkedIn content: a headline, an About section, your five strongest skills, a block for every role in your experience, three post ideas drawn from your real projects, and clear instructions for the sections LinkedIn makes you type in directly. Essential comes with the Pro and Elite plans, ${ADDON_CAPS.pro.linkedinEssential} profiles a month on Pro and ${ADDON_CAPS.elite.linkedinEssential} on Elite. It's written in English whatever language your CV is in, because that's how recruiters across the region search.`,
        },
        {
          id: "linkedin-tiers",
          q: "What is the difference between LinkedIn Essential and Premium?",
          a: `Essential is included with the Pro and Elite plans rather than sold separately. It gives you the finished content and you place it on your profile yourself, delivered the moment you generate it: ${ADDON_CAPS.pro.linkedinEssential} profiles a month on Pro, ${ADDON_CAPS.elite.linkedinEssential} on Elite. Premium, ${LINKEDIN_PREMIUM_SAR} SAR, is a separate one-time purchase that includes all of that and adds a specialist from our team who contacts you directly, builds and optimizes your whole profile with you, designs a custom cover photo, and reviews it once it's live.`,
        },
        {
          id: "linkedin-refunds",
          q: "Can I get a refund on the LinkedIn add-on?",
          a: "Essential isn't bought separately, so there's nothing to refund on it: it comes with a Pro or Elite subscription, and those can be cancelled any time and stay active to the end of the cycle you've already paid for. Premium is a one-time purchase and is refundable in full any time before your specialist begins work. Once the build has started it isn't, because the content has been delivered and the service is already under way.",
        },
      ],
    },
    finalCta: {
      title: "Your next application deserves better odds",
      description:
        "Try Tarshih on your next role in under five minutes. Free to start, no credit card, no commitment.",
      ctaPrimary: "Get started free",
      ctaSecondary: "See how it works",
      // The one price on the landing page now that pricing has its own route
      // (§4). The figure is passed in already formatted, from lib/pricing.ts,
      // so this string can never carry a stale number.
      priceLine: (proPrice: string) => `Free to start · Pro from ${proPrice} a month`,
    },
    footer: {
      description:
        "Tarshih helps you turn any job description into an ATS optimized resume and a tailored cover letter, in seconds.",
      columns: [
        {
          title: "Product",
          links: [
            { label: "Features", href: "/#features", doc: null as string | null },
            { label: "Pricing", href: "/pricing", doc: null as string | null },
            { label: "How it works", href: "/#how-it-works", doc: null as string | null },
          ],
        },
        {
          title: "Resources",
          links: [
            { label: "Resume guide", href: "/guides#resume-guide", doc: null as string | null },
            { label: "ATS tips", href: "/guides#ats-tips", doc: null as string | null },
          ],
        },
        {
          title: "Company",
          links: [
            { label: "About", href: "/about", doc: null as string | null },
            { label: "Contact", href: "#", doc: "contact" },
          ],
        },
      ],
      rights: (year: number) => `© ${year} Tarshih. All rights reserved.`,
      terms: "Terms & Conditions",
      privacy: "Privacy",
      security: "Security",
      returnPolicy: "Refund & Exchange Policy",
    },
    brandPanel: {
      headline: "Every application, sharper than the last.",
      sub: "Sign in to keep tailoring resumes and cover letters that actually get read.",
      points: [
        "Encrypted uploads, always",
        "Transparent ATS scoring",
        "Never invents your experience",
      ],
    },
    form: {
      eyebrow: "Welcome back",
      title: "Log in to Tarshih",
      sub: "Pick up where you left off with your applications.",
      googleCta: "Continue with Google",
      dividerLabel: "or log in with email",
      usernameLabel: "Email or username",
      usernamePlaceholder: "you@example.com",
      passwordLabel: "Password",
      passwordPlaceholder: "Enter your password",
      forgot: "Forgot password?",
      submit: "Log in",
      submitting: "Logging in…",
      noAccount: "Don't have an account?",
      signup: "Sign up for free",
      terms: "By continuing, you agree to Tarshih's",
      termsLink: "Terms",
      and: "and",
      privacyLink: "Privacy Policy",
      showPassword: "Show password",
      hidePassword: "Hide password",
      missingFields: "Please enter your email/username and password.",
      invalidCredentials: "Incorrect email or password.",
      // Shown when the login route's rate limiter rejects an attempt. Kept
      // vague about which limit was hit (IP or account) so it gives an
      // attacker nothing to calibrate against.
      tooManyAttempts: "Too many sign-in attempts. Please wait a few minutes and try again.",
      oauthError: "Something went wrong with Google sign-in. Please try again.",
      backToHome: "Back to home",
    },
    forgotPassword: {
      backToLogin: "Back to login",
      eyebrow: "Reset your password",
      title: "Forgot your password?",
      sub: "Enter the email on your account and we'll send you a link to reset it.",
      emailLabel: "Email",
      emailPlaceholder: "you@example.com",
      submit: "Send reset link",
      submitting: "Sending...",
      missingEmail: "Enter your email address.",
      invalidEmail: "Enter a valid email address.",
      genericError: "Something went wrong. Please try again.",
      expiredLink: "That reset link expired or was already used. Enter your email to get a new one.",
      successTitle: "Check your inbox",
      successBody: (email: string) =>
        `We've sent a password reset link to ${email}. It'll expire shortly, so use it soon.`,
      resend: "Didn't get it? Send again",
      rememberPassword: "Remember your password?",
      login: "Log in",
    },
    resetPassword: {
      eyebrow: "Almost done",
      title: "Set a new password",
      sub: "Choose a new password for your account.",
      passwordLabel: "New password",
      confirmLabel: "Confirm new password",
      placeholder: "••••••••",
      showPassword: "Show password",
      hidePassword: "Hide password",
      submit: "Update password",
      submitting: "Updating...",
      missingFields: "Fill in both fields.",
      tooShort: "Password must be at least 8 characters.",
      breached: "This password has appeared in a known data breach. Please choose a different one.",
      mismatch: "Passwords don't match.",
      samePassword: "Your new password must be different from your current one.",
      weakPassword: "That password is too easy to guess. Try adding numbers, symbols, or uppercase letters.",
      sessionExpired: "Your reset link expired. Request a new one and try again.",
      rateLimited: "Too many attempts. Wait a moment, then try again.",
      genericError: "Something went wrong. Please try again.",
      successTitle: "Password updated",
      successBody: "Your password has been changed. You can now log in with it.",
      goToDashboard: "Continue to dashboard",
      invalidLinkTitle: "This link isn't valid",
      invalidLinkBody:
        "This password reset link is invalid or has expired. Request a new one to continue.",
      requestNewLink: "Request a new link",
    },
    signup: {
      brandPanel: {
        headline: "Every application, sharper than the last.",
        sub: "Create your account and start tailoring resumes and cover letters that actually get read.",
        points: [
          "Encrypted uploads, always",
          "Transparent ATS scoring",
          "Never invents your experience",
        ],
      },
      eyebrow: "Start free",
      title: "Create your Tarshih account",
      sub: "Set up your account to start tailoring applications in minutes.",
      googleCta: "Continue with Google",
      dividerLabel: "or sign up with email",
      // Two script-specific name fields. We never transliterate a name
      // between scripts — the same name has several valid Arabic spellings
      // and only its owner knows which is theirs.
      nameEnLabel: "Name (English)",
      nameArLabel: "Name (Arabic)",
      // No in-field placeholders on purpose — the labels plus nameHelp
      // below already say what each field is for, and an example name adds
      // nothing (same reasoning as the Settings name fields).
      nameHelp: "Fill in at least one. We use each exactly as you write it, and never translate your name.",
      emailLabel: "Email address",
      emailPlaceholder: "you@example.com",
      passwordLabel: "Password",
      passwordPlaceholder: "Create a password",
      confirmPasswordLabel: "Confirm password",
      confirmPasswordPlaceholder: "Re-enter your password",
      termsPrefix: "I agree to Tarshih's",
      submit: "Create account",
      submitting: "Creating account…",
      alreadyHaveAccount: "Already have an account?",
      loginLink: "Log in",
      changePlan: "Change plan",
      planLabel: (planName: string) => `You selected: ${planName} Plan`,
      showPassword: "Show password",
      hidePassword: "Hide password",
      errors: {
        missingFields: "Please fill in all required fields.",
        invalidEmail: "Please enter a valid email address.",
        // Matches the 8-character floor already enforced on the reset-password
        // and settings forms. Signup had no length check at all, so an account
        // could be created with a password its owner could not later re-set.
        passwordTooShort: "Password must be at least 8 characters.",
        // Deliberately says the password appeared in a breach elsewhere, not
        // that Tarshih was breached, and does not name a count — a number
        // invites arguing with it rather than picking another password.
        passwordBreached: "This password has appeared in a known data breach. Please choose a different one.",
        passwordMismatch: "Passwords do not match.",
        termsRequired: "You must agree to the Terms and Privacy Policy to continue.",
        signupFailed: "Something went wrong creating your account. Please try again.",
        oauthError: "Something went wrong with Google sign-in. Please try again.",
      },
      checkEmailTitle: "Check your inbox",
      checkEmailBody: "We've sent a confirmation link to your email. Click it to finish creating your account.",
    },
    dashboard: {
      sidebar: {
        dashboard: "Dashboard",
        myResumes: "My Resumes",
        // Directly under My Resumes: it's the next thing you do with a CV
        // you've already made, and it reads as part of that flow.
        interview: "Interview Prep",
        // Standalone job search — no CV needed, so it sits ABOVE the
        // CV-derived features rather than in that chain.
        jobSearch: "Job Search",
        // Sits between My Resumes and Settings — the LinkedIn add-on is
        // something you do AFTER making a CV, so it reads in that order.
        linkedin: "LinkedIn",
        settings: "Settings",
        admin: "Admin",
        logout: "Log out",
      },
      generate: {
        eyebrow: "New application",
        title: "Tailor a resume for your next role",
        sub: "Build a new CV or upload your existing one, paste the job description, and let Tarshih handle the rest. Everything is written from your real experience, in language that reads like a professional wrote it.",
        uploadLabel: "Your CV",
        uploadHint: "Drag and drop a PDF or DOCX, or click to browse",
        uploadedLabel: "Parsed",
        removeFile: "Remove file",
        jdLabel: "Job description",
        jdPlaceholder: "Paste the full job posting here...",
        // A title on its own is enough: the backend sources real current
        // postings for that title and builds a representative description
        // from them before tailoring (see agents/jd_analyzer.py). Says what
        // the user gets, not how it works.
        jdHint: "No posting to hand? Enter just the job title and we'll build the description from current listings for that role.",
        generateCta: "Generate",
        generatingCta: "Generating…",
        resultsTitle: "Your tailored application",
        atsLabel: "ATS match score",
        keywordMatch: "Keyword match",
        formatting: "Formatting",
        suggestionsLabel: "AI suggestions",
        resumeCardTitle: "Tailored resume",
        coverLetterCardTitle: "Cover letter",
        downloadCv: "Download CV",
        downloadCoverLetter: "Download Cover Letter",
        preview: "Preview",
        missingFields: "Upload a CV and paste a job description to generate.",
        // Shown when the profile is missing the name for the requested
        // output language. We ask instead of transliterating — a name has
        // several valid spellings in another script and getting it wrong
        // puts the wrong name on someone's CV.
        namePrompt: {
          titleAr: "What's your name in Arabic?",
          titleEn: "What's your name in English?",
          bodyAr:
            "Your Arabic CV will show this name exactly as you type it. We don't translate names automatically, because the same name can be spelled several valid ways and only you know which is yours.",
          bodyEn:
            "Your English CV will show this name exactly as you type it. We don't translate names automatically, because only you know the spelling you use.",
          suggested: "Found on your CV, edit if it isn't right.",
          saveAndGenerate: "Save and generate",
          skip: "Generate without it",
          skipHint: "We'll convert your existing name automatically, which may spell it differently than you do.",
          error: "Couldn't save your name. Please try again.",
        },
        progress: {
          title: "Preparing your application",
          agentLabel: (n: number) => `Agent ${n}`,
          steps: {
            cvParse: "Reading your CV",
            jdAnalyze: "Analyzing the job description",
            tailor: "Tailoring your experience",
            factCheck: "Verifying accuracy",
            atsScore: "Scoring ATS match",
            coverLetter: "Writing your cover letter",
            matchScore: "Calculating job match",
            similarJobs: "Finding similar roles",
          },
        },
      },
      resumes: {
        title: "My Resumes",
        sub: "Every tailored version you've generated, in one place.",
        columns: {
          role: "Role",
          company: "Company",
          date: "Date",
          language: "Language",
          score: "ATS score",
          match: "Job match",
          download: "Download",
        },
        emptyTitle: "No resumes yet",
        emptyBody: "Generate your first tailored resume from the Dashboard to see it here.",
        emptyCta: "Go to Dashboard",
        languageBadge: { en: "English", ar: "Arabic" },
        untitledRole: "Untitled role",
        unknownCompany: "Unknown company",
        viewDetails: "View details",
        hideDetails: "Hide details",
        loading: "Loading your resumes…",
        loadError: "Couldn't load your resumes. Please try again.",
        fileUnavailable: "File not available",
        matchReasonLabel: "Why this match",
        recommendationLabel: "Overall recommendation",
        factCheckPassed: "Fact-check passed",
        factCheckFlagged: "Fact-check flagged issues",
        // Jobs found for this resume when it was generated. Re-read from the
        // saved row — no search runs when the history page is opened — so
        // the wording says "when this resume was generated", not "open now":
        // a listing found weeks ago may well have closed since.
        jobsTitle: "Jobs found for this resume",
        jobsSub: "Found when this resume was generated. Older listings may have closed since.",
        jobsCount: (n: number) => (n === 1 ? "1 job" : `${n} jobs`),
        jobsEmpty: "No job matches were saved with this resume.",
        jobsOpen: "Open listing",
      },

      /* ── JOB SEARCH (/dashboard/job-search) ───────────────────────────
         Pro and Elite. Standalone: a job title and nothing else, no CV and
         no job description. Free users get the page blurred behind an
         upgrade panel, same treatment as Interview Prep. */
      jobSearch: {
        eyebrow: "Pro and Elite",
        title: "Job Search",
        sub: "Search live openings by job title. No CV or job description needed.",
        titleLabel: "Job title",
        titlePlaceholder: "IT Technician",
        kindLabel: "Looking for",
        kindJobs: "Jobs",
        kindInternships: "Internships",
        locationLabel: "Location",
        locationPlaceholder: "Riyadh, Saudi Arabia",
        locationHint: "Leave blank to use the location saved in your settings.",
        searchCta: "Search",
        searching: "Searching live listings…",
        exactHeading: (title: string) => `Openings for ${title}`,
        relatedHeading: "Related roles",
        relatedSub: "Shown once the closest matches ran out. These are adjacent roles, not exact matches for what you searched.",
        resultCount: (n: number) => (n === 1 ? "1 result" : `${n} results`),
        emptyTitle: "No live openings found",
        emptyBody: "Nothing matching that title is currently open from the sources we check. Try a broader title, or search again in a few days.",
        errors: {
          missingTitle: "Enter a job title to search for.",
          titleTooLong: "That looks like a job description. Enter just the job title.",
          search: "Job search is temporarily unavailable. Please try again shortly.",
          upgradeRequired: "Job Search is available on the Pro and Elite plans.",
        },
        locked: {
          badge: "Pro and Elite",
          title: "Search jobs without a CV",
          body: "Enter a job title and get current openings from Saudi government platforms, the major boards, and companies' own careers pages. Upgrade to search.",
          cta: "See plans",
        },
      },

      /* ── INTERVIEW PREP (/dashboard/interview) ────────────────────────
         Pro and Elite only. Free users get this page rendered and blurred
         behind an upgrade panel rather than a redirect, so they can see
         what they'd be buying.

         The QUESTIONS themselves are generated in the CV's language, not
         the site's — an Arabic CV means an Arabic interview. Everything
         below is interface copy and follows the site toggle as usual. */
      interview: {
        eyebrow: "Pro and Elite",
        title: "Interview Prep",
        sub: "Pick a CV you've already tailored here and get the questions that job is likely to open with, each one answered from your own experience.",

        locked: {
          title: "Upgrade to Pro or Elite to unlock Interview Prep",
          body: "Interview Prep turns a CV you've already tailored into the questions that role will actually ask, with an answer for each one built from your real projects and experience. It's included on both paid plans.",
          cta: "See plans",
          badge: "Locked",
        },

        picker: {
          title: "Choose a CV to get started",
          sub: "We prepare from the job description this CV was tailored against, so the questions are for that specific role.",
          eligibleTag: "Ready",
          preparedTag: "Prepared",
          openCta: "Open your questions",
          openingCta: "Opening…",
          preparedOn: (date: string) => `Prepared ${date}`,
          selectCta: "Prepare questions",
          loading: "Loading your CVs…",
          emptyTitle: "No CVs yet",
          emptyBody: "Tailor a CV against a job description first, and it'll show up here ready to prepare from.",
          emptyCta: "Tailor a CV",
          noneEligibleTitle: "None of your CVs can be used yet",
          noneEligibleBody:
            "Interview Prep needs a CV that was tailored against a full job description. Generate a new one and it'll appear here.",
          // Why a specific card is disabled. Both are permanent for that CV,
          // so the card is greyed out rather than allowed to fail on click.
          reasons: {
            no_jd: "No job description saved with this CV",
            no_snapshot: "Saved before we stored the data this needs",
          },
          hiddenCount: (n: number) =>
            n === 1
              ? "1 CV can't be used for this, shown greyed out below."
              : `${n} CVs can't be used for this, shown greyed out below.`,
        },

        generating: {
          title: "Preparing your questions",
          // Honest about the wait, and measured rather than guessed: the two
          // halves run concurrently, which puts a real run at roughly two
          // minutes in English and three in Arabic.
          body: "Reading the job description against your CV and writing an answer for each question. This takes a couple of minutes, so keep this page open.",
          // THESE ARE THE PHASES THE BACKEND ACTUALLY REPORTS, keyed by the
          // step names it emits (see on_step in agents/interview_prep.py).
          // They are not a padded list on a timer: each one lights up when
          // the server says it has genuinely started. "localize" only ever
          // fires on an Arabic CV, so it is absent from an English run.
          steps: {
            prepare: "Re-reading this job against your CV",
            generate: "Writing your questions and answers",
            localize: "Putting it all into Arabic",
          },
        },

        results: {
          backToCvs: "Choose another CV",
          regenerate: "Generate again",
          regenerateWithCount: (left: number, total: number) =>
            `Generate again (${left} of ${total} left this month)`,
          regenerateNoneLeft: (total: number) =>
            `You have used all ${total} generations this month`,
          savedNote: "Saved. You can leave this page and come back to it without generating again.",
          // The "progress feel" line at the top of the results.
          prepared: (n: number) => `${n} questions prepared`,
          forRole: "For",
          atCompany: "at",
          overviewLabel: "What this interview turns on",
          // Written in the CV's language, which may differ from the site's.
          languageNote: {
            ar: "These questions are in Arabic, matching the CV you picked.",
            en: "These questions are in English, matching the CV you picked.",
          },
          filterAll: "All",
          countLabel: (n: number) => `${n}`,
          emptyFilter: "No questions in this category.",
          expandAll: "Expand all",
          collapseAll: "Collapse all",
          // Inside a card.
          whyAsked: "Why they'd ask this",
          fromPosting: "From the posting",
          answerAngle: "How to approach it",
          starLabel: "Your answer, from your CV",
          starSummaryLabel: "Quick summary",
          star: {
            situation: "Situation",
            task: "Task",
            action: "Action",
            result: "Result",
          },
          evidenceLabel: "Built from",
          gapHonesty: "The honest way to answer this",
          gapHonestyNote:
            "This is a real gap in your CV for this role. Say so plainly and point at the closest thing you have actually done. Never claim the requirement is met.",
          starEmpty:
            "Your CV doesn't have a matching example for this one, so there's nothing to build a STAR answer from. Use the approach above.",
        },

        categories: {
          behavioral: "Behavioral",
          technical: "Technical",
          role_specific: "Role-specific",
          gap: "Gap",
        },

        errors: {
          load: "We couldn't load your CVs. Please try again.",
          upgradeRequired: "Interview Prep is available on the Pro and Elite plans.",
          no_jd: "This CV has no job description saved with it, so there's nothing to prepare against.",
          no_snapshot:
            "This CV was saved before we started storing the data this needs. Generate a newer CV and prepare from that one.",
          generationFailed:
            "Something went wrong preparing your questions. Nothing was charged, so please try again.",
          monthlyLimit: "You have used all of this month's interview preps. Your allowance resets with your credits.",
          retry: "Try again",
        },
      },
      settings: {
        title: "Settings",
        sub: "Manage your account and preferences.",
        accountSection: "Account",
        nameEnLabel: "Name (English)",
        nameArLabel: "Name (Arabic)",
        // No placeholder here on purpose — nameHelp already explains what
        // the field is for, and an example name adds nothing.
        nameHelp: "Used exactly as written on your generated CV. English CVs use the English name, Arabic CVs use the Arabic one. We never translate your name.",
        nameSave: "Save name",
        nameSaved: "Saved.",
        nameAtLeastOne: "Enter your name in at least one language.",
        emailLabel: "Email",
        passwordSection: "Password",
        changePassword: "Change password",
        planSection: "Subscription",
        planLabel: "Current plan",
        changePlan: "Change plan",
        languageSection: "Language",
        languageLabel: "Preferred language",
        languageSaved: "Saved. This applies on any device you log in from.",
      },
      /* ── LinkedIn add-on (/dashboard/linkedin) ──────────────────────────
         UI copy follows the language toggle like everything else. The
         GENERATED content it wraps is always English, by design: see
         englishOnlyNote and the language rule in
         backend/agents/linkedin_generator.py.

         TIER NAMES ARE DISPLAY ONLY. The wire/database values stay
         'normal' | 'premium' (see PRICING in backend/core/linkedin.py and the
         CHECK constraint in 008_linkedin_addon.sql); "Essential" is what a
         customer reads. Renaming the label costs nothing, renaming the enum
         would mean migrating live purchase rows. */
      linkedin: {
        eyebrow: "One-time add-on",
        title: "Your LinkedIn profile, written from your CV",
        sub: "Turn a CV you have already created on Tarshih into LinkedIn content you can paste in directly, or have a specialist on our team build the entire profile for you.",
        englishOnlyNote:
          "Your LinkedIn content is written in English regardless of the language of your CV. This is deliberate. Professionals across Saudi Arabia and the wider region keep their profiles in English because that is how recruiters search, so an English profile reaches considerably more of them.",

        explainer: {
          title: "Two ways to do this",
          body: "One tier hands you the finished words to place yourself. The other places them for you.",

          normalTitle: "Essential",
          normalSubtitle: "Written for you. Placed by you.",
          normalBestFor:
            "For professionals who are comfortable updating their own profile and want the writing handled properly.",
          normalItems: [
            "A headline, an About section, and your five strongest skills, written from your CV",
            "A ready to paste block for every role in your experience",
            "Three post ideas drawn from your real projects and achievements",
            "Precise instructions for your Featured, Education, Certifications, and Projects sections",
            "A copy button on every field, so nothing is retyped",
            "Delivered instantly and kept in your account for whenever you need it",
          ],

          premiumTitle: "Premium",
          premiumSubtitle: "Created for you, end to end, by a specialist on our team.",
          premiumBestFor:
            "For senior professionals and executives who would rather hand the whole thing over and be presented with a finished profile.",
          premiumItems: [
            "Everything in Essential, generated instantly",
            "A specialist from our team contacts you directly on WhatsApp or by phone",
            "We create your complete LinkedIn profile for you, section by section",
            "Your headline, About section, experience, and skills written, placed, and optimized for recruiter search",
            "A custom cover photo designed for your profile by our team, matched to your field",
            "A full review of the finished profile, plus one round of refinements",
            "Direct access to the specialist handling your profile until it is complete",
          ],
        },

        refundNote: {
          title: "Before you pay",
          oneTime: "This is a one-time purchase, not a subscription. Nothing renews and nothing is charged again.",
          normal:
            "Essential is delivered the moment you generate it, so it cannot be refunded once your content exists. If you have paid and have not generated yet, write to us and we will refund it in full.",
          premium:
            "Premium is refundable in full at any time before your specialist begins work. Once the build has started the fee is no longer refundable, as the content has been delivered and the service is already under way.",
          contact: "For anything at all, write to support@tarshih.com.",
          policyLink: "Read the full refund policy",
        },

        /* ESSENTIAL, AS AN ENTITLEMENT RATHER THAN A PRODUCT. It comes with
           Pro and Elite and is capped monthly, so this block has no price
           and no buy copy: it states what the subscription includes and how
           much of this month is left. */
        included: {
          name: "Essential",
          subtitle: "Written for you. Placed by you.",
          includedLabel: "Included",
          includedWith: "Included with Pro & Elite",
          bestFor:
            "Turn any CV you have tailored here into a complete, paste-ready LinkedIn profile. No extra charge, it is part of your plan.",
          features: [
            "A headline, an About section, and your five strongest skills",
            "A ready to paste block for every role in your experience",
            "Three post ideas drawn from your real projects",
            "Five skills to tag on each of your projects",
            "A copy button on every field",
          ],
          cta: "Generate a LinkedIn profile",
          remaining: (left: number, total: number) => `${left} of ${total} left this month`,
          usedUp: (total: number) =>
            `You have used all ${total} of this month's LinkedIn profiles. Your allowance resets with your credits.`,
          lockedTitle: "Included with Pro and Elite",
          lockedBody: `Subscribe to generate LinkedIn profiles from your CVs: ${ADDON_CAPS.pro.linkedinEssential} a month on Pro, ${ADDON_CAPS.elite.linkedinEssential} a month on Elite.`,
          lockedCta: "See plans",
        },

        tiers: {
          sectionTitle: "Choose your tier",
          oneTime: "one-time",
          included: "What is included",
          or: "or",
          normalName: "Essential",
          normalTagline: "Written for you, placed by you",
          normalBadge: "Self-directed",
          // Sits where Premium shows its price. Essential has none.
          normalIncluded: "Free with Pro or Elite",
          normalCta: "Choose Essential",
          premiumName: "Premium",
          premiumTagline: "Created for you by a specialist",
          premiumBadge: "Fully managed",
          premiumCta: "Choose Premium",
          premiumScarcity:
            "Every Premium profile is built by hand, so we take only a limited number each week.",
          seeOnPlans: "View this on the plans page",
        },

        teaser: {
          heading: "Reach 500+ connections and post consistently to stay visible to recruiters",
          locked: "Unlocks after purchase",
          body: "The full playbook, covering exactly who to connect with in your field, a posting cadence you can realistically keep, and the recruiter visibility settings most people never switch on, is delivered with your content.",
        },

        needCv: {
          title: "Create a CV first, it is free",
          body: "This add-on is written from a CV you have generated on Tarshih, so there is nothing to build from yet. The free plan includes three CVs a month, which is all you need to unlock this.",
          cta: "Create a free CV",
        },

        cvSelector: {
          title: "Which CV should we build from?",
          sub: "We use the verified facts from a CV you have already generated here. Nothing is invented, and you do not need to enter anything again.",
          empty: "You will need a generated CV first, as that is where the facts come from.",
          emptyCta: "Generate a CV",
          // Shown when every CV on the account predates structured storage, so
          // there is nothing selectable. Says what to do rather than listing
          // each unusable CV as a dead row.
          allLegacy: (count: number) =>
            count === 1
              ? "Your CV was created before we started storing the structured data this add-on needs."
              : `All ${count} of your CVs were created before we started storing the structured data this add-on needs.`,
          allLegacyWhy:
            "Generating one new CV fixes it, and the free plan covers it. The new CV keeps everything the old one had, plus the underlying facts we build your LinkedIn profile from.",
          hiddenLegacy: (count: number) =>
            count === 1
              ? "1 older CV is not shown here, as it was saved before the structured data this needs."
              : `${count} older CVs are not shown here, as they were saved before the structured data this needs.`,
          unsupported: "Saved before structured data was stored, so it cannot be used here",
          atsLabel: "ATS",
          matchLabel: "Job match",
          langEn: "English",
          langAr: "Arabic",
          untitled: "Untitled role",
          unknownCompany: "Unknown company",
          continue: "Continue to checkout",
          selectFirst: "Select a CV to continue.",
          loading: "Loading your CVs…",
          changeCv: "Change CV",
        },

        checkout: {
          title: "Checkout",
          sub: "A single payment. No subscription.",
          orderTitle: "Your order",
          tierLabel: "Tier",
          cvLabel: "Based on",
          totalLabel: "Total",
          contactTitle: "How your specialist reaches you",
          phoneLabel: "Phone number (WhatsApp)",
          phonePlaceholder: "05X XXX XXXX",
          phoneHint: "Premium is delivered personally, so we need a number to reach you on.",
          consentLabel: "I agree to be contacted on WhatsApp or by phone regarding this order.",
          payCta: (amount: string) => `Pay ${amount}`,
          paying: "Starting payment…",
          comingSoonTitle: "Online payment is almost ready",
          comingSoonBody:
            "We are completing the payment setup with our provider. This page will take payment as soon as that is live, and nothing has been charged.",
          comingSoonCta: "Back to LinkedIn",
          mockNotice: "Test mode. This payment is simulated and no money is taken.",
          back: "Back",
          paidTitle: "Payment received",
          paidBody: "You can generate your LinkedIn content now.",
          goGenerate: "Generate my profile",
          errors: {
            consent: "Please confirm you agree to be contacted, so your specialist can reach you.",
            phone: "Please add a phone number we can reach you on.",
            missingSelection: "This order is missing information. Please start again from the LinkedIn page.",
            generic: "We could not start the payment. Please try again.",
          },
        },

        generateBox: {
          title: "Your purchase is ready to use",
          bodyNormal: "Generate your LinkedIn content from the CV you selected. This takes about a minute.",
          bodyPremium: "Generate your content now. Your specialist will be in touch shortly to build your profile.",
          cta: "Generate my LinkedIn content",
          running: "Writing your profile…",
          runningHint: "A single pass over your CV, usually under a minute. Please keep this page open.",
          failed: "That did not complete. Your purchase remains valid and nothing was lost.",
          retry: "Try again",
          basedOn: "Based on",
          pickReplacementCv:
            "The CV this purchase was based on has been deleted. Select another one to use it with.",
        },

        nameNeeded: {
          title: "How is your name written in English?",
          body: "Your LinkedIn profile will carry this name exactly as you type it. We never translate or respell a name, because only you know the spelling you use.",
          placeholder: "",
          save: "Save and generate",
          error: "We could not save your name. Please try again.",
        },

        results: {
          title: "Your LinkedIn content",
          sub: "Work through this in order. It follows the sequence of LinkedIn's own sections, and anything with a copy button is ready to paste exactly as written.",
          copy: "Copy",
          copied: "Copied",
          step: (n: number) => `Step ${n}`,
          backToLinkedin: "Back to LinkedIn",
          generatedOn: "Generated",
          fromCv: "From",
          translatedNote: "Your CV is in Arabic, so its facts were translated for this profile.",
          charCount: (used: number, max: number) => `${used} / ${max} characters`,
          sections: {
            intro: "Intro",
            about: "About",
            skills: "Your five skills",
            featured: "Featured",
            experience: "Experience",
            posts: "Post ideas",
            education: "Education and certifications",
            projects: "Projects",
            growth: "Being found by recruiters",
          },
          labels: {
            firstName: "First name",
            lastName: "Last name",
            headline: "Headline",
            currentPosition: "Current position",
            industry: "Industry",
            education: "Education",
            location: "Location",
            aboutText: "About text",
            jobTitle: "Title",
            organization: "Company",
            location2: "Location",
            locationType: "Location type",
            employmentType: "Employment type",
            startDate: "Start date",
            endDate: "End date",
            description: "Description",
            highlights: "The lines it is built from",
            roleSkills: "Skills to tag on this role",
            projectSkills: "Skills to add to this project",
            angle: "What to say",
            hook: "Opening line",
            why: "Why it is worth it",
            issuer: "Issuer",
            suggestion: "Suggestion",
            link: "Link",
          },
          notes: {
            intro: "Paste these into LinkedIn's \"Edit intro\" panel.",
            aboutFirstLine:
              "LinkedIn shows only the first 300 characters or so before \"see more\", which is why the opening line carries most of the weight.",
            skills: "Add these under Skills, then pin them to the top of your profile.",
            featured: "Add these under Featured, so a recruiter can see your work rather than only read about it.",
            experienceNa:
              "\"N/A\" means your CV did not state it. Fill those in yourself. We do not guess dates, employers, or titles.",
            posts: "These are yours to publish. Each one is tied to something you genuinely did.",
            manualEntry:
              "LinkedIn requires these to be entered directly, so it can match your institution and issuer to the real ones.",
            recommendedCerts:
              "Your CV lists no certifications. These are the ones worth holding in your field. They are recommendations, not something to list as already earned.",
            existingCerts: "Add the certificates you already hold here.",
            projectEntries: "Add each of these under Projects on your profile.",
            recommendedProjects: "Ideas worth building. Add them to your profile only once they are real.",
            growth:
              "This is the part most people skip, and it is the part that decides whether the profile is seen at all.",
          },
          empty: "Nothing here yet.",
        },

        history: {
          title: "Your LinkedIn profiles",
          sub: "Everything you have purchased and generated. Open any of them at any time.",
          open: "Open",
          columns: { date: "Date", tier: "Tier", cv: "Based on", status: "Status" },
          status: { ready: "Ready", generating: "Generating", failed: "Failed" },
          empty: "You have not generated anything yet.",
          buyAgainTitle: "Create another profile",
          buyAgainBody:
            "Changed roles, or created a new CV? Generate a fresh profile from a different CV.",
          buyAgainCta: "Create a new profile",
          hideBuyAgain: "Not now",
        },

        premiumPending: {
          title: "Your specialist is on it",
          body: "You purchased Premium, so a specialist from Tarshih will contact you on the number you provided and build your profile for you. Your generated content is available below in the meantime.",
        },

        errors: {
          load: "We could not load your LinkedIn add-on. Please try again.",
          alreadyGenerated: "This purchase has already been used. Open it from your history below.",
          inProgress: "That profile is still being generated. Please give it a moment.",
          notPaid: "This purchase has not been paid for yet.",
          cvDeleted: "The CV this purchase was based on has been deleted. Select another CV to use it with.",
          cvNotSupported:
            "That CV was saved before structured data was stored, so we cannot build from it. Please select a more recent one.",
          generationFailed:
            "Something went wrong while generating your profile. Your purchase remains valid, so please try again.",
        },
      },
    },
  },

  ar: {
    nav: {
      features: "المميزات",
      howItWorks: "كيف يعمل",
      pricing: "الأسعار",
      linkedin: "لينكدإن",
      faq: "الأسئلة الشائعة",
      about: "من نحن",
      login: "تسجيل الدخول",
      getStarted: "ابدأ الآن",
      dashboard: "لوحة التحكم",
    },
    /* ── HERO (§3.1) ──────────────────────────────────────────────────────
       Written as Arabic, not as a translation of the English above. The
       English headline is "Every job gets its own CV"; the Arabic carries
       the same idea in a construction Arabic actually uses, which is why the
       wording diverges rather than tracking the English word order. */
    hero: {
      /* مكتوب للبحث العربي لا كترجمة للعنوان الإنجليزي: المصطلح الذي يُبحث
         عنه فعلًا هو «منشئ سيرة ذاتية»، و«ATS» تُكتب باللاتينية في البحث
         العربي أكثر مما تُترجم. العنوان يذكر الأداة ثم يعد بما تفعله، كما
         في الإنجليزية، لكن بصياغة عربية لا تتبع ترتيب كلماتها. */
      headline: "منشئ سيرة ذاتية بالذكاء الاصطناعي يعيد كتابة سيرتك لكل وظيفة",
      sub: "الصق إعلان الوظيفة لتحصل على سيرة ذاتية وخطاب تقديم مكتوبين له، بالعربية أو بالإنجليزية. ومع كل سيرة درجة توافق مع أنظمة ATS، وما ينقصها، ووظائف مفتوحة تناسب خبرتك.",
      ctaPrimary: "ابدأ مجانًا",
      ctaSecondary: "شاهد كيف يعمل",
      freeLine: `${arCount(TIERS.free.credits, AR_POINTS)} مجانًا كل شهر، بلا بطاقة. تكفي ${arCount(TIERS.free.credits, AR_CVS)} بالإنجليزية، أو واحدة بالعربية وأخرى بالإنجليزية.`,
      scoreAlt: "درجة توافق مع أنظمة التتبع 92، موزّعة على المهارات والكلمات المفتاحية والمسمى الوظيفي والخبرة والتعليم",
      matchesAlt: "خمس وظائف مطابقة، كل واحدة موسومة بتطابق قوي أو جزئي أو فرصة طموحة",
    },
    /* ── الصورة الأولى في الواجهة (§3.1) ────────────────────────────────
       المسميات هنا هي نفسها المستخدمة في بطاقة ATS داخل لوحة التحكم، لأنها
       العوامل التي يحسبها utils/ats_scorer.py فعلًا. لا وجود لدرجة
       «تنسيق» في المنتج، وقد كانت معروضة في نسخة سابقة من هذه اللوحة. */
    heroScore: {
      title: "نتيجة نظام ATS",
      sub: "التفصيل نفسه الذي تراه بعد كل إنشاء، ووزن كل عامل في النتيجة.",
      factors: {
        skills: "المهارات",
        keywords: "الكلمات المفتاحية",
        title: "المسمى الوظيفي",
        experience: "الخبرة",
        education: "التعليم",
      },
      missingLabel: "لم تُغطَّ بعد:",
      missing: ["Terraform", "GraphQL"],
    },
    heroMatches: {
      /* خمسة هو RESULT_CAP في agents/jobs_finder.py، وليس رقمًا اختير للصفحة.
         النص يقول «حتى خمس» لأن الحد هدف يُملأ مما هو منشور فعلًا، وقد تعود
         الوظائف الضيقة بعدد أقل. */
      headline: "وظائف حقيقية تقدّم عليها اليوم",
      sub: "ما إن تجهز سيرتك حتى نبحث في الإعلانات المفتوحة الآن، ونعيد لك ما يصل إلى خمس وظائف مرتبة بحسب مدى ملاءمتك لها. كل واحدة تفتح الإعلان الأصلي، فتقدّم عليها في الجلسة نفسها.",
      countLabel: "وظائف مفتوحة الآن",
      // تظهر في رأس اللوحة وعلى كل سطر، لا كتعليق ختامي: أن كل نتيجة تفتح
      // إعلان الوظيفة الحقيقي هو ما تقوم عليه هذه الصورة.
      linkNote: "كل واحدة تفتح الإعلان الأصلي",
      viewListing: "فتح الإعلان",
      // أسماء وظائف ومدن فقط، بلا أسماء جهات توظيف: ربط شركات حقيقية بوظائف
      // «مطابقة» في نموذج توضيحي يوحي بأنها توظّف عبرنا، وهذا ادعاء لا نملكه.
      items: [
        { role: "مهندس واجهات أمامية", city: "الرياض", rank: "strong" as const },
        { role: "مهندس منتجات", city: "جدة", rank: "strong" as const },
        { role: "مطوّر متكامل", city: "الرياض", rank: "partial" as const },
        { role: "مهندس واجهات", city: "عن بُعد", rank: "partial" as const },
        { role: "قائد فريق هندسي", city: "الرياض", rank: "stretch" as const },
      ],
      ranks: { strong: "تطابق قوي", partial: "تطابق جزئي", stretch: "فرصة طموحة" },
    },
    /* ── COMPANY MARQUEE (§3.2) ───────────────────────────────────────────
       الصيغة هنا ليست ادعاء توظيف: نقول ما هو صحيح فعلًا، وهو أنك تستطيع
       لصق أي إعلان من هذه الجهات وتُكتب سيرتك له. */
    marquee: {
      label: "صمّم سيرتك لوظائف في",
    },
    dashboardPreview: {
      urlLabel: "app.tarshih.ai / لوحة التحكم",
      sidebar: {
        dashboard: "لوحة التحكم",
        myResumes: "سيري الذاتية",
        applications: "الطلبات",
        settings: "الإعدادات",
      },
      uploadLabel: "سيرتك الذاتية",
      fileName: "سيرتي-الذاتية.pdf",
      parsed: "تم التحليل",
      jdLabel: "الوصف الوظيفي",
      role: "مهندس واجهات أمامية أول · Linear",
      generate: "إنشاء",
      generating: "جارٍ الإنشاء",
      optimized: "محسّنة",
      atsLabel: "نتيجة التوافق",
      keywordMatch: "تطابق الكلمات المفتاحية",
      formatting: "التنسيق",
      suggestionsLabel: "اقتراحات الذكاء الاصطناعي",
      improvements: [
        "تطابق 14 من أصل 16 متطلبًا رئيسيًا",
        "إضافة 9 كلمات مفتاحية مرتبطة بالوظيفة",
        "تحديد كمّي لخمسة إنجازات",
      ],
      resumeLabel: "السيرة الذاتية",
      coverLetterLabel: "خطاب التقديم",
      ready: "جاهز",
    },
    /* عبارات قصيرة عمدًا: تقف في سطر واحد على الشاشات الكبيرة، وأي عبارة
       تلتفّ تحوّل صفًا من أربعة إلى كتلة من ثمانية. */
    trustBar: [
      "تشفير كامل لما ترفعه",
      "نتيجة ATS شفافة",
      "كل سطر يُراجَع مقابل سيرتك",
      "منقّح الأسلوب يزيل نبرة الآلة",
    ],
    /* ── حجّة التخصيص (§3.4، الركيزة الأولى في الرسائل) ────────────────────
       مكتوبة بالعربية ابتداءً لا مترجمة عن الإنجليزية: العنوان الإنجليزي
       يقول إن إعلانين لوظيفة واحدة لا يفحصان الشيء نفسه، والعربي يحمل الفكرة
       نفسها بتركيب تستعمله العربية فعلًا، ولذلك تختلف الصياغة.

       ثلاث جمل فقط، لأن اللوحة هي التي تحمل الحجّة. */
    tailoringCase: {
      label: "سيرة واحدة تُرسل إلى الجميع",
      title: "إعلانان لوظيفة واحدة لا يبحثان عن الشيء نفسه",
      description:
        "حين تُرسل السيرة كما هي، يقرأ كل صاحب عمل الترتيب نفسه، وتنتهي الخبرة التي يبحث عنها هو تحديدًا في أسفل الصفحة الثانية. يقرأ ترشيح كل إعلان ويعيد بناء الترتيب حول ما طلبه ذلك الإعلان. لا يُضاف شيء، بل هو السجل نفسه يُقرأ مرتين.",
      panelTitle: "سيرة واحدة، مقروءة أمام إعلانين",
      keyLead: "تتقدّم",
      keyRest: "تتأخّر",
      matchLabel: "التوافق",
      roles: ["مهندس واجهات أمامية", "مطوّر متكامل"],
      footnote: "السيرة نفسها في الحالتين. لا شيء مُضاف ولا شيء مُختلق.",
      alt: "سيرة واحدة مقروءة أمام إعلانين، المهارات الست نفسها مرتّبة على نحو مختلف في كل منهما، ودرجة توافق مختلفة",
    },
    /* ── المميزات (§3.5) ──────────────────────────────────────────────────
       تدرّج لا شبكة مسطّحة: ثلاث مزايا رئيسية لكل واحدة صورتها، ثم قائمة
       مختصرة بالبقية. النسخة السابقة كانت ست بطاقات متطابقة برموز داخل
       مربعات ملوّنة، وهي أوضح علامات القالب الجاهز في §2.1، وكانت إحداها
       تعلن عن «ستة وكلاء ذكاء اصطناعي»: تفصيل داخلي، والرقم خطأ أصلًا.

       كل سطر هنا مأخوذ من الشيفرة. التحضير للمقابلة تحديدًا موصوف بما
       يُخرجه agents/interview_prep.py فعلًا — أسئلة متوقّعة مع إجابة لكل
       سؤال — لا تدريبًا ولا محاكاة ولا مقابلة تجريبية، فلا شيء من ذلك موجود
       في المنتج. ولينكدإن والتحضير للمقابلة يحملان شرط الخطة في note، لأن
       core/entitlements.py يضع حدّهما عند صفر في الخطة المجانية. */
    features: {
      label: "ما الذي تحصل عليه",
      title: "سيرة مخصّصة، والنتائج التي تفسّرها، والوظائف التي تُرسل إليها",
      description:
        "تشغيل واحد يُخرج الثلاثة: المستندات، والتقييم الذي يشرحها، والإعلانات التي وُجّهت إليها.",
      primary: [
        {
          lead: "سيرة ذاتية تُكتب من جديد للإعلان، وخطاب تقديم يرافقها",
          body: "يُكتب الاثنان أمام الوصف الوظيفي الذي لصقته، بالعربية أو بالإنجليزية، ويُنسَّقان تنسيقًا صحيحًا في كلتيهما. وكل سطر يعود إلى شيء موجود في سيرتك أصلًا.",
        },
        {
          lead: "اعرف ما ينقصك قبل أن يعرفه من يقرأ سيرتك",
          body: "نتيجة ATS بعواملها الموزونة، ودرجة توافق مستقلة مع الوظيفة، ثم الفجوات المحدّدة التي كلّفتك ما تبقّى. ولكل فجوة طريقة صادقة لسدّها، لا طريقة لادّعائها.",
        },
        {
          lead: "وظائف مرتّبة، كل واحدة على بعد نقرة من إعلانها",
          body: "ما إن تجهز السيرة حتى نبحث فيما هو منشور الآن ونعيد ما يصل إلى خمس وظائف، موسومة بمقدار ما تُظهره سيرتك ممّا تطلبه. وكل سطر يفتح الإعلان الأصلي.",
        },
      ],
      secondaryTitle: "وبقية الأدوات",
      secondary: [
        {
          title: "ابدأ بلا سيرة ذاتية",
          body: "لا يوجد ملف ترفعه؟ املأ النموذج بدلًا منه، ويعمل المسار نفسه على ما أدخلته.",
          note: "",
        },
        {
          title: "أو طوّر سيرتك الحالية",
          body: "ارفع ملف PDF أو Word، فيُقرأ كما هو دون أن تعيد كتابة شيء.",
          note: "",
        },
        {
          title: "PDF و Word",
          // "DOCX" and not ".docx": a Latin run that STARTS with a full stop
          // is a neutral character at the edge of a bidi run, which is the
          // exact shape that renders on the wrong side inside an Arabic
          // sentence. Seen on a screenshot, not guessed. The extension is
          // named without its dot instead of being patched with an LRM.
          body: "تُنزَّل السيرة الذاتية بصيغة PDF أو DOCX، ويأتي خطاب التقديم بصيغة PDF.",
          note: "",
        },
        {
          title: "كل نسخة محفوظة",
          body: "تبقى كل سيرة أنشأتها في حسابك، ومعها الوظيفة ونتائجها وملفاتها.",
          note: "",
        },
        {
          title: "محتوى ملفك في لينكدإن",
          body: "عنوان مهني، وقسم «نبذة»، ونص جاهز للصق لكل وظيفة في خبرتك، مكتوب من سيرة خصّصتها هنا. بالإنجليزية، لأن بها يبحث المسؤولون عن التوظيف.",
          note: "ضمن خطتَي Pro و Elite",
        },
        {
          title: "أسئلة المقابلة، مع إجاباتها",
          body: "الأسئلة التي يُرجَّح أن تبدأ بها تلك الوظيفة تحديدًا، ومع كل سؤال كيف تجيب عنه من خبرتك أنت.",
          note: "ضمن خطتَي Pro و Elite",
        },
      ],
    },
    /* نصّا المستندين نفسيهما موجودان في المكوّن لا هنا: ورقة السيرة عربية
       وورقة الخطاب إنجليزية في اللغتين معًا، عمدًا، لأن ما يُدَّعى هنا هو أن
       المنتج ينسّق النصّين. */
    featureDocs: {
      cvLabel: "السيرة المخصّصة",
      letterLabel: "خطاب التقديم",
      caption: "إنشاء واحد، بالنصّين، كلٌّ منسّق باتجاهه.",
      alt: "صفحة سيرة ذاتية بالعربية بحروف موصولة، وخلفها خطاب تقديم بالإنجليزية",
    },
    /* الحقول الثلاثة هي GapItem في schemas/output_schema.py حرفيًا: المهارة،
       وأهميتها (مطلوبة أو مفضّلة)، وكيف تُسدّ. وأسطر السدّ تتبع قاعدة
       match_scorer.py نفسها: إن تعذّر سدّ الفجوة بصدق، يُشار إلى خبرة حقيقية
       أو بديل صادق، لا إلى طريقة لادّعاء أن الشرط مستوفى. */
    featureGaps: {
      atsLabel: "نتيجة ATS",
      matchLabel: "توافق الوظيفة",
      gapsLabel: "ما الذي ينقص",
      importance: { required: "مطلوبة", preferred: "مفضّلة" },
      items: [
        {
          skill: "Terraform",
          importance: "required" as const,
          how: "أنشأت بنية تحتية يدويًا. اذكر ما الذي أتمتّه منها، وبأي أداة.",
        },
        {
          skill: "GraphQL",
          importance: "preferred" as const,
          how: "طبقة الواجهات في وظيفتك الثانية قريبة بما يكفي لذكرها. اذكر ما الذي كانت تخدمه.",
        },
        {
          skill: "قيادة فريق",
          importance: "required" as const,
          how: "أشرفت على مهندسَين العام الماضي. مكان ذلك داخل الوظيفة نفسها، لا في قائمة المهارات.",
        },
      ],
      alt: "نتيجة ATS ودرجة توافق مع الوظيفة، ومعهما ثلاث فجوات محدّدة وكيفية سدّ كل واحدة",
    },
    /* الأسماء تأتي من t.heroMatches.ranks حتى لا تختلف عن لوحة الواجهة. ما
       يُكتب هنا هو معنى كل وسم فقط، وهو ما لا تقوله تلك اللوحة. */
    featureRanks: {
      title: "كيف تُوسَم كل وظيفة",
      meanings: {
        strong: "سيرتك تُظهر أصلًا معظم ما يطلبه الإعلان.",
        partial: "جزء ممّا يطلبه موجود في سيرتك، وجزء غير موجود.",
        stretch: "أبعد ممّا تُظهره سيرتك الآن. تُعرض عليك بدل أن تُخفى عنك.",
      },
      alt: "الأوسمة الثلاثة التي قد تحملها وظيفة مطابقة، ومعنى كل واحد",
    },
    /* ثلاث خطوات لا أربع، وبلا ذكر لعدد الوكلاء: النسخة السابقة كانت تفتح
       بـ«ستة وكلاء ذكاء اصطناعي»، والرقم خطأ (المسار يشغّل ثمانية)، والأهم
       أن عدد الوكلاء ليس شيئًا يحصل عليه القارئ. */
    howItWorks: {
      label: "كيف يعمل",
      title: "ثلاث خطوات، وينتهي العمل",
      description:
        "تخصيص السيرة الذاتية كما ينبغي يستغرق من 30 إلى 45 دقيقة لكل طلب. هنا يستغرق دقيقتين، وتُدخل معلوماتك مرة واحدة لا مرة مع كل وظيفة.",
      steps: [
        {
          title: "أضف سيرتك الذاتية",
          description: "ارفع ملف PDF أو Word. وإن لم تكن لديك سيرة بعد، فاملأ النموذج بدلًا من ذلك.",
        },
        {
          title: "الصق إعلان الوظيفة",
          description: "الإعلان كاملًا. نقرأ ما تطلبه الوظيفة فعلًا، بالعربية أو بالإنجليزية.",
        },
        {
          title: "استلم كل ما يلزمك",
          description: "سيرة ذاتية مخصصة وخطاب تقديم، ودرجة توافقك مع أنظمة التتبع وما ينقصها، وما يصل إلى خمس وظائف مفتوحة ترسلها إليها.",
        },
      ],
    },
    /* ── الثقة ────────────────────────────────────────────────────────────
       أُعيد بناء القسم حول عرض عملي بدل ثلاث دعاوى في ثلاث بطاقات. «لا شيء
       مُختلق» هو أثقل وعد في هذا الموقع، وهو الاعتراض الأول لدى كل مرشّح على
       أدوات الكتابة بالذكاء الاصطناعي، وسرده في فقرة أضعف طريقة لإثباته.

       كل تفصيلة هنا مقروءة من core/fact_checker.py: الفحص يجري مقابل
       facts_json المستخرج من السيرة المرفوعة، وإعادة التسمية والصياغة
       مسموحة بينما أي رقم أو أداة أو نطاق جديد ممنوع، و MAX_RETRIES = 2،
       والسطر الراسب يُعاد إنشاؤه ويُفحص من جديد لا أن يُعلَّم فحسب.

       المثال مكتوب بالعربية ابتداءً: ترجمة المثال الإنجليزي كانت ستنتج جملة
       لا يكتبها أحد في سيرته. */
    trustSection: {
      label: "ما الذي لن يفعله",
      title: "تُراجَع الصياغة الجديدة مقابل سيرتك قبل أن تصل إليك",
      description:
        "النموذج الذي يكتب جيدًا قادر أيضًا، إن تُرك، على كتابة ما ليس صحيحًا. هنا لا يُترك: كل سطر معاد صياغته يُقرأ مقابل الحقائق المستخرجة من ملفك، وأي سطر يضيف شيئًا يُعاد.",
      proof: {
        caption: "سطر واحد، تحت الفحص",
        sourceLabel: "في سيرتك",
        source: "أدرت مكتب الاستقبال في عيادة أسنان.",
        allowedLabel: "مقبول",
        allowed: "أدرت عمليات الاستقبال والتنسيق اليومي في عيادة أسنان.",
        allowedNote: "تسمية أدقّ للعمل نفسه، دون ادّعاء جديد.",
        rejectedLabel: "مُعاد",
        rejected: "أدرت عمليات الاستقبال في عيادة أسنان من 12 كرسيًا.",
        rejectedNote: "«12 كرسيًا» غير موجود في سيرتك، فلا يصل هذا السطر إلى مستندك.",
        outcome: "السطر المُعاد تُعاد كتابته ويُفحص مرة أخرى، حتى مرتين، قبل أن تُبنى السيرة.",
        alt: "سطر من سيرة ذاتية، والصياغة التي يقبلها المدقّق، وصياغة مختلقة يعيدها",
      },
      pillars: [
        {
          title: "مستنداتك تبقى ملكك",
          description:
            "يتم تشفير كل ما ترفعه أثناء النقل والتخزين. لا يقوم ترشيح أبدًا بتدريب نماذجه على سيرتك الذاتية أو مشاركتها مع أي طرف ثالث، ويمكنك حذف كل شيء نهائيًا في أي وقت.",
        },
        {
          title: "النتيجة تعرض حسابها",
          description:
            "رقم واحد، ووراءه عوامل بأوزانها: المهارات 40 بالمئة، والكلمات المفتاحية 25، والمسمى الوظيفي 15، والخبرة 12، والتعليم 8. ثم الفجوات التي كلّفتك ما تبقّى، ولكل واحدة طريقة صادقة لسدّها لا طريقة لادّعائها.",
        },
        {
          title: "يجب أن يُقرأ وكأنك كتبته",
          description:
            "القواعد نفسها تسري على كل سيرة وخطاب تقديم وملف لينكدإن: بلا شرطات، وبلا «علاوة على ذلك» و«إضافة إلى ما سبق»، وبلا تضخيم للأهمية. وهي جزء من طريقة كتابة النص أصلًا، لا مراجعة ثانية تجري عليه بعد كتابته.",
        },
      ],
    },
    pricing: {
      eyebrow: "الأسعار",
      title: "أسعار بسيطة تنمو مع بحثك عن عمل",
      description:
        "ابدأ مجانًا وطوّر خطتك فقط عند الحاجة لمزيد من النقاط. ألغِ الاشتراك في أي وقت.",
      // AR_POINTS / AR_CVS carry the four Arabic forms of "نقطة" (credit) and
      // "سيرة ذاتية" (CV) so a changed allowance keeps correct grammar rather
      // than producing "٢ نقاط". See arCount in lib/pricing.ts.
      creditNote: `${arCount(CREDIT_COST.en, AR_POINTS)} = سيرة ذاتية إنجليزية + خطاب تقديم · ${arCount(CREDIT_COST.ar, AR_POINTS)} = سيرة ذاتية عربية + خطاب تقديم.`,
      founderNote: {
        title: "شخص واحد يدفع تكلفة كل خطة تراها هنا",
        body: "ترشيح مبنية ومُدارة من شخص واحد، وكل توليد، في كل فئة، يكلّف مالًا حقيقيًا لمعالجة الذكاء الاصطناعي. الفئة المجانية ليست فقط غير مربحة، بل خسارة أتحملها عمدًا لتتمكن من تجربة ترشيح قبل أن تدفع أي شيء. مشتركو برو والنخبة هم من يبقون كل شيء قائمًا.",
        cta: "اقرأ القصة كاملة",
      },
      mostPopular: "الأكثر رواجًا",
      premiumBadgeLabel: "الفئة المميزة",
      currencyNote: `تُحصَّل جميع الأسعار بالريال السعودي. ورقم الدولار الظاهر تحت كل سعر للمرجعية فقط بسعر التعادل ${SAR_PER_USD} ريال للدولار، وليس خيار دفع.`,
      plans: [
        {
          name: "مجاني",
          slug: "free",
          // لا يوجد حقل «سعر سابق» في أي خطة، وهذا مقصود: كل سعر معروض هو
          // السعر الوحيد الذي حملته الخطة، فلا شيء يُشطب فوقه.
          sar: TIERS.free.sar,
          period: "شهريًا",
          description: "كل ما تحتاجه لتجربة ترشيح في طلبك القادم.",
          features: [
            `${arCount(TIERS.free.credits, AR_POINTS)} شهريًا: ${arCount(TIERS.free.credits, AR_CVS)} إنجليزية، أو مزيج مع العربية`,
            "نتيجة ATS وتوافق وظيفي كاملة",
            "سيرة ذاتية مخصصة + خطاب تقديم مطابق",
            "سجل يحفظ آخر 10 سير ذاتية",
          ],
          cta: "ابدأ مجانًا",
          badge: null as string | null,
          limitedOffer: null as string | null,
          featured: false,
          premium: false,
        },
        {
          name: "برو",
          slug: "pro",
          // سعر واحد لكل مشتركي برو، مؤسسين أو غير مؤسسين. لا خصم تأسيس ولا
          // سعر سابق: 29 ريالًا لم يكن يومًا رقمًا آخر.
          sar: TIERS.pro.sar,
          period: "شهريًا",
          description: "لمن يبحث عن عمل بنشاط ويريد كمية أكبر من الطلبات، في كل مرة.",
          features: [
            `${arCount(TIERS.pro.credits, AR_POINTS)} شهريًا: ${arCount(TIERS.pro.credits, AR_CVS)} إنجليزية، أو مزيج مع العربية`,
            "سيرة ذاتية مخصصة + خطاب تقديم شخصي",
            "نتيجة ATS وتوافق وظيفي كاملة",
            "يوضح بالضبط ما ينقصك",
            "5 وظائف مشابهة ومصنّفة مع كل طلب",
            "مراجعة تحقق من الحقائق",
            `لينكدإن الأساسية، ${arCount(ADDON_CAPS.pro.linkedinEssential, AR_PROFILES)} شهريًا`,
            `التحضير للمقابلة، ${arCount(ADDON_CAPS.pro.interviewPrep, AR_JOBS)} شهريًا`,
            "شارة برو على ملفك الشخصي",
            "سجل يحفظ آخر 100 سيرة ذاتية",
            "معالجة ذات أولوية",
          ],
          cta: "ابدأ مع برو",
          badge: "الأكثر رواجًا",
          // عرض التأسيس شارة وندرة، وليس خصمًا.
          limitedOffer: "أول 50 مشتركًا في برو يحتفظون بشارة «عضو مؤسس» دائمة على ملفهم الشخصي.",
          featured: true,
          premium: false,
        },
        {
          name: "النخبة",
          slug: "elite",
          sar: TIERS.elite.sar,
          period: "شهريًا",
          description: "الفئة المميزة لمن يريد كل ميزة ممكنة في طلباته.",
          features: [
            `${arCount(TIERS.elite.credits, AR_POINTS)} شهريًا: ${arCount(TIERS.elite.credits, AR_CVS)} إنجليزية، أو مزيج مع العربية`,
            "سيرة ذاتية مخصصة + خطاب تقديم شخصي",
            "نتيجة ATS وتوافق وظيفي كاملة",
            "يوضح بالضبط ما ينقصك",
            "5 وظائف مشابهة ومصنّفة مع كل طلب",
            "مراجعة تحقق من الحقائق",
            `لينكدإن الأساسية، ${arCount(ADDON_CAPS.elite.linkedinEssential, AR_PROFILES)} شهريًا`,
            `التحضير للمقابلة، ${arCount(ADDON_CAPS.elite.interviewPrep, AR_JOBS)} شهريًا`,
            "سجل غير محدود للسير الذاتية",
            "أعلى أولوية في معالجة الذكاء الاصطناعي",
            "شارة النخبة الحصرية على ملفك الشخصي",
            "كل ما في خطة برو",
          ],
          cta: "انضم إلى النخبة",
          badge: null as string | null,
          limitedOffer: null as string | null,
          featured: false,
          premium: true,
        },
      ],
    },
    payg: {
      eyebrow: "الدفع حسب الاستخدام",
      title: "الدفع حسب الاستخدام",
      description: "مثالي لمن يحتاج عددًا قليلًا من النقاط فقط، بلا اشتراك.",
      perApp: "لكل نقطة",
      cta: "شراء الحزمة",
      packs: [
        {
          name: "البداية",
          slug: "starter",
          sar: PACKS.starter.sar,
          creditCount: PACKS.starter.credits,
          credits: arCount(PACKS.starter.credits, AR_POINTS),
          blurb: "بضعة طلبات لتجربة الخدمة.",
          badge: null as string | null,
          featured: false,
        },
        {
          name: "أفضل قيمة",
          slug: "best-value",
          sar: PACKS["best-value"].sar,
          creditCount: PACKS["best-value"].credits,
          credits: arCount(PACKS["best-value"].credits, AR_POINTS),
          blurb: "الخيار الأمثل لبحث نشط عن عمل.",
          badge: "أفضل قيمة",
          featured: true,
        },
        {
          name: "الأقوى",
          slug: "power",
          sar: PACKS.power.sar,
          creditCount: PACKS.power.credits,
          credits: arCount(PACKS.power.credits, AR_POINTS),
          blurb: "لبحث جاد وعالي الكثافة عن وظيفة.",
          badge: "أعلى توفير",
          featured: false,
        },
      ],
    },
    /* ── صفحة الأسعار (§4) ────────────────────────────────────────────────
       إطار الصفحة فقط. كل خطة وحزمة وإضافة تُعرض هناك تعيد استخدام المدخلات
       الموجودة أعلاه، فلا تختلف صفحة الأسعار عن الصفحة الرئيسية عن شاشة
       الترقية في لوحة التحكم. ولا يُكتب رقم هنا إطلاقًا.

       لا قسم لطرق الدفع: البوابة (Moyasar) غير مربوطة بعد، ووعد فارغ في
       صفحة أسعار أسوأ من غيابه.

       «العضوية المؤسِّسة» شارة فقط: لا سعر مؤسِّس ولا خصم ولا سعر سابق
       مشطوب في أي موضع. */
    pricingPage: {
      label: "الأسعار",
      title: "كم يكلّف، وما الذي تشتريه النقطة",
      description:
        "ثلاث خطط، أو نقاط تُشترى وحدها. الخطة المجانية لا تحتاج بطاقة، ولا يتجدّد شيء ما لم تشترك.",
      plansTitle: "الخطط",
      plansBody: "كل الخطط تشغّل المسار نفسه. ما يختلف هو مقدار ما تحصل عليه منه كل شهر.",

      creditsTitle: "نقطة واحدة، طلب واحد",
      creditsBody:
        "تغطي النقطة سيرة ذاتية واحدة تُعاد كتابتها لإعلان وظيفة، وخطاب التقديم المرافق لها. والعربية تستهلك نقطتين، لأن الإنشاء بالعربية يمرّ بمرحلة توطين ومعالجة للنص لا تمرّ بها الإنجليزية.",
      // القيم تأتي من CREDIT_COST ولا تُكتب. والسطران الأخيران «مشمول» لأن
      // التقييم والبحث عن الوظائف يجريان داخل الإنشاء نفسه (انظر
      // core/orchestrator.py)، فلا يكلّفان شيئًا فوق النقطة المدفوعة أصلًا.
      creditsRows: [
        { label: "سيرة ذاتية وخطاب تقديم بالإنجليزية", value: arCount(CREDIT_COST.en, AR_POINTS) },
        { label: "سيرة ذاتية وخطاب تقديم بالعربية", value: arCount(CREDIT_COST.ar, AR_POINTS) },
        { label: "نتيجة ATS ودرجة التوافق وقائمة الفجوات", value: "مشمول" },
        { label: "ما يصل إلى خمس وظائف مطابقة، كل واحدة تفتح إعلانها", value: "مشمول" },
      ],

      packsTitle: "أو اشترِ النقاط وحدها",
      packsBody: "شراء لمرة واحدة لا اشتراك، لبحث يأتي على فترات متباعدة.",

      foundingTitle: "الأعضاء المؤسِّسون",
      foundingBody:
        "أول خمسين مشتركًا في خطة Pro تبقى في ملفاتهم شارة «عضو مؤسِّس» بشكل دائم. وهي شارة فحسب: السعر هو سعر Pro المعتاد، ولا يوجد خصم تأسيسي ولا سعر يُثبَّت.",

      linkedinTitle: "إضافة لينكدإن",

      faqTitle: "أسئلة عن الاشتراك والدفع",
      backToProduct: "شاهد ما الذي يقدّمه المنتج",
    },
    /* ── إضافة لينكدإن، قسم مميز في الصفحة الرئيسية ──
       الأسعار مكرّرة هنا كأرقام لأن هذا القسم يُعرض للزوار غير المسجّلين،
       ويجب أن تطابق PRICING في backend/core/linkedin.py. */
    linkedinPromo: {
      eyebrow: "إضافة لينكدإن",
      title: "سيرتك الذاتية تتجاوز الفلترة، وملفك على لينكدإن هو ما يجعلهم يجدونك.",
      description:
        "جهات التوظيف تبحث في لينكدإن قبل أن تفتح أي سيرة ذاتية. حوّل سيرة ذاتية أنشأتها هنا إلى ملف لينكدإن كامل جاهز للّصق، أو دع متخصصًا من فريقنا يبنيه لك بالكامل.",
      whyTitle: "ولماذا لا تسأل روبوت محادثة مجانيًا؟",
      reasons: [
        {
          title: "يبدأ من سيرة ذاتية تم التحقق من حقائقها",
          body: "لا من صفحة محادثة فارغة. فهو يُبنى على المعلومات المستخرجة من سيرتك الذاتية والتي مرّت بمرحلة تحقق مخصصة، فلا إعادة كتابة ولا تخمين ولا اختلاق. أما روبوت المحادثة فلا يعرف إلا ما تلصقه له في تلك اللحظة.",
        },
        {
          title: "مبني على حدود حقول لينكدإن الحقيقية",
          body: "220 حرفًا للعنوان المهني، و2600 لقسم «نبذة»، و2000 لكل وظيفة. كل حقل يُكتب داخل حدّه ويُراجع مرة أخرى بعد التوليد، فلا يصلك نص مقطوع في منتصف الجملة عند اللصق.",
        },
        {
          title: "مرتبط بالوظيفة التي خصّصت سيرتك لها",
          body: "أنت تختار أي سيرة ذاتية مخصصة يعمل منها، فيصبح العنوان المهني و«نبذة» والمهارات موجّهة إلى الوظائف التي تتقدم لها فعلًا، لا ملخصًا عامًا لمسيرتك كلها.",
        },
        {
          title: "مكتوب بأسلوب محترف، لا بأسلوب نموذج آلي",
          body: "القواعد نفسها التي تحكم سيرتك الذاتية تنطبق هنا: لا إكثار من الشرطات، ولا «علاوة على ذلك»، ولا قوائم ثلاثية محشوة، ولا عبارات منفوخة. يُقرأ كأنك وصفت عملك بنفسك، لأنه مبني على ما فعلته فعلًا.",
        },
      ],
      alwaysEnglish:
        "يُكتب بالإنجليزية دائمًا أيًا كانت لغة سيرتك الذاتية، لأن هذه هي طريقة بحث جهات التوظيف في السعودية والمنطقة.",
      // الأساسية لا تُباع منفصلة، بل تأتي مع اشتراك برو أو النخبة، فلا سعر
      // على هذه البطاقة وزرها يقود إلى صفحة الخطط لا إلى الدفع.
      essential: {
        name: "الأساسية",
        includedLabel: "مشمولة مع برو والنخبة",
        badge: "تنفيذ ذاتي",
        tagline: "نكتبه لك وتضعه أنت",
        bullets: [
          "عنوان مهني، وقسم «نبذة»، وأقوى خمس مهارات لديك",
          "نص جاهز للّصق لكل وظيفة في خبراتك",
          "ثلاث أفكار منشورات من مشاريعك الحقيقية",
          "زر نسخ عند كل حقل",
          `${arCount(ADDON_CAPS.pro.linkedinEssential, AR_PROFILES)} شهريًا في برو، و${ADDON_CAPS.elite.linkedinEssential} في النخبة`,
        ],
        cta: "عرض الخطط",
      },
      premium: {
        name: "المميزة",
        sar: LINKEDIN_PREMIUM_SAR,
        badge: "تنفيذ كامل",
        tagline: "يُنشئه لك متخصص",
        bullets: [
          "كل ما في الأساسية، ويُولَّد فورًا",
          "يتواصل معك متخصص ويبني الملف معك",
          "صورة غلاف مخصصة مصمّمة لملفك",
          "مراجعة كاملة وجولة تحسينات واحدة بعد النشر",
        ],
        cta: "احصل على المميزة",
      },
      oneTime: "لمرة واحدة",
      footnote: "عمليات شراء لمرة واحدة لا اشتراكات. وتتطلب سيرة ذاتية مُنشأة في ترشيح، والخطة المجانية تكفي لذلك.",
      seeDetails: "عرض التفاصيل كاملة",
    },
    faq: {
      eyebrow: "الأسئلة الشائعة",
      title: "أسئلة، وأجوبتها",
      description: "كل ما تحتاج معرفته قبل أن تبدأ طلب توظيفك القادم.",
      // نفس المعرّفات في اللغتين: الصفحة الرئيسية تعرض هذه فقط وتربط ببقية
      // الأسئلة في /questions.
      // FIVE, which is the top of the brief's 4-5 range (§3.7). It was seven.
      // "refunds" and "linkedin-what-is-it" left for /pricing, where the rest
      // of the commerce questions now live; nothing was rewritten to make the
      // cut, these are the same entries shown verbatim.
      landing: ["credits", "need-existing-cv", "never-invents", "ai-sounding", "data-safe"],
      // The billing set, shown on /pricing under the plans. Same mechanism:
      // ids, not a slice, so reordering the master list is safe.
      pricingPage: ["credits", "no-card", "refunds", "linkedin-what-is-it", "linkedin-tiers", "linkedin-refunds"],
      seeAll: "عرض كل الأسئلة",
      allTitle: "كل الأسئلة",
      allDescription: "كل ما يتعلق بطريقة عمل ترشيح وتكلفته وما يحدث لبياناتك.",
      searchLabel: "ابحث في الأسئلة",
      searchPlaceholder: "ابحث عن سؤال…",
      searchEmpty: "لا نتائج مطابقة. جرّب كلمة أخرى، أو تواصل معنا بالأسفل.",
      resultCount: (shown: number, total: number) => `${shown} من ${total} سؤالًا`,
      contactTitle: "لم تجد إجابتك؟",
      contactBody: "أرسل لنا سؤالك وسيتواصل معك أحد أعضاء فريق الدعم.",
      supportEmail: "support@tarshih.com",
      backToHome: "العودة إلى الرئيسية",
      items: [
        {
          id: "ats-what-is-it",
          q: "ما هو نظام ATS ولماذا يهم؟",
          a: "نظام تتبع المتقدمين هو برنامج تستخدمه الشركات لفرز السير الذاتية قبل أن يطّلع عليها شخص حقيقي. يحلّل ترشيح كل وصف وظيفي ويحسّن سيرتك الذاتية لتُقرأ بوضوح من قبل النظام الآلي والمسؤول عن التوظيف على حد سواء.",
        },
        {
          id: "arabic-quality",
          q: "هل ينتج ترشيح فعلًا سيرًا ذاتية عربية جيدة؟",
          a: "نعم. السير الذاتية العربية معروفة بصعوبة تنسيقها بشكل صحيح، حروف مكسورة، اتجاه خاطئ، تشكيل في غير مكانه. يُنشئ ترشيح سيرًا ذاتية وخطابات تقديم عربية منسّقة بشكل صحيح من اليمين لليسار، لا النصوص المشوّشة التي تنتجها معظم الأدوات.",
        },
        {
          id: "need-existing-cv",
          q: "هل أحتاج سيرة ذاتية جاهزة لاستخدام ترشيح؟",
          a: "لا. يمكنك رفع سيرتك الحالية لتطويرها، أو بناء سيرة جديدة تمامًا من الصفر. في الحالتين، يكون الناتج مخصصًا للوظيفة التي تتقدم لها تحديدًا.",
        },
        {
          id: "job-matching",
          q: "كيف يعمل اقتراح الوظائف المشابهة؟",
          a: "الصق وصفًا وظيفيًا ويُرجع ترشيح 5 وظائف مشابهة، كل واحدة مصنّفة كتطابق قوي أو تطابق جزئي أو فرصة طموحة، لتجد دائمًا فرصًا أخرى تستحق التقديم.",
        },
        {
          id: "score-meaning",
          q: "ماذا تخبرني نتيجة ATS والتوافق بالضبط؟",
          a: "تقسّم سيرتك الذاتية إلى تطابق الكلمات المفتاحية والمهارات والتعليم والخبرة مقارنة بالوصف الوظيفي، ثم تسرد بالضبط ما ينقصك، شهادة أو مهارة أو كلمة مفتاحية، لتعرف ما يجب إضافته.",
        },
        {
          id: "never-invents",
          q: "هل سيختلق ترشيح خبرات لا أملكها؟",
          a: "لا. قد تذكر نماذج الذكاء الاصطناعي معلومات تبدو معقولة وهي غير صحيحة، وهذا هو الخطر الأهم في السيرة الذاتية تحديدًا، لأنها تحمل اسمك وأنت من سيُسأل عنها في المقابلة. تُستخرج كل حقيقة من سيرتك الحقيقية أولًا، ثم تُراجَع كل نقطة مولّدة مقابل تلك الحقائق في مرحلة تحقق مخصصة قبل أن تصل إليك. يعيد ترشيح صياغة ما هو حقيقي فقط ولا يختلق شيئًا أبدًا.",
        },
        {
          id: "how-many-agents",
          q: "كم عدد وكلاء الذكاء الاصطناعي الذين يعملون على طلبي؟",
          a: "ثماني مراحل تعمل على كل طلب، كل مرحلة يتولاها وكيل مستقل بدلًا من طلب واحد يحاول فعل كل شيء: تحليل السيرة الذاتية، وتحليل الوصف الوظيفي، والتخصيص، والتحقق من الحقائق، وتقييم التوافق مع ATS، وكتابة خطاب التقديم، وحساب درجة التوافق، والبحث عن وظائف. ويمكنك متابعتها مرحلة بمرحلة أثناء إنشاء سيرتك. أما تقييم ATS نفسه فيجري بحساب ثابت لا بنموذج ذكاء اصطناعي.",
        },
        {
          id: "credits",
          q: "ما هي النقطة (Credit) وكم أحصل منها؟",
          a: `النقطة هي ما تستهلكه لتوليد سيرة ذاتية وخطاب تقديم مخصصين. الطلبات بالإنجليزية تكلّف ${arCount(CREDIT_COST.en, AR_POINTS)}، والطلبات بالعربية تكلّف ${arCount(CREDIT_COST.ar, AR_POINTS)} لأنها تتطلب معالجة أكبر. تشمل الخطة المجانية ${arCount(TIERS.free.credits, AR_POINTS)} شهريًا، وبرو ${arCount(TIERS.pro.credits, AR_POINTS)}، والنخبة ${arCount(TIERS.elite.credits, AR_POINTS)}.`,
        },
        {
          id: "sounds-like-me",
          q: "هل ستبقى سيرتي الذاتية تعبّر عني فعلًا؟",
          a: "نعم. يعزز ترشيح خبرتك الحقيقية ويعيد صياغتها، ولا يخترع أبدًا وظائف أو مؤهلات. يمكنك مراجعة كل اقتراح وتعديله قبل التصدير.",
        },
        {
          id: "file-formats",
          q: "ما هي صيغ الملفات التي يمكنني رفعها وتنزيلها؟",
          a: "يمكنك رفع ملفات بصيغة PDF أو DOCX، وتصدير سيرتك الذاتية وخطاب التقديم المحسّنين بأي من الصيغتين، جاهزين للتقديم في أي مكان.",
        },
        {
          id: "data-safe",
          q: "هل بياناتي الشخصية آمنة؟",
          a: "مستنداتك مشفّرة أثناء النقل والتخزين. نحن لا نبيع بياناتك ولا نستخدمها لتدريب النماذج، ويمكنك حذف ملفاتك نهائيًا في أي وقت.",
        },
        {
          id: "no-card",
          q: "هل أحتاج بطاقة ائتمان للبدء؟",
          a: "لا. الخطة المجانية متاحة للأبد دون الحاجة لبطاقة. طوّر إلى برو أو النخبة فقط عندما تريد نقاطًا أكثر كل شهر.",
        },
        {
          id: "refunds",
          q: "هل يمكنني استرداد المبلغ؟",
          a: "بعد استخدام النقطة تصبح العملية نهائية، لأن المستند يُسلَّم لحظة إنشائه. وإذا حال عطل تقني من جانبنا دون إنتاج أي مستند بعد خصم النقطة، فراسل الدعم وسنعيد النقطة أو نسترد تلك العملية تحديدًا. أما الاشتراكات فيمكن إلغاؤها في أي وقت، وتبقى فعّالة حتى نهاية الدورة التي دفعت مقابلها.",
        },
        {
          id: "ai-sounding",
          q: "هل سيكون واضحًا أن الذكاء الاصطناعي كتبه؟",
          a: "لا ينبغي ذلك. كل عملية توليد تتبع قواعد صريحة ضد العادات التي تكشف الكتابة الآلية: الإكثار من الشرطات، وكلمات الربط مثل «علاوة على ذلك» و«بالإضافة إلى ذلك»، والعبارات المنفوخة مثل «يلعب دورًا حيويًا»، وقوائم الصفات الثلاثية المحشوة، ورتابة أطوال الجمل التي يلاحظها الناس دون أن يعرفوا تسميتها. والنتيجة تُقرأ كما لو أن محترفًا يصف عمله بنفسه، وهذا ما بُنيت منه أصلًا.",
        },
        {
          id: "linkedin-what-is-it",
          q: "ما هي إضافة لينكدإن؟",
          a: `تحوّل سيرة ذاتية أنشأتها هنا إلى محتوى لينكدإن جاهز للّصق: عنوان مهني، وقسم «نبذة»، وأقوى خمس مهارات لديك، ونص لكل وظيفة في خبراتك، وثلاث أفكار منشورات مستخرجة من مشاريعك الحقيقية، وإرشادات واضحة للأقسام التي يشترط لينكدإن إدخالها مباشرة. والباقة الأساسية مشمولة في خطتَي برو والنخبة، ${arCount(ADDON_CAPS.pro.linkedinEssential, AR_PROFILES)} شهريًا في برو و${arCount(ADDON_CAPS.elite.linkedinEssential, AR_PROFILES)} في النخبة. ويُكتب بالإنجليزية أيًا كانت لغة سيرتك الذاتية، لأن هذه هي طريقة بحث جهات التوظيف في المنطقة.`,
        },
        {
          id: "linkedin-tiers",
          q: "ما الفرق بين الباقة الأساسية والمميزة في إضافة لينكدإن؟",
          a: `الأساسية مشمولة في خطتَي برو والنخبة ولا تُباع على حدة. تمنحك المحتوى النهائي وتضعه أنت في ملفك، ويُسلَّم لحظة توليده: ${arCount(ADDON_CAPS.pro.linkedinEssential, AR_PROFILES)} شهريًا في برو، و${arCount(ADDON_CAPS.elite.linkedinEssential, AR_PROFILES)} في النخبة. أما المميزة، ${LINKEDIN_PREMIUM_SAR} ريال، فهي شراء منفصل لمرة واحدة يشمل كل ذلك ويضيف متخصصًا من فريقنا يتواصل معك مباشرة، ويبني ملفك بالكامل ويحسّنه معك، ويصمم صورة غلاف مخصصة، ويراجعه بعد نشره.`,
        },
        {
          id: "linkedin-refunds",
          q: "هل يمكنني استرداد مبلغ إضافة لينكدإن؟",
          a: "الباقة الأساسية لا تُشترى على حدة، فلا شيء يُسترد فيها: هي مشمولة في اشتراك برو أو النخبة، ويمكن إلغاء الاشتراك في أي وقت مع بقائه فعّالًا حتى نهاية الدورة المدفوعة. أما الباقة المميزة فهي شراء لمرة واحدة وقابلة للاسترداد كاملًا في أي وقت قبل أن يبدأ المتخصص عمله، وبعد بدء التنفيذ لا تعود قابلة للاسترداد لأن المحتوى قد سُلِّم والخدمة جارية.",
        },
      ],
    },
    finalCta: {
      title: "طلبك القادم يستحق فرصًا أفضل",
      description:
        "جرّب ترشيح على وظيفتك القادمة في أقل من خمس دقائق. مجاني للبدء، بلا بطاقة ائتمان، وبلا التزام.",
      ctaPrimary: "ابدأ مجانًا",
      ctaSecondary: "شاهد كيف يعمل",
      // السعر يصل مُنسّقًا من lib/pricing.ts، فلا يُكتب رقم داخل هذه العبارة.
      priceLine: (proPrice: string) => `البداية مجانية · Pro من ${proPrice} شهريًا`,
    },
    footer: {
      description:
        "يساعدك ترشيح على تحويل أي وصف وظيفي إلى سيرة ذاتية محسّنة لأنظمة ATS وخطاب تقديم مخصص، خلال ثوانٍ.",
      columns: [
        {
          title: "المنتج",
          links: [
            { label: "المميزات", href: "/#features", doc: null as string | null },
            { label: "الأسعار", href: "/pricing", doc: null as string | null },
            { label: "كيف يعمل", href: "/#how-it-works", doc: null as string | null },
          ],
        },
        {
          title: "مصادر",
          links: [
            { label: "دليل السيرة الذاتية", href: "/guides#resume-guide", doc: null as string | null },
            { label: "نصائح ATS", href: "/guides#ats-tips", doc: null as string | null },
          ],
        },
        {
          title: "الشركة",
          links: [
            { label: "من نحن", href: "/about", doc: null as string | null },
            { label: "تواصل معنا", href: "#", doc: "contact" },
          ],
        },
      ],
      rights: (year: number) => `© ${year} ترشيح. جميع الحقوق محفوظة.`,
      terms: "الشروط والأحكام",
      privacy: "الخصوصية",
      security: "الأمان",
      returnPolicy: "سياسة الاسترداد والاستبدال",
    },
    brandPanel: {
      headline: "كل طلب توظيف، أفضل من سابقه.",
      sub: "سجّل الدخول لتستمر في تخصيص سير ذاتية وخطابات تقديم تُقرأ فعلًا.",
      points: [
        "تشفير كامل لكل ما ترفعه",
        "نتائج توافق ATS واضحة وشفافة",
        "لا يخترع خبرات لم تعشها أبدًا",
      ],
    },
    form: {
      eyebrow: "أهلًا بعودتك",
      title: "سجّل الدخول إلى ترشيح",
      sub: "أكمل من حيث توقفت في طلبات توظيفك.",
      googleCta: "المتابعة عبر جوجل",
      dividerLabel: "أو سجّل الدخول بالبريد الإلكتروني",
      usernameLabel: "البريد الإلكتروني أو اسم المستخدم",
      usernamePlaceholder: "you@example.com",
      passwordLabel: "كلمة المرور",
      passwordPlaceholder: "أدخل كلمة المرور",
      forgot: "هل نسيت كلمة المرور؟",
      submit: "تسجيل الدخول",
      submitting: "جارٍ تسجيل الدخول…",
      noAccount: "ليس لديك حساب؟",
      signup: "أنشئ حسابًا مجانًا",
      terms: "بالمتابعة، أنت توافق على",
      termsLink: "الشروط",
      and: "و",
      privacyLink: "سياسة الخصوصية",
      showPassword: "إظهار كلمة المرور",
      hidePassword: "إخفاء كلمة المرور",
      missingFields: "يرجى إدخال البريد الإلكتروني وكلمة المرور.",
      invalidCredentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
      tooManyAttempts: "جرّبت تسجيل الدخول مرات كثيرة. انتظر بضع دقائق ثم أعد المحاولة.",
      oauthError: "حدث خطأ أثناء تسجيل الدخول عبر جوجل. حاول مرة أخرى.",
      backToHome: "العودة إلى الرئيسية",
    },
    forgotPassword: {
      backToLogin: "العودة لتسجيل الدخول",
      eyebrow: "إعادة تعيين كلمة المرور",
      title: "نسيت كلمة المرور؟",
      sub: "أدخل البريد الإلكتروني المرتبط بحسابك وسنرسل لك رابطًا لإعادة تعيينها.",
      emailLabel: "البريد الإلكتروني",
      emailPlaceholder: "you@example.com",
      submit: "إرسال رابط إعادة التعيين",
      submitting: "جارٍ الإرسال...",
      missingEmail: "الرجاء إدخال بريدك الإلكتروني.",
      invalidEmail: "الرجاء إدخال بريد إلكتروني صحيح.",
      genericError: "حدث خطأ ما. حاول مرة أخرى.",
      expiredLink: "انتهت صلاحية رابط إعادة التعيين أو تم استخدامه بالفعل. أدخل بريدك الإلكتروني للحصول على رابط جديد.",
      successTitle: "تحقق من بريدك الإلكتروني",
      successBody: (email: string) =>
        `أرسلنا رابط إعادة تعيين كلمة المرور إلى ${email}. الرابط صالح لفترة قصيرة، فاستخدمه قريبًا.`,
      resend: "لم يصلك؟ أرسل مرة أخرى",
      rememberPassword: "تتذكر كلمة المرور؟",
      login: "تسجيل الدخول",
    },
    resetPassword: {
      eyebrow: "خطوة أخيرة",
      title: "تعيين كلمة مرور جديدة",
      sub: "اختر كلمة مرور جديدة لحسابك.",
      passwordLabel: "كلمة المرور الجديدة",
      confirmLabel: "تأكيد كلمة المرور الجديدة",
      placeholder: "••••••••",
      showPassword: "إظهار كلمة المرور",
      hidePassword: "إخفاء كلمة المرور",
      submit: "تحديث كلمة المرور",
      submitting: "جارٍ التحديث...",
      missingFields: "الرجاء تعبئة الحقلين.",
      tooShort: "يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.",
      breached: "كلمة المرور هذه ظهرت في تسريب بيانات معروف. اختر كلمة مرور غيرها.",
      mismatch: "كلمتا المرور غير متطابقتين.",
      samePassword: "يجب أن تكون كلمة المرور الجديدة مختلفة عن كلمة المرور الحالية.",
      weakPassword: "كلمة المرور سهلة التخمين. جرّب إضافة أرقام أو رموز أو أحرف كبيرة.",
      sessionExpired: "انتهت صلاحية رابط إعادة التعيين. اطلب رابطًا جديدًا وحاول مرة أخرى.",
      rateLimited: "محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.",
      genericError: "حدث خطأ ما. حاول مرة أخرى.",
      successTitle: "تم تحديث كلمة المرور",
      successBody: "تم تغيير كلمة المرور الخاصة بك. يمكنك الآن تسجيل الدخول بها.",
      goToDashboard: "المتابعة إلى لوحة التحكم",
      invalidLinkTitle: "هذا الرابط غير صالح",
      invalidLinkBody: "رابط إعادة تعيين كلمة المرور غير صالح أو منتهي الصلاحية. اطلب رابطًا جديدًا للمتابعة.",
      requestNewLink: "طلب رابط جديد",
    },
    signup: {
      brandPanel: {
        headline: "كل طلب توظيف، أفضل من سابقه.",
        sub: "أنشئ حسابك وابدأ في تخصيص سير ذاتية وخطابات تقديم تُقرأ فعلًا.",
        points: [
          "تشفير كامل لكل ما ترفعه",
          "نتائج توافق ATS واضحة وشفافة",
          "لا يخترع خبرات لم تعشها أبدًا",
        ],
      },
      eyebrow: "ابدأ مجانًا",
      title: "أنشئ حسابك في ترشيح",
      sub: "أعدّ حسابك لتبدأ في تخصيص طلبات التوظيف خلال دقائق.",
      googleCta: "المتابعة عبر جوجل",
      dividerLabel: "أو أنشئ حسابًا بالبريد الإلكتروني",
      nameEnLabel: "الاسم (بالإنجليزية)",
      nameArLabel: "الاسم (بالعربية)",
      nameHelp: "أدخل واحدًا على الأقل. نستخدم كل اسم كما تكتبه تمامًا، ولا نترجم اسمك أبدًا.",
      emailLabel: "البريد الإلكتروني",
      emailPlaceholder: "you@example.com",
      passwordLabel: "كلمة المرور",
      passwordPlaceholder: "أنشئ كلمة مرور",
      confirmPasswordLabel: "تأكيد كلمة المرور",
      confirmPasswordPlaceholder: "أعد إدخل كلمة المرور",
      termsPrefix: "أوافق على",
      submit: "إنشاء حساب",
      submitting: "جارٍ إنشاء الحساب…",
      alreadyHaveAccount: "لديك حساب بالفعل؟",
      loginLink: "تسجيل الدخول",
      changePlan: "تغيير الخطة",
      planLabel: (planName: string) => `لقد اخترت: خطة ${planName}`,
      showPassword: "إظهار كلمة المرور",
      hidePassword: "إخفاء كلمة المرور",
      errors: {
        missingFields: "يرجى تعبئة جميع الحقول المطلوبة.",
        invalidEmail: "يرجى إدخال بريد إلكتروني صالح.",
        passwordTooShort: "يجب ألا تقل كلمة المرور عن 8 أحرف.",
        passwordBreached: "كلمة المرور هذه ظهرت في تسريب بيانات معروف. اختر كلمة مرور غيرها.",
        passwordMismatch: "كلمتا المرور غير متطابقتين.",
        termsRequired: "يجب الموافقة على الشروط وسياسة الخصوصية للمتابعة.",
        signupFailed: "حدث خطأ أثناء إنشاء حسابك. حاول مرة أخرى.",
        oauthError: "حدث خطأ أثناء تسجيل الدخول عبر جوجل. حاول مرة أخرى.",
      },
      checkEmailTitle: "تحقق من بريدك الإلكتروني",
      checkEmailBody: "لقد أرسلنا رابط تأكيد إلى بريدك الإلكتروني. اضغط عليه لإتمام إنشاء حسابك.",
    },
    dashboard: {
      sidebar: {
        dashboard: "لوحة التحكم",
        myResumes: "سيري الذاتية",
        interview: "التحضير للمقابلة",
        jobSearch: "البحث عن وظائف",
        linkedin: "لينكدإن",
        settings: "الإعدادات",
        admin: "الإدارة",
        logout: "تسجيل الخروج",
      },
      generate: {
        eyebrow: "طلب جديد",
        title: "خصّص سيرة ذاتية لوظيفتك القادمة",
        sub: "أنشئ سيرة ذاتية جديدة أو ارفع ملفك الحالي، ثم الصق الوصف الوظيفي ودع ترشيح يتولى الباقي. وكل شيء يُكتب من خبرتك الحقيقية، وبأسلوب يُقرأ كأن محترفًا كتبه.",
        uploadLabel: "سيرتك الذاتية",
        uploadHint: "اسحب وأفلت ملف PDF أو DOCX، أو اضغط للاختيار",
        uploadedLabel: "تم التحليل",
        removeFile: "إزالة الملف",
        jdLabel: "الوصف الوظيفي",
        jdPlaceholder: "الصق نص الإعلان الوظيفي كاملًا هنا...",
        jdHint: "لا يتوفر لديك إعلان؟ اكتب المسمى الوظيفي فقط، وسنبني الوصف من الإعلانات المنشورة حاليًا لهذه الوظيفة.",
        generateCta: "إنشاء",
        generatingCta: "جارٍ الإنشاء…",
        resultsTitle: "طلبك المخصص",
        atsLabel: "نتيجة توافق ATS",
        keywordMatch: "تطابق الكلمات المفتاحية",
        formatting: "التنسيق",
        suggestionsLabel: "اقتراحات الذكاء الاصطناعي",
        resumeCardTitle: "السيرة الذاتية المخصصة",
        coverLetterCardTitle: "خطاب التقديم",
        downloadCv: "تنزيل السيرة الذاتية",
        downloadCoverLetter: "تنزيل خطاب التقديم",
        preview: "معاينة",
        missingFields: "ارفع سيرتك الذاتية والصق وصفًا وظيفيًا لإنشاء الطلب.",
        namePrompt: {
          titleAr: "ما اسمك بالعربية؟",
          titleEn: "ما اسمك بالإنجليزية؟",
          bodyAr:
            "ستظهر سيرتك الذاتية العربية بهذا الاسم كما تكتبه تمامًا. نحن لا نترجم الأسماء تلقائيًا، لأن الاسم الواحد قد يُكتب بأكثر من صيغة صحيحة وأنت وحدك تعرف صيغتك.",
          bodyEn:
            "ستظهر سيرتك الذاتية الإنجليزية بهذا الاسم كما تكتبه تمامًا. نحن لا نترجم الأسماء تلقائيًا، لأنك وحدك تعرف الصيغة التي تستخدمها.",
          suggested: "وجدناه في سيرتك الذاتية، عدّله إن لم يكن صحيحًا.",
          saveAndGenerate: "حفظ ثم الإنشاء",
          skip: "الإنشاء بدونه",
          skipHint: "سنحوّل اسمك الحالي تلقائيًا، وقد تختلف طريقة كتابته عمّا تستخدمه.",
          error: "تعذّر حفظ اسمك. حاول مرة أخرى.",
        },
        progress: {
          title: "جارٍ تجهيز طلبك",
          agentLabel: (n: number) => `الوكيل ${n}`,
          steps: {
            cvParse: "قراءة سيرتك الذاتية",
            jdAnalyze: "تحليل الوصف الوظيفي",
            tailor: "تخصيص خبراتك",
            factCheck: "التحقق من الدقة",
            atsScore: "حساب توافق ATS",
            coverLetter: "كتابة خطاب التقديم",
            matchScore: "حساب نسبة التوافق الوظيفي",
            similarJobs: "البحث عن وظائف مشابهة",
          },
        },
      },
      resumes: {
        title: "سيري الذاتية",
        sub: "كل نسخة مخصصة أنشأتها، في مكان واحد.",
        columns: {
          role: "الوظيفة",
          company: "الشركة",
          date: "التاريخ",
          language: "اللغة",
          score: "نتيجة ATS",
          match: "نسبة التطابق",
          download: "تنزيل",
        },
        emptyTitle: "لا توجد سير ذاتية بعد",
        emptyBody: "أنشئ أول سيرة ذاتية مخصصة من لوحة التحكم لتظهر هنا.",
        emptyCta: "الذهاب إلى لوحة التحكم",
        languageBadge: { en: "الإنجليزية", ar: "العربية" },
        untitledRole: "وظيفة بدون عنوان",
        unknownCompany: "شركة غير معروفة",
        viewDetails: "عرض التفاصيل",
        hideDetails: "إخفاء التفاصيل",
        loading: "جارٍ تحميل سيرك الذاتية…",
        loadError: "تعذّر تحميل سيرك الذاتية. حاول مرة أخرى.",
        fileUnavailable: "الملف غير متاح",
        matchReasonLabel: "سبب هذا التطابق",
        recommendationLabel: "التوصية العامة",
        factCheckPassed: "اجتاز التحقق من الحقائق",
        factCheckFlagged: "تم رصد ملاحظات في التحقق من الحقائق",
        // مكتوبة بالعربية مباشرة، لا ترجمة حرفية للنص الإنجليزي. الصياغة
        // تقول "عند إنشاء السيرة" وليس "متاحة الآن"، لأن الوظائف محفوظة من
        // وقت الإنشاء ولا يُعاد البحث عند فتح الصفحة.
        jobsTitle: "وظائف وُجدت لهذه السيرة",
        jobsSub: "وُجدت عند إنشاء هذه السيرة الذاتية، وقد يكون بعضها أُغلق منذ ذلك الحين.",
        jobsCount: (n: number) => (n === 1 ? "وظيفة واحدة" : n === 2 ? "وظيفتان" : `${n} وظائف`),
        jobsEmpty: "لم تُحفظ أي وظائف مع هذه السيرة الذاتية.",
        jobsOpen: "فتح الإعلان",
      },

      /* ── البحث عن وظائف (/dashboard/job-search) ─────────────────────── */
      jobSearch: {
        eyebrow: "للباقتين المدفوعتين",
        title: "البحث عن وظائف",
        sub: "ابحث عن الوظائف المتاحة بالمسمى الوظيفي. لا تحتاج إلى سيرة ذاتية أو وصف وظيفي.",
        titleLabel: "المسمى الوظيفي",
        titlePlaceholder: "فني تقنية معلومات",
        kindLabel: "تبحث عن",
        kindJobs: "وظائف",
        kindInternships: "تدريب",
        locationLabel: "الموقع",
        locationPlaceholder: "الرياض، المملكة العربية السعودية",
        locationHint: "اتركه فارغًا لاستخدام الموقع المحفوظ في إعداداتك.",
        searchCta: "بحث",
        searching: "جارٍ البحث في الإعلانات المتاحة…",
        exactHeading: (title: string) => `وظائف ${title}`,
        relatedHeading: "وظائف ذات صلة",
        relatedSub: "تظهر بعد نفاد النتائج الأقرب. هذه وظائف مشابهة وليست مطابقة تمامًا لما بحثت عنه.",
        resultCount: (n: number) => (n === 1 ? "نتيجة واحدة" : n === 2 ? "نتيجتان" : `${n} نتائج`),
        emptyTitle: "لا توجد وظائف متاحة",
        emptyBody: "لا يوجد حاليًا إعلان مفتوح بهذا المسمى في المصادر التي نتحقق منها. جرّب مسمى أوسع، أو أعد البحث بعد أيام.",
        errors: {
          missingTitle: "اكتب المسمى الوظيفي للبحث عنه.",
          titleTooLong: "هذا يبدو وصفًا وظيفيًا. اكتب المسمى الوظيفي فقط.",
          search: "خدمة البحث غير متاحة حاليًا. حاول مرة أخرى بعد قليل.",
          upgradeRequired: "البحث عن وظائف متاح في الباقتين المدفوعتين.",
        },
        locked: {
          badge: "للباقتين المدفوعتين",
          title: "ابحث عن وظائف بدون سيرة ذاتية",
          body: "اكتب المسمى الوظيفي واحصل على الإعلانات المفتوحة من المنصات الحكومية السعودية ومواقع التوظيف الكبرى وصفحات التوظيف في الشركات نفسها. رقِّ باقتك للبحث.",
          cta: "عرض الباقات",
        },
      },

      /* ── التحضير للمقابلة (/dashboard/interview) ───────────────────────
         للباقتين المدفوعتين فقط. مستخدم الخطة المجانية يرى الصفحة مموّهة
         خلف لوحة ترقية بدل تحويله إلى صفحة أخرى.

         الأسئلة نفسها تُولَّد بلغة السيرة الذاتية لا بلغة الموقع: السيرة
         العربية تعني مقابلة عربية. أما نصوص الواجهة هنا فتتبع لغة الموقع. */
      interview: {
        eyebrow: "المميزة والنخبة",
        title: "التحضير للمقابلة",
        sub: "اختر سيرة ذاتية سبق أن خصّصتها هنا، واحصل على الأسئلة التي ستبدأ بها تلك الوظيفة غالبًا، مع إجابة لكل سؤال مبنية على خبرتك أنت.",

        locked: {
          title: "رقِّ اشتراكك إلى المميزة أو النخبة لفتح التحضير للمقابلة",
          body: "يحوّل «التحضير للمقابلة» سيرة ذاتية خصّصتها بالفعل إلى الأسئلة التي ستطرحها تلك الوظيفة فعليًا، مع إجابة لكل سؤال مبنية على مشاريعك وخبراتك الحقيقية. وهو مشمول في الباقتين المدفوعتين.",
          cta: "عرض الخطط",
          badge: "مقفل",
        },

        picker: {
          title: "اختر سيرة ذاتية للبدء",
          sub: "نحضّر انطلاقًا من الوصف الوظيفي الذي خُصصت له هذه السيرة، فتكون الأسئلة لتلك الوظيفة تحديدًا.",
          eligibleTag: "جاهزة",
          preparedTag: "محضّرة",
          openCta: "افتح أسئلتك",
          openingCta: "جارٍ الفتح…",
          preparedOn: (date: string) => `حُضّرت في ${date}`,
          selectCta: "تحضير الأسئلة",
          loading: "جارٍ تحميل سيرك الذاتية…",
          emptyTitle: "لا توجد سير ذاتية بعد",
          emptyBody: "خصّص سيرة ذاتية لوصف وظيفي أولًا، وستظهر هنا جاهزة للتحضير منها.",
          emptyCta: "تخصيص سيرة ذاتية",
          noneEligibleTitle: "لا يمكن استخدام أي من سيرك الذاتية بعد",
          noneEligibleBody:
            "يحتاج «التحضير للمقابلة» إلى سيرة ذاتية خُصصت لوصف وظيفي كامل. أنشئ واحدة جديدة وستظهر هنا.",
          reasons: {
            no_jd: "لا يوجد وصف وظيفي محفوظ مع هذه السيرة",
            no_snapshot: "حُفظت قبل تخزين البيانات التي يحتاجها هذا القسم",
          },
          hiddenCount: (n: number) =>
            n === 1
              ? "سيرة ذاتية واحدة لا يمكن استخدامها هنا، وتظهر بالأسفل بلون باهت."
              : `${n} سير ذاتية لا يمكن استخدامها هنا، وتظهر بالأسفل بلون باهت.`,
        },

        generating: {
          title: "جارٍ تحضير أسئلتك",
          body: "نقرأ الوصف الوظيفي مقابل سيرتك الذاتية ونكتب إجابة لكل سؤال. يستغرق ذلك دقيقتين تقريبًا، فأبقِ هذه الصفحة مفتوحة.",
          steps: {
            prepare: "إعادة قراءة هذه الوظيفة مقابل سيرتك الذاتية",
            generate: "كتابة أسئلتك وإجاباتها",
            localize: "تحويل كل شيء إلى العربية",
          },
        },

        results: {
          backToCvs: "اختيار سيرة أخرى",
          regenerate: "إعادة التوليد",
          regenerateWithCount: (left: number, total: number) =>
            `إعادة التوليد (بقي ${left} من ${total} هذا الشهر)`,
          regenerateNoneLeft: (total: number) => `استخدمت كل مرات التوليد هذا الشهر (${total})`,
          savedNote: "تم الحفظ. يمكنك مغادرة الصفحة والعودة إليها دون إعادة التوليد.",
          prepared: (n: number) => `${n} سؤالًا جاهزًا`,
          forRole: "لوظيفة",
          atCompany: "في",
          overviewLabel: "ما تتوقف عليه هذه المقابلة",
          languageNote: {
            ar: "هذه الأسئلة بالعربية، مطابقةً للسيرة الذاتية التي اخترتها.",
            en: "هذه الأسئلة بالإنجليزية، مطابقةً للسيرة الذاتية التي اخترتها.",
          },
          filterAll: "الكل",
          countLabel: (n: number) => `${n}`,
          emptyFilter: "لا توجد أسئلة في هذه الفئة.",
          expandAll: "توسيع الكل",
          collapseAll: "طي الكل",
          whyAsked: "لماذا قد يسألون هذا",
          fromPosting: "من الإعلان الوظيفي",
          answerAngle: "كيف تتعامل معه",
          starLabel: "إجابتك، من سيرتك الذاتية",
          starSummaryLabel: "ملخّص سريع",
          star: {
            situation: "الموقف",
            task: "المهمة",
            action: "الإجراء",
            result: "النتيجة",
          },
          evidenceLabel: "مبنية على",
          gapHonesty: "الطريقة الصادقة للإجابة",
          gapHonestyNote:
            "هذه ثغرة حقيقية في سيرتك الذاتية بالنسبة لهذه الوظيفة. قلها بوضوح، ثم أشر إلى أقرب شيء فعلته حقًا. ولا تدّعِ أبدًا أنك تستوفي المتطلب.",
          starEmpty:
            "لا تتضمن سيرتك الذاتية مثالًا مطابقًا لهذا السؤال، فلا يوجد ما نبني منه إجابة STAR. استخدم المنهج المذكور بالأعلى.",
        },

        categories: {
          behavioral: "سلوكي",
          technical: "تقني",
          role_specific: "خاص بالوظيفة",
          gap: "ثغرة",
        },

        errors: {
          load: "تعذّر تحميل سيرك الذاتية. حاول مرة أخرى.",
          upgradeRequired: "«التحضير للمقابلة» متاح في باقتي المميزة والنخبة.",
          no_jd: "لا يوجد وصف وظيفي محفوظ مع هذه السيرة الذاتية، فلا يوجد ما نحضّر مقابله.",
          no_snapshot:
            "حُفظت هذه السيرة قبل أن نبدأ بتخزين البيانات التي يحتاجها هذا القسم. أنشئ سيرة أحدث وحضّر منها.",
          generationFailed: "حدث خطأ أثناء تحضير أسئلتك. لم يُخصم منك شيء، فحاول مرة أخرى.",
          monthlyLimit: "استخدمت كل مرات التحضير للمقابلة هذا الشهر. ويتجدد رصيدك مع تجدد نقاطك.",
          retry: "حاول مرة أخرى",
        },
      },

      settings: {
        title: "الإعدادات",
        sub: "إدارة حسابك وتفضيلاتك.",
        accountSection: "الحساب",
        nameEnLabel: "الاسم (بالإنجليزية)",
        nameArLabel: "الاسم (بالعربية)",
        // لا يوجد نص توضيحي داخل الحقل عمدًا — nameHelp يشرح الغرض بالفعل.
        nameHelp: "يُستخدم كما هو مكتوب تمامًا في سيرتك الذاتية. السير الإنجليزية تستخدم الاسم الإنجليزي، والعربية تستخدم الاسم العربي. لا نترجم اسمك أبدًا.",
        nameSave: "حفظ الاسم",
        nameSaved: "تم الحفظ.",
        nameAtLeastOne: "أدخل اسمك بلغة واحدة على الأقل.",
        emailLabel: "البريد الإلكتروني",
        passwordSection: "كلمة المرور",
        changePassword: "تغيير كلمة المرور",
        planSection: "الاشتراك",
        planLabel: "الخطة الحالية",
        changePlan: "تغيير الخطة",
        languageSection: "اللغة",
        languageLabel: "اللغة المفضلة",
        languageSaved: "تم الحفظ. سيُطبَّق على أي جهاز تسجّل الدخول منه.",
      },
      /* ── إضافة لينكدإن (/dashboard/linkedin) ────────────────────────────
         نصوص الواجهة تتبع لغة الموقع كالمعتاد، أما المحتوى المُولَّد نفسه فهو
         بالإنجليزية دائمًا. أسماء الباقات هنا للعرض فقط: القيم المخزّنة تبقى
         'normal' و'premium'. */
      linkedin: {
        eyebrow: "إضافة لمرة واحدة",
        title: "ملفك على لينكدإن، مكتوبًا من سيرتك الذاتية",
        sub: "حوّل سيرة ذاتية أنشأتها في ترشيح إلى محتوى لينكدإن جاهز للّصق مباشرة، أو دع أحد المتخصصين في فريقنا يبني لك الملف بالكامل.",
        englishOnlyNote:
          "يُكتب محتوى لينكدإن بالإنجليزية أيًا كانت لغة سيرتك الذاتية، وهذا مقصود. فالمحترفون في السعودية والمنطقة يحتفظون بملفاتهم بالإنجليزية لأن هذه هي طريقة بحث جهات التوظيف، وبذلك يصل ملفك إلى عدد أكبر منهم.",

        explainer: {
          title: "طريقتان للتنفيذ",
          body: "باقة تمنحك النص النهائي لتضعه بنفسك، وأخرى نضعه لك فيها بالكامل.",

          normalTitle: "الأساسية",
          normalSubtitle: "نكتبه لك، وتضعه أنت.",
          normalBestFor: "مناسبة للمحترفين الذين لا يجدون صعوبة في تحديث ملفهم بأنفسهم ويريدون الكتابة أن تُنجَز باحتراف.",
          normalItems: [
            "عنوان مهني، وقسم «نبذة»، وأقوى خمس مهارات لديك، مكتوبة من سيرتك الذاتية",
            "نص جاهز للّصق لكل وظيفة في خبراتك",
            "ثلاث أفكار منشورات مستخرجة من مشاريعك وإنجازاتك الحقيقية",
            "إرشادات دقيقة لأقسام «المميز» و«التعليم» و«الشهادات» و«المشاريع»",
            "زر نسخ عند كل حقل، فلا تعيد كتابة أي شيء",
            "يُسلَّم فورًا ويبقى محفوظًا في حسابك لتعود إليه وقتما تشاء",
          ],

          premiumTitle: "المميزة",
          premiumSubtitle: "يُنشئه لك متخصص من فريقنا من البداية إلى النهاية.",
          premiumBestFor: "مناسبة للمحترفين وأصحاب المناصب القيادية الذين يفضّلون تسليم المهمة بالكامل واستلام ملف جاهز.",
          premiumItems: [
            "كل ما في الباقة الأساسية، ويُولَّد فورًا",
            "يتواصل معك متخصص من فريقنا مباشرة عبر واتساب أو هاتفيًا",
            "ننشئ لك ملفك الكامل على لينكدإن، قسمًا بقسم",
            "نكتب ونضع لك العنوان المهني و«نبذة» والخبرات والمهارات، ونهيّئها لبحث جهات التوظيف",
            "صورة غلاف مخصصة يصممها فريقنا لملفك، مناسبة لمجالك",
            "مراجعة كاملة للملف بعد إنجازه، مع جولة تحسينات واحدة",
            "تواصل مباشر مع المتخصص المسؤول عن ملفك حتى يكتمل",
          ],
        },

        refundNote: {
          title: "قبل الدفع",
          oneTime: "هذه عملية شراء لمرة واحدة، وليست اشتراكًا. لا تجديد ولا خصم متكرر.",
          normal:
            "الباقة الأساسية تُسلَّم لحظة توليدك للمحتوى، لذا لا يمكن استردادها بعد أن يصبح المحتوى موجودًا. وإن كنت قد دفعت ولم تولّد بعد، فراسلنا ونعيد المبلغ كاملًا.",
          premium:
            "الباقة المميزة قابلة للاسترداد كاملًا في أي وقت قبل أن يبدأ المتخصص عمله. وبعد بدء التنفيذ لا تعود الرسوم قابلة للاسترداد، لأن المحتوى قد سُلِّم والخدمة جارية بالفعل.",
          contact: "لأي استفسار، راسلنا على support@tarshih.com.",
          policyLink: "اقرأ سياسة الاسترداد كاملة",
        },

        /* الأساسية بوصفها ميزة مشمولة لا منتجًا يُباع: بلا سعر وبلا زر شراء،
           مع بيان ما تبقّى من رصيد هذا الشهر. */
        included: {
          name: "الأساسية",
          subtitle: "نكتبه لك، وتضعه أنت.",
          includedLabel: "مشمولة",
          includedWith: "مشمولة مع برو والنخبة",
          bestFor:
            "حوّل أي سيرة ذاتية خصّصتها هنا إلى ملف لينكدإن كامل جاهز للّصق. بلا رسوم إضافية، فهي جزء من خطتك.",
          features: [
            "عنوان مهني، وقسم «نبذة»، وأقوى خمس مهارات لديك",
            "نص جاهز للّصق لكل وظيفة في خبراتك",
            "ثلاث أفكار منشورات من مشاريعك الحقيقية",
            "خمس مهارات تُضاف إلى كل مشروع من مشاريعك",
            "زر نسخ عند كل حقل",
          ],
          cta: "توليد ملف لينكدإن",
          remaining: (left: number, total: number) => `بقي ${left} من ${total} هذا الشهر`,
          usedUp: (total: number) =>
            `استخدمت كل ملفات لينكدإن المتاحة هذا الشهر (${total}). ويتجدد رصيدك مع تجدد نقاطك.`,
          lockedTitle: "مشمولة مع برو والنخبة",
          lockedBody: `اشترك لتوليد ملفات لينكدإن من سيرك الذاتية: ${arCount(ADDON_CAPS.pro.linkedinEssential, AR_PROFILES)} شهريًا في برو، و${arCount(ADDON_CAPS.elite.linkedinEssential, AR_PROFILES)} في النخبة.`,
          lockedCta: "عرض الخطط",
        },

        tiers: {
          sectionTitle: "اختر باقتك",
          oneTime: "لمرة واحدة",
          included: "ما تشمله",
          or: "أو",
          normalName: "الأساسية",
          normalTagline: "نكتبه لك وتضعه أنت",
          normalBadge: "تنفيذ ذاتي",
          normalIncluded: "مجانًا مع برو أو النخبة",
          normalCta: "اختيار الأساسية",
          premiumName: "المميزة",
          premiumTagline: "يُنشئه لك متخصص",
          premiumBadge: "تنفيذ كامل",
          premiumCta: "اختيار المميزة",
          premiumScarcity: "كل ملف في الباقة المميزة يُبنى يدويًا، لذا نقبل عددًا محدودًا فقط كل أسبوع.",
          seeOnPlans: "اعرضها في صفحة الخطط",
        },

        teaser: {
          heading: "تجاوز 500 متابع وانشر بانتظام لتبقى مرئيًا لجهات التوظيف",
          locked: "يُفتح بعد الشراء",
          body: "الدليل الكامل، بما فيه من تتواصل معه تحديدًا في مجالك، ووتيرة نشر يمكنك الالتزام بها فعليًا، وإعدادات الظهور لجهات التوظيف التي لا يفعّلها معظم الناس، يُسلَّم مع محتواك.",
        },

        needCv: {
          title: "أنشئ سيرة ذاتية أولًا، والأمر مجاني",
          body: "تُكتب هذه الإضافة من سيرة ذاتية أنشأتها في ترشيح، ولا يوجد ما نبني منه حتى الآن. والخطة المجانية تتضمن ثلاث سير ذاتية شهريًا، وهذا كل ما يلزم لتفعيل هذه الميزة.",
          cta: "إنشاء سيرة ذاتية مجانًا",
        },

        cvSelector: {
          title: "من أي سيرة ذاتية نبني؟",
          sub: "نستخدم المعلومات الموثوقة من سيرة ذاتية أنشأتها هنا مسبقًا. لا نختلق شيئًا، ولا تحتاج إلى إدخال أي بيانات من جديد.",
          empty: "تحتاج أولًا إلى سيرة ذاتية مُنشأة، فمنها تأتي المعلومات.",
          emptyCta: "إنشاء سيرة ذاتية",
          allLegacy: (count: number) =>
            count === 1
              ? "سيرتك الذاتية أُنشئت قبل أن نبدأ بتخزين البيانات المنظمة التي تحتاجها هذه الإضافة."
              : `جميع سيرك الذاتية (${count}) أُنشئت قبل أن نبدأ بتخزين البيانات المنظمة التي تحتاجها هذه الإضافة.`,
          allLegacyWhy:
            "إنشاء سيرة ذاتية جديدة واحدة يحل الأمر، والخطة المجانية تكفي لذلك. والسيرة الجديدة تحتفظ بكل ما في القديمة، بالإضافة إلى المعلومات الأساسية التي نبني منها ملفك على لينكدإن.",
          hiddenLegacy: (count: number) =>
            count === 1
              ? "سيرة ذاتية أقدم واحدة غير معروضة هنا، لأنها حُفظت قبل توفر البيانات المنظمة اللازمة."
              : `${count} سير ذاتية أقدم غير معروضة هنا، لأنها حُفظت قبل توفر البيانات المنظمة اللازمة.`,
          unsupported: "محفوظة قبل تخزين البيانات المنظمة، لذا لا يمكن استخدامها هنا",
          atsLabel: "ATS",
          matchLabel: "التوافق الوظيفي",
          langEn: "الإنجليزية",
          langAr: "العربية",
          untitled: "وظيفة بدون عنوان",
          unknownCompany: "شركة غير معروفة",
          continue: "المتابعة إلى الدفع",
          selectFirst: "اختر سيرة ذاتية للمتابعة.",
          loading: "جارٍ تحميل سيرك الذاتية…",
          changeCv: "تغيير السيرة الذاتية",
        },

        checkout: {
          title: "الدفع",
          sub: "دفعة واحدة. بدون اشتراك.",
          orderTitle: "طلبك",
          tierLabel: "الباقة",
          cvLabel: "مبنية على",
          totalLabel: "الإجمالي",
          contactTitle: "كيف يتواصل معك المتخصص",
          phoneLabel: "رقم الجوال (واتساب)",
          phonePlaceholder: "05X XXX XXXX",
          phoneHint: "الباقة المميزة تُسلَّم بتواصل شخصي، لذا نحتاج رقمًا نصل إليك عبره.",
          consentLabel: "أوافق على التواصل معي عبر واتساب أو الهاتف بخصوص هذا الطلب.",
          payCta: (amount: string) => `ادفع ${amount}`,
          paying: "جارٍ بدء الدفع…",
          comingSoonTitle: "الدفع الإلكتروني على وشك الجهوزية",
          comingSoonBody:
            "نُكمل حاليًا إعداد الدفع مع مزوّد الخدمة. ستتولى هذه الصفحة الدفع بمجرد جهوزيته، ولم يُخصم منك أي مبلغ.",
          comingSoonCta: "العودة إلى لينكدإن",
          mockNotice: "وضع تجريبي. عملية الدفع هذه محاكاة ولا يُخصم أي مبلغ.",
          back: "رجوع",
          paidTitle: "تم استلام الدفع",
          paidBody: "يمكنك الآن توليد محتوى لينكدإن الخاص بك.",
          goGenerate: "توليد ملفي",
          errors: {
            consent: "أكّد موافقتك على التواصل معك حتى يستطيع المتخصص الوصول إليك.",
            phone: "أضف رقم جوال نستطيع الوصول إليك عبره.",
            missingSelection: "هذا الطلب تنقصه بيانات. ابدأ من جديد من صفحة لينكدإن.",
            generic: "تعذّر بدء الدفع. حاول مرة أخرى.",
          },
        },

        generateBox: {
          title: "شراؤك جاهز للاستخدام",
          bodyNormal: "ولّد محتوى لينكدإن من السيرة الذاتية التي اخترتها. يستغرق ذلك دقيقة تقريبًا.",
          bodyPremium: "ولّد محتواك الآن، وسيتواصل معك المتخصص قريبًا لبناء ملفك.",
          cta: "توليد محتوى لينكدإن",
          running: "جارٍ كتابة ملفك…",
          runningHint: "مرور واحد على سيرتك الذاتية، وعادة أقل من دقيقة. أبقِ هذه الصفحة مفتوحة.",
          failed: "لم تكتمل العملية. شراؤك ما زال ساريًا ولم تفقد شيئًا.",
          retry: "حاول مرة أخرى",
          basedOn: "مبني على",
          pickReplacementCv: "السيرة الذاتية التي بُني عليها هذا الشراء محذوفة. اختر سيرة أخرى لاستخدامه معها.",
        },

        nameNeeded: {
          title: "كيف يُكتب اسمك بالإنجليزية؟",
          body: "سيحمل ملفك على لينكدإن هذا الاسم كما تكتبه تمامًا. نحن لا نترجم الأسماء ولا نعيد كتابتها، لأنك وحدك تعرف الصيغة التي تستخدمها.",
          placeholder: "",
          save: "حفظ ثم التوليد",
          error: "تعذّر حفظ اسمك. حاول مرة أخرى.",
        },

        results: {
          title: "محتوى لينكدإن الخاص بك",
          sub: "اتبع هذا الترتيب من الأعلى إلى الأسفل، فهو يطابق تسلسل أقسام لينكدإن نفسها. وكل ما يظهر بجانبه زر نسخ جاهز للّصق كما هو تمامًا.",
          copy: "نسخ",
          copied: "تم النسخ",
          step: (n: number) => `الخطوة ${n}`,
          backToLinkedin: "العودة إلى لينكدإن",
          generatedOn: "تاريخ التوليد",
          fromCv: "من",
          translatedNote: "سيرتك الذاتية بالعربية، لذا تُرجمت معلوماتها لهذا الملف.",
          charCount: (used: number, max: number) => `${used} / ${max} حرف`,
          sections: {
            intro: "التعريف",
            about: "نبذة",
            skills: "مهاراتك الخمس",
            featured: "المميز",
            experience: "الخبرات",
            posts: "أفكار منشورات",
            education: "التعليم والشهادات",
            projects: "المشاريع",
            growth: "أن تجدك جهات التوظيف",
          },
          labels: {
            firstName: "الاسم الأول",
            lastName: "اسم العائلة",
            headline: "العنوان المهني",
            currentPosition: "المنصب الحالي",
            industry: "المجال",
            education: "التعليم",
            location: "الموقع",
            aboutText: "نص النبذة",
            jobTitle: "المسمى الوظيفي",
            organization: "جهة العمل",
            location2: "الموقع",
            locationType: "نوع الموقع",
            employmentType: "نوع التوظيف",
            startDate: "تاريخ البداية",
            endDate: "تاريخ النهاية",
            description: "الوصف",
            highlights: "الأسطر المكوّنة له",
            roleSkills: "مهارات تُربط بهذه الوظيفة",
            projectSkills: "مهارات تُضاف إلى هذا المشروع",
            angle: "ما تقوله",
            hook: "السطر الافتتاحي",
            why: "لماذا يستحق",
            issuer: "الجهة المانحة",
            suggestion: "اقتراح",
            link: "الرابط",
          },
          notes: {
            intro: "الصق هذه في لوحة «تعديل التعريف» في لينكدإن.",
            aboutFirstLine:
              "لينكدإن يعرض نحو أول 300 حرف فقط قبل «عرض المزيد»، ولهذا فإن السطر الافتتاحي يحمل معظم الأثر.",
            skills: "أضف هذه في قسم المهارات، ثم ثبّتها في أعلى ملفك.",
            featured: "أضف هذه في قسم «المميز»، ليرى المسؤول عملك لا أن يقرأ عنه فقط.",
            experienceNa:
              "«N/A» تعني أن سيرتك الذاتية لم تذكرها. اكتبها بنفسك، فنحن لا نخمّن التواريخ ولا جهات العمل ولا المسميات.",
            posts: "هذه لك لتنشرها، وكل فكرة مرتبطة بشيء فعلته حقًا.",
            manualEntry:
              "يشترط لينكدإن إدخال هذه مباشرة، حتى يطابق جامعتك والجهة المانحة بالجهات الحقيقية.",
            recommendedCerts:
              "سيرتك الذاتية لا تذكر أي شهادات. هذه أفضل ما يستحق الحصول عليه في مجالك، وهي توصيات لا شيء تدرجه كأنك حصلت عليه.",
            existingCerts: "أضف هنا الشهادات التي تملكها بالفعل.",
            projectEntries: "أضف كل واحد من هذه في قسم المشاريع في ملفك.",
            recommendedProjects: "أفكار تستحق التنفيذ. لا تضفها إلى ملفك إلا بعد أن تصبح حقيقية.",
            growth: "هذا هو الجزء الذي يتجاوزه معظم الناس، وهو الجزء الذي يحدد إن كان الملف سيُرى أصلًا.",
          },
          empty: "لا يوجد شيء هنا بعد.",
        },

        history: {
          title: "ملفاتك على لينكدإن",
          sub: "كل ما اشتريته وولّدته. افتح أيًا منها في أي وقت.",
          open: "فتح",
          columns: { date: "التاريخ", tier: "الباقة", cv: "مبني على", status: "الحالة" },
          status: { ready: "جاهز", generating: "جارٍ التوليد", failed: "فشل" },
          empty: "لم تولّد شيئًا بعد.",
          buyAgainTitle: "أنشئ ملفًا آخر",
          buyAgainBody: "غيّرت وظيفتك أو أنشأت سيرة ذاتية جديدة؟ ولّد ملفًا جديدًا من سيرة مختلفة.",
          buyAgainCta: "إنشاء ملف جديد",
          hideBuyAgain: "ليس الآن",
        },

        premiumPending: {
          title: "المتخصص يعمل على ملفك",
          body: "لقد اشتريت الباقة المميزة، وسيتواصل معك متخصص من ترشيح على الرقم الذي أعطيتنا إياه ليبني لك ملفك. ومحتواك المُولَّد متاح بالأسفل في الوقت الحالي.",
        },

        errors: {
          load: "تعذّر تحميل إضافة لينكدإن. حاول مرة أخرى.",
          alreadyGenerated: "هذا الشراء مُستخدم بالفعل. افتحه من سجلك بالأسفل.",
          inProgress: "الملف ما زال قيد التوليد. أمهله لحظة.",
          notPaid: "لم يُدفع مقابل هذا الشراء بعد.",
          cvDeleted: "السيرة الذاتية التي بُني عليها هذا الشراء محذوفة. اختر سيرة أخرى لاستخدامه معها.",
          cvNotSupported:
            "تلك السيرة الذاتية محفوظة قبل تخزين البيانات المنظمة، لذا لا نستطيع البناء منها. اختر واحدة أحدث.",
          generationFailed: "حدث خطأ أثناء توليد ملفك. شراؤك ما زال ساريًا، فحاول مرة أخرى.",
        },
      },
    },
  },
};

export type Lang = keyof typeof content;

type LangContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  isRTL: boolean;
  dir: "rtl" | "ltr";
  t: (typeof content)["en"];
};

const LangContext = createContext<LangContextValue | null>(null);

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used inside <LangProvider>");
  return ctx;
}

/**
 * Call once from the dashboard shell with the user's
 * user_metadata.preferred_language (read server-side in the layout).
 * If it's set and differs from what's currently active (e.g. first login
 * on a new device, so localStorage is empty), switches the UI to match.
 * Runs at most once per mount.
 */
export function useSyncLanguageFromAccount(preferredLanguage: string | null | undefined) {
  const { lang, setLang } = useLang();
  const synced = useRef(false);

  useEffect(() => {
    if (synced.current) return;
    if (preferredLanguage !== "en" && preferredLanguage !== "ar") return;
    synced.current = true;
    if (preferredLanguage !== lang) {
      setLang(preferredLanguage);
    }
    // Only run on mount / when the account's saved value first arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredLanguage]);
}

/**
 * Fire-and-forget: saves the language choice to the logged-in user's
 * Supabase account (user_metadata.preferred_language), so it follows them
 * to any device they log into. Silently does nothing if nobody's logged in
 * — this is also called from public marketing pages where that's normal.
 */
async function persistLanguageToAccount(lang: Lang) {
  if (typeof window === "undefined") return;
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.auth.updateUser({ data: { preferred_language: lang } });
  } catch {
    // Not logged in, offline, etc. — localStorage already has the pick,
    // that's enough for this session.
  }
}

/** Same key as the cookie, in localStorage. Kept because that is where every
 *  existing visitor's choice currently lives — see the migration in the
 *  provider below. */
const LANG_STORAGE_KEY = "tarshih_lang";

function writeLangCookie(lang: Lang) {
  // A year, readable by the server on the next request, and Lax so it still
  // arrives on a normal top-level navigation from a search result or a link.
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; SameSite=Lax`;
}

export function LangProvider({
  children,
  initialLang,
}: {
  children: ReactNode;
  /** Read from the cookie in app/layout.tsx, so the FIRST render on the
   *  server is already in the reader's language. */
  initialLang?: Lang;
}) {
  // WHY THIS IS A PROP AND NOT A useEffect ANY MORE.
  //
  // This used to hardcode "en" and then swap to the saved language after
  // mount, to dodge a hydration mismatch. The cost was that every returning
  // Arabic reader — most of them — was served an English LTR page and watched
  // it flip to Arabic RTL a moment later. On an Arabic-first product that is
  // the first impression.
  //
  // The language now travels in a cookie, so the server knows it before it
  // renders and passes it down here. Server and client agree on the first
  // paint, there is nothing to correct, and no flash. localStorage is still
  // read below, but only to migrate visitors who chose a language before the
  // cookie existed.
  const [lang, setLangState] = useState<Lang>(initialLang ?? "en");
  const router = useRouter();

  useEffect(() => {
    // MIGRATION, and nothing else. If the cookie is already set, the server
    // used it and this must not touch anything.
    if (document.cookie.includes(`${LANG_COOKIE}=`)) return;
    const saved = localStorage.getItem(LANG_STORAGE_KEY) as Lang;
    if (saved === "en" || saved === "ar") {
      writeLangCookie(saved);
      // Sets state in an effect, which the lint rule rightly objects to in
      // general. It is correct here and cannot be avoided: localStorage does
      // not exist on the server, so a visitor who chose Arabic before the
      // cookie existed cannot be known about until after mount. It fires at
      // most once per such visitor — the cookie written on the line above is
      // what stops it ever running again. Reading localStorage in the
      // useState initializer instead would just move the same mismatch into
      // hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved !== lang) setLangState(saved);
    }
    // Runs once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Custom setter that persists the language pick to the cookie (so the
  // server renders it next time), to localStorage, and, if the person is
  // logged in, to their account too.
  /* THE TOGGLE IS A NAVIGATION NOW, on the marketing pages.
   *
   * Those pages live at /ar/... and /en/..., so switching language has to
   * change the URL or the reader ends up on an Arabic page whose address
   * still says /en — which is the thing hreflang exists to stop. Off
   * /[lang] (the dashboard, the auth pages) there is no locale in the URL
   * and this stays exactly what it was: state plus a cookie.
   *
   * Changing it HERE rather than in LangSwitcher means every caller gets the
   * right behaviour, including the dashboard's own copy of the control. */
  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    if (typeof window !== "undefined") {
      localStorage.setItem(LANG_STORAGE_KEY, newLang);
      writeLangCookie(newLang);

      // On a /[lang] route, mirror the current path into the new locale and
      // navigate. The cookie is written first so the server renders the new
      // language even on the very first request of the new URL.
      const { lang: urlLang, rest } = splitLocale(window.location.pathname);
      if (urlLang) {
        const target = rest === "/" ? `/${newLang}` : `/${newLang}${rest}`;
        router.push(target + window.location.search + window.location.hash);
      }
    }
    persistLanguageToAccount(newLang);
  };

  const isRTL = lang === "ar";
  const dir = isRTL ? "rtl" : "ltr";
  const t = content[lang];

  return (
    <LangContext.Provider value={{ lang, setLang, isRTL, dir, t }}>
      <div
        dir={dir}
        lang={lang}
        className="min-h-screen bg-zinc-950 font-sans"
        style={isRTL ? { fontFamily: "var(--font-cairo-sans), ui-sans-serif, system-ui, sans-serif" } : undefined}
      >
        {children}
      </div>
    </LangContext.Provider>
  );
}
/**
 * Locale-aware href builder for marketing links.
 *
 * `const href = useLocaleHref(); <Link href={href("/pricing")} />` produces
 * /ar/pricing for an Arabic reader. Non-marketing paths (/signup, /dashboard)
 * and external hrefs pass through unchanged — see localePath().
 *
 * Without this every in-page link would land on a bare path and bounce
 * through the middleware redirect: an extra round trip and a visible URL
 * flash on each navigation. The redirect still exists, but as a safety net
 * for old bookmarks and inbound links rather than as the normal path.
 */
export function useLocaleHref() {
  const { lang } = useLang();
  return (href: string) => localePath(href, lang);
}

"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
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
    hero: {
      badge: "New",
      badgeText: "6 AI agents tailoring every application",
      headline: "Land more interviews with an AI tailored resume",
      sub: "Upload your CV or build one from scratch, paste a job description, and Tarshih tailors your resume and cover letter to it, in English or Arabic, then shows you exactly what's missing and finds similar jobs to apply to.",
      ctaPrimary: "Optimize my resume",
      ctaSecondary: "See how it works",
      noCard: "No credit card required",
      freeForever: "Free plan forever",
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
    trustBar: [
      "Encrypted uploads, always",
      "Transparent ATS scoring",
      "Never invents your experience",
      "Reads like a person wrote it",
    ],
    features: {
      eyebrow: "Everything you need",
      title: "A complete toolkit for every application",
      description:
        "Tarshih handles the tedious parts of applying so you can focus on the roles you actually want.",
      items: [
        {
          title: "Create or upgrade any CV",
          description:
            "Start from a blank slate or upload your current CV. Either way, Tarshih builds a resume tailored to the exact job you're applying for, plus a matching cover letter in the same language, every time.",
        },
        {
          title: "ATS score you can act on",
          description:
            "See your ATS and job match score broken down by keywords, skills, education, and experience, so you know exactly what's strong and what's holding you back, not just a number.",
        },
        {
          title: "Your words, leveled up",
          description:
            "Describe a project in one vague sentence and Tarshih turns it into a polished, professional bullet point, using only what's true in your CV. Nothing is ever invented.",
        },
        {
          title: "Finds jobs for you",
          description:
            "Every job description you paste returns 5 similar openings, ranked Strong Match, Partial Match, or Stretch Role, so you're never applying blind.",
        },
        {
          title: "6 AI agents working together",
          description:
            "Parsing, tailoring, fact-checking, scoring, writing, and job search each run through a specialized agent instead of one prompt guessing its way through everything.",
        },
        {
          title: "Arabic and English, done properly",
          description:
            "Generate polished CVs and cover letters in English or Arabic, with correct RTL formatting, not the broken, jumbled Arabic output most tools produce.",
        },
      ],
    },
    howItWorks: {
      eyebrow: "How it works",
      title: "From job posting to submitted application",
      description:
        "Six AI agents work behind the scenes. All you do is upload or start fresh, paste, and download.",
      steps: [
        {
          step: "01",
          title: "Start from scratch or upload your CV",
          description:
            "Upload an existing resume as a PDF or DOCX, or build one from nothing. Tarshih extracts every real fact about your experience, skills, and history.",
        },
        {
          step: "02",
          title: "Paste the job description",
          description:
            "Tarshih's agents analyze the requirements and tailor your resume and cover letter around them, in English or Arabic.",
        },
        {
          step: "03",
          title: "See your score and what's missing",
          description:
            "Get an ATS and job match score broken down by keyword, skills, education, and experience, plus a clear list of what to add or improve.",
        },
        {
          step: "04",
          title: "Download and discover similar jobs",
          description:
            "Get your polished, ATS ready resume and cover letter, plus 5 similar openings ranked by how strong a match they are.",
        },
      ],
    },
    trustSection: {
      eyebrow: "Built on trust",
      title: "How Tarshih actually handles your career",
      description:
        "No borrowed logos, no invented reviews, just what the product does and why it's safe to use.",
      pillars: [
        {
          title: "Your documents stay yours",
          description:
            "Uploads are encrypted in transit and at rest. Tarshih never trains models on your resume or shares it with third parties, and you can delete everything permanently at any time.",
        },
        {
          title: "Scoring you can inspect, and gaps you can fix",
          description:
            "Every score breaks down into keyword match, skills, education, and experience, so you can see exactly why a resume scored the way it did. Then Tarshih tells you precisely what's missing, a certificate, a skill, a keyword, so you know what to add.",
        },
        {
          title: "Nothing invented, ever",
          description:
            "Tarshih rewrites and reframes your real experience. It will never fabricate a job, a skill, or a credential you didn't have, so what you download is always defensible in an interview.",
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
      landing: ["credits", "refunds", "need-existing-cv", "never-invents", "ai-sounding", "data-safe", "linkedin-what-is-it"],
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
          a: "No. Every fact is extracted from your real CV first, and every generated bullet is checked against it in a dedicated fact-check pass. Tarshih reframes and professionalizes what's true; it never fabricates.",
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
    },
    footer: {
      description:
        "Tarshih helps you turn any job description into an ATS optimized resume and a tailored cover letter, in seconds.",
      columns: [
        {
          title: "Product",
          links: [
            { label: "Features", href: "#features", doc: null as string | null },
            { label: "Pricing", href: "#pricing", doc: null as string | null },
            { label: "How it works", href: "#how-it-works", doc: null as string | null },
          ],
        },
        {
          title: "Resources",
          links: [
            { label: "Resume guide", href: "#", doc: "resumeGuide" },
            { label: "ATS tips", href: "#", doc: "atsTips" },
          ],
        },
        {
          title: "Company",
          links: [
            { label: "About", href: "#", doc: "about" },
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
    hero: {
      badge: "جديد",
      badgeText: "6 وكلاء ذكاء اصطناعي يخصّصون كل طلب",
      headline: "احصل على مقابلات أكثر بسيرة ذاتية مصمّمة بالذكاء الاصطناعي",
      sub: "ارفع سيرتك الذاتية أو ابنِ واحدة من الصفر، الصق الوصف الوظيفي، ويقوم ترشيح بتخصيص سيرتك وخطاب تقديمك له، بالعربية أو الإنجليزية، ثم يوضح لك بالضبط ما ينقصك ويقترح عليك وظائف مشابهة للتقديم عليها.",
      ctaPrimary: "حسّن سيرتي الذاتية",
      ctaSecondary: "شاهد كيف يعمل",
      noCard: "لا حاجة لبطاقة ائتمان",
      freeForever: "خطة مجانية للأبد",
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
    trustBar: [
      "تشفير كامل لكل ما ترفعه",
      "نتائج توافق ATS واضحة وشفافة",
      "لا يخترع خبرات لم تعشها أبدًا",
      "يُقرأ كأن إنسانًا كتبه",
    ],
    features: {
      eyebrow: "كل ما تحتاجه",
      title: "مجموعة أدوات متكاملة لكل طلب توظيف",
      description:
        "يتولى ترشيح الجوانب المرهقة في التقديم على الوظائف لتتفرغ للأدوار التي تريدها فعلًا.",
      items: [
        {
          title: "أنشئ سيرة جديدة أو طوّر الحالية",
          description:
            "ابدأ من صفحة فارغة أو ارفع سيرتك الحالية. في الحالتين، يبني ترشيح سيرة مخصصة تمامًا للوظيفة التي تتقدم لها، مع خطاب تقديم مطابق بنفس اللغة، في كل مرة.",
        },
        {
          title: "نتيجة ATS يمكنك التصرف بناءً عليها",
          description:
            "شاهد نتيجة التوافق مقسّمة إلى الكلمات المفتاحية والمهارات والتعليم والخبرة، لتعرف بالضبط ما هو قوي وما يحتاج تحسينًا، لا مجرد رقم.",
        },
        {
          title: "كلماتك، بمستوى احترافي أعلى",
          description:
            "صف مشروعك بجملة بسيطة غير مصقولة، ويحوّلها ترشيح إلى نقطة احترافية جاهزة، معتمدًا فقط على ما هو حقيقي في سيرتك. لا شيء يُختلق أبدًا.",
        },
        {
          title: "يبحث عن وظائف لك",
          description:
            "كل وصف وظيفي تلصقه يُرجع 5 وظائف مشابهة، مصنّفة كتطابق قوي أو تطابق جزئي أو فرصة طموحة، حتى لا تبحث عن عمل بشكل عشوائي.",
        },
        {
          title: "6 وكلاء ذكاء اصطناعي يعملون معًا",
          description:
            "التحليل والتخصيص والتحقق من الحقائق وتقييم التوافق والكتابة والبحث عن وظائف، كل خطوة يتولاها وكيل متخصص بدلًا من طلب واحد يخمّن كل شيء.",
        },
        {
          title: "عربي وإنجليزي، بشكل صحيح",
          description:
            "أنشئ سيرًا ذاتية وخطابات تقديم احترافية بالعربية أو الإنجليزية، بتنسيق صحيح من اليمين لليسار، لا النصوص العربية المكسورة والمشوّشة التي تنتجها معظم الأدوات الأخرى.",
        },
      ],
    },
    howItWorks: {
      eyebrow: "كيف يعمل",
      title: "من إعلان الوظيفة إلى طلب مُقدَّم",
      description: "ستة وكلاء ذكاء اصطناعي يعملون خلف الكواليس. كل ما عليك فعله هو الرفع أو البدء من جديد، اللصق، والتنزيل.",
      steps: [
        {
          step: "01",
          title: "ابدأ من الصفر أو ارفع سيرتك الذاتية",
          description:
            "أرفق سيرتك الحالية بصيغة PDF أو DOCX، أو ابنِ واحدة من لا شيء. يستخرج ترشيح كل حقيقة فعلية عن خبراتك ومهاراتك وتاريخك المهني.",
        },
        {
          step: "02",
          title: "الصق الوصف الوظيفي",
          description:
            "يحلّل وكلاء ترشيح المتطلبات ويخصّصون سيرتك وخطاب تقديمك بناءً عليها، بالعربية أو الإنجليزية.",
        },
        {
          step: "03",
          title: "شاهد نتيجتك وما ينقصك",
          description:
            "احصل على نتيجة توافق مقسّمة إلى الكلمات المفتاحية والمهارات والتعليم والخبرة، مع قائمة واضحة بما يجب إضافته أو تحسينه.",
        },
        {
          step: "04",
          title: "نزّل الملفات واكتشف وظائف مشابهة",
          description:
            "احصل على سيرة ذاتية وخطاب تقديم جاهزين لأنظمة ATS، إضافة إلى 5 وظائف مشابهة مصنّفة حسب قوة التطابق.",
        },
      ],
    },
    trustSection: {
      eyebrow: "مبني على الثقة",
      title: "كيف يتعامل ترشيح فعليًا مع مسيرتك المهنية",
      description:
        "بلا شعارات مستعارة وبلا مراجعات ملفّقة، فقط ما يقوم به المنتج فعلًا ولماذا هو آمن للاستخدام.",
      pillars: [
        {
          title: "مستنداتك تبقى ملكك",
          description:
            "يتم تشفير كل ما ترفعه أثناء النقل والتخزين. لا يقوم ترشيح أبدًا بتدريب نماذجه على سيرتك الذاتية أو مشاركتها مع أي طرف ثالث، ويمكنك حذف كل شيء نهائيًا في أي وقت.",
        },
        {
          title: "نتائج يمكنك فهمها بالتفصيل، وفجوات يمكنك سدّها",
          description:
            "تنقسم كل نتيجة إلى تطابق الكلمات المفتاحية والمهارات والتعليم والخبرة، لتعرف بالضبط سبب النتيجة. ثم يخبرك ترشيح بدقة بما ينقصك، شهادة أو مهارة أو كلمة مفتاحية، لتعرف ما يجب إضافته.",
        },
        {
          title: "لا شيء مُختلق، أبدًا",
          description:
            "يعيد ترشيح صياغة خبرتك الحقيقية وتأطيرها. لن يختلق أبدًا وظيفة أو مهارة أو مؤهلًا لم تحصل عليه، فما تحصل عليه دائمًا قابل للدفاع عنه في أي مقابلة.",
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
      landing: ["credits", "refunds", "need-existing-cv", "never-invents", "ai-sounding", "data-safe", "linkedin-what-is-it"],
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
          a: "لا. تُستخرج كل حقيقة من سيرتك الذاتية الحقيقية أولًا، وتُراجع كل نقطة يتم توليدها مقارنة بها في مرحلة تحقق مخصصة من الحقائق. يعيد ترشيح صياغة ما هو حقيقي فقط ولا يختلق شيئًا أبدًا.",
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
    },
    footer: {
      description:
        "يساعدك ترشيح على تحويل أي وصف وظيفي إلى سيرة ذاتية محسّنة لأنظمة ATS وخطاب تقديم مخصص، خلال ثوانٍ.",
      columns: [
        {
          title: "المنتج",
          links: [
            { label: "المميزات", href: "#features", doc: null as string | null },
            { label: "الأسعار", href: "#pricing", doc: null as string | null },
            { label: "كيف يعمل", href: "#how-it-works", doc: null as string | null },
          ],
        },
        {
          title: "مصادر",
          links: [
            { label: "دليل السيرة الذاتية", href: "#", doc: "resumeGuide" },
            { label: "نصائح ATS", href: "#", doc: "atsTips" },
          ],
        },
        {
          title: "الشركة",
          links: [
            { label: "من نحن", href: "#", doc: "about" },
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

export function LangProvider({ children }: { children: ReactNode }) {
  // Always start at "en" to match what the server renders (no localStorage
  // on the server). Reading the saved language happens after mount, below —
  // reading it during the initial render caused a client/server mismatch
  // (hydration error) whenever the saved language wasn't "en".
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const saved = localStorage.getItem("tarshih_lang") as Lang;
    if (saved === "en" || saved === "ar") {
      setLangState(saved);
    }
  }, []);

  // Custom setter that persists the language pick to localStorage and,
  // if the person is logged in, to their account too.
  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    if (typeof window !== "undefined") {
      localStorage.setItem("tarshih_lang", newLang);
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
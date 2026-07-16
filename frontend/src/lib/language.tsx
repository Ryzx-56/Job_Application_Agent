"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

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
      creditNote: "1 credit = 1 English CV + cover letter · 2 credits = 1 Arabic CV + cover letter.",
      mostPopular: "Most popular",
      premiumBadgeLabel: "Premium tier",
      currencyNote: null as string | null,
      plans: [
        {
          name: "Free",
          slug: "free",
          price: "$0",
          originalPrice: null as string | null,
          priceSar: null as string | null,
          period: "/ month",
          description: "Everything you need to try Tarshih on your next application.",
          features: [
            "5 credits / month — 5 English CVs, or mix in Arabic",
            "Full ATS & job match scoring",
            "Tailored CV + matching cover letter",
            "Application history, saved",
          ],
          cta: "Get started free",
          badge: null as string | null,
          offerBanner: null as string | null,
          discountLabel: null as string | null,
          limitedOffer: null as string | null,
          featured: false,
          premium: false,
        },
        {
          name: "Pro",
          slug: "pro",
          price: "$10.99",
          originalPrice: "$12.99",
          priceSar: null as string | null,
          period: "/ month",
          description: "For active job seekers who want serious volume, every time.",
          features: [
            "40 credits / month — 40 English CVs, or mix in Arabic",
            "Tailored CV + personalized cover letter",
            "Full ATS & job match scoring",
            "Shows exactly what you're missing",
            "5 similar jobs, ranked, per application",
            "Fact-check pass on every generation",
            "Application history, saved",
            "Priority processing",
          ],
          cta: "Start Pro",
          badge: "Most Popular",
          offerBanner: "Limited time offer — 15% off, forever",
          discountLabel: "15% OFF",
          limitedOffer: "This price is locked in for as long as you stay subscribed, plus a permanent Founder badge on your profile. Only the first 50 Pro members get it.",
          featured: true,
          premium: false,
        },
        {
          name: "Elite",
          slug: "elite",
          price: "$34.99",
          originalPrice: null as string | null,
          priceSar: null as string | null,
          period: "/ month",
          description: "The premium tier for candidates who want every advantage.",
          features: [
            "120 credits / month — 120 English CVs, or mix in Arabic",
            "Tailored CV + personalized cover letter",
            "Full ATS & job match scoring",
            "Shows exactly what you're missing",
            "5 similar jobs, ranked, per application",
            "Fact-check pass on every generation",
            "Highest AI processing priority",
            "Everything included in Pro",
          ],
          cta: "Go Elite",
          badge: null as string | null,
          offerBanner: null as string | null,
          discountLabel: null as string | null,
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
        { name: "Starter", slug: "starter", price: "$4.99", priceSar: null as string | null, credits: "5 credits", blurb: "A couple of applications to test the waters.", perAppValue: "≈ $1.00", badge: null as string | null, featured: false },
        { name: "Best Value", slug: "best-value", price: "$11.99", priceSar: null as string | null, credits: "15 credits", blurb: "The sweet spot for an active search.", perAppValue: "≈ $0.80", badge: "Best Value", featured: true },
        { name: "Power", slug: "power", price: "$19.99", priceSar: null as string | null, credits: "30 credits", blurb: "For a serious, high volume job hunt.", perAppValue: "≈ $0.67", badge: "Max Savings", featured: false },
      ],
    },
    faq: {
      eyebrow: "FAQ",
      title: "Questions, answered",
      description: "Everything you need to know before you start your next application.",
      items: [
        {
          q: "What is an ATS and why does it matter?",
          a: "An Applicant Tracking System is software companies use to filter resumes before a human reads them. Tarshih analyzes each job description and optimizes your resume so it reads clearly for both the ATS and the recruiter behind it.",
        },
        {
          q: "Does Tarshih actually produce good Arabic CVs?",
          a: "Yes. Arabic resumes are notoriously hard to format correctly, broken letters, wrong direction, misplaced diacritics. Tarshih generates properly structured, right to left Arabic CVs and cover letters, not the jumbled output most tools produce.",
        },
        {
          q: "Do I need an existing CV to use Tarshih?",
          a: "No. You can upload an existing resume to upgrade it, or build a brand new one from scratch. Either way, the output is tailored to the specific job you're applying for.",
        },
        {
          q: "How does the job matching work?",
          a: "Paste a job description and Tarshih returns 5 similar openings, each ranked Strong Match, Partial Match, or Stretch Role, so you always have more roles worth applying to.",
        },
        {
          q: "What exactly does the ATS and match score tell me?",
          a: "It breaks your resume down by keyword match, skills, education, and experience against the job description, then lists exactly what's missing, a certificate, a skill, a keyword, so you know what to add.",
        },
        {
          q: "Will Tarshih invent experience I don't have?",
          a: "No. Every fact is extracted from your real CV first, and every generated bullet is checked against it in a dedicated fact-check pass. Tarshih reframes and professionalizes what's true; it never fabricates.",
        },
        {
          q: "How many AI agents are working on my application?",
          a: "Six. Separate agents handle CV parsing, job description analysis, tailoring, fact-checking, ATS scoring, document generation, and job search, instead of one prompt trying to do everything at once.",
        },
        {
          q: "What's a credit and how many do I get?",
          a: "A credit is what you spend generating one tailored CV and cover letter. English applications cost 1 credit, Arabic applications cost 2, since they take more processing. Free includes 5 credits a month, Pro includes 40, and Elite includes 120.",
        },
        {
          q: "Will my resume still sound like me?",
          a: "Yes. Tarshih enhances and reframes your real experience; it never invents jobs or credentials. You can review and edit every suggestion before you export.",
        },
        {
          q: "What file formats can I upload and download?",
          a: "You can upload PDF or DOCX files, and export your optimized resume and cover letter in either format, ready to submit anywhere.",
        },
        {
          q: "Is my personal data safe?",
          a: "Your documents are encrypted in transit and at rest. We never sell your data or use it to train models, and you can permanently delete your files at any time.",
        },
        {
          q: "Do I need a credit card to start?",
          a: "No. The Free plan is available forever with no card required. Upgrade to Pro or Elite only when you want more credits each month.",
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
      terms: "Terms",
      privacy: "Privacy",
      security: "Security",
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
      fullNameLabel: "Full name",
      fullNamePlaceholder: "Your full name",
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
        settings: "Settings",
        logout: "Log out",
      },
      generate: {
        eyebrow: "New application",
        title: "Tailor a resume for your next role",
        sub: "Build a new CV or upload your existing one, paste the job description, and let Tarshih handle the rest.",
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
        download: "Download PDF",
        preview: "Preview",
        missingFields: "Upload a CV and paste a job description to generate.",
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
      settings: {
        title: "Settings",
        sub: "Manage your account and preferences.",
        accountSection: "Account",
        nameLabel: "Full name",
        emailLabel: "Email",
        passwordSection: "Password",
        changePassword: "Change password",
        planSection: "Subscription",
        planLabel: "Current plan",
        changePlan: "Change plan",
        languageSection: "Language",
        languageLabel: "Preferred language",
        languageSaved: "Saved — applies on any device you log in from.",
      },
    },
  },

  ar: {
    nav: {
      features: "المميزات",
      howItWorks: "كيف يعمل",
      pricing: "الأسعار",
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
      creditNote: "نقطة واحدة = سيرة ذاتية إنجليزية + خطاب تقديم · نقطتان = سيرة ذاتية عربية + خطاب تقديم.",
      mostPopular: "الأكثر رواجًا",
      premiumBadgeLabel: "الفئة المميزة",
      currencyNote: "الأسعار بالدولار الأمريكي، والقيمة المقابلة بالريال السعودي للمرجعية فقط (1$ ≈ 3.75 ر.س).",
      plans: [
        {
          name: "مجاني",
          slug: "free",
          price: "0$",
          originalPrice: null as string | null,
          priceSar: "0 ر.س",
          period: "شهريًا",
          description: "كل ما تحتاجه لتجربة ترشيح في طلبك القادم.",
          features: [
            "5 نقاط شهريًا — 5 سير ذاتية إنجليزية، أو مزيج مع العربية",
            "نتيجة ATS وتوافق وظيفي كاملة",
            "سيرة ذاتية مخصصة + خطاب تقديم مطابق",
            "سجل الطلبات محفوظ",
          ],
          cta: "ابدأ مجانًا",
          badge: null as string | null,
          offerBanner: null as string | null,
          discountLabel: null as string | null,
          limitedOffer: null as string | null,
          featured: false,
          premium: false,
        },
        {
          name: "برو",
          slug: "pro",
          price: "10.99$",
          originalPrice: "12.99$",
          priceSar: "≈ 41.21 ر.س",
          period: "شهريًا",
          description: "لمن يبحث عن عمل بنشاط ويريد كمية أكبر من الطلبات، في كل مرة.",
          features: [
            "40 نقطة شهريًا — 40 سيرة ذاتية إنجليزية، أو مزيج مع العربية",
            "سيرة ذاتية مخصصة + خطاب تقديم شخصي",
            "نتيجة ATS وتوافق وظيفي كاملة",
            "يوضح بالضبط ما ينقصك",
            "5 وظائف مشابهة ومصنّفة مع كل طلب",
            "مراجعة تحقق من الحقائق",
            "سجل الطلبات محفوظ",
            "معالجة ذات أولوية",
          ],
          cta: "ابدأ مع برو",
          badge: "الأكثر رواجًا",
          offerBanner: "عرض لفترة محدودة — خصم 15% إلى الأبد",
          discountLabel: "خصم 15%",
          limitedOffer: "سعر ثابت طوال فترة اشتراكك، مع شارة عضو مؤسس دائمة على ملفك الشخصي. فقط لأول 50 مشتركًا في خطة برو.",
          featured: true,
          premium: false,
        },
        {
          name: "النخبة",
          slug: "elite",
          price: "34.99$",
          originalPrice: null as string | null,
          priceSar: "≈ 131.21 ر.س",
          period: "شهريًا",
          description: "الفئة المميزة لمن يريد كل ميزة ممكنة في طلباته.",
          features: [
            "120 نقطة شهريًا — 120 سيرة ذاتية إنجليزية، أو مزيج مع العربية",
            "سيرة ذاتية مخصصة + خطاب تقديم شخصي",
            "نتيجة ATS وتوافق وظيفي كاملة",
            "يوضح بالضبط ما ينقصك",
            "5 وظائف مشابهة ومصنّفة مع كل طلب",
            "مراجعة تحقق من الحقائق",
            "أعلى أولوية في معالجة الذكاء الاصطناعي",
            "كل ما في خطة برو",
          ],
          cta: "انضم إلى النخبة",
          badge: null as string | null,
          offerBanner: null as string | null,
          discountLabel: null as string | null,
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
          price: "4.99$",
          priceSar: "≈ 18.71 ر.س",
          credits: "5 نقاط",
          blurb: "بضعة طلبات لتجربة الخدمة.",
          perAppValue: "≈ 1.00$",
          badge: null as string | null,
          featured: false,
        },
        {
          name: "أفضل قيمة",
          slug: "best-value",
          price: "11.99$",
          priceSar: "≈ 44.96 ر.س",
          credits: "15 نقطة",
          blurb: "الخيار الأمثل لبحث نشط عن عمل.",
          perAppValue: "≈ 0.80$",
          badge: "أفضل قيمة",
          featured: true,
        },
        {
          name: "الأقوى",
          slug: "power",
          price: "19.99$",
          priceSar: "≈ 74.96 ر.س",
          credits: "30 نقطة",
          blurb: "لبحث جاد وعالي الكثافة عن وظيفة.",
          perAppValue: "≈ 0.67$",
          badge: "أعلى توفير",
          featured: false,
        },
      ],
    },
    faq: {
      eyebrow: "الأسئلة الشائعة",
      title: "أسئلة، وأجوبتها",
      description: "كل ما تحتاج معرفته قبل أن تبدأ طلب توظيفك القادم.",
      items: [
        {
          q: "ما هو نظام ATS ولماذا يهم؟",
          a: "نظام تتبع المتقدمين هو برنامج تستخدمه الشركات لفرز السير الذاتية قبل أن يطّلع عليها شخص حقيقي. يحلّل ترشيح كل وصف وظيفي ويحسّن سيرتك الذاتية لتُقرأ بوضوح من قبل النظام الآلي والمسؤول عن التوظيف على حد سواء.",
        },
        {
          q: "هل ينتج ترشيح فعلًا سيرًا ذاتية عربية جيدة؟",
          a: "نعم. السير الذاتية العربية معروفة بصعوبة تنسيقها بشكل صحيح، حروف مكسورة، اتجاه خاطئ، تشكيل في غير مكانه. يُنشئ ترشيح سيرًا ذاتية وخطابات تقديم عربية منسّقة بشكل صحيح من اليمين لليسار، لا النصوص المشوّشة التي تنتجها معظم الأدوات.",
        },
        {
          q: "هل أحتاج سيرة ذاتية جاهزة لاستخدام ترشيح؟",
          a: "لا. يمكنك رفع سيرتك الحالية لتطويرها، أو بناء سيرة جديدة تمامًا من الصفر. في الحالتين، يكون الناتج مخصصًا للوظيفة التي تتقدم لها تحديدًا.",
        },
        {
          q: "كيف يعمل اقتراح الوظائف المشابهة؟",
          a: "الصق وصفًا وظيفيًا ويُرجع ترشيح 5 وظائف مشابهة، كل واحدة مصنّفة كتطابق قوي أو تطابق جزئي أو فرصة طموحة، لتجد دائمًا فرصًا أخرى تستحق التقديم.",
        },
        {
          q: "ماذا تخبرني نتيجة ATS والتوافق بالضبط؟",
          a: "تقسّم سيرتك الذاتية إلى تطابق الكلمات المفتاحية والمهارات والتعليم والخبرة مقارنة بالوصف الوظيفي، ثم تسرد بالضبط ما ينقصك، شهادة أو مهارة أو كلمة مفتاحية، لتعرف ما يجب إضافته.",
        },
        {
          q: "هل سيختلق ترشيح خبرات لا أملكها؟",
          a: "لا. تُستخرج كل حقيقة من سيرتك الذاتية الحقيقية أولًا، وتُراجع كل نقطة يتم توليدها مقارنة بها في مرحلة تحقق مخصصة من الحقائق. يعيد ترشيح صياغة ما هو حقيقي فقط ولا يختلق شيئًا أبدًا.",
        },
        {
          q: "كم عدد وكلاء الذكاء الاصطناعي الذين يعملون على طلبي؟",
          a: "ستة. وكلاء منفصلون يتولون تحليل السيرة الذاتية، وتحليل الوصف الوظيفي، والتخصيص، والتحقق من الحقائق، وتقييم التوافق مع ATS، وتوليد المستندات، والبحث عن وظائف، بدلًا من طلب واحد يحاول فعل كل شيء.",
        },
        {
          q: "ما هي النقطة (Credit) وكم أحصل منها؟",
          a: "النقطة هي ما تستهلكه لتوليد سيرة ذاتية وخطاب تقديم مخصصين. الطلبات بالإنجليزية تكلّف نقطة واحدة، والطلبات بالعربية تكلّف نقطتين لأنها تتطلب معالجة أكبر. تشمل الخطة المجانية 5 نقاط شهريًا، وبرو 40 نقطة، والنخبة 120 نقطة.",
        },
        {
          q: "هل ستبقى سيرتي الذاتية تعبّر عني فعلًا؟",
          a: "نعم. يعزز ترشيح خبرتك الحقيقية ويعيد صياغتها، ولا يخترع أبدًا وظائف أو مؤهلات. يمكنك مراجعة كل اقتراح وتعديله قبل التصدير.",
        },
        {
          q: "ما هي صيغ الملفات التي يمكنني رفعها وتنزيلها؟",
          a: "يمكنك رفع ملفات بصيغة PDF أو DOCX، وتصدير سيرتك الذاتية وخطاب التقديم المحسّنين بأي من الصيغتين، جاهزين للتقديم في أي مكان.",
        },
        {
          q: "هل بياناتي الشخصية آمنة؟",
          a: "مستنداتك مشفّرة أثناء النقل والتخزين. نحن لا نبيع بياناتك ولا نستخدمها لتدريب النماذج، ويمكنك حذف ملفاتك نهائيًا في أي وقت.",
        },
        {
          q: "هل أحتاج بطاقة ائتمان للبدء؟",
          a: "لا. الخطة المجانية متاحة للأبد دون الحاجة لبطاقة. طوّر إلى برو أو النخبة فقط عندما تريد نقاطًا أكثر كل شهر.",
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
      terms: "الشروط",
      privacy: "الخصوصية",
      security: "الأمان",
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
      fullNameLabel: "الاسم الكامل",
      fullNamePlaceholder: "اسمك الكامل",
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
        settings: "الإعدادات",
        logout: "تسجيل الخروج",
      },
      generate: {
        eyebrow: "طلب جديد",
        title: "خصّص سيرة ذاتية لوظيفتك القادمة",
        sub: "أنشئ سيرة ذاتية جديدة أو ارفع ملفك الحالي، ثم الصق الوصف الوظيفي ودع ترشيح يتولى الباقي.",
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
        download: "تنزيل PDF",
        preview: "معاينة",
        missingFields: "ارفع سيرتك الذاتية والصق وصفًا وظيفيًا لإنشاء الطلب.",
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
      settings: {
        title: "الإعدادات",
        sub: "إدارة حسابك وتفضيلاتك.",
        accountSection: "الحساب",
        nameLabel: "الاسم الكامل",
        emailLabel: "البريد الإلكتروني",
        passwordSection: "كلمة المرور",
        changePassword: "تغيير كلمة المرور",
        planSection: "الاشتراك",
        planLabel: "الخطة الحالية",
        changePlan: "تغيير الخطة",
        languageSection: "اللغة",
        languageLabel: "اللغة المفضلة",
        languageSaved: "تم الحفظ — ستُطبَّق على أي جهاز تسجّل الدخول منه.",
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
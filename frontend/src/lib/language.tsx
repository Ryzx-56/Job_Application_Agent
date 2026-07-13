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
      login: "Log in",
      getStarted: "Get started",
    },
    hero: {
      badge: "New",
      badgeText: "Cover letters that match any job in seconds",
      headline: "Land more interviews with an AI tailored resume",
      sub: "Upload your CV, paste a job description, and Tarshih rewrites your resume to beat applicant tracking systems, then drafts a matching cover letter you can send with confidence.",
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
          title: "AI resume optimization",
          description:
            "Tarshih rewrites your bullet points to mirror the language of each role, surfacing the impact recruiters actually look for.",
        },
        {
          title: "ATS score improvement",
          description:
            "See a clear score against the job description, then apply one click fixes to get past automated screening filters.",
        },
        {
          title: "Cover letter generator",
          description:
            "Generate a personalized cover letter, in your voice, that references the company and role, with no blank page anxiety.",
        },
        {
          title: "Resume version management",
          description:
            "Save a tailored version for every application and keep your master CV organized in one place.",
        },
        {
          title: "Fast generation",
          description:
            "Go from job posting to a polished, ready-to-send application in under a minute, not an afternoon.",
        },
        {
          title: "Privacy & security",
          description:
            "Your documents are encrypted in transit and at rest. We never train on your data or share it with third parties.",
        },
      ],
    },
    howItWorks: {
      eyebrow: "How it works",
      title: "Three steps to a stronger application",
      description:
        "No learning curve, no templates to fight with. Just upload, paste, and download.",
      steps: [
        {
          step: "01",
          title: "Upload your CV",
          description:
            "Drop in your existing resume as a PDF or DOCX. Tarshih instantly parses your experience, skills, and history.",
        },
        {
          step: "02",
          title: "Paste the job description",
          description:
            "Copy any job posting into Tarshih. It analyzes the requirements and maps them against your background.",
        },
        {
          step: "03",
          title: "Download optimized documents",
          description:
            "Get an ATS ready resume and a tailored cover letter, formatted and ready to submit in one click.",
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
          title: "Scoring you can inspect",
          description:
            "Every ATS score breaks down into keyword match, formatting, and relevance, so you can see exactly why a resume scored the way it did, not just a number.",
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
      description: "Start free and upgrade only when you need unlimited applications. Cancel anytime.",
      mostPopular: "Most popular",
      premiumBadgeLabel: "Premium tier",
      currencyNote: null as string | null,
      plans: [
        {
          name: "Free",
          slug: "free",
          price: "$0",
          priceSar: null as string | null,
          period: "/ month",
          description: "Everything you need to try Tarshih on your next application.",
          features: [
            "3 tailored applications / month",
            "Basic ATS Match Score",
            "Standard processing speed",
            "Small watermark on exported PDF",
          ],
          cta: "Get started free",
          badge: null as string | null,
          featured: false,
          premium: false,
        },
        {
          name: "Pro",
          slug: "pro",
          price: "$12.99",
          priceSar: null as string | null,
          period: "/ month",
          description: "For active job seekers who want unlimited polish, every time.",
          features: [
            "40 tailored applications / month",
            "Tailored CV",
            "Personalized cover letter",
            "ATS Match Score",
            "Fact check pass",
            "No watermark",
            "Application history",
            "Priority processing",
          ],
          cta: "Start Pro",
          badge: "Most Popular",
          featured: true,
          premium: false,
        },
        {
          name: "Elite",
          slug: "elite",
          price: "$34.99",
          priceSar: null as string | null,
          period: "/ month",
          description: "The premium tier for candidates who want every advantage.",
          features: [
            "Unlimited tailored applications",
            "Unlimited tailored CV generations",
            "Unlimited cover letter generations",
            "Highest AI processing priority",
            "Maximum application history",
            "Everything included in Pro",
          ],
          cta: "Go Elite",
          badge: null as string | null,
          featured: false,
          premium: true,
        },
      ],
    },
    payg: {
      eyebrow: "Pay as you go",
      title: "Pay as you go",
      description: "Perfect for users who only need help with a few applications.",
      perApp: "per application",
      cta: "Buy pack",
      packs: [
        { name: "Starter", slug: "starter", price: "$4.99", priceSar: null as string | null, credits: "5 applications", perAppValue: "≈ $1.00", badge: null as string | null, featured: false },
        { name: "Best Value", slug: "best-value", price: "$11.99", priceSar: null as string | null, credits: "15 applications", perAppValue: "≈ $0.80", badge: "Best Value", featured: true },
        { name: "Power", slug: "power", price: "$19.99", priceSar: null as string | null, credits: "30 applications", perAppValue: "≈ $0.67", badge: "Max Savings", featured: false },
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
          q: "Can I use Tarshih for different types of roles?",
          a: "Absolutely. Tarshih works for internships, new-grad roles, engineering positions, and career changes. Save a tailored version for each application you send.",
        },
        {
          q: "Do I need a credit card to start?",
          a: "No. The Free plan is available forever with no card required. Upgrade to Pro only when you want unlimited optimizations and cover letters.",
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
            { label: "Features", href: "#features" },
            { label: "Pricing", href: "#pricing" },
            { label: "How it works", href: "#how-it-works" },
          ],
        },
        {
          title: "Resources",
          links: [
            { label: "Resume guide", href: "#" },
            { label: "ATS tips", href: "#" },
          ],
        },
        {
          title: "Company",
          links: [
            { label: "About", href: "#" },
            { label: "Contact", href: "#" },
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
      login: "تسجيل الدخول",
      getStarted: "ابدأ الآن",
    },
    hero: {
      badge: "جديد",
      badgeText: "خطابات تقديم تُطابق أي وظيفة خلال ثوانٍ",
      headline: "احصل على مقابلات أكثر بسيرة ذاتية مصمّمة بالذكاء الاصطناعي",
      sub: "ارفع سيرتك الذاتية، الصق الوصف الوظيفي، ويقوم ترشيح بإعادة صياغة سيرتك لتجاوز أنظمة تتبع المتقدمين، ثم يكتب خطاب تقديم مطابقًا يمكنك إرساله بثقة.",
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
          title: "تحسين السيرة الذاتية بالذكاء الاصطناعي",
          description:
            "يعيد ترشيح صياغة نقاطك لتعكس لغة كل وظيفة، ويبرز الأثر الذي يبحث عنه المسؤولون عن التوظيف فعلًا.",
        },
        {
          title: "تحسين نتيجة التوافق مع ATS",
          description:
            "شاهد نتيجة واضحة مقارنة بالوصف الوظيفي، ثم طبّق تعديلات بضغطة واحدة لتجاوز أنظمة الفرز الآلي.",
        },
        {
          title: "مولّد خطابات التقديم",
          description:
            "أنشئ خطاب تقديم شخصيًا يشير إلى الشركة والوظيفة، دون قلق الصفحة الفارغة.",
        },
        {
          title: "إدارة نسخ السيرة الذاتية",
          description:
            "احفظ نسخة مخصصة لكل طلب توظيف، وحافظ على سيرتك الأساسية منظمة في مكان واحد.",
        },
        {
          title: "توليد سريع",
          description:
            "انتقل من إعلان الوظيفة إلى طلب متكامل وجاهز للإرسال في أقل من دقيقة، بدلًا من ساعة كاملة.",
        },
        {
          title: "الخصوصية والأمان",
          description:
            "مستنداتك مشفّرة أثناء النقل والتخزين. نحن لا ندرّب النماذج على بياناتك ولا نشاركها مع أي طرف ثالث.",
        },
      ],
    },
    howItWorks: {
      eyebrow: "كيف يعمل",
      title: "ثلاث خطوات لطلب توظيف أقوى",
      description: "بلا منحنى تعلّم، وبلا قوالب معقّدة. فقط ارفع، الصق، ونزّل.",
      steps: [
        {
          step: "01",
          title: "ارفع سيرتك الذاتية",
          description:
            "أرفق سيرتك الحالية بصيغة PDF أو DOCX. يحلّل ترشيح فورًا خبراتك ومهاراتك وتاريخك المهني.",
        },
        {
          step: "02",
          title: "الصق الوصف الوظيفي",
          description:
            "انسخ أي إعلان وظيفي إلى ترشيح. سيحلّل المتطلبات ويطابقها مع خلفيتك المهنية.",
        },
        {
          step: "03",
          title: "نزّل المستندات المحسّنة",
          description:
            "احصل على سيرة ذاتية جاهزة لأنظمة ATS وخطاب تقديم مخصص، منسّقين وجاهزين للإرسال بضغطة واحدة.",
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
          title: "نتائج يمكنك فهمها بالتفصيل",
          description:
            "تنقسم كل نتيجة ATS إلى تطابق الكلمات المفتاحية والتنسيق والملاءمة، لتعرف بالضبط سبب النتيجة، لا مجرد رقم.",
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
        "ابدأ مجانًا وطوّر خطتك فقط عند الحاجة لمزيد من الطلبات. ألغِ الاشتراك في أي وقت.",
      mostPopular: "الأكثر رواجًا",
      premiumBadgeLabel: "الفئة المميزة",
      currencyNote: "الأسعار بالدولار الأمريكي، والقيمة المقابلة بالريال السعودي للمرجعية فقط (1$ ≈ 3.75 ر.س).",
      plans: [
        {
          name: "مجاني",
          slug: "free",
          price: "0$",
          priceSar: "0 ر.س",
          period: "شهريًا",
          description: "كل ما تحتاجه لتجربة ترشيح في طلبك القادم.",
          features: [
            "3 طلبات مخصصة شهريًا",
            "نتيجة تطابق ATS أساسية",
            "سرعة معالجة عادية",
            "علامة مائية صغيرة على ملف PDF المُصدَّر",
          ],
          cta: "ابدأ مجانًا",
          badge: null as string | null,
          featured: false,
          premium: false,
        },
        {
          name: "برو",
          slug: "pro",
          price: "12.99$",
          priceSar: "≈ 48.71 ر.س",
          period: "شهريًا",
          description: "لمن يبحث عن عمل بنشاط ويريد نتائج مصقولة وغير محدودة تقريبًا.",
          features: [
            "40 طلبًا مخصصًا شهريًا",
            "سيرة ذاتية مخصصة",
            "خطاب تقديم شخصي",
            "نتيجة تطابق ATS",
            "مراجعة تحقق من الحقائق",
            "بدون علامة مائية",
            "سجل الطلبات",
            "معالجة ذات أولوية",
          ],
          cta: "ابدأ مع برو",
          badge: "الأكثر رواجًا",
          featured: true,
          premium: false,
        },
        {
          name: "النخبة",
          slug: "elite",
          price: "34.99$",
          priceSar: "≈ 131.21 ر.س",
          period: "شهريًا",
          description: "الفئة المميزة لمن يريد كل ميزة ممكنة في طلباته.",
          features: [
            "طلبات مخصصة غير محدودة",
            "توليد غير محدود للسيرة الذاتية المخصصة",
            "توليد غير محدود لخطابات التقديم",
            "أعلى أولوية في معالجة الذكاء الاصطناعي",
            "أقصى سجل للطلبات",
            "كل ما في خطة برو",
          ],
          cta: "انضم إلى النخبة",
          badge: null as string | null,
          featured: false,
          premium: true,
        },
      ],
    },
    payg: {
      eyebrow: "الدفع حسب الاستخدام",
      title: "الدفع حسب الاستخدام",
      description: "مثالي لمن يحتاج مساعدة في عدد قليل من الطلبات فقط.",
      perApp: "لكل طلب",
      cta: "شراء الحزمة",
      packs: [
        {
          name: "البداية",
          slug: "starter",
          price: "4.99$",
          priceSar: "≈ 18.71 ر.س",
          credits: "5 طلبات",
          perAppValue: "≈ 1.00$",
          badge: null as string | null,
          featured: false,
        },
        {
          name: "أفضل قيمة",
          slug: "best-value",
          price: "11.99$",
          priceSar: "≈ 44.96 ر.س",
          credits: "15 طلبًا",
          perAppValue: "≈ 0.80$",
          badge: "أفضل قيمة",
          featured: true,
        },
        {
          name: "الأقوى",
          slug: "power",
          price: "19.99$",
          priceSar: "≈ 74.96 ر.س",
          credits: "30 طلبًا",
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
          a: "نظام تتبع المتقدمين هو برنامج تستخدمه الشركات لفرز السير الذاتية قبل أن يطّلع عليها شخص حقيقي. يحلّل ترشيح كل وصف وظيفي ويحسّن سيرتك الذاتية لتُقرأ بوضوح من قبل النظام الآلي والمسؤول عن التوظيف على حد Apparel.",
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
          q: "هل يمكنني استخدام ترشيح لأنواع مختلفة من الوظائف؟",
          a: "بالتأكيد. يعمل ترشيح مع التدريب، ووظائف الخريجين الجدد، والوظائف الهندسية، وتغيير المسار المهني. احفظ نسخة مخصصة لكل طلب ترسله.",
        },
        {
          q: "هل أحتاج بطاقة ائتمان للبدء؟",
          a: "لا. الخطة المجانية متاحة للأبد دون الحاجة لبطاقة. طوّر إلى الخطة الاحترافية فقط عندما تريد عمليات تحسين وخطابات تقديم غير محدودة.",
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
            { label: "المميزات", href: "#features" },
            { label: "الأسعار", href: "#pricing" },
            { label: "كيف يعمل", href: "#how-it-works" },
          ],
        },
        {
          title: "مصادر",
          links: [
            { label: "دليل السيرة الذاتية", href: "#" },
            { label: "نصائح ATS", href: "#" },
          ],
        },
        {
          title: "الشركة",
          links: [
            { label: "من نحن", href: "#" },
            { label: "تواصل معنا", href: "#" },
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
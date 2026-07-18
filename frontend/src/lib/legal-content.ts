// lib/legal-content.ts
//
// Structured content for every document opened from the footer (and the
// auth pages): Terms & Conditions, Privacy Policy, Security, About,
// Resume Guide, ATS Tips, and Contact. Kept separate from language.tsx
// because it's long-form and doesn't need to flow through the `t` object
// used for UI chrome. Components pull the right language version off
// `legalContent[lang][key]` directly.
//
// IMPORTANT: The Terms & Privacy content was drafted to be thorough and
// KSA-aware (PDPL references, freelance-certificate operating structure,
// Moyasar as payment processor, etc.), but it is not a substitute for
// review by a licensed Saudi lawyer before this goes live in production,
// especially around consumer protection and refund-window requirements.

export type LegalSection = { heading: string; body: string[] };
export type LegalDoc = { title: string; updated: string; intro?: string; sections: LegalSection[] };
export type LegalDocKey = "terms" | "privacy" | "security" | "about" | "resumeGuide" | "atsTips" | "contact";
export type Lang = "en" | "ar";

export const legalContent: Record<Lang, Record<LegalDocKey, LegalDoc>> = {
  en: {
    terms: {
      title: "Terms & Conditions",
      updated: "Last updated: July 2026",
      intro:
        "These Terms & Conditions (\"Terms\") govern your access to and use of Tarshih (\"Tarshih\", \"we\", \"us\", \"our\"), including our website, dashboard, and any related services (together, the \"Service\"). By creating an account or using the Service, you agree to these Terms. If you do not agree, do not use the Service.",
      sections: [
        {
          heading: "1. Who we are",
          body: [
            "Tarshih is currently operated by an individual entrepreneur based in Jeddah, Kingdom of Saudi Arabia, providing services under the Kingdom's freelance work document framework. Tarshih is not, at this time, a separately incorporated company. References in these Terms to \"we\", \"us\", or \"Tarshih\" mean the individual operator trading as Tarshih.",
            "Tarshih operates under Freelancing Practitioner Certificate No. FL-547870023, issued by the Saudi Ministry of Human Resources and Social Development to Abdulmalik Yousef Mohammedrabi Hawsawi under the Specialized Services category, Software Engineering specialty, valid from 15 July 2026 to 15 July 2027. You can reach us at tarshih.dev@gmail.com.",
            "We intend to keep this section updated if our legal structure changes, for example upon incorporation, and any such change will not reduce your rights under these Terms.",
          ],
        },
        {
          heading: "2. Eligibility",
          body: [
            "You must be at least 18 years old, or the age of legal majority in your jurisdiction if higher, and able to form a binding contract to use the Service. By using Tarshih, you represent that you meet this requirement.",
            "You are responsible for ensuring your use of the Service complies with the laws that apply to you, including any local restrictions on online contracting, data transfer, or payments.",
          ],
        },
        {
          heading: "3. The Service",
          body: [
            "Tarshih uses artificial intelligence, including third-party AI models, to help you create, upgrade, and tailor resumes (CVs) and cover letters against specific job descriptions, in English or Arabic, and to surface related job postings and applicant tracking system (ATS) and job-match scoring for informational purposes.",
            "The Service is provided on a credit basis. Each generated application (a tailored CV and matching cover letter) consumes credits from your account, at a rate that may differ by language, as described on our pricing page. We may update credit costs, features, or the mechanics of the Service from time to time; material changes will be reflected on the pricing page and, where required, communicated to you in advance.",
          ],
        },
        {
          heading: "4. Accounts",
          body: [
            "You must provide accurate information when creating an account and keep your login credentials confidential. You are responsible for all activity that occurs under your account, whether or not you authorized it, except to the extent caused by our failure to secure the Service.",
            "Notify us immediately at tarshih.dev@gmail.com if you suspect unauthorized access to your account. We may suspend or terminate accounts that provide false information, are used to violate these Terms, or are inactive for an extended period, subject to Section 12 (Termination).",
          ],
        },
        {
          heading: "5. Subscriptions, credits, and billing",
          body: [
            "Tarshih offers a free tier and paid subscription tiers (currently Pro and Elite), each with a monthly credit allotment, as well as one-time pay-as-you-go credit packs. Current pricing, credit allotments, and features are shown on our pricing page and form part of these Terms by reference.",
            "Paid subscriptions renew automatically each billing period until cancelled. Upgrading to a higher tier takes effect immediately and you may be charged a prorated amount. Downgrading or cancelling a subscription does not take effect immediately: your current plan and any remaining credits stay active until the end of the current billing cycle, at which point the new (lower or free) tier applies. On a downgrade specifically, any credits you have not used carry over and are added to the new tier's allotment at renewal, rather than being reset; ordinary month-to-month renewals with no tier change reset to that tier's fixed monthly allotment and do not accumulate indefinitely. You may reverse a scheduled downgrade or cancellation at any time before it takes effect.",
            "Pay-as-you-go credit packs are one-time purchases that do not expire on a monthly cycle, but Tarshih is not obligated to preserve unused credits indefinitely if your account is terminated under Section 12.",
            "Where we run a limited-time promotional price (for example, a founding-member discount restricted to a set number of subscribers), the discounted price applies only to eligible subscribers who purchase during the offer and is honored for as long as the qualifying subscription remains continuously active. Allowing a qualifying subscription to lapse, cancel, or downgrade to Free and later resubscribing may result in the then-current standard price applying instead. We may end a promotional offer once its stated capacity is reached or its stated period ends, without affecting subscribers who already locked in the price.",
            "Payments are processed by a third-party payment processor. We do not store your full card number. All fees are quoted and charged in the currency shown at checkout. Prices do not include Saudi Value Added Tax (VAT) unless stated otherwise; VAT will be added at checkout once and if we are required to register as a VAT taxpayer under Saudi law. You are responsible for any other taxes applicable to your purchase in your jurisdiction.",
            "Except where required by applicable law or expressly stated otherwise, fees already paid and credits already consumed are non-refundable. If a technical failure on our part prevents the Service from delivering a paid-for generation (for example, a credit is deducted but no document is produced), contact tarshih.dev@gmail.com and we will restore the credit or, at our discretion, issue a refund for that specific charge.",
          ],
        },
        {
          heading: "6. Right of withdrawal for digital content",
          body: [
            "Under Saudi Arabia's e-commerce regulations, consumers generally have a right to withdraw from an online purchase within a set period. That right does not apply to digital content or services that are not supplied on a tangible medium once performance has begun with your prior express consent and acknowledgment that you thereby lose the right of withdrawal.",
            "By purchasing a subscription or a pay-as-you-go credit pack and generating at least one tailored document with it, you expressly request that we begin performing the Service immediately and acknowledge that your right of withdrawal ends once that generation is delivered, to the extent permitted by applicable law. If you have not yet used any credit from a purchase, contact tarshih.dev@gmail.com within a reasonable time and we will review the request in line with applicable consumer protection law.",
          ],
        },
        {
          heading: "7. Your content",
          body: [
            "You retain ownership of the CVs, job descriptions, and other material you upload or paste into Tarshih (\"Your Content\"), and of the tailored documents Tarshih generates for you based on it.",
            "You grant us a limited, worldwide license to host, process, and transmit Your Content, including to the third-party AI and infrastructure providers described in our Privacy Policy, solely to operate and improve the Service and for no other purpose. This license ends when Your Content is deleted from our systems, subject to the retention terms in our Privacy Policy.",
            "You represent that you have the right to submit Your Content and that it does not infringe any third party's rights or violate any law.",
          ],
        },
        {
          heading: "8. AI-generated content; no guarantee of outcomes",
          body: [
            "Tarshih is designed to reframe and present information you actually provided, and our pipeline includes a fact-checking step intended to prevent invented experience, credentials, or dates. However, AI systems can make mistakes, and we do not guarantee that generated content is free of errors, omissions, or inaccuracies.",
            "You are solely responsible for reviewing every generated CV, cover letter, ATS score, gap analysis, and job match before relying on it or submitting it to any employer. Do not submit a document you have not personally reviewed and confirmed to be accurate.",
            "We do not guarantee that use of the Service will result in interviews, job offers, ATS pass-through with any specific employer's system, or any other employment outcome. Similar-job suggestions are informational and are not job offers, endorsements, or guarantees of eligibility.",
          ],
        },
        {
          heading: "9. Acceptable use",
          body: [
            "You agree not to: (a) submit false credentials, fabricated experience, or documents intended to defraud an employer or third party; (b) use the Service to build a profile of, impersonate, or harass another person; (c) attempt to reverse engineer, scrape, or extract our models, prompts, or underlying systems; (d) probe, disrupt, or place excessive load on the Service, including via automated means; (e) resell or provide commercial access to the Service without our written permission; or (f) use the Service for any unlawful purpose.",
            "We may suspend or terminate access for violations of this section, in addition to any other remedy available to us.",
          ],
        },
        {
          heading: "10. Intellectual property",
          body: [
            "The Tarshih name, logo, website, dashboard, and underlying software, workflows, and design are our property or that of our licensors and are protected by intellectual property laws. Nothing in these Terms grants you rights in our brand or technology beyond the limited right to use the Service as intended.",
            "Feedback you voluntarily send us about the Service may be used by us without restriction or compensation to you.",
          ],
        },
        {
          heading: "11. Third-party services",
          body: [
            "Delivering the Service relies on third-party providers, including AI model providers and search providers used to tailor documents and surface similar jobs, an authentication and database provider, and a payment processor. These providers process data on our behalf under their own terms and, where applicable, data processing agreements, as described further in our Privacy Policy. We select providers with appropriate safeguards but are not responsible for outages or failures caused solely by a third-party provider outside our control.",
          ],
        },
        {
          heading: "12. Privacy",
          body: [
            "Our Privacy Policy explains what personal data we collect, why, and your rights regarding it, and is incorporated into these Terms by reference. By using the Service, you consent to the data practices described there.",
          ],
        },
        {
          heading: "13. Termination",
          body: [
            "You may stop using the Service and delete your account at any time from your dashboard settings or by emailing tarshih.dev@gmail.com.",
            "We may suspend or terminate your account, with notice where practicable, if you materially breach these Terms, if required by law, or if we discontinue the Service. On termination, your right to use the Service ends immediately; unused pay-as-you-go credits and any remaining subscription period are forfeited except where a refund is required by applicable law or expressly provided under Section 5.",
            "Sections that by their nature should survive termination (including Sections 7, 9, 14, 15, and 16) continue to apply after your account is closed.",
          ],
        },
        {
          heading: "14. Disclaimer of warranties",
          body: [
            "The Service is provided \"as is\" and \"as available\", without warranties of any kind, whether express, implied, or statutory, including implied warranties of merchantability, fitness for a particular purpose, and non-infringement, to the maximum extent permitted by applicable law. We do not warrant that the Service will be uninterrupted, error-free, or fully secure.",
          ],
        },
        {
          heading: "15. Limitation of liability",
          body: [
            "To the maximum extent permitted by applicable law, Tarshih will not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, employment opportunity, revenue, data, or goodwill, arising from or related to your use of the Service, even if advised of the possibility of such damages.",
            "To the maximum extent permitted by applicable law, our total aggregate liability arising from or related to these Terms or the Service will not exceed the greater of (a) the amount you paid us in the six months preceding the claim, or (b) 100 SAR.",
            "Nothing in these Terms limits liability that cannot be limited under applicable law, including liability for our gross negligence, willful misconduct, or fraud.",
          ],
        },
        {
          heading: "16. Indemnification",
          body: [
            "You agree to indemnify and hold Tarshih harmless from claims, damages, and reasonable expenses arising from Your Content, your breach of these Terms, or your violation of any law or third-party right, except to the extent caused by our own breach of these Terms.",
          ],
        },
        {
          heading: "17. Governing law and disputes",
          body: [
            "These Terms are governed by the laws of the Kingdom of Saudi Arabia. Any dispute arising from these Terms or the Service that cannot be resolved informally will be subject to the exclusive jurisdiction of the competent courts of the Kingdom of Saudi Arabia, without prejudice to any mandatory consumer-protection rights you may have under the laws of your place of residence.",
            "Before filing a claim, please contact us at tarshih.dev@gmail.com; most issues can be resolved directly and faster than through formal proceedings.",
          ],
        },
        {
          heading: "18. Changes to these Terms",
          body: [
            "We may update these Terms from time to time. If we make material changes, we will post the updated Terms with a new \"Last updated\" date and, where required by law, provide additional notice. Continuing to use the Service after changes take effect means you accept the updated Terms.",
          ],
        },
        {
          heading: "19. Miscellaneous",
          body: [
            "If any provision of these Terms is found unenforceable, the remaining provisions remain in full force. Our failure to enforce a provision is not a waiver of it. You may not assign these Terms without our consent; we may assign these Terms in connection with a reorganization or transfer of the business operating Tarshih. These Terms, together with our Privacy Policy and the pricing page, are the entire agreement between you and us regarding the Service.",
          ],
        },
        {
          heading: "20. Contact",
          body: ["Questions about these Terms can be sent to tarshih.dev@gmail.com."],
        },
      ],
    },
    privacy: {
      title: "Privacy Policy",
      updated: "Last updated: July 2026",
      intro:
        "This Privacy Policy explains how Tarshih collects, uses, shares, and protects your personal data when you use our website and dashboard (the \"Service\"), and the rights available to you, including under the Kingdom of Saudi Arabia's Personal Data Protection Law (PDPL).",
      sections: [
        {
          heading: "1. Who is responsible for your data",
          body: [
            "Tarshih is currently operated by an individual entrepreneur based in Jeddah, Kingdom of Saudi Arabia, who acts as the data controller for the personal data described in this policy. You can reach us at tarshih.dev@gmail.com for any privacy question or request.",
          ],
        },
        {
          heading: "2. Data we collect",
          body: [
            "Account data: your name, email address, password (stored in hashed form by our authentication provider), preferred language, and selected subscription tier.",
            "Content data: the CVs, job descriptions, cover letter drafts, and any other material you upload, paste, or generate through the Service, including resulting tailored documents, ATS/match scores, gap analyses, and job-match results.",
            "Billing data: subscription tier, credit balance and usage history, and transaction records. Full payment card details are collected and processed directly by our payment processor and are not stored on our servers.",
            "Usage and device data: log data such as IP address, browser type, device information, pages viewed, and timestamps, collected automatically to operate and secure the Service.",
          ],
        },
        {
          heading: "3. How we use your data",
          body: [
            "To provide the Service: parsing your CV, analyzing job descriptions, generating tailored CVs and cover letters, calculating ATS and job-match scores, identifying gaps, and surfacing similar job postings.",
            "To operate your account: authentication, credit tracking, billing, customer support, and service-related communications (for example, confirming a plan change or responding to a support request).",
            "To maintain and improve the Service: monitoring performance, diagnosing and fixing errors, and understanding aggregate usage patterns, using data that is anonymized or aggregated where feasible.",
            "To meet legal obligations, prevent fraud or abuse, and enforce our Terms & Conditions.",
            "We do not use Your Content to train our own foundational AI models. Content sent to third-party AI providers is processed under those providers' API terms in order to generate your requested output; we do not authorize those providers to use it to train models serving other customers, to the extent their own commercial API terms allow us to make that election.",
          ],
        },
        {
          heading: "4. Who we share data with",
          body: [
            "We share personal data only with service providers who process it on our behalf to deliver the Service (\"sub-processors\"), and only to the extent necessary for the purpose each one serves:",
            "• AI model and search providers, to parse content, tailor documents, generate cover letters, calculate scores, and find similar jobs.",
            "• Our authentication, database, and hosting provider, to store your account, content, and application data securely.",
            "• Our payment processor, to handle subscription billing and pay-as-you-go purchases.",
            "We do not sell your personal data, and we do not share it with third parties for their own independent marketing purposes.",
            "We may disclose data if required to comply with a valid legal process, to protect the rights, property, or safety of Tarshih, our users, or others, or in connection with a merger, acquisition, or sale of assets, subject to this policy continuing to apply to previously collected data.",
          ],
        },
        {
          heading: "5. International data transfers",
          body: [
            "Some of our service providers may process data on servers located outside the Kingdom of Saudi Arabia. Where this occurs, we take reasonable steps to use providers that maintain appropriate safeguards for the data, consistent with the requirements of the PDPL for transferring personal data outside the Kingdom.",
          ],
        },
        {
          heading: "6. Data retention",
          body: [
            "We retain your account and content data for as long as your account remains active, so that your resume history, generated documents, and settings stay available to you. If you delete your account, we will delete or anonymize your personal data within a reasonable period, except where we are required to retain certain records (such as billing records) for legal, tax, or accounting purposes, or to resolve disputes.",
            "You can request deletion of specific uploaded content or your entire account at any time from your dashboard or by emailing tarshih.dev@gmail.com.",
          ],
        },
        {
          heading: "7. Data security",
          body: [
            "We use encryption in transit and at rest, access controls limiting who can reach production data, and industry-standard authentication practices. No system is completely secure, and we cannot guarantee absolute security, but we work to apply reasonable and appropriate technical and organizational measures. See our Security page for more detail.",
          ],
        },
        {
          heading: "8. Your rights",
          body: [
            "Subject to applicable law, including the PDPL, you have the right to: access the personal data we hold about you; request correction of inaccurate data; request deletion of your data; withdraw consent where processing is based on consent, without affecting processing carried out before withdrawal; object to certain processing; and request a copy of your data in a portable format.",
            "To exercise any of these rights, email tarshih.dev@gmail.com. We may need to verify your identity before acting on a request, and may decline requests that are manifestly unfounded, excessive, or where an exemption applies under law.",
          ],
        },
        {
          heading: "9. Cookies and similar technologies",
          body: [
            "We use essential cookies and local storage to keep you signed in and to remember your language preference. These are required for the Service to function and are not subject to consent.",
            "With your consent, given through the cookie banner shown when you first visit, we use Google Analytics to understand in aggregate how the Service is used, for example which pages are visited and how the CV-tailoring flow is used, so we can improve it. If you decline, or later withdraw consent, Google Analytics is not loaded and no analytics cookies are set. You can change your choice at any time from the cookie preferences link in the site footer.",
            "We do not use advertising trackers or sell data derived from cookies to advertisers.",
          ],
        },
        {
          heading: "10. Children's privacy",
          body: [
            "The Service is intended for adults seeking employment and is not directed at children. We do not knowingly collect personal data from anyone under 18. If you believe a child has provided us with personal data, contact us and we will take appropriate steps to delete it.",
          ],
        },
        {
          heading: "11. Changes to this policy",
          body: [
            "We may update this Privacy Policy from time to time. We will post the updated version with a new \"Last updated\" date and, for material changes, provide additional notice where required by law.",
          ],
        },
        {
          heading: "12. Contact",
          body: ["For any privacy question, request, or complaint, email tarshih.dev@gmail.com."],
        },
      ],
    },
    security: {
      title: "Security",
      updated: "Last updated: July 2026",
      intro:
        "Your CV and career information are sensitive. Here's a plain-language summary of how Tarshih protects them. This page is informational and doesn't limit or expand the commitments in our Privacy Policy.",
      sections: [
        {
          heading: "Encryption",
          body: [
            "Data is encrypted in transit between your browser and our servers using HTTPS/TLS, and encrypted at rest in our database and file storage.",
          ],
        },
        {
          heading: "Authentication",
          body: [
            "Account authentication is handled by our authentication provider, which stores passwords using industry-standard hashing rather than plain text. You can also sign in with Google OAuth, in which case we never see or store your Google password.",
          ],
        },
        {
          heading: "Access controls",
          body: [
            "Access to production data is restricted and limited to what is necessary to operate and support the Service. We do not grant broad standing access to user content.",
          ],
        },
        {
          heading: "Payment security",
          body: [
            "Card payments are handled entirely by our payment processor. Tarshih never receives or stores your full card number, expiry date, or CVV on its own servers.",
          ],
        },
        {
          heading: "Third-party AI processing",
          body: [
            "When your CV or a job description is tailored, relevant content is sent to third-party AI providers over encrypted connections solely to generate your requested output. This is described in more detail in our Privacy Policy.",
          ],
        },
        {
          heading: "Data isolation",
          body: [
            "Your resumes, cover letters, and history are scoped to your account and are not visible to other users.",
          ],
        },
        {
          heading: "Reporting a security issue",
          body: [
            "If you believe you've found a security vulnerability in Tarshih, please report it to tarshih.dev@gmail.com with as much detail as possible. Please do not publicly disclose a suspected vulnerability before giving us a reasonable opportunity to address it. We appreciate responsible disclosure and will respond as quickly as we can.",
          ],
        },
      ],
    },
    about: {
      title: "About Tarshih",
      updated: "",
      sections: [
        {
          heading: "A one-person company, built to fix a real problem",
          body: [
            "Tarshih is built and run by Abdulmalik Hawsawi, an AI engineer based in Jeddah, Saudi Arabia. It isn't a large team or a funded startup. It's one person who kept watching capable people, including friends and classmates, get filtered out by applicant tracking systems before a human ever read their resume, and who wanted to actually fix that instead of just complaining about it.",
            "That's also why Tarshih isn't fully free. Every tailored resume runs through several AI models behind the scenes, and every one of those calls costs real money, on every plan, including the free one. The free tier doesn't just break even, it's a direct loss on every person who uses it and never upgrades: we pay for those AI calls out of pocket with no revenue coming back. It exists anyway, on purpose, so anyone can genuinely try Tarshih before deciding it's worth paying for. Pro and Elite subscribers are what cover that loss and keep the whole thing, including the free tier, running.",
          ],
        },
        {
          heading: "What we're trying to solve",
          body: [
            "Two problems, specifically: first, that a strong candidate's resume often doesn't speak the exact language a specific job description needs, so it gets filtered out by automated systems for reasons that have nothing to do with whether they'd actually be good at the job. Second, that good Arabic-language resume tooling barely exists. Most tools either ignore Arabic entirely or produce broken, jumbled output, despite huge demand for it across the region.",
            "Tarshih exists to close both gaps: tailoring that's specific to the job you're applying for, built by multiple specialized AI agents working together instead of one general-purpose prompt, in English or properly formatted Arabic, with a fact-checking step so your real experience gets reframed, never invented.",
          ],
        },
        {
          heading: "Where it's going",
          body: [
            "Tarshih is actively developed and still growing. If something feels rough around the edges, that's honest feedback we want to hear, not something we're trying to hide. You can reach the person actually building this at tarshih.dev@gmail.com.",
          ],
        },
      ],
    },
    resumeGuide: {
      title: "Resume Guide",
      updated: "",
      intro:
        "A short, practical guide to resumes that get past the filter and get read by a human, whether or not you use Tarshih to build one.",
      sections: [
        {
          heading: "1. Start from the job description, not your memory",
          body: [
            "Before you write or edit a single line, read the job description closely and pull out the exact skills, tools, and qualifications it names. Recruiters and ATS software both weigh how closely your resume mirrors that specific language, not just whether you have relevant experience in general.",
          ],
        },
        {
          heading: "2. Use a structure that survives parsing",
          body: [
            "Stick to standard section headings (Experience, Education, Skills), a single column where possible, and avoid putting critical information inside text boxes, tables, headers, or footers. Many ATS parsers silently drop content in those elements, even when it looks fine to your eye.",
          ],
        },
        {
          heading: "3. Quantify your impact",
          body: [
            "\"Improved onboarding process\" is forgettable. \"Redesigned onboarding, cutting new-hire ramp time from 6 weeks to 3\" is not. Wherever you can, attach a number, a percentage, or a scale to what you did.",
          ],
        },
        {
          heading: "4. Keep formatting simple",
          body: [
            "Standard fonts, consistent date formats, and minimal graphics. Save as a text-selectable PDF or .docx, not an image or a scanned file, so both ATS software and humans can actually read it.",
          ],
        },
        {
          heading: "5. Tailor every single application",
          body: [
            "A resume optimized for one job description is rarely optimized for the next one. This is the part Tarshih exists to automate: re-tailoring your resume and cover letter for each role, so you don't have to manually rewrite bullet points every time you apply.",
          ],
        },
      ],
    },
    atsTips: {
      title: "ATS Tips",
      updated: "",
      intro: "Fast, practical fixes to help your resume clear applicant tracking systems.",
      sections: [
        {
          heading: "Quick tips",
          body: [
            "Mirror the job description's exact keywords and phrasing, don't just paraphrase them.",
            "Use standard section headings like \"Experience\" and \"Education\", not creative alternatives.",
            "Avoid tables, text boxes, and columns for anything you need the ATS to actually read.",
            "Spell out acronyms at least once (\"Search Engine Optimization (SEO)\").",
            "Save and submit as a text-based PDF or .docx, never a scanned image.",
            "Keep critical information out of headers and footers; many parsers skip them.",
            "List your job titles clearly and consistently; unusual titles can fail to match the role being searched for.",
            "Use a simple, widely supported font rather than a decorative one.",
            "Name your file clearly, e.g. \"FirstName-LastName-Resume.pdf\", not \"Resume(3)_final_FINAL.pdf\".",
            "Tailor your resume per application. A generic resume, however well formatted, will consistently score lower than one tailored to the specific job description.",
          ],
        },
      ],
    },
    contact: {
      title: "Contact",
      updated: "",
      sections: [
        {
          heading: "Get in touch",
          body: [
            "For support, billing questions, feedback, or anything else, email us at tarshih.dev@gmail.com. We typically reply within one to two business days.",
          ],
        },
      ],
    },
  },
  ar: {
    terms: {
      title: "الشروط والأحكام",
      updated: "آخر تحديث: يوليو 2026",
      intro:
        "تحكم هذه الشروط والأحكام (\"الشروط\") وصولك إلى واستخدامك لترشيح (\"ترشيح\"، \"نحن\")، بما يشمل موقعنا الإلكتروني ولوحة التحكم وأي خدمات مرتبطة (يُشار إليها معًا بـ\"الخدمة\"). بإنشائك حسابًا أو استخدامك للخدمة، فإنك توافق على هذه الشروط. إن لم توافق، يرجى عدم استخدام الخدمة.",
      sections: [
        {
          heading: "1. من نحن",
          body: [
            "تُدار ترشيح حاليًا من قِبل صاحب أعمال فردي مقيم في جدة، المملكة العربية السعودية، ويقدّم الخدمة بموجب نظام وثيقة العمل الحر في المملكة. ترشيح ليست، في الوقت الحالي، شركة مسجّلة بشكل منفصل. الإشارة إلى \"نحن\" أو \"ترشيح\" في هذه الشروط تعني المشغّل الفردي العامل تحت اسم ترشيح.",
            "تعمل ترشيح بموجب وثيقة ممارس حر رقم FL-547870023، الصادرة من وزارة الموارد البشرية والتنمية الاجتماعية السعودية باسم عبدالملك يوسف محمد رابع هوساوي، ضمن فئة الخدمات التخصصية، تخصص هندسة برمجيات، سارية من 15 يوليو 2026 حتى 15 يوليو 2027. يمكنك التواصل معنا على tarshih.dev@gmail.com.",
            "سنحرص على تحديث هذا القسم إذا تغيّر هيكلنا القانوني، مثلًا عند التأسيس كشركة، ولن يقلّل أي تغيير من هذا القبيل من حقوقك بموجب هذه الشروط.",
          ],
        },
        {
          heading: "2. الأهلية",
          body: [
            "يجب أن يكون عمرك 18 عامًا على الأقل، أو سن الرشد القانوني في نطاقك القضائي إن كان أعلى، وأن تكون قادرًا على إبرام عقد ملزم لاستخدام الخدمة. باستخدامك ترشيح، فإنك تقر باستيفائك لهذا الشرط.",
            "أنت مسؤول عن التأكد من أن استخدامك للخدمة يتوافق مع القوانين المطبقة عليك، بما في ذلك أي قيود محلية على التعاقد الإلكتروني أو نقل البيانات أو المدفوعات.",
          ],
        },
        {
          heading: "3. الخدمة",
          body: [
            "تستخدم ترشيح الذكاء الاصطناعي، بما في ذلك نماذج ذكاء اصطناعي من أطراف ثالثة، لمساعدتك على إنشاء وتطوير وتخصيص السير الذاتية وخطابات التقديم وفقًا لأوصاف وظيفية محددة، بالعربية أو الإنجليزية، وإظهار وظائف ذات صلة ونتائج تقييم لأنظمة تتبع المتقدمين (ATS) والتوافق الوظيفي لأغراض معلوماتية.",
            "تُقدَّم الخدمة على أساس نظام النقاط. كل طلب يتم توليده (سيرة ذاتية مخصصة وخطاب تقديم مطابق) يستهلك نقاطًا من حسابك، بمعدل قد يختلف حسب اللغة، كما هو موضح في صفحة الأسعار. يجوز لنا تحديث تكلفة النقاط أو الميزات أو آلية عمل الخدمة من وقت لآخر؛ وستنعكس التغييرات الجوهرية في صفحة الأسعار، وسيتم إبلاغك مسبقًا عند الاقتضاء.",
          ],
        },
        {
          heading: "4. الحسابات",
          body: [
            "يجب عليك تقديم معلومات دقيقة عند إنشاء حساب والحفاظ على سرية بيانات تسجيل الدخول الخاصة بك. أنت مسؤول عن جميع الأنشطة التي تحدث ضمن حسابك، سواء صرّحت بها أم لا، إلا في حال نتجت عن إخفاقنا في تأمين الخدمة.",
            "أبلغنا فورًا على tarshih.dev@gmail.com إذا اشتبهت بوصول غير مصرح به إلى حسابك. يجوز لنا تعليق أو إنهاء الحسابات التي تقدم معلومات كاذبة، أو تُستخدم لانتهاك هذه الشروط، أو تظل غير نشطة لفترة طويلة، وفقًا للبند 12 (الإنهاء).",
          ],
        },
        {
          heading: "5. الاشتراكات والنقاط والفوترة",
          body: [
            "تقدّم ترشيح فئة مجانية وفئات اشتراك مدفوعة (حاليًا برو والنخبة)، لكل منها مخصص شهري من النقاط، إضافة إلى حزم نقاط تُشترى لمرة واحدة (الدفع حسب الاستخدام). تُعرض الأسعار الحالية ومخصصات النقاط والميزات في صفحة الأسعار وتُعد جزءًا من هذه الشروط بالإشارة إليها.",
            "تتجدد الاشتراكات المدفوعة تلقائيًا كل فترة فوترة حتى يتم إلغاؤها. الترقية إلى فئة أعلى تسري فورًا وقد يُحتسب عليك مبلغ تناسبي. لا يسري تخفيض الفئة أو إلغاء الاشتراك فورًا: تبقى خطتك الحالية وأي نقاط متبقية سارية حتى نهاية دورة الفوترة الحالية، وعندها تُطبَّق الفئة الجديدة (الأقل أو المجانية). في حال تخفيض الفئة تحديدًا، تُرحَّل أي نقاط لم تُستخدم وتُضاف إلى مخصص الفئة الجديدة عند التجديد، بدلًا من إعادة تصفيرها؛ أما التجديدات الشهرية الاعتيادية دون تغيير الفئة فتُعيد التعيين إلى المخصص الشهري الثابت لتلك الفئة ولا تتراكم إلى ما لا نهاية. يمكنك التراجع عن تخفيض أو إلغاء مجدوَل في أي وقت قبل سريانه.",
            "حزم الدفع حسب الاستخدام هي مشتريات لمرة واحدة لا تنتهي وفق دورة شهرية، لكن ترشيح غير ملزمة بالحفاظ على النقاط غير المستخدمة إلى أجل غير مسمى إذا تم إنهاء حسابك بموجب البند 12.",
            "عند تفعيل عرض سعر ترويجي محدود المدة (مثل خصم الأعضاء المؤسسين المقتصر على عدد محدد من المشتركين)، يُطبَّق السعر المخفّض فقط على المشتركين المؤهلين الذين يشتركون خلال فترة العرض، ويستمر العمل به طالما بقي الاشتراك المؤهل ساريًا دون انقطاع. السماح بانتهاء أو إلغاء أو تخفيض اشتراك مؤهل إلى الفئة المجانية ثم إعادة الاشتراك لاحقًا قد يؤدي إلى تطبيق السعر القياسي المعمول به حينها بدلًا من ذلك. يجوز لنا إنهاء عرض ترويجي عند بلوغ السعة المعلنة له أو انتهاء مدته المعلنة، دون أن يؤثر ذلك على المشتركين الذين ثبّتوا السعر بالفعل.",
            "تتم معالجة المدفوعات عبر معالج دفع خارجي. نحن لا نخزّن رقم بطاقتك الكامل. تُعرض جميع الرسوم وتُحصَّل بالعملة الظاهرة عند الدفع. لا تشمل الأسعار ضريبة القيمة المضافة السعودية ما لم يُذكر خلاف ذلك؛ وستُضاف الضريبة عند الدفع إذا ومتى أصبحنا ملزمين بالتسجيل كمكلَّف بضريبة القيمة المضافة بموجب النظام السعودي. أنت مسؤول عن أي ضرائب أخرى مطبقة على مشترياتك في نطاقك القضائي.",
            "باستثناء ما يقتضيه القانون المعمول به أو ما هو منصوص عليه صراحة خلاف ذلك، فإن الرسوم المدفوعة والنقاط المستهلكة غير قابلة للاسترداد. إذا حال عطل تقني من جانبنا دون تسليم توليد مدفوع (مثلًا: خُصمت نقطة دون إنتاج مستند)، تواصل معنا على tarshih.dev@gmail.com وسنعيد النقطة أو نصدر، وفق تقديرنا، استردادًا لتلك الرسوم تحديدًا.",
          ],
        },
        {
          heading: "6. حق الرجوع (الاسترداد) في المحتوى الرقمي",
          body: [
            "بموجب أنظمة التجارة الإلكترونية في المملكة العربية السعودية، يتمتع المستهلكون عمومًا بحق الرجوع عن عملية شراء إلكترونية خلال مدة محددة. لا ينطبق هذا الحق على المحتوى الرقمي أو الخدمات التي لا تُسلَّم على وسيط ملموس متى بدأ تنفيذها بموافقتك الصريحة المسبقة وإقرارك بأنك بذلك تفقد حق الرجوع.",
            "بشرائك اشتراكًا أو حزمة نقاط للدفع حسب الاستخدام، وتوليدك مستندًا مخصصًا واحدًا على الأقل باستخدامها، فإنك تطلب صراحةً أن نبدأ بتنفيذ الخدمة فورًا، وتقرّ بأن حق الرجوع لديك ينتهي فور تسليم ذلك المستند، بالقدر الذي يسمح به القانون المعمول به. إذا لم تكن قد استخدمت أي نقطة من عملية شراء بعد، تواصل معنا على tarshih.dev@gmail.com خلال مدة معقولة وسنراجع الطلب بما يتوافق مع نظام حماية المستهلك المعمول به.",
          ],
        },
        {
          heading: "7. محتواك",
          body: [
            "تحتفظ بملكية السير الذاتية والأوصاف الوظيفية وأي مواد أخرى ترفعها أو تلصقها في ترشيح (\"محتواك\")، وكذلك المستندات المخصصة التي تولّدها ترشيح لك بناءً عليها.",
            "أنت تمنحنا ترخيصًا محدودًا وعالميًا لاستضافة ومعالجة ونقل محتواك، بما يشمل مزودي الذكاء الاصطناعي والبنية التحتية من أطراف ثالثة الموضحين في سياسة الخصوصية، وذلك فقط لتشغيل الخدمة وتحسينها ولا لأي غرض آخر. ينتهي هذا الترخيص عند حذف محتواك من أنظمتنا، مع مراعاة شروط الاحتفاظ بالبيانات في سياسة الخصوصية.",
            "أنت تقر بأن لديك الحق في تقديم محتواك وأنه لا ينتهك حقوق أي طرف ثالث أو يخالف أي قانون.",
          ],
        },
        {
          heading: "8. المحتوى المُولَّد بالذكاء الاصطناعي؛ لا ضمان للنتائج",
          body: [
            "صُمّمت ترشيح لإعادة صياغة وعرض المعلومات التي قدّمتها فعليًا، وتتضمن آليتنا خطوة تحقق من الحقائق تهدف إلى منع اختلاق خبرات أو مؤهلات أو تواريخ. مع ذلك، فإن أنظمة الذكاء الاصطناعي قد ترتكب أخطاء، ونحن لا نضمن خلو المحتوى المُولَّد من الأخطاء أو الإغفالات أو عدم الدقة.",
            "أنت وحدك المسؤول عن مراجعة كل سيرة ذاتية وخطاب تقديم ونتيجة ATS وتحليل فجوات ومطابقة وظيفية قبل الاعتماد عليها أو تقديمها لأي جهة عمل. لا تُقدّم مستندًا لم تراجعه شخصيًا وتتأكد من دقته.",
            "نحن لا نضمن أن استخدام الخدمة سيؤدي إلى مقابلات أو عروض عمل أو اجتياز أنظمة ATS الخاصة بأي جهة عمل معينة أو أي نتيجة توظيف أخرى. اقتراحات الوظائف المشابهة معلوماتية فقط وليست عروض عمل أو تزكيات أو ضمانات للأهلية.",
          ],
        },
        {
          heading: "9. الاستخدام المقبول",
          body: [
            "توافق على عدم: (أ) تقديم مؤهلات كاذبة أو خبرات ملفقة أو مستندات بقصد الاحتيال على جهة عمل أو طرف ثالث؛ (ب) استخدام الخدمة لإنشاء ملف تعريفي عن شخص آخر أو انتحال شخصيته أو مضايقته؛ (ج) محاولة الهندسة العكسية لنماذجنا أو استخلاصها أو استخراج الأوامر التوجيهية أو الأنظمة الأساسية؛ (د) اختبار الخدمة أو تعطيلها أو تحميلها بشكل مفرط، بما يشمل عبر وسائل آلية؛ (هـ) إعادة بيع الخدمة أو توفير وصول تجاري إليها دون إذن كتابي منا؛ أو (و) استخدام الخدمة لأي غرض غير قانوني.",
            "يجوز لنا تعليق أو إنهاء الوصول عند انتهاك هذا البند، إضافة إلى أي وسيلة انتصاف أخرى متاحة لنا.",
          ],
        },
        {
          heading: "10. الملكية الفكرية",
          body: [
            "اسم ترشيح وشعارها وموقعها ولوحة التحكم والبرمجيات والتصميم الأساسي مملوكة لنا أو للجهات المرخِّصة لنا ومحمية بموجب قوانين الملكية الفكرية. لا يمنحك شيء في هذه الشروط أي حقوق في علامتنا التجارية أو تقنيتنا تتجاوز الحق المحدود في استخدام الخدمة على النحو المقصود.",
            "أي ملاحظات ترسلها إلينا طواعية بخصوص الخدمة يجوز لنا استخدامها دون قيد أو مقابل لك.",
          ],
        },
        {
          heading: "11. خدمات الأطراف الثالثة",
          body: [
            "يعتمد تقديم الخدمة على مزودين من أطراف ثالثة، بما يشمل مزودي نماذج الذكاء الاصطناعي والبحث المستخدَمين لتخصيص المستندات وإظهار الوظائف المشابهة، ومزود المصادقة وقواعد البيانات، ومعالج الدفع. يعالج هؤلاء المزودون البيانات نيابة عنا بموجب شروطهم الخاصة، وحسب الاقتضاء، اتفاقيات معالجة بيانات، كما هو موضح بمزيد من التفصيل في سياسة الخصوصية. نختار مزودين يوفرون ضمانات مناسبة، لكننا لسنا مسؤولين عن انقطاعات أو أعطال ناتجة حصرًا عن طرف ثالث خارج عن سيطرتنا.",
          ],
        },
        {
          heading: "12. الخصوصية",
          body: [
            "توضح سياسة الخصوصية الخاصة بنا البيانات الشخصية التي نجمعها وسبب جمعها وحقوقك المتعلقة بها، وهي مدرجة ضمن هذه الشروط بالإشارة إليها. باستخدامك الخدمة، فإنك توافق على ممارسات البيانات الموضحة فيها.",
          ],
        },
        {
          heading: "13. الإنهاء",
          body: [
            "يمكنك التوقف عن استخدام الخدمة وحذف حسابك في أي وقت من إعدادات لوحة التحكم أو بمراسلتنا على tarshih.dev@gmail.com.",
            "يجوز لنا تعليق أو إنهاء حسابك، مع الإشعار متى أمكن ذلك عمليًا، إذا خالفت هذه الشروط بشكل جوهري، أو إذا اقتضى القانون ذلك، أو إذا أوقفنا الخدمة. عند الإنهاء، ينتهي حقك في استخدام الخدمة فورًا؛ وتسقط النقاط غير المستخدمة من حزم الدفع حسب الاستخدام وأي فترة اشتراك متبقية، باستثناء ما يقتضيه القانون المعمول به من استرداد أو ما هو منصوص عليه صراحة في البند 5.",
            "تستمر البنود التي تقتضي طبيعتها استمرارها بعد الإنهاء (بما يشمل البنود 7 و9 و14 و15 و16) في السريان بعد إغلاق حسابك.",
          ],
        },
        {
          heading: "14. إخلاء المسؤولية عن الضمانات",
          body: [
            "تُقدَّم الخدمة \"كما هي\" و\"حسب توفرها\"، دون أي ضمانات من أي نوع، صريحة كانت أو ضمنية أو قانونية، بما يشمل الضمانات الضمنية للتسويق والملاءمة لغرض معين وعدم الانتهاك، إلى أقصى حد يسمح به القانون المعمول به. نحن لا نضمن أن تكون الخدمة متواصلة دون انقطاع أو خالية من الأخطاء أو آمنة تمامًا.",
          ],
        },
        {
          heading: "15. تحديد المسؤولية",
          body: [
            "إلى أقصى حد يسمح به القانون المعمول به، لن تكون ترشيح مسؤولة عن أي أضرار غير مباشرة أو عرضية أو خاصة أو تبعية أو تأديبية، أو أي خسارة في الأرباح أو فرص العمل أو الإيرادات أو البيانات أو السمعة، ناشئة عن أو متعلقة باستخدامك للخدمة، حتى لو تم إبلاغنا بإمكانية حدوث هذه الأضرار.",
            "إلى أقصى حد يسمح به القانون المعمول به، لن تتجاوز مسؤوليتنا الإجمالية الناشئة عن أو المتعلقة بهذه الشروط أو الخدمة الأكبر من: (أ) المبلغ الذي دفعته لنا خلال الأشهر الستة السابقة للمطالبة، أو (ب) 100 ريال سعودي.",
            "لا شيء في هذه الشروط يحدّ من المسؤولية التي لا يجوز الحد منها بموجب القانون المعمول به، بما يشمل المسؤولية عن الإهمال الجسيم أو سوء السلوك المتعمد أو الاحتيال من جانبنا.",
          ],
        },
        {
          heading: "16. التعويض",
          body: [
            "توافق على تعويض ترشيح وإبرائها من أي مطالبات أو أضرار أو نفقات معقولة ناشئة عن محتواك، أو مخالفتك لهذه الشروط، أو انتهاكك لأي قانون أو حق لطرف ثالث، باستثناء ما ينتج عن مخالفتنا نحن لهذه الشروط.",
          ],
        },
        {
          heading: "17. القانون الحاكم والنزاعات",
          body: [
            "تخضع هذه الشروط لأنظمة المملكة العربية السعودية. أي نزاع ينشأ عن هذه الشروط أو الخدمة ولا يمكن حله وديًا يخضع للاختصاص القضائي الحصري للمحاكم المختصة في المملكة العربية السعودية، دون الإخلال بأي حقوق حماية للمستهلك إلزامية قد تتمتع بها بموجب أنظمة مكان إقامتك.",
            "قبل رفع أي مطالبة، يرجى التواصل معنا على tarshih.dev@gmail.com؛ يمكن حل معظم المشكلات مباشرة وبشكل أسرع من الإجراءات الرسمية.",
          ],
        },
        {
          heading: "18. التغييرات على هذه الشروط",
          body: [
            "يجوز لنا تحديث هذه الشروط من وقت لآخر. عند إجراء تغييرات جوهرية، سننشر النسخة المحدثة بتاريخ \"آخر تحديث\" جديد، وسنقدم إشعارًا إضافيًا متى اقتضى القانون ذلك. استمرارك في استخدام الخدمة بعد سريان التغييرات يعني قبولك للشروط المحدثة.",
          ],
        },
        {
          heading: "19. أحكام عامة",
          body: [
            "إذا تبيّن أن أي بند من هذه الشروط غير قابل للتنفيذ، تبقى بقية البنود سارية المفعول بالكامل. عدم قيامنا بتطبيق بند ما لا يُعد تنازلًا عنه. لا يجوز لك التنازل عن هذه الشروط دون موافقتنا؛ ويجوز لنا التنازل عنها في سياق إعادة هيكلة أو نقل ملكية النشاط الذي يُشغّل ترشيح. تشكّل هذه الشروط، مع سياسة الخصوصية وصفحة الأسعار، الاتفاقية الكاملة بينك وبيننا بخصوص الخدمة.",
          ],
        },
        {
          heading: "20. التواصل",
          body: ["يمكن إرسال أي استفسارات حول هذه الشروط إلى tarshih.dev@gmail.com."],
        },
      ],
    },
    privacy: {
      title: "سياسة الخصوصية",
      updated: "آخر تحديث: يوليو 2026",
      intro:
        "توضح سياسة الخصوصية هذه كيفية جمع ترشيح لبياناتك الشخصية واستخدامها ومشاركتها وحمايتها عند استخدامك لموقعنا ولوحة التحكم (\"الخدمة\")، والحقوق المتاحة لك، بما يشمل الحقوق بموجب نظام حماية البيانات الشخصية (PDPL) في المملكة العربية السعودية.",
      sections: [
        {
          heading: "1. من المسؤول عن بياناتك",
          body: [
            "تُدار ترشيح حاليًا من قِبل صاحب أعمال فردي مقيم في جدة، المملكة العربية السعودية، والذي يعمل كمتحكم في البيانات الموضحة في هذه السياسة. يمكنك التواصل معنا على tarshih.dev@gmail.com لأي استفسار أو طلب متعلق بالخصوصية.",
          ],
        },
        {
          heading: "2. البيانات التي نجمعها",
          body: [
            "بيانات الحساب: اسمك، بريدك الإلكتروني، كلمة المرور (مخزّنة بصيغة مشفّرة لدى مزود المصادقة لدينا)، لغتك المفضلة، وفئة اشتراكك المختارة.",
            "بيانات المحتوى: السير الذاتية، الأوصاف الوظيفية، مسودات خطابات التقديم، وأي مواد أخرى ترفعها أو تلصقها أو تولّدها عبر الخدمة، بما يشمل المستندات المخصصة الناتجة ونتائج ATS/التوافق وتحليلات الفجوات ونتائج مطابقة الوظائف.",
            "بيانات الفوترة: فئة الاشتراك، رصيد النقاط وسجل الاستخدام، وسجلات المعاملات. يتم جمع ومعالجة تفاصيل بطاقة الدفع الكاملة مباشرة عبر معالج الدفع لدينا ولا تُخزَّن على خوادمنا.",
            "بيانات الاستخدام والجهاز: بيانات السجلّ مثل عنوان IP ونوع المتصفح ومعلومات الجهاز والصفحات المُشاهَدة والطوابع الزمنية، تُجمَع تلقائيًا لتشغيل الخدمة وتأمينها.",
          ],
        },
        {
          heading: "3. كيف نستخدم بياناتك",
          body: [
            "لتقديم الخدمة: تحليل سيرتك الذاتية، تحليل الأوصاف الوظيفية، توليد سير ذاتية وخطابات تقديم مخصصة، حساب نتائج ATS والتوافق الوظيفي، تحديد الفجوات، وإظهار وظائف مشابهة.",
            "لإدارة حسابك: المصادقة، تتبع النقاط، الفوترة، دعم العملاء، والتواصل المتعلق بالخدمة (مثل تأكيد تغيير خطة أو الرد على طلب دعم).",
            "لصيانة الخدمة وتحسينها: مراقبة الأداء، تشخيص الأخطاء وإصلاحها، وفهم أنماط الاستخدام الإجمالية، باستخدام بيانات مجهولة المصدر أو مجمّعة حيثما أمكن.",
            "للوفاء بالالتزامات القانونية، ومنع الاحتيال أو إساءة الاستخدام، وتطبيق شروطنا وأحكامنا.",
            "نحن لا نستخدم محتواك لتدريب نماذج ذكاء اصطناعي أساسية خاصة بنا. تتم معالجة المحتوى المُرسَل إلى مزودي الذكاء الاصطناعي من أطراف ثالثة بموجب شروط واجهة برمجة التطبيقات الخاصة بهم بهدف توليد المخرجات التي طلبتها؛ ونحن لا نأذن لهؤلاء المزودين باستخدامه لتدريب نماذج تخدم عملاء آخرين، بالقدر الذي تسمح لنا شروطهم التجارية الخاصة بذلك.",
          ],
        },
        {
          heading: "4. مع من نشارك بياناتك",
          body: [
            "نشارك البيانات الشخصية فقط مع مزودي خدمات يعالجونها نيابة عنا لتقديم الخدمة (\"معالجو البيانات الفرعيون\")، وفقط بالقدر اللازم للغرض الذي يخدمه كل منهم:",
            "• مزودو نماذج الذكاء الاصطناعي والبحث، لتحليل المحتوى وتخصيص المستندات وتوليد خطابات التقديم وحساب النتائج وإيجاد وظائف مشابهة.",
            "• مزود المصادقة وقواعد البيانات والاستضافة لدينا، لتخزين بيانات حسابك ومحتواك وطلباتك بأمان.",
            "• معالج الدفع لدينا، لإدارة فوترة الاشتراكات ومشتريات الدفع حسب الاستخدام.",
            "نحن لا نبيع بياناتك الشخصية، ولا نشاركها مع أطراف ثالثة لأغراضها التسويقية المستقلة.",
            "قد نكشف عن البيانات إذا اقتضى ذلك الامتثال لإجراء قانوني صحيح، أو لحماية حقوق أو ممتلكات أو سلامة ترشيح أو مستخدمينا أو غيرهم، أو في سياق اندماج أو استحواذ أو بيع أصول، مع استمرار سريان هذه السياسة على البيانات التي سبق جمعها.",
          ],
        },
        {
          heading: "5. نقل البيانات دوليًا",
          body: [
            "قد يعالج بعض مزودي الخدمة لدينا البيانات على خوادم موجودة خارج المملكة العربية السعودية. في هذه الحالة، نتخذ خطوات معقولة لاختيار مزودين يحافظون على ضمانات مناسبة للبيانات، بما يتوافق مع متطلبات نظام حماية البيانات الشخصية لنقل البيانات الشخصية خارج المملكة.",
          ],
        },
        {
          heading: "6. الاحتفاظ بالبيانات",
          body: [
            "نحتفظ ببيانات حسابك ومحتواك طالما ظل حسابك نشطًا، لتبقى سجلات سيرتك الذاتية والمستندات المُولَّدة وإعداداتك متاحة لك. إذا حذفت حسابك، سنحذف أو نُخفي هوية بياناتك الشخصية خلال فترة معقولة، باستثناء ما يلزم الاحتفاظ به من سجلات (مثل سجلات الفوترة) لأغراض قانونية أو ضريبية أو محاسبية، أو لتسوية النزاعات.",
            "يمكنك طلب حذف محتوى محدد تم رفعه أو حذف حسابك بالكامل في أي وقت من لوحة التحكم أو بمراسلتنا على tarshih.dev@gmail.com.",
          ],
        },
        {
          heading: "7. أمن البيانات",
          body: [
            "نستخدم التشفير أثناء النقل وفي حالة التخزين، وضوابط وصول تحدّ ممن يمكنه الوصول إلى بيانات الإنتاج، وممارسات مصادقة وفق معايير الصناعة. لا يوجد نظام آمن تمامًا، ولا يمكننا ضمان أمان مطلق، لكننا نعمل على تطبيق تدابير تقنية وتنظيمية معقولة ومناسبة. راجع صفحة الأمان لمزيد من التفاصيل.",
          ],
        },
        {
          heading: "8. حقوقك",
          body: [
            "وفقًا للقانون المعمول به، بما يشمل نظام حماية البيانات الشخصية، يحق لك: الوصول إلى بياناتك الشخصية التي نحتفظ بها؛ طلب تصحيح البيانات غير الدقيقة؛ طلب حذف بياناتك؛ سحب الموافقة عندما تكون المعالجة مبنية على الموافقة، دون التأثير على المعالجة التي تمت قبل السحب؛ الاعتراض على معالجة معينة؛ وطلب نسخة من بياناتك بصيغة قابلة للنقل.",
            "لممارسة أي من هذه الحقوق، راسلنا على tarshih.dev@gmail.com. قد نحتاج للتحقق من هويتك قبل تنفيذ الطلب، ويجوز لنا رفض الطلبات التي تكون واضحة عدم استنادها لأساس، أو مفرطة، أو التي ينطبق عليها استثناء بموجب القانون.",
          ],
        },
        {
          heading: "9. ملفات تعريف الارتباط والتقنيات المشابهة",
          body: [
            "نستخدم ملفات تعريف ارتباط أساسية وتخزينًا محليًا للحفاظ على تسجيل دخولك وتذكّر لغتك المفضلة. هذه ضرورية لعمل الخدمة ولا تخضع للموافقة.",
            "بموافقتك، عبر شريط ملفات تعريف الارتباط الذي يظهر عند أول زيارة لك، نستخدم Google Analytics لفهم كيفية استخدام الخدمة إجماليًا، مثل الصفحات التي تُزار وكيفية استخدام عملية تخصيص السيرة الذاتية، لنتمكن من تحسينها. إذا رفضت الموافقة، أو سحبتها لاحقًا، لن يتم تحميل Google Analytics ولن تُوضع أي ملفات تعريف ارتباط تحليلية. يمكنك تغيير اختيارك في أي وقت من رابط تفضيلات ملفات تعريف الارتباط في تذييل الموقع.",
            "نحن لا نستخدم متعقبات إعلانية ولا نبيع بيانات مستمدة من ملفات تعريف الارتباط لمعلنين.",
          ],
        },
        {
          heading: "10. خصوصية الأطفال",
          body: [
            "الخدمة موجهة للبالغين الباحثين عن عمل وليست موجهة للأطفال. نحن لا نجمع عن علم بيانات شخصية من أي شخص دون 18 عامًا. إذا كنت تعتقد أن طفلًا قدّم لنا بيانات شخصية، تواصل معنا وسنتخذ الخطوات المناسبة لحذفها.",
          ],
        },
        {
          heading: "11. التغييرات على هذه السياسة",
          body: [
            "يجوز لنا تحديث سياسة الخصوصية هذه من وقت لآخر. سننشر النسخة المحدثة بتاريخ \"آخر تحديث\" جديد، وسنقدم إشعارًا إضافيًا عن التغييرات الجوهرية متى اقتضى القانون ذلك.",
          ],
        },
        {
          heading: "12. التواصل",
          body: ["لأي استفسار أو طلب أو شكوى تتعلق بالخصوصية، راسلنا على tarshih.dev@gmail.com."],
        },
      ],
    },
    security: {
      title: "الأمان",
      updated: "آخر تحديث: يوليو 2026",
      intro:
        "سيرتك الذاتية ومعلوماتك المهنية حسّاسة. إليك ملخص مبسّط لكيفية حمايتها في ترشيح. هذه الصفحة معلوماتية ولا تحدّ أو توسّع الالتزامات الواردة في سياسة الخصوصية.",
      sections: [
        {
          heading: "التشفير",
          body: ["تُشفَّر البيانات أثناء النقل بين متصفحك وخوادمنا عبر HTTPS/TLS، وتُشفَّر في حالة التخزين ضمن قاعدة بياناتنا وتخزين الملفات."],
        },
        {
          heading: "المصادقة",
          body: ["تُدار مصادقة الحساب عبر مزود المصادقة لدينا، الذي يخزّن كلمات المرور بصيغة مشفّرة وفق معايير الصناعة بدلًا من نص عادي. يمكنك أيضًا تسجيل الدخول عبر Google OAuth، وفي هذه الحالة لا نرى كلمة مرور Google الخاصة بك ولا نخزّنها إطلاقًا."],
        },
        {
          heading: "ضوابط الوصول",
          body: ["الوصول إلى بيانات الإنتاج مقيّد ومحدود بما هو ضروري لتشغيل الخدمة ودعمها. نحن لا نمنح وصولًا دائمًا وواسعًا لمحتوى المستخدمين."],
        },
        {
          heading: "أمان المدفوعات",
          body: ["تتم معالجة مدفوعات البطاقات بالكامل عبر معالج الدفع لدينا. ترشيح لا تستلم أو تخزّن أبدًا رقم بطاقتك الكامل أو تاريخ انتهائها أو رمز CVV على خوادمها الخاصة."],
        },
        {
          heading: "معالجة الذكاء الاصطناعي من أطراف ثالثة",
          body: ["عند تخصيص سيرتك الذاتية أو وصف وظيفي، يُرسَل المحتوى ذو الصلة إلى مزودي ذكاء اصطناعي من أطراف ثالثة عبر اتصالات مشفّرة فقط لتوليد المخرجات التي طلبتها. مزيد من التفاصيل موضح في سياسة الخصوصية."],
        },
        {
          heading: "عزل البيانات",
          body: ["سيرك الذاتية وخطابات تقديمك وسجلّك مرتبطة بحسابك فقط وغير مرئية لمستخدمين آخرين."],
        },
        {
          heading: "الإبلاغ عن مشكلة أمنية",
          body: [
            "إذا كنت تعتقد أنك عثرت على ثغرة أمنية في ترشيح، يرجى الإبلاغ عنها على tarshih.dev@gmail.com بأكبر قدر ممكن من التفاصيل. يرجى عدم الإفصاح علنًا عن ثغرة مشتبه بها قبل منحنا فرصة معقولة لمعالجتها. نقدّر الإفصاح المسؤول وسنرد بأسرع ما يمكن.",
          ],
        },
      ],
    },
    about: {
      title: "عن ترشيح",
      updated: "",
      sections: [
        {
          heading: "شركة من شخص واحد، بُنيت لحل مشكلة حقيقية",
          body: [
            "ترشيح مبنية ومُدارة من قِبل عبدالملك هوساوي، مهندس ذكاء اصطناعي مقيم في جدة، السعودية. ليست فريقًا كبيرًا ولا شركة ناشئة ممولة، بل شخص واحد ظل يشاهد أشخاصًا أكفاء، من بينهم أصدقاء وزملاء دراسة، يُستبعَدون بواسطة أنظمة تتبع المتقدمين قبل أن تقرأ سيرهم الذاتية عين إنسان، وأراد فعليًا حل هذه المشكلة بدلًا من مجرد الشكوى منها.",
            "هذا أيضًا سبب عدم كون ترشيح مجانية بالكامل. كل سيرة ذاتية مخصصة تمرّ عبر عدة نماذج ذكاء اصطناعي خلف الكواليس، وكل استدعاء من هذه الاستدعاءات يكلّف مالًا حقيقيًا، في كل فئة، بما فيها الفئة المجانية. الفئة المجانية لا تكتفي بعدم تحقيق ربح، بل هي خسارة مباشرة على كل شخص يستخدمها ولا يشترك لاحقًا: نحن ندفع تكلفة تلك الاستدعاءات من جيبنا دون أي إيراد مقابل. ومع ذلك تبقى موجودة عن قصد، ليتمكن أي شخص من تجربة ترشيح فعليًا قبل أن يقرر أنها تستحق الدفع. مشتركو برو والنخبة هم من يغطون تلك الخسارة ويبقون كل شيء، بما في ذلك الفئة المجانية، قائمًا.",
          ],
        },
        {
          heading: "ما الذي نحاول حله",
          body: [
            "مشكلتان تحديدًا: الأولى، أن سيرة المرشح القوي غالبًا لا تتحدث بالضبط اللغة التي يحتاجها وصف وظيفي معين، فتُستبعَد بواسطة أنظمة آلية لأسباب لا علاقة لها بمدى كفاءته الفعلية في الوظيفة. الثانية، أن أدوات جيدة للسير الذاتية باللغة العربية تكاد لا توجد، إذ تتجاهل معظم الأدوات العربية تمامًا أو تنتج نصوصًا مكسورة ومشوّشة، رغم الطلب الكبير عليها في المنطقة.",
            "توجد ترشيح لسد هاتين الفجوتين: تخصيص محدد للوظيفة التي تتقدم لها، مبني بواسطة عدة وكلاء ذكاء اصطناعي متخصصين يعملون معًا بدلًا من طلب عام واحد، بالعربية المنسّقة بشكل صحيح أو الإنجليزية، مع خطوة تحقق من الحقائق لضمان إعادة صياغة خبرتك الحقيقية لا اختلاقها.",
          ],
        },
        {
          heading: "إلى أين تتجه",
          body: [
            "ترشيح قيد التطوير المستمر ولا تزال تنمو. إذا شعرت أن شيئًا ما يحتاج إلى تحسين، فتلك ملاحظة صادقة نريد سماعها، وليست شيئًا نحاول إخفاءه. يمكنك التواصل مباشرة مع الشخص الذي يبني هذا المشروع فعليًا على tarshih.dev@gmail.com.",
          ],
        },
      ],
    },
    resumeGuide: {
      title: "دليل السيرة الذاتية",
      updated: "",
      intro: "دليل عملي وموجز لسيرة ذاتية تتجاوز الفرز الآلي وتصل إلى إنسان يقرأها، سواء استخدمت ترشيح لبنائها أم لا.",
      sections: [
        {
          heading: "1. ابدأ من الوصف الوظيفي، لا من ذاكرتك",
          body: [
            "قبل أن تكتب أو تعدّل أي سطر، اقرأ الوصف الوظيفي بعناية واستخرج المهارات والأدوات والمؤهلات التي يذكرها بالضبط. يقيّم كل من مسؤولي التوظيف وأنظمة ATS مدى تطابق سيرتك مع تلك اللغة تحديدًا، لا مجرد امتلاكك خبرة ذات صلة بشكل عام.",
          ],
        },
        {
          heading: "2. استخدم بنية تنجو من التحليل الآلي",
          body: [
            "التزم بعناوين أقسام قياسية (الخبرة، التعليم، المهارات)، وعمود واحد ما أمكن، وتجنّب وضع معلومات أساسية داخل مربعات نصية أو جداول أو رؤوس أو تذييلات. تتجاهل أنظمة ATS كثيرًا محتوى هذه العناصر بصمت، حتى وإن بدت سليمة لعينك.",
          ],
        },
        {
          heading: "3. قِس أثرك برقم",
          body: [
            "\"حسّنت عملية التهيئة\" جملة تُنسى. \"أعدت تصميم عملية التهيئة، ما خفّض وقت تأهيل الموظف الجديد من 6 أسابيع إلى 3\" لا تُنسى. أرفق رقمًا أو نسبة أو مقياسًا لما أنجزته كلما أمكن.",
          ],
        },
        {
          heading: "4. حافظ على تنسيق بسيط",
          body: [
            "خطوط قياسية، تنسيق تواريخ متسق، وأقل قدر من الرسومات. احفظها كملف PDF قابل لتحديد النص أو DOCX، لا كصورة أو ملف ممسوح ضوئيًا، ليتمكن كل من أنظمة ATS والبشر من قراءتها فعليًا.",
          ],
        },
        {
          heading: "5. خصّص كل طلب توظيف على حدة",
          body: [
            "السيرة الذاتية المُحسَّنة لوصف وظيفي واحد نادرًا ما تكون محسّنة للوظيفة التالية. هذا هو الجزء الذي وُجدت ترشيح لأتمتته: إعادة تخصيص سيرتك وخطاب تقديمك لكل وظيفة، حتى لا تُعيد كتابة النقاط يدويًا في كل مرة تتقدم فيها.",
          ],
        },
      ],
    },
    atsTips: {
      title: "نصائح ATS",
      updated: "",
      intro: "حلول سريعة وعملية تساعد سيرتك الذاتية على تجاوز أنظمة تتبع المتقدمين.",
      sections: [
        {
          heading: "نصائح سريعة",
          body: [
            "طابِق الكلمات المفتاحية والصياغة الدقيقة في الوصف الوظيفي، لا مجرد إعادة صياغتها.",
            "استخدم عناوين أقسام قياسية مثل \"الخبرة\" و\"التعليم\"، لا بدائل إبداعية.",
            "تجنّب الجداول والمربعات النصية والأعمدة لأي معلومة تحتاج أن يقرأها نظام ATS فعليًا.",
            "اكتب المختصرات كاملة مرة واحدة على الأقل (\"تحسين محركات البحث (SEO)\").",
            "احفظ وأرسل الملف كـ PDF نصي أو DOCX، وليس أبدًا كصورة ممسوحة ضوئيًا.",
            "أبقِ المعلومات الأساسية بعيدة عن الرؤوس والتذييلات؛ فكثير من المحلّلات الآلية تتجاهلها.",
            "اذكر مسمياتك الوظيفية بوضوح واتساق؛ فالمسميات غير المألوفة قد لا تُطابق الوظيفة المُبحث عنها.",
            "استخدم خطًا بسيطًا مدعومًا على نطاق واسع بدلًا من خط زخرفي.",
            "سمِّ ملفك بوضوح، مثل \"الاسم-اللقب-سيرة-ذاتية.pdf\"، لا \"سيرة(3)_نهائي_أخير.pdf\".",
            "خصّص سيرتك الذاتية لكل طلب توظيف. السيرة العامة، مهما كان تنسيقها جيدًا، ستحصل باستمرار على نتيجة أقل من سيرة مخصصة للوصف الوظيفي المحدد.",
          ],
        },
      ],
    },
    contact: {
      title: "تواصل معنا",
      updated: "",
      sections: [
        {
          heading: "تواصل معنا",
          body: [
            "للدعم الفني أو استفسارات الفوترة أو الملاحظات أو أي شيء آخر، راسلنا على tarshih.dev@gmail.com. عادةً ما نرد خلال يوم إلى يومي عمل.",
          ],
        },
      ],
    },
  },
};

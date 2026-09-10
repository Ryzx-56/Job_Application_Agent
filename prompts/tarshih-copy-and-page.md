# Tarshih — DOCX copy and the /build-cv page

Content only. The prompt is a separate file.

---

## Part 1 — The DOCX-for-Arabic copy

Goes in the §12c download format dialog. Shown when the CV being downloaded is
Arabic; hidden for English CVs, where it isn't true and would just add noise.

**Placement:** a short line under the Word option, not a warning banner. This is
a recommendation, not an error, and it should read like helpful advice rather
than an apology for a limitation.

### English

> **Word** — recommended for Arabic
> Applicant tracking systems read Arabic text more reliably from Word files.

If there's only room for one line:

> Recommended for Arabic — applicant tracking systems read it more reliably.

### Arabic

> **Word** — يُفضّل للسيرة العربية
> أنظمة التوظيف تقرأ النص العربي من ملفات Word بدقة أعلى.

Single line version:

> يُفضّل للسيرة العربية — أنظمة التوظيف تقرأ النص العربي منه بدقة أعلى.

### Why it's worded this way

It says what to do and why, without claiming the PDF is broken. The PDF is
visually perfect and fine for a human reader — someone emailing a CV directly
to a hiring manager has no reason to avoid it. The recommendation is
specifically about machine parsing, so the copy says exactly that and no more.

Avoid anything like "our PDF has a problem with Arabic". It's more alarming than
the situation warrants and it makes a working option look unusable.

---

## Part 2 — The `/build-cv` public page

The SEO and conversion landing page for the public CV-creation flow. Lives
beside `/pricing` and `/guides` under the existing `[lang]` segment, inherits the
marketing layout, and is in the sitemap — unlike `/dashboard`, which is now
`noindex`.

**Target searches.** English: *build a CV, CV builder, ATS-friendly CV, CV for
Saudi jobs*. Arabic: *إنشاء سيرة ذاتية، سيرة ذاتية احترافية، سيرة ذاتية ATS،
قالب سيرة ذاتية*.

**The form is on this page**, not behind a link to it. Someone arriving from
Google should be able to start typing immediately — that's the point of the
deferred-signup work. The account wall appears at Generate.

### Page structure

```
H1 + subhead
    ↓
The CV form itself (above the fold on desktop, immediately below on mobile)
    ↓
How it works — 3 steps
    ↓
What an ATS is and why it rejects CVs   ← the SEO body, and the education
    ↓
Arabic and English
    ↓
What you get free
    ↓
FAQ  ← long-tail search
```

### English copy

**H1:** Build a CV that gets read

**Subhead:** Paste the job posting, add your details, and get a CV written for
that specific role — in English or Arabic, formatted so applicant tracking
systems can actually read it.

**How it works**

1. **Add your details.** Type them in, or upload a CV you already have and we'll
   pull the information out of it.
2. **Paste the job posting.** The whole thing — we read the requirements and work
   out what matters.
3. **Get a tailored CV.** Rewritten for that role, with a match score showing how
   well you fit and what's missing.

**Why most CVs never reach a person**

Most employers run applications through an applicant tracking system before
anyone reads them. The software pulls text out of your file and matches it
against the role. If it can't read your file properly, or the words don't line up
with the posting, the application stops there — and you never find out why.

Two things go wrong most often. The formatting confuses the parser: columns, text
boxes, headers and graphics that look fine to you and come out as scrambled text
to the machine. And the wording doesn't match: you wrote "managed a team", the
posting says "team leadership", and nothing connects them.

Tarshih handles both. Every CV is built in a layout parsers can read, and the
wording is rewritten against the posting you paste — using your real experience,
not invented claims.

**Arabic and English**

Write in either. Arabic CVs are laid out right-to-left properly, with Arabic
typography rather than a mirrored English template — and the job matching works
in both languages.

**What you get free**

Three CVs, the ATS score on every one, and a cover letter. No card needed to
start.

**FAQ**

*Do I need an account?*
Not to start. Fill in your details and see the whole form first — you'll only
need an account when you generate.

*Will it invent things about me?*
No. It rewrites what you give it and can add skills your own descriptions already
demonstrate, but it won't claim experience you never mentioned. A fact-checking
pass runs over every CV before you see it.

*Is my information kept private?*
Your details stay in your browser until you create an account. After that they
belong to your account and you can delete everything from your settings page at
any time.

*What file do I get?*
PDF or Word, your choice. For Arabic, Word is the safer option for applicant
tracking systems.

*Does it work for jobs in Saudi Arabia?*
That's what it was built for. Job matching searches your city first, then your
country.

### Arabic copy

**H1:** اصنع سيرة ذاتية تُقرأ فعلاً

**Subhead:** الصق إعلان الوظيفة، أضف بياناتك، واحصل على سيرة ذاتية مكتوبة لهذه
الوظيفة تحديدًا — بالعربية أو الإنجليزية، ومنسّقة بحيث تستطيع أنظمة التوظيف
قراءتها.

**كيف تعمل**

1. **أضف بياناتك.** اكتبها، أو ارفع سيرتك الحالية ونستخرج المعلومات منها.
2. **الصق إعلان الوظيفة.** كاملًا — نقرأ المتطلبات ونحدد ما يهم منها.
3. **احصل على سيرة مخصّصة.** مُعاد كتابتها لهذه الوظيفة، مع درجة توافق توضح مدى
   ملاءمتك وما ينقصك.

**لماذا لا تصل أغلب السير الذاتية إلى موظف التوظيف**

معظم جهات العمل تمرّر الطلبات على نظام تتبّع المتقدمين قبل أن يقرأها أحد. البرنامج
يستخرج النص من ملفك ويطابقه مع الوظيفة. وإذا لم يستطع قراءة الملف بشكل صحيح، أو لم
تتطابق الصياغة مع الإعلان، يتوقف الطلب عند هذه النقطة — دون أن تعرف السبب.

المشكلتان الأكثر تكرارًا: تنسيق يربك البرنامج — أعمدة ومربعات نصية ورسومات تبدو
جيدة أمامك وتخرج نصًا مبعثرًا أمام النظام. وصياغة لا تتطابق: كتبت "أدرت فريقًا"،
والإعلان يقول "قيادة فريق"، ولا شيء يربط بينهما.

ترشيح يعالج الأمرين. كل سيرة تُبنى بتنسيق تقرأه الأنظمة، والصياغة يُعاد كتابتها
مقابل الإعلان الذي تلصقه — من خبرتك الحقيقية، دون ادعاءات مُختلقة.

**بالعربية والإنجليزية**

اكتب بأيّهما شئت. السير العربية تُنسّق من اليمين إلى اليسار كما ينبغي، بخطوط عربية
حقيقية لا قالب إنجليزي معكوس — ومطابقة الوظائف تعمل باللغتين.

**ما تحصل عليه مجانًا**

ثلاث سير ذاتية، ودرجة ATS لكل واحدة، وخطاب تقديم. دون بطاقة.

**الأسئلة الشائعة**

*هل أحتاج حسابًا؟*
ليس للبدء. عبّئ بياناتك واطّلع على النموذج كاملًا أولًا — الحساب مطلوب عند الإنشاء
فقط.

*هل يختلق معلومات عني؟*
لا. يعيد صياغة ما تكتبه، وقد يضيف مهارات يثبتها وصفك بنفسه، لكنه لن يدّعي خبرة لم
تذكرها. تمرّ كل سيرة على مرحلة تدقيق قبل أن تصلك.

*هل بياناتي محفوظة بخصوصية؟*
تبقى بياناتك في متصفحك حتى تنشئ حسابًا. بعدها تصبح ملك حسابك، ويمكنك حذف كل شيء من
صفحة الإعدادات متى شئت.

*ما صيغة الملف؟*
PDF أو Word، باختيارك. وللعربية، Word هو الخيار الأنسب لأنظمة التوظيف.

*هل يعمل مع وظائف السعودية؟*
لهذا بُني. مطابقة الوظائف تبحث في مدينتك أولًا، ثم في بلدك.

### Notes on the copy

- **No hype and no exclamation marks**, matching the tone rules for the rest of
  the site. Every claim is something the product actually does.
- **"Three CVs free" must match `FREE_TIER_CREDITS`.** It's a pricing claim on a
  public page — read it from the constant, don't hardcode it.
- **The ATS section is the SEO body.** It's long on purpose: it targets
  informational searches and it's genuinely useful, which is what makes it rank
  rather than read as keyword filler.
- **The Arabic is written natively**, not translated from the English. The two say
  the same things, not in the same sentences — a translated landing page reads
  like one.
- **Check the credits terminology.** The payment success screen currently says
  "نقاط" (points). If the pricing page says something else, pick one and make the
  whole Arabic UI agree.

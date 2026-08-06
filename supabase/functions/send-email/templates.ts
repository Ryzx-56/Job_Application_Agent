// templates.ts
// Branded, bilingual (EN/AR) HTML templates for Tarshih's transactional
// auth emails, sent via the "Send Email" hook (see index.ts).
//
// Design notes:
//  - Table-based layout + inline styles only — no flexbox/grid/external CSS,
//    since email clients (Outlook desktop in particular) don't render those
//    reliably.
//  - Arabic uses dir="rtl" plus align="right" table attributes (not just
//    CSS text-align, which some clients strip), and keeps raw URLs inside
//    an LTR-forced <span> so they don't get visually reversed.
//  - Brand values mirror frontend/src/components/brand.tsx (Button/Logo)
//    and frontend/src/app/globals.css: primary blue #2563eb, dark navy
//    heading text #0f172a, Plus Jakarta Sans (EN) / Cairo (AR).
//  - Logo is served as a PNG (frontend/public/email/tarshih-logo-{lang}.png,
//    generated from the site's own Logo_2_dark / Logo_2_A_dark SVGs) since
//    Outlook desktop doesn't render inline SVG in emails.

export type EmailType = "signup" | "recovery" | "magiclink" | "invite" | "email_change";
type Lang = "ar" | "en";

interface TemplateResult {
  subject: string;
  html: string;
}

interface RenderOptions {
  siteUrl: string; // used to build an absolute URL for the logo image
  name?: string; // user's full name, if available, for the greeting
}

const BRAND = {
  bg: "#f4f5f7",
  card: "#ffffff",
  border: "#e5e7eb",
  heading: "#0f172a",
  body: "#52525b",
  muted: "#9ca3af",
  primary: "#2563eb",
};

const FONT_STACK: Record<Lang, string> = {
  en: "'Plus Jakarta Sans','Segoe UI',Helvetica,Arial,sans-serif",
  ar: "'Cairo','Segoe UI',Tahoma,Arial,sans-serif",
};

function firstName(fullName?: string): string {
  return fullName?.trim().split(/\s+/)[0] ?? "";
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The shared visual shell every auth email uses: logo header, card, CTA
 * button, footer sign-off. `bodyHtml` is the pre-built inner HTML for the
 * message-specific paragraphs.
 */
function renderShell(opts: {
  lang: Lang;
  siteUrl: string;
  preheader: string;
  eyebrow: string;
  heading: string;
  bodyHtml: string;
  buttonLabel: string;
  buttonUrl: string;
  footerNote: string;
}): string {
  const { lang, siteUrl, preheader, eyebrow, heading, bodyHtml, buttonLabel, buttonUrl, footerNote } = opts;
  const dir = lang === "ar" ? "rtl" : "ltr";
  const align = lang === "ar" ? "right" : "left";
  const font = FONT_STACK[lang];
  const logoUrl = `${siteUrl.replace(/\/+$/, "")}/email/tarshih-logo-${lang}.png`;
  const logoAlt = lang === "ar" ? "شعار ترشيح" : "Tarshih";
  const signOff = lang === "ar" ? "فريق ترشيح" : "The Tarshih Team";
  const rawLinkLabel =
    lang === "ar"
      ? "إذا لم يعمل الزر، انسخ الرابط التالي والصقه في متصفحك:"
      : "If the button doesn't work, copy and paste this link into your browser:";
  const safeButtonUrl = escapeHtml(buttonUrl); // confirmation URLs contain literal "&" between query params

  return `<!doctype html>
<html dir="${dir}" lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.bg};direction:${dir};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${BRAND.bg};">
      ${escapeHtml(preheader)}
      &#8203;&zwnj;&nbsp;&#8203;&zwnj;&nbsp;&#8203;&zwnj;&nbsp;&#8203;&zwnj;&nbsp;&#8203;&zwnj;&nbsp;
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:36px 40px 8px 40px;">
                <img src="${logoUrl}" alt="${logoAlt}" height="40" style="height:40px;width:auto;display:block;border:0;outline:none;" />
              </td>
            </tr>
            <tr>
              <td align="${align}" dir="${dir}" style="padding:24px 40px 0 40px;font-family:${font};">
                <p style="margin:0 0 8px 0;font-size:12px;font-weight:700;letter-spacing:0.06em;color:${BRAND.primary};text-transform:uppercase;">
                  ${escapeHtml(eyebrow)}
                </p>
                <h1 style="margin:0 0 16px 0;font-size:23px;line-height:1.35;font-weight:700;color:${BRAND.heading};">
                  ${escapeHtml(heading)}
                </h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:28px 40px 8px 40px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" bgcolor="${BRAND.primary}" style="border-radius:8px;">
                      <a href="${safeButtonUrl}" target="_blank"
                         style="display:inline-block;padding:13px 32px;font-family:${font};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
                        ${escapeHtml(buttonLabel)}
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="${align}" dir="${dir}" style="padding:8px 40px 0 40px;font-family:${font};">
                <p style="margin:0;font-size:13px;line-height:1.6;color:${BRAND.muted};">
                  ${escapeHtml(rawLinkLabel)}<br />
                  <span dir="ltr" style="unicode-bidi:embed;word-break:break-all;color:${BRAND.primary};">${safeButtonUrl}</span>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 40px 0 40px;">
                <hr style="border:none;border-top:1px solid ${BRAND.border};margin:0;" />
              </td>
            </tr>
            <tr>
              <td align="${align}" dir="${dir}" style="padding:20px 40px 36px 40px;font-family:${font};">
                <p style="margin:0 0 4px 0;font-size:13px;line-height:1.6;color:${BRAND.muted};">
                  ${escapeHtml(footerNote)}
                </p>
                <p style="margin:16px 0 0 0;font-size:14px;line-height:1.6;color:${BRAND.body};font-weight:600;">
                  ${escapeHtml(signOff)}
                </p>
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
            <tr>
              <td align="center" style="padding:20px 16px;font-family:${font};font-size:12px;color:${BRAND.muted};">
                Tarshih · tarshih.com
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function paragraphs(lines: string[], font: string): string {
  return lines
    .map(
      (line) =>
        `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:${BRAND.body};font-family:${font};">${line}</p>`
    )
    .join("");
}

interface Copy {
  subject: string;
  preheader: string;
  eyebrow: string;
  heading: string;
  greeting: (name: string) => string;
  body: string[]; // paragraphs after the greeting line
  buttonLabel: string;
  footerNote: string;
}

const COPY: Record<EmailType, Record<Lang, Copy>> = {
  signup: {
    en: {
      subject: "Confirm your email to activate your Tarshih account",
      preheader: "One click and you're in — let's get your resume working for you.",
      eyebrow: "Welcome to Tarshih",
      heading: "Confirm your email address",
      greeting: (name) => `Hi${name ? ` ${escapeHtml(name)}` : ""},`,
      body: [
        "Thanks for signing up. We tailor resumes and cover letters with AI, so every application you send is built for the job you actually want — not a generic template.",
        "Click the button below to confirm your email and activate your account. This link expires in 1 hour.",
      ],
      buttonLabel: "Confirm email",
      footerNote:
        "If you didn't create a Tarshih account, you can safely ignore this email — no account will be created.",
    },
    ar: {
      subject: "تأكيد بريدك الإلكتروني لتفعيل حسابك في ترشيح",
      preheader: "خطوة واحدة تفصلك عن البدء — لنجهّز سيرتك الذاتية لفرصتك القادمة.",
      eyebrow: "مرحباً بك في ترشيح",
      heading: "أكّد بريدك الإلكتروني",
      greeting: (name) => `مرحباً${name ? ` ${escapeHtml(name)}` : ""}،`,
      body: [
        "شكراً لتسجيلك في ترشيح. نُخصّص سيرتك الذاتية وخطاباتك التعريفية باستخدام الذكاء الاصطناعي، بحيث يكون كل طلب توظيف تُرسله مبنيًا خصيصًا للوظيفة التي تريدها فعلاً، لا مجرد قالب عام.",
        "اضغط على الزر أدناه لتأكيد بريدك الإلكتروني وتفعيل حسابك. صلاحية هذا الرابط ساعة واحدة.",
      ],
      buttonLabel: "تأكيد البريد الإلكتروني",
      footerNote: "إذا لم تقم بإنشاء حساب في ترشيح، يمكنك تجاهل هذه الرسالة بأمان — لن يتم إنشاء أي حساب.",
    },
  },
  recovery: {
    en: {
      subject: "Reset your Tarshih password",
      preheader: "Use the button below to choose a new password — this link expires in 1 hour.",
      eyebrow: "Password reset",
      heading: "Reset your password",
      greeting: (name) => `Hi${name ? ` ${escapeHtml(name)}` : ""},`,
      body: [
        "We received a request to reset the password on your Tarshih account. Click the button below to choose a new one. This link expires in 1 hour.",
        "If you didn't request this, you can safely ignore this email — your password won't be changed.",
      ],
      buttonLabel: "Reset password",
      footerNote: "For your security, this link can only be used once.",
    },
    ar: {
      subject: "إعادة تعيين كلمة مرور حسابك في ترشيح",
      preheader: "استخدم الزر أدناه لاختيار كلمة مرور جديدة — صلاحية هذا الرابط ساعة واحدة.",
      eyebrow: "إعادة تعيين كلمة المرور",
      heading: "إعادة تعيين كلمة المرور",
      greeting: (name) => `مرحباً${name ? ` ${escapeHtml(name)}` : ""}،`,
      body: [
        "وصلنا طلب لإعادة تعيين كلمة مرور حسابك في ترشيح. اضغط على الزر أدناه لاختيار كلمة مرور جديدة. صلاحية هذا الرابط ساعة واحدة.",
        "إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة بأمان — لن يتم تغيير كلمة المرور الخاصة بك.",
      ],
      buttonLabel: "إعادة تعيين كلمة المرور",
      footerNote: "لأمان حسابك، لا يمكن استخدام هذا الرابط إلا مرة واحدة.",
    },
  },
  magiclink: {
    en: {
      subject: "Your Tarshih sign-in link",
      preheader: "Click below to sign in — no password needed.",
      eyebrow: "Sign-in link",
      heading: "Sign in to Tarshih",
      greeting: (name) => `Hi${name ? ` ${escapeHtml(name)}` : ""},`,
      body: ["Click the button below to sign in to your Tarshih account. This link expires in 1 hour."],
      buttonLabel: "Sign in",
      footerNote: "If you didn't request this, you can safely ignore this email.",
    },
    ar: {
      subject: "رابط تسجيل الدخول إلى ترشيح",
      preheader: "اضغط أدناه لتسجيل الدخول دون الحاجة لكلمة مرور.",
      eyebrow: "رابط تسجيل الدخول",
      heading: "تسجيل الدخول إلى ترشيح",
      greeting: (name) => `مرحباً${name ? ` ${escapeHtml(name)}` : ""}،`,
      body: ["اضغط على الزر أدناه لتسجيل الدخول إلى حسابك في ترشيح. صلاحية هذا الرابط ساعة واحدة."],
      buttonLabel: "تسجيل الدخول",
      footerNote: "إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة بأمان.",
    },
  },
  invite: {
    en: {
      subject: "You're invited to Tarshih",
      preheader: "Someone invited you to tailor your resume and cover letters with AI.",
      eyebrow: "You're invited",
      heading: "You've been invited to Tarshih",
      greeting: (name) => `Hi${name ? ` ${escapeHtml(name)}` : ""},`,
      body: [
        "Someone invited you to join Tarshih, the AI platform that tailors resumes and cover letters to every job you apply for. Click below to accept.",
      ],
      buttonLabel: "Accept invite",
      footerNote: "If you weren't expecting this invitation, you can safely ignore this email.",
    },
    ar: {
      subject: "تمت دعوتك للانضمام إلى ترشيح",
      preheader: "دعاك أحدهم لتخصيص سيرتك الذاتية وخطاباتك التعريفية بالذكاء الاصطناعي.",
      eyebrow: "دعوة",
      heading: "تمت دعوتك للانضمام إلى ترشيح",
      greeting: (name) => `مرحباً${name ? ` ${escapeHtml(name)}` : ""}،`,
      body: [
        "قام أحدهم بدعوتك للانضمام إلى ترشيح، المنصة التي تُخصّص سيرتك الذاتية وخطاباتك التعريفية بالذكاء الاصطناعي لكل وظيفة تتقدم لها. اضغط أدناه لقبول الدعوة.",
      ],
      buttonLabel: "قبول الدعوة",
      footerNote: "إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهل هذه الرسالة بأمان.",
    },
  },
  email_change: {
    en: {
      subject: "Confirm your new email address",
      preheader: "Confirm this is your new email address for your Tarshih account.",
      eyebrow: "Email change",
      heading: "Confirm your new email",
      greeting: (name) => `Hi${name ? ` ${escapeHtml(name)}` : ""},`,
      body: [
        "Click the button below to confirm this is your new email address for your Tarshih account. This link expires in 1 hour.",
      ],
      buttonLabel: "Confirm new email",
      footerNote: "If you didn't request this change, please secure your account by resetting your password.",
    },
    ar: {
      subject: "تأكيد بريدك الإلكتروني الجديد",
      preheader: "أكّد أن هذا هو بريدك الإلكتروني الجديد لحسابك في ترشيح.",
      eyebrow: "تغيير البريد الإلكتروني",
      heading: "تأكيد بريدك الإلكتروني الجديد",
      greeting: (name) => `مرحباً${name ? ` ${escapeHtml(name)}` : ""}،`,
      body: [
        "اضغط على الزر أدناه لتأكيد أن هذا هو بريدك الإلكتروني الجديد لحسابك في ترشيح. صلاحية هذا الرابط ساعة واحدة.",
      ],
      buttonLabel: "تأكيد البريد الجديد",
      footerNote: "إذا لم تطلب هذا التغيير، فيرجى تأمين حسابك بإعادة تعيين كلمة المرور.",
    },
  },
};

export function getEmailTemplate(
  lang: Lang,
  emailType: EmailType,
  confirmationUrl: string,
  { siteUrl, name }: RenderOptions
): TemplateResult {
  const copy = COPY[emailType][lang];
  const font = FONT_STACK[lang];
  const greetingLine = copy.greeting(firstName(name));
  const bodyHtml = paragraphs([greetingLine, ...copy.body], font);

  const html = renderShell({
    lang,
    siteUrl,
    preheader: copy.preheader,
    eyebrow: copy.eyebrow,
    heading: copy.heading,
    bodyHtml,
    buttonLabel: copy.buttonLabel,
    buttonUrl: confirmationUrl,
    footerNote: copy.footerNote,
  });

  return { subject: copy.subject, html };
}

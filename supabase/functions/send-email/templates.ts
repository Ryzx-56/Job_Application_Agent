// templates.ts
// Confirmation email templates for Tarshih (ترشيح).
// Add more email_action_types (magiclink, recovery, invite, etc.) the same way if needed.

export type EmailType = "signup" | "recovery" | "magiclink" | "invite" | "email_change";

interface TemplateResult {
  subject: string;
  html: string;
}

export function getEmailTemplate(
  lang: "ar" | "en",
  emailType: EmailType,
  confirmationUrl: string
): TemplateResult {
  if (emailType !== "signup") {
    // Fallback for other auth email types — extend this the same way as signup below.
    return lang === "ar"
      ? {
          subject: "رسالة من ترشيح",
          html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;text-align:right">
            <p>مرحباً،</p>
            <p>يرجى الضغط على الرابط التالي للمتابعة:</p>
            <p><a href="${confirmationUrl}">${confirmationUrl}</a></p>
          </div>`,
        }
      : {
          subject: "Message from Tarshih",
          html: `<div style="font-family:Arial,sans-serif">
            <p>Hi,</p>
            <p>Please click the link below to continue:</p>
            <p><a href="${confirmationUrl}">${confirmationUrl}</a></p>
          </div>`,
        };
  }

  if (lang === "ar") {
    return {
      subject: "تأكيد إنشاء حسابك في ترشيح",
      html: `
        <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;text-align:right;max-width:480px;margin:auto;padding:24px">
          <h2 style="color:#111">مرحباً بك في ترشيح 👋</h2>
          <p>شكراً لتسجيلك. لتفعيل حسابك، اضغط على الزر أدناه:</p>
          <p style="text-align:center;margin:32px 0">
            <a href="${confirmationUrl}"
               style="background:#111;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;display:inline-block">
              تأكيد الحساب
            </a>
          </p>
          <p style="font-size:13px;color:#666">
            إذا لم يعمل الزر، انسخ الرابط التالي والصقه في متصفحك:<br>
            <span style="direction:ltr;display:inline-block">${confirmationUrl}</span>
          </p>
          <p style="font-size:13px;color:#999;margin-top:32px">
            إذا لم تقم بإنشاء هذا الحساب، يمكنك تجاهل هذه الرسالة بأمان.
          </p>
        </div>`,
    };
  }

  return {
    subject: "Confirm your Tarshih account",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px">
        <h2 style="color:#111">Welcome to Tarshih 👋</h2>
        <p>Thanks for signing up. Confirm your account to get started:</p>
        <p style="text-align:center;margin:32px 0">
          <a href="${confirmationUrl}"
             style="background:#111;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;display:inline-block">
            Confirm account
          </a>
        </p>
        <p style="font-size:13px;color:#666">
          If the button doesn't work, copy and paste this link into your browser:<br>
          ${confirmationUrl}
        </p>
        <p style="font-size:13px;color:#999;margin-top:32px">
          If you didn't create this account, you can safely ignore this email.
        </p>
      </div>`,
  };
}

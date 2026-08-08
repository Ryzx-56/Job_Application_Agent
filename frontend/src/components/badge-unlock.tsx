"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Badge, BadgeKey } from "@/components/badges";

/* ========================================================================
   BADGE UNLOCK POPUP

   Fires once per badge, the first time the user lands on the dashboard
   after earning it. "Once" is enforced SERVER-side: the backend compares
   the badges you currently hold against profiles.seen_badges and returns
   the difference, and this component acknowledges them only after they've
   actually been displayed. Closing the tab mid-animation means you get the
   popup next visit rather than silently missing it.

   Several badges can be earned at the same moment (subscribing to Pro as
   one of the first 50 grants Pro AND Founding Member), so this steps
   through them one at a time rather than cramming them together.
======================================================================== */

const COPY: Record<BadgeKey, { en: { title: string; body: string }; ar: { title: string; body: string } }> = {
  owner: {
    en: { title: "You own this place", body: "The Owner badge is yours. Obviously." },
    ar: { title: "هذا المكان لك", body: "شارة المالك أصبحت لك. بالطبع." },
  },
  admin: {
    en: { title: "Admin access granted", body: "You've got the Admin badge and the tools that come with it." },
    ar: { title: "تم منحك صلاحية الإدارة", body: "حصلت على شارة المشرف والأدوات التي تأتي معها." },
  },
  elite: {
    en: { title: "Welcome to Elite", body: "The rarest badge on the platform is now on your profile. Thank you for backing Tarshih." },
    ar: { title: "مرحبًا بك في النخبة", body: "أندر شارة في المنصة أصبحت على ملفك. شكرًا لدعمك ترشيح." },
  },
  pro: {
    en: { title: "You're Pro now", body: "The Pro badge is on your profile, and your credits just went up. Go get some interviews." },
    ar: { title: "أصبحت من فئة برو", body: "شارة برو أصبحت على ملفك، ورصيدك ارتفع للتو. اذهب واحصل على مقابلات." },
  },
  founding_member: {
    en: { title: "You're a Founding Member", body: "One of the first 50 people to ever pay for Tarshih. This badge and your price are locked in for good." },
    ar: { title: "أنت عضو مؤسس", body: "أحد أول 50 شخصًا يدفعون لترشيح على الإطلاق. هذه الشارة وسعرك مثبّتان إلى الأبد." },
  },
  alpha_tester: {
    en: { title: "Alpha Tester unlocked", body: "You were here early and helped break things before anyone else could. Genuinely, thank you." },
    ar: { title: "تم فتح شارة مختبِر ألفا", body: "كنت هنا مبكرًا وساعدت في اكتشاف المشاكل قبل غيرك. شكرًا لك حقًا." },
  },
  free: {
    en: { title: "Welcome to Tarshih", body: "You're on the free plan with 3 credits a month. Subscribe any time to trade this badge for a better one." },
    ar: { title: "مرحبًا بك في ترشيح", body: "أنت على الخطة المجانية بثلاث نقاط شهريًا. اشترك في أي وقت لتستبدل هذه الشارة بأفضل منها." },
  },
};

export function BadgeUnlockModal({
  badges,
  foundingMemberNumber,
  lang = "en",
  onDismiss,
}: {
  /** New badge keys from GET /api/v1/profile/badges. */
  badges: BadgeKey[];
  foundingMemberNumber?: number | null;
  lang?: "en" | "ar";
  /** Called once every badge has been shown and dismissed. */
  onDismiss: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [entered, setEntered] = useState(false);
  const isAr = lang === "ar";

  // One frame's delay before adding the "entered" class so the CSS
  // transition has a starting state to animate FROM. Setting both states in
  // the same paint would skip the animation entirely.
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [index]);

  // Escape closes, like any dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!badges.length) return null;
  const badge = badges[index];
  if (!badge || !COPY[badge]) return null;

  const copy = COPY[badge][isAr ? "ar" : "en"];
  const isLast = index >= badges.length - 1;

  function next() {
    if (isLast) {
      onDismiss();
    } else {
      setEntered(false);
      setIndex((i) => i + 1);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="badge-unlock-title"
    >
      {/* Backdrop. Clicking it advances too, so the popup can never trap
          someone who just wants to get to their dashboard. */}
      <div
        className={`absolute inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300 ${
          entered ? "opacity-100" : "opacity-0"
        }`}
        onClick={next}
      />

      <div
        className={`relative w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xl transition-all duration-300 ${
          entered ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-95 opacity-0"
        }`}
      >
        {/* Confetti-ish rays behind the badge. Pure CSS, no library, and
            purely decorative so it's hidden from assistive tech. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 overflow-hidden" aria-hidden>
          <div className="absolute left-1/2 top-0 size-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-b from-amber-200/50 via-blue-200/30 to-transparent blur-2xl" />
        </div>

        <button
          type="button"
          onClick={next}
          aria-label={isAr ? "إغلاق" : "Close"}
          className="absolute end-3 top-3 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="size-4" aria-hidden />
        </button>

        <p className="relative text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
          {isAr ? "شارة جديدة" : "New badge"}
        </p>

        {/* The badge itself, at the largest size and with its tooltip
            suppressed — there's already a full explanation underneath. */}
        <div className={`relative mt-4 flex justify-center ${entered ? "jbaa-unlock-pop" : ""}`}>
          <Badge badge={badge} size="lg" lang={lang} foundingMemberNumber={foundingMemberNumber} withTooltip={false} />
        </div>

        <h2 id="badge-unlock-title" className="relative mt-5 text-lg font-semibold text-slate-900">
          {copy.title}
        </h2>
        <p className="relative mt-2 text-sm leading-relaxed text-slate-500">{copy.body}</p>

        <button
          type="button"
          onClick={next}
          className="relative mt-5 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        >
          {isLast
            ? isAr
              ? "رائع!"
              : "Nice!"
            : isAr
            ? `التالي (${index + 1}/${badges.length})`
            : `Next (${index + 1}/${badges.length})`}
        </button>
      </div>

      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .jbaa-unlock-pop { animation: jbaa-unlock-pop 520ms cubic-bezier(0.34, 1.56, 0.64, 1); }
        }
        @keyframes jbaa-unlock-pop {
          0% { transform: scale(0.4) rotate(-8deg); opacity: 0; }
          60% { transform: scale(1.12) rotate(2deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); }
        }
      `}</style>
    </div>
  );
}

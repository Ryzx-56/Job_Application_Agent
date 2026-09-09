# Tarshih — Outstanding Items

*Snapshot as of the locale routing / performance / hreflang session. Everything not listed here is confirmed complete per the last status report.*

---

## 1. Mobile performance — currently 72/100, target ≥85

Two remaining causes, both real work:

- **~146 KiB unused JS / 13 KiB legacy transpilation** — mostly Next framework + Supabase client chunks. Needs bundle analysis and likely code-splitting the Supabase client out of the marketing bundle.
- **LCP still ~7.2s** — marketing pages are dynamic (`no-store`, no bf-cache) because the root layout reads `headers()`. Making them static requires `<html lang>` to come from the route param instead — the two-root-layout restructure that was deliberately avoided this session to protect `/auth`. This is the real fix, but it's the riskier move and should be planned as its own isolated change, tested carefully around auth again.

## 2. Saudi trust signals row

- Not started. A product/design decision, not a technical blocker.
- Previously discussed: hold off on payment-related claims (e.g. "secure SAR payments") until Moyasar is actually live, so nothing false ships.

## 3. Arabic OG card

- Auto-generation fails — the rendering library can't shape/join Arabic script (`lookupType: 5 - substFormat: 3` unsupported).
- Needs a hand-designed static PNG (1200×630), matching the English auto-generated card's layout.
- **You're doing this yourself in Canva** — use the live English card as the visual reference, translate the text into Arabic, export, hand off to wire in per-language.

## 4. Payment methods section on /pricing

- Blocked — Moyasar isn't integrated yet.
- Add this section once the payment gateway is actually live. Don't add placeholder/fake payment method logos before then.

## 5. §3.6 Social proof

- Deliberately skipped — only ~20 test CVs generated so far, not enough for credible real numbers or testimonials.
- Revisit once there's meaningful real usage data. Do not fabricate stats or quotes (flagged earlier as a legal/trust risk, not just a preference).

---

## Also worth remembering (not "unfinished," but noted during the sessions)

- **Pricing change (29 → 29.99 SAR)** — you paused this to focus on features first. Revisit pricing as its own dedicated pass when ready; don't bundle it into unrelated feature prompts.
- **Manually test login/signup/logout yourself** before/after pushing this branch live — the locale routing session touched auth-adjacent middleware. Automated checks passed, but worth a manual pass given what's at stake.

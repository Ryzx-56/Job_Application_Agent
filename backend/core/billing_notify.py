# core/billing_notify.py
#
# The three emails a failing subscription sends. Bilingual, because most of
# this product's customers read Arabic.
#
# REUSES THE EXISTING MAIL PATH rather than adding a second one: the same
# Resend endpoint, sender and buyer lookup that core/linkedin_notify.py
# already uses for premium-order alerts. The difference is the recipient —
# those go to support, these go to the customer.
#
# NOTHING HERE MAY RAISE INTO BILLING. A subscription's state must not depend
# on whether an email went out. Every path logs and returns.
import os
from datetime import datetime
from typing import Optional

import requests
from loguru import logger

from core.linkedin_notify import DEFAULT_FROM, RESEND_ENDPOINT, lookup_buyer

_TIMEOUT_SECONDS = 10
_APP_URL = (os.getenv("PUBLIC_APP_URL", "") or "https://tarshih.com").rstrip("/")

# Arabic first in each pair: it is the primary language of this product, and
# the email leads with it. Written natively, not translated from the English.
_COPY = {
    "retry": {
        "subject": "تعذّر تجديد اشتراكك · Your Tarshih renewal didn't go through",
        "ar": (
            "لم تنجح محاولة تجديد اشتراكك. لا يزال حسابك يعمل كالمعتاد، وسنحاول "
            "مرة أخرى في {next_try}. غالبًا ما يعود السبب إلى بطاقة منتهية أو "
            "مُستبدلة — يمكنك تحديث بطاقتك من إعدادات الحساب."
        ),
        "en": (
            "We couldn't renew your subscription. Your account is still working "
            "normally and we'll try again on {next_try}. The usual cause is an "
            "expired or replaced card — you can update yours in account settings."
        ),
    },
    "past_due": {
        "subject": "اشتراكك متأخر السداد · Your Tarshih subscription is past due",
        "ar": (
            "حاولنا تجديد اشتراكك عدة مرات دون نجاح. سيبقى حسابك يعمل حتى "
            "{next_try}، وبعدها سيتحوّل إلى الخطة المجانية. تحديث بطاقتك من "
            "إعدادات الحساب يعيد تفعيل الاشتراك."
        ),
        "en": (
            "We've tried to renew your subscription several times without "
            "success. Your account keeps working until {next_try}, after which "
            "it moves to the Free plan. Updating your card in account settings "
            "restores it."
        ),
    },
    "canceled": {
        "subject": "تم إيقاف اشتراكك · Your Tarshih subscription has ended",
        "ar": (
            "انتهت فترة السماح ولم نتمكن من تجديد اشتراكك، لذلك تحوّل حسابك إلى "
            "الخطة المجانية. سيرك الذاتية المحفوظة كما هي، ويمكنك الاشتراك مجددًا "
            "في أي وقت."
        ),
        "en": (
            "The grace period ended without a successful renewal, so your "
            "account has moved to the Free plan. Your saved CVs are untouched, "
            "and you can subscribe again whenever you want."
        ),
    },
}


def send_dunning_email(sub: dict, stage: str, attempts: int,
                       next_try: Optional[datetime]) -> bool:
    api_key = (os.getenv("RESEND_API_KEY", "") or "").strip()
    sender = (os.getenv("EMAIL_FROM", DEFAULT_FROM) or DEFAULT_FROM).strip()

    copy = _COPY.get(stage)
    if copy is None:
        logger.error(f"❌ No dunning copy for stage {stage!r}.")
        return False

    buyer = lookup_buyer(sub.get("user_id") or "") or {}
    email = (buyer.get("email") or "").strip()
    if not email:
        logger.error(
            f"❌ No email on file for {sub.get('user_id')}, so no '{stage}' dunning notice "
            f"was sent for subscription {sub.get('id')}."
        )
        return False

    when = next_try.date().isoformat() if next_try else ""
    ar = copy["ar"].format(next_try=when)
    en = copy["en"].format(next_try=when)

    if not api_key:
        # Expected while RESEND_API_KEY is unset. The billing state has
        # already been applied; this only means nobody was told.
        logger.warning(
            f"📭 RESEND_API_KEY is not set, so no '{stage}' dunning notice went to {email} "
            f"for subscription {sub.get('id')} (attempt {attempts})."
        )
        return False

    try:
        response = requests.post(
            RESEND_ENDPOINT,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "from": sender,
                "to": [email],
                "subject": copy["subject"],
                "text": f"{ar}\n\n---\n\n{en}\n\n{_APP_URL}/dashboard/settings",
                "html": _html(ar, en),
            },
            timeout=_TIMEOUT_SECONDS,
        )
    except Exception as e:
        logger.error(f"❌ Dunning email '{stage}' failed to send for subscription {sub.get('id')}: {e}")
        return False

    if response.status_code >= 300:
        logger.error(
            f"❌ Resend rejected the '{stage}' dunning email for subscription "
            f"{sub.get('id')}: {response.status_code}"
        )
        return False

    logger.info(f"📧 Sent '{stage}' dunning notice for subscription {sub.get('id')}.")
    return True


def _html(ar: str, en: str) -> str:
    """One email carrying both languages. dir is set per block — an Arabic
    paragraph in an LTR container renders with its punctuation on the wrong
    side, which is the sort of detail that makes a billing email look fake."""
    return (
        '<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;'
        'color:#111827;line-height:1.7">'
        f'<p dir="rtl" style="text-align:right;margin:0 0 20px">{ar}</p>'
        '<hr style="border:0;border-top:1px solid #e5e7eb;margin:20px 0">'
        f'<p dir="ltr" style="margin:0 0 20px">{en}</p>'
        f'<p dir="ltr" style="margin:0"><a href="{_APP_URL}/dashboard/settings" '
        'style="color:#2563eb">tarshih.com</a></p>'
        "</div>"
    )

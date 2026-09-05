# core/account.py
#
# Account deletion. One endpoint, and everything it has to get right.
#
# ─── THE ORDER MATTERS ──────────────────────────────────────────────────────
#
# Deleting the auth.users row cascades profiles, resumes, interview_preps,
# linkedin_generations, linkedin_purchases, payment_tokens and subscriptions —
# every table whose foreign key says ON DELETE CASCADE. That is most of the
# job, but it is not all of it, and it is not the part that can go wrong
# expensively.
#
# purge_account_data() runs FIRST, in one transaction, and does the three
# things the cascade would get wrong:
#
#   1. Cancels any live subscription. The cascade deletes the row, but if
#      anything after it fails, a deleted-looking account with a live
#      subscription row is the state that bills a card next month. Stopping
#      the money first is the same ordering core/subscription.py uses, for the
#      same reason.
#   2. Detaches the payments rather than losing them, and strips the
#      cardholder name out of the stored gateway response.
#   3. Nulls the user id on cv_generation_events, which has no foreign key and
#      so would otherwise keep pointing at a person who no longer exists.
#
# ─── WHAT IS NOT DELETED, AND WHY ───────────────────────────────────────────
#
# public.free_grant_ledger keeps one HMAC of this account's normalized email.
# That is deliberate and it is what stops delete-and-recreate from minting
# free credits forever. It holds no address and no user id — see the migration
# 20260903140000 for why it is an HMAC and not a plain hash.
#
# public.payments keeps the charges. They are financial records with their own
# retention obligation, they may still need refunding or reconciling, and they
# no longer name anybody.

from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger

from core.auth import get_current_user_id
from core.credits import get_admin_client

router = APIRouter()


@router.delete("/api/v1/account")
def delete_account(user_id: str = Depends(get_current_user_id)) -> dict:
    """Delete the caller's own account. There is no admin variant and no
    user id parameter: the only account this can delete is the one whose
    token made the request."""
    admin = get_admin_client()

    # ─── 1. the transactional part ──────────────────────────────────────────
    try:
        summary = admin.rpc("purge_account_data", {"p_user_id": user_id}).execute().data or {}
    except Exception as e:
        # NOTHING HAS BEEN DELETED. The RPC is one transaction, so a failure
        # here leaves the account exactly as it was and the caller can retry.
        logger.error(f"❌ purge_account_data failed for {user_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "deletion_unavailable",
                "message": "We couldn't delete your account just now. Nothing was changed — "
                           "please try again shortly.",
            },
        )

    # ─── 2. the cascade ─────────────────────────────────────────────────────
    try:
        # should_soft_delete defaults to False and is passed explicitly because
        # the default is the whole point: a soft delete keeps the auth row and
        # its email address, which would make this endpoint a lie.
        admin.auth.admin.delete_user(user_id, should_soft_delete=False)
    except Exception as e:
        # Billing is already stopped and the payments are already detached, so
        # the dangerous half is done and safe. The account still exists;
        # every step above is idempotent, so retrying is correct.
        logger.error(
            f"❌ auth user deletion failed for {user_id} AFTER the data purge succeeded "
            f"({summary}): {e}. Billing is stopped; the account still exists. Safe to retry."
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "deletion_incomplete",
                "message": "We stopped your billing but couldn't finish deleting your account. "
                           "Please try again, or contact support.",
            },
        )

    logger.info(f"🗑️ Account {user_id} deleted. {summary}")
    return {"deleted": True, **summary}

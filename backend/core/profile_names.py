# core/profile_names.py
#
# Reads and writes profiles.name_en / profiles.name_ar.
#
# WHY THESE EXIST: the Arabic localizer translates the CV's content, and the
# candidate's name used to go through it like any other string. That is the
# wrong tool for a name — the same name has several valid Arabic spellings
# and only its owner knows which is theirs, so the output was simply wrong
# for some users. Names now follow the SAME "preserve as-is" path that
# email / phone / LinkedIn / GitHub already take (see
# utils/arabic_localizer.py's identifier handling and cv_context.py), just
# sourced from these two profile fields instead of from generated text.
#
# Same trust model as core/location.py: the frontend can never write to
# `profiles` directly (RLS grants SELECT only), so every write goes through
# this router using the service_role client.
import re

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from loguru import logger

from core.auth import get_current_user_id, read_admin_flag, read_owner_flag
from core.credits import get_admin_client

router = APIRouter()

MAX_NAME_LENGTH = 120

# Arabic block (plus Arabic Supplement / Extended-A). Used only to decide
# which field a detected name belongs in — never to transform it.
ARABIC_CHAR_RE = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿ]")
LATIN_CHAR_RE = re.compile(r"[A-Za-z]")


def has_arabic(text: str) -> bool:
    return bool(ARABIC_CHAR_RE.search(text or ""))


def has_latin(text: str) -> bool:
    return bool(LATIN_CHAR_RE.search(text or ""))


def get_profile_names(user_id: str | None) -> dict:
    """
    {"name_en": str|None, "name_ar": str|None} for this user, or empty
    strings if the profile can't be read. Never raises — a name lookup
    failing must not take down a generation request; the caller treats a
    missing name the same way it treats an empty one.
    """
    if not user_id:
        return {"name_en": None, "name_ar": None}
    try:
        row = (
            get_admin_client()
            .table("profiles")
            .select("name_en, name_ar")
            .eq("id", user_id)
            .maybe_single()
            .execute()
            .data
        )
        return {
            "name_en": ((row or {}).get("name_en") or "").strip() or None,
            "name_ar": ((row or {}).get("name_ar") or "").strip() or None,
        }
    except Exception as e:
        logger.warning(f"Couldn't read profile names for user {user_id}: {e}")
        return {"name_en": None, "name_ar": None}


def required_name_for(cv_language: str, names: dict) -> tuple[bool, str]:
    """
    Does this user have the name they need for this output language?
    Returns (has_it, field_name) so the caller can name the missing field
    in its error payload.
    """
    field = "name_ar" if str(cv_language).lower().startswith("ar") else "name_en"
    return bool((names or {}).get(field)), field


class NamesUpdateRequest(BaseModel):
    # PARTIAL UPDATE SEMANTICS: a field left out entirely (or sent as null)
    # means "leave it alone". Only an explicitly-sent value changes a column,
    # and an explicit "" clears one.
    #
    # This matters because the generation-time name prompt only ever asks for
    # ONE of the two. If omission meant "set to null", answering that prompt
    # for Arabic would silently wipe the user's English name.
    name_en: str | None = Field(default=None, max_length=MAX_NAME_LENGTH)
    name_ar: str | None = Field(default=None, max_length=MAX_NAME_LENGTH)


@router.get("/api/v1/profile/names", tags=["Profile"])
def read_names(user_id: str = Depends(get_current_user_id)) -> dict:
    return get_profile_names(user_id)


@router.get("/api/v1/profile/admin-status", tags=["Profile"])
def read_admin_status(user_id: str = Depends(get_current_user_id)) -> dict:
    """
    Which role badges to render, and whether to show the Settings link to
    the Resume Viewer.

    Deliberately its OWN endpoint rather than another field on the profile
    row the browser already reads. The frontend fetches profiles directly
    via Supabase with a fixed column list, and PostgREST fails the WHOLE
    query if any named column is missing — so adding is_admin there meant a
    schema that hadn't been migrated yet broke tier, credits and location
    display too, not just the admin link. Reading it here keeps that blast
    radius at zero, and read_admin_flag accepts either column name so this
    works before and after 003_admin_access.sql.

    This is presentation only. Every real admin route re-checks the flag
    server-side (see _require_admin), so a forged `true` here would reveal
    a link and nothing behind it.
    """
    return {"is_admin": read_admin_flag(user_id), "is_owner": read_owner_flag(user_id)}


@router.patch("/api/v1/profile/names", tags=["Profile"])
def update_names(payload: NamesUpdateRequest, user_id: str = Depends(get_current_user_id)) -> dict:
    admin = get_admin_client()

    # Merge over what's already stored — see NamesUpdateRequest for why
    # omission must mean "unchanged" rather than "clear".
    current = get_profile_names(user_id)
    name_en = (payload.name_en if payload.name_en is not None else current.get("name_en") or "").strip()
    name_ar = (payload.name_ar if payload.name_ar is not None else current.get("name_ar") or "").strip()

    # The rule is about the RESULTING profile, not about this request: an
    # update that would leave the user with no name at all is rejected.
    if not name_en and not name_ar:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "no_name_provided",
                "message": "Enter your name in at least one language.",
            },
        )

    # Stored as NULL rather than "" when blank, so `name_ar IS NULL` is the
    # single unambiguous "not provided yet" signal everywhere downstream.
    result = (
        admin.table("profiles")
        .update({"name_en": name_en or None, "name_ar": name_ar or None})
        .eq("id", user_id)
        .select()
        .execute()
    )
    # Same postgrest-py quirk core/location.py documents: this builder always
    # returns .data as a list, and .maybe_single() isn't available on it.
    row = result.data[0] if result.data else None
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")

    _sync_auth_metadata_names(user_id, name_en, name_ar)

    logger.info(f"👤 Profile names updated for user {user_id} (en={bool(name_en)}, ar={bool(name_ar)}).")
    return {"name_en": row.get("name_en"), "name_ar": row.get("name_ar")}


def _sync_auth_metadata_names(user_id: str, name_en: str, name_ar: str) -> None:
    """
    Mirrors the names into auth.users.user_metadata.

    `profiles` is the source of truth, but two things read auth metadata and
    can't reach the profiles table: the confirmation/welcome email Edge
    Function (supabase/functions/send-email), and anything reading
    user_metadata.full_name directly. Without this, changing your name in
    Settings would leave those greeting you by the name you signed up with,
    possibly forever.

    full_name prefers English for the same reason signup does: it's the
    single-value fallback that shows up in the Supabase dashboard and in
    tooling, and one consistent script there is easier to scan.

    Best-effort. A metadata sync failure must not fail the name update the
    user actually asked for — profiles is already written by this point, and
    that's what every user-facing surface reads.
    """
    try:
        admin = get_admin_client()
        # READ-MODIFY-WRITE, not a blind overwrite: user_metadata also holds
        # preferred_language, selected_plan, avatar_url and the OAuth
        # provider's own fields. Replacing the object wholesale would drop
        # all of them.
        existing = admin.auth.admin.get_user_by_id(user_id)
        current = dict(getattr(existing.user, "user_metadata", None) or {})
        current.update({
            "name_en": name_en or None,
            "name_ar": name_ar or None,
            "full_name": name_en or name_ar,
        })
        admin.auth.admin.update_user_by_id(user_id, {"user_metadata": current})
    except Exception as e:
        logger.warning(f"Couldn't sync names into auth metadata for {user_id}: {e}")


# ─── NAME SUGGESTION FROM AN UPLOADED CV ───────────────────────────────────
# A CV written in Arabic already contains the candidate's own Arabic
# spelling, which is authoritative in a way a machine transliteration never
# is. Offering it as a pre-filled, editable default beats making the user
# retype it — and beats us guessing.
#
# Deliberately NO LLM call here: this endpoint runs before credits are
# reserved, on a file the user may not even end up generating from, so it
# has to be free and instant. Pure text heuristics on the first lines of
# the document, where a CV's name essentially always sits.

_NAME_SCAN_LINES = 12          # a CV's name is at the very top, always
_MAX_NAME_WORDS = 5
_MIN_NAME_CHARS = 3

# Lines that are structurally not a name, regardless of script.
_NOT_A_NAME_RE = re.compile(
    r"(@|https?://|www\.|\+?\d{5,}|"
    r"\b(cv|resume|curriculum|vitae|profile|summary|objective|contact|"
    r"experience|education|skills|projects)\b|"
    r"السيرة|الذاتية|الملف|الخبرات|التعليم|المهارات|المشاريع|نبذة)",
    re.IGNORECASE,
)


def _looks_like_name(line: str) -> bool:
    cleaned = (line or "").strip().strip("|•·-—–*")
    if len(cleaned) < _MIN_NAME_CHARS or len(cleaned) > MAX_NAME_LENGTH:
        return False
    if _NOT_A_NAME_RE.search(cleaned):
        return False
    words = cleaned.split()
    if not (1 <= len(words) <= _MAX_NAME_WORDS):
        return False
    # A name is letters and spaces. Digits or heavy punctuation mean it's a
    # heading, an address, or a date line.
    return not re.search(r"[\d_/\\=+#<>{}\[\]]", cleaned)


# A CV header commonly puts both scripts on ONE line, separated by a pipe or
# slash ("Abdulmalik Hawsawi | عبدالملك حوساوي"). Without splitting, that
# whole string gets suggested as the Arabic name — and the scan then wanders
# to line 2 for the English one, where it happily mistakes the city for a
# name. Splitting the line first fixes both at once.
_SEGMENT_SPLIT_RE = re.compile(r"[|/•·\t]+|\s[-—–]\s")

# The Latin name sits on the very first line essentially always. Capping how
# far we'll look for it stops a one-word line further down (a city, a job
# title) from being offered as the user's name.
_LATIN_NAME_MAX_LINE = 3


def suggest_names_from_text(cv_text: str) -> dict:
    """
    Best-effort {"name_en": str|None, "name_ar": str|None} read off the top
    of a CV. Either side may be None — an English-only CV yields no Arabic
    suggestion, which is correct: the user types their own.

    Wrong is cheap here (the value lands in an editable field the user
    confirms) but not free, so this stays conservative: it would rather
    return None than offer a plausible-looking city as someone's name.
    """
    suggestions: dict[str, str | None] = {"name_en": None, "name_ar": None}

    for line_index, raw_line in enumerate((cv_text or "").splitlines()[:_NAME_SCAN_LINES]):
        for segment in _SEGMENT_SPLIT_RE.split(raw_line):
            candidate = segment.strip().strip("|•·-—–*").strip()
            if not _looks_like_name(candidate):
                continue
            if has_arabic(candidate):
                if not suggestions["name_ar"]:
                    suggestions["name_ar"] = candidate
            elif has_latin(candidate) and not suggestions["name_en"] and line_index < _LATIN_NAME_MAX_LINE:
                suggestions["name_en"] = candidate
        if suggestions["name_ar"] and suggestions["name_en"]:
            break

    return suggestions


@router.post("/api/v1/profile/suggest-name", tags=["Profile"])
async def suggest_name_from_cv(
    cv: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """
    Reads an uploaded CV and returns any name it can find, per script, so
    the frontend can pre-fill the "Name (Arabic)" prompt instead of showing
    an empty box. Costs nothing — no credits, no LLM.

    Returns empty suggestions rather than an error when the file can't be
    parsed: this is a convenience, and failing it must never block the user
    from typing their own name.
    """
    # Imported here rather than at module scope to keep this module free of
    # a hard dependency on the parser for the read/write endpoints above.
    from utils.pdf_parser import extract_text_from_pdf, UnsupportedCVFormat

    try:
        cv_bytes = await cv.read()
        text = extract_text_from_pdf(pdf_bytes=cv_bytes)
    except (UnsupportedCVFormat, Exception) as e:  # noqa: B014 - intentional catch-all
        logger.info(f"Name suggestion skipped, CV unreadable: {e}")
        return {"name_en": None, "name_ar": None}

    return suggest_names_from_text(text)

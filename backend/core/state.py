from typing import TypedDict, List, Optional, Annotated


def merge_errors(existing: Optional[str], new: Optional[str]) -> Optional[str]:
    """
    Reducer for the 'error' field. Parallel nodes (cv_parser + jd_analyzer,
    or document_generator + match_scorer + jobs_finder) could each fail in
    the same step — this combines them instead of raising a concurrent-write
    error. A None update never clears an existing error.
    """
    if new is None:
        return existing
    if existing is None:
        return new
    return f"{existing} | {new}"


class AgentState(TypedDict):
    # ── INPUTS ──────────────────────────────────────────────
    raw_cv_text:             str
    job_description:         str

    # ── CV INPUT MODE ────────────────────────────────────────
    # "upload" (PDF parsed by cv_parser) or "manual" (form data
    # parsed by manual_cv_parser) — orchestrator routes on this.
    input_mode:               str
    manual_cv_data:            dict
    additional_info:           str

    # ── AGENT 1 OUTPUT (Gemini) ─────────────────────────────
    facts_json:              dict

    # ── AGENT 2 OUTPUT (Gemini) ─────────────────────────────
    weight_factors:          dict

    # ── AGENT 3 OUTPUT (Gemini — temporary; Claude later) ───
    tailored_bullets:        List[dict]
    tailored_summary:        str
    # Free-text sections (project descriptions, volunteer work,
    # candidate-typed additional info) polished into professional
    # language by Agent 3, kept separate from facts_json since Agent 1
    # must never rephrase — only Agent 3 (tailoring_engine) does that.
    tailored_projects:       List[dict]   # [{"name": str, "tailored_description": str}]
    tailored_volunteer_work: List[str]
    tailored_additional_info: str

    # ── FACT CHECK LOOP (Gemini) ────────────────────────────
    hallucination_flags:     List[dict]
    fact_check_passed:       bool

    # ── AGENT 4 OUTPUT ──────────────────────────────────────
    cover_letter_text:       str
    cv_pdf_path:             str
    cover_letter_pdf_path:   str

    # ── AGENT 5 OUTPUT (Claude) — semantic job fit ──────────
    job_match_score:         int
    job_match_reason:        str
    overall_recommendation:  str

    # ── DETERMINISTIC ATS KEYWORD-COVERAGE CHECK (no LLM) ───
    ats_score:               int
    score_breakdown:         dict
    gap_analysis:            List[dict]

    # ── AGENT 6 OUTPUT (Tavily) ─────────────────────────────
    similar_jobs:            List[dict]

    # ── CONTROL ─────────────────────────────────────────────
    tailoring_attempts:      int
    error:                   Annotated[Optional[str], merge_errors]
    current_step:            str

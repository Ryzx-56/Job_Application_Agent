from typing import TypedDict, List, Optional

class AgentState(TypedDict):
    # ── INPUTS ──────────────────────────────────────────────
    raw_cv_text:             str
    job_description:         str

    # ── AGENT 1 OUTPUT (Gemini) ─────────────────────────────
    facts_json:              dict

    # ── AGENT 2 OUTPUT (Gemini) ─────────────────────────────
    weight_factors:          dict

    # ── AGENT 3 OUTPUT (Claude) ─────────────────────────────
    tailored_bullets:        List[dict]
    tailored_summary:        str

    # ── FACT CHECK LOOP ─────────────────────────────────────
    hallucination_flags:     List[dict]
    fact_check_passed:       bool

    # ── AGENT 4 OUTPUT ──────────────────────────────────────
    cover_letter_text:       str
    cv_pdf_path:             str
    cover_letter_pdf_path:   str

    # ── AGENT 5 OUTPUT (Claude) ─────────────────────────────
    ats_score:               int
    score_breakdown:         dict
    gap_analysis:            List[dict]

    # ── AGENT 6 OUTPUT (Tavily) ─────────────────────────────
    similar_jobs:            List[dict]

    # ── CONTROL ─────────────────────────────────────────────
    error:                   Optional[str]
    current_step:            str
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
    # The job description being tailored against. USUALLY what the user
    # pasted — but when they submitted only a job title, jd_analyzer replaces
    # it with a representative JD composed from real current postings for
    # that title (see agents/jd_analyzer.py's title-only section) before
    # anything downstream reads it. Everything after Agent 2 therefore sees
    # JD-shaped content either way, which is the point: match_scorer reads
    # this text directly, main.py stores it on the resume, and Interview Prep
    # reads it back off that row later.
    job_description:         str
    # True when the field above is a composed representative JD rather than
    # something the user pasted, with how many real postings went into it.
    # Declared here because LangGraph drops undeclared keys (see the user_id
    # note below) — without these, jd_analyzer's update would vanish and the
    # composite would never reach the rest of the graph.
    jd_synthesized_from_title: bool
    jd_source_postings:        int

    # BUG FIX (silent state-drop): LangGraph builds its channels from THIS
    # TypedDict's annotations and silently discards any key that isn't
    # declared here — both on input (map_input logs a warning and drops it)
    # and on every node's return value (_get_updates filters to schema keys).
    # `user_id` was being set on initial_state in main.py but was never
    # declared, so `state.get("user_id")` inside jobs_finder.py was ALWAYS
    # None and the Supabase profile-location fallback could never run — the
    # user's saved location was silently ignored on every single request.
    # Same class of bug hit tailored_experience_titles, hit_max_retries and
    # every usage_* counter below: nodes returned them, LangGraph dropped
    # them, nothing errored. Anything a node writes or reads MUST be
    # declared here.
    user_id:                 Optional[str]

    # This request's unique id — the same one output_paths() builds the
    # generated file names from, so a log line and a downloaded file can be
    # traced to each other. Agents log it so two runs are distinguishable:
    # every agent prints under a fixed "[Agent N]" tag, so two requests in
    # flight at once (or one resubmitted after a failure) produce two
    # interleaved sets of identical-looking lines, and a genuinely puzzling
    # discrepancy — Agent 1 reporting 16 experience entries while the
    # usable-CV gate a few lines later reported 15 — could not be resolved
    # from the log at all. Declared here for the reason in the user_id note
    # above: LangGraph drops any state key this TypedDict doesn't list.
    request_id:              str

    # ── CANDIDATE NAME (never machine-translated) ───────────────────────
    # Read from profiles.name_en / profiles.name_ar in main.py. These are
    # the name for a document whose output script differs from the uploaded
    # CV's; when the CV is already written in the output language, its own
    # parsed name wins instead. utils/cv_context.py's resolve_candidate_name
    # owns that decision and documents why. Either way the name is used
    # verbatim — a name is not a translation problem, see
    # core/profile_names.py.
    # name_fallback_used records the legacy path: the required field was
    # empty and the user chose to generate anyway, so the name went through
    # the Arabic glossary after all. Tracked so we can see how many users
    # are still hitting the old behavior.
    profile_name_en:         Optional[str]
    profile_name_ar:         Optional[str]
    name_fallback_used:      bool

    # ── CANDIDATE PHOTO ─────────────────────────────────────────────────
    # A JPEG data URI pulled out of the uploaded file by utils/cv_photo.py
    # BEFORE the graph runs — no agent produces or reads it, and no LLM ever
    # sees the image (Agent 1 keeps receiving text only). It rides through
    # state exactly like template_id does, so utils/cv_context.py can put it
    # in the render context and pdf_generator can reuse it on the cover
    # letter. Empty string when the CV had no usable photo, or for the
    # manual 'Create New CV' flow, which has no uploaded file at all.
    #
    # Declared here for the reason spelled out in the user_id note above:
    # LangGraph drops any state key this TypedDict doesn't list, so an
    # undeclared candidate_photo would silently arrive at the renderers as
    # None on every single request.
    candidate_photo:         Optional[str]

    # ── CV INPUT MODE ────────────────────────────────────────
    # "upload" (PDF parsed by cv_parser) or "manual" (form data
    # parsed by manual_cv_parser) — orchestrator routes on this.
    input_mode:               str
    manual_cv_data:            dict
    additional_info:           str

    # Output language for the generated CV + cover letter: "en" or "ar".
    # Independent of what language the candidate's source data is in —
    # tailoring_engine / document_generator translate as needed.
    cv_language:                str

    # The language the USER IS READING THE DASHBOARD IN. Distinct from
    # cv_language on purpose: someone browsing in Arabic may well be
    # generating an English CV for an English-speaking employer, and the
    # feedback about that CV should still reach them in Arabic. Only the
    # match score's prose follows this; the CV and cover letter follow
    # cv_language, and so does the portfolio section.
    ui_language:                str

    # Which of the 11 CV templates to render with (see
    # utils/template_registry.py). No graph node reads or writes this — it
    # rides through state untouched from make_initial_state() all the way
    # to result_state, purely so main.py can read result["template_id"]
    # once at the end instead of threading a separate variable through
    # _stream_pipeline's signature. Falls back to DEFAULT_TEMPLATE_ID if
    # empty (see utils.template_registry.resolve_template_path).
    template_id:                 str

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
    tailored_projects:       List[dict]   # [{"name": str, "display_name": str, "tailored_description": str}]
    tailored_volunteer_work: List[str]
    tailored_skills:         dict         # cleaned/filtered version of facts_json["skills"]
    # [{"company": str, "title": str}] — the job title localized/translated
    # by Agent 3. Read back by utils/cv_context.py's title_lookup. Was
    # missing from this schema, so on an Arabic CV the job title silently
    # stayed in the source CV's language while the bullets under it were
    # translated. See the note on user_id above.
    tailored_experience_titles: List[dict]
    # {latin_term: arabic_term} built once per Arabic run by
    # tailoring_engine.py and reused by utils/cv_context.py (to localize the
    # raw facts_json fields the CV renders — employer, university, degree,
    # certifications, city) and agents/document_generator.py (the cover
    # letter). Shared so a term can't be translated one way on the CV and a
    # different way in the letter. Always {} for English CVs.
    arabic_glossary:            dict
    # The tailored CV's text/skills as they were BEFORE Arabic localization,
    # kept solely as input to the ATS scorer. The JD's keywords are English,
    # so scoring translated Arabic text against them always returned 0% —
    # see the note in tailoring_engine.py. Empty for English CVs, where the
    # rendered text already IS the scoring text.
    ats_source_text:            str
    ats_source_skills:          dict

    # ── FACT CHECK LOOP (Gemini) ────────────────────────────
    hallucination_flags:     List[dict]
    fact_check_passed:       bool
    # True only when the fact checker itself couldn't run (Gemini down /
    # quota exhausted), as opposed to running and rejecting content. Kept
    # separate so the user-facing error can say which one actually happened.
    fact_check_unavailable:  bool

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
    # Set by any node whose failure makes the rest of the pipeline pointless
    # (currently: tailoring_engine exhausting its retries, and the fact
    # checker rejecting everything). orchestrator.py routes straight to END
    # when this is set instead of fanning out to the remaining agents, so a
    # dead run stops costing Claude/Tavily calls the moment it's known dead.
    # A short machine-readable code, NOT a message — main.py maps it to the
    # user-facing text so wording lives in one place.
    fatal_error_code:        Optional[str]
    hit_max_retries:         bool

    # ── USAGE / COST INSTRUMENTATION ────────────────────────
    # Written cumulatively by tailoring_engine.py and fact_checker.py, read
    # by core/usage_tracker.py's UsageEvent.from_pipeline_result. Every one
    # of these was being dropped by LangGraph before being declared here,
    # so every cv_generation_events row logged 0 tokens and 0 calls.
    usage_tailoring_calls:            int
    usage_tailoring_input_tokens:     int
    usage_tailoring_output_tokens:    int
    usage_arabic_purity_fired:        bool
    usage_arabic_purity_still_bad:    bool
    usage_bullets_regenerated_count:  int
    usage_regen_calls:                int
    usage_regen_input_tokens:         int
    usage_regen_output_tokens:        int
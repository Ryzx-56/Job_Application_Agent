# agents/document_generator.py
import json
from loguru import logger
from core.state import AgentState
from core.llm_config import WRITING_MODEL, ProviderAPIError, generate_writing_text
from core.humanizer import HUMANIZER_RULES
from schemas.jd_schema import real_company
from utils.arabic_localizer import apply_glossary, build_glossary, find_latin_terms
from utils.cv_context import resolve_candidate_name

# SPLIT INTO A STATIC SYSTEM BLOCK AND A SMALL DYNAMIC USER BLOCK.
#
# WHY: OpenAI's prompt caching is automatic and PREFIX-based — it caches the
# longest identical leading span of a request. This prompt used to open with
# "Write a cover letter for {job_title} at {company}." and put the tone
# guidance on line 3, so the very first tokens of every request differed and
# nothing after them could ever be cached. The rules below are ~2,400 tokens
# of byte-identical text that was being paid for at full price on every single
# cover letter.
#
# Static first, variable last. Same split tailoring_engine.py already uses,
# and it is also what the Anthropic path wants (an identical `system` block is
# what cache_control marks), so this is correct under either provider.
COVER_LETTER_SYSTEM_PROMPT = """
You write cover letters. One letter per request, body paragraphs only.

TONE, taken from the culture signals given in the request:
  - If culture is 'fast-paced startup': write direct, confident, minimal fluff
  - If culture is 'corporate / enterprise': write slightly more formal
  - If culture is 'research / academic': lead with curiosity and depth

Structure (3 paragraphs only, body text ONLY — see HARD RULES below):
  Paragraph 1: Open on the CANDIDATE'S OWN WORK, not on praise for the company.
               The one thing they have actually done that matters most for this
               role, stated concretely enough that it could not appear in
               anyone else's letter. Name the company by name somewhere in this
               paragraph, tying that work to what the JD says the role needs —
               naming them is specificity, complimenting them is filler.
  Paragraph 2: Two specific achievements from FACTS_JSON that answer
               requirements the JD actually states. Name the requirement, then
               the evidence for it.
  Paragraph 3: Short, plain close. Ask for the conversation once, without
               ceremony. No 'I look forward to hearing'.

HARD RULES:
  - NO COMPANY FLATTERY, AND NOTHING INVENTED ABOUT THE EMPLOYER. Never praise their mission,
    values, culture, innovation, reputation, growth or "commitment to" anything. You know nothing
    about this company beyond what the job description says, so any such sentence is either
    fabricated or filler, and it is the single most recognisable line in a machine-written cover
    letter. Naming the company is REQUIRED and is not flattery: say who they are and what the JD
    says the role involves. Any claim about what they are like, believe in, or are known for is
    not available to you and must not appear.
  - DO NOT RESTATE THE CV. It is attached and the reader has it. The letter exists to make one
    argument the CV cannot make on its own.
  - BANNED OPENINGS AND PHRASES, and their equivalents in whatever language you are writing in:
    'I am writing to', 'I am excited to apply', 'I was thrilled/excited to see', 'As a [role] with
    N years of experience', 'I believe I would be a great fit', 'I am confident that my skills',
    'my background aligns with', 'resonates with', 'proven track record', 'uniquely positioned',
    'I would welcome the opportunity', 'Thank you for considering my application'.
  - Never use the phrase 'passion for' (or its equivalent)
  - Never write more than 3 paragraphs
  - Every achievement mentioned must come from FACTS_JSON
  - Do NOT include a greeting or salutation line (e.g. "Dear Hiring Manager," / "Dear Hiring Team,").
    Start directly with paragraph 1's content. The document template adds the greeting separately —
    if you include one too, it will appear twice in the final letter.
  - Do NOT include a complimentary close, sign-off, or the candidate's name anywhere in your output
    (e.g. no "Sincerely," and no name at the end). The document template adds this separately. End
    paragraph 3 with the actual closing sentence and stop there, do not add anything after it.
  - Output ONLY the 3 body paragraphs, nothing else, no header, no date, no subject line, no greeting,
    no sign-off.
  - NEVER use em dashes (—) or en dashes as punctuation, anywhere in the letter. This reads as generic
    AI-generated text. Use a comma, period, colon, or "and" instead. Write two sentences if you need to.
    Ordinary hyphens inside compound words are fine (e.g. "well-suited"), just not as a standalone dash.

<<HUMANIZER_RULES>>"""

COVER_LETTER_USER_TEMPLATE = """
Write a cover letter for this role: {job_title}
Employer: {company}

Tone guidance from JD: {culture_signals}
{employer_rule}

{language_instruction}

FACTS_JSON: {facts_json}
WEIGHT_FACTORS: {weight_factors}
"""

# Shared with the tailored CV and the LinkedIn generator so all three hold one
# standard for not reading as machine-written. Substituted here rather than
# copied into the string above, and done BEFORE any .format() call so the rules
# text is never treated as a format template itself.
COVER_LETTER_SYSTEM_PROMPT = COVER_LETTER_SYSTEM_PROMPT.replace(
    "<<HUMANIZER_RULES>>", HUMANIZER_RULES
)

# BUG FIX (Arabic cover letter): this used to instruct the model to KEEP tool
# names, technical terms and acronyms in Latin script inline. On a
# right-to-left letter that produced exactly the reported symptom — Arabic
# prose with English words scattered through the middle of it, rendering in
# visually scrambled order once ReportLab applied bidi. It also contradicted
# the CV path, where tailoring_engine.py's Arabic rule translates every one
# of those same terms. One document had "بايثون", the other "Python", in the
# same application. The letter now follows the CV's rule.
_AR_COVER_LETTER_LANGUAGE_INSTRUCTION = """OUTPUT LANGUAGE — MANDATORY ARABIC RULES:
  - Write the entire letter in Modern Standard Arabic, in natural professional business-letter register,
    not a literal word-for-word translation of a typical English cover letter.
  - FACTS_JSON and WEIGHT_FACTORS may contain English or Arabic text. Regardless of source language,
    write your output entirely in Arabic; do not leave sentences untranslated.
  - Absolutely NO English or Latin-script characters anywhere in the letter body. Translate technical
    terms, tool names, framework names and acronyms into Arabic (write "بايثون" not "Python",
    "واجهة برمجة التطبيقات" not "API", "التعلم الآلي" not "Machine Learning"). Mixing Latin words into
    Arabic sentences breaks right-to-left layout rendering and is the single most visible defect in
    an Arabic letter.
  - This rule matters MORE than elegant phrasing. If you are unsure how to translate a term, translate
    it as best you can rather than leaving it in English. A slightly awkward Arabic phrase is always
    better than any English word appearing in the output.
  - Numbers and dates stay as normal digits, not spelled out."""

_EN_COVER_LETTER_LANGUAGE_INSTRUCTION = """OUTPUT LANGUAGE:
  - Write the entire letter in professional English, regardless of what language FACTS_JSON or
    WEIGHT_FACTORS are written in. Translate any non-English source content into natural English."""


_GREETING_PREFIXES = ("dear ", "السادة", "عزيزي", "الأفاضل")
_SIGNOFF_MARKERS = ("sincerely", "regards", "best regards", "مع خالص التقدير", "مع تحياتي", "وتفضلوا بقبول")


def _enforce_arabic_letter_purity(text: str, cv_language: str, glossary: dict | None = None) -> str:
    """
    Two-stage Arabic cleanup for the letter, mirroring the CV path.

    Stage 1 applies the SHARED glossary tailoring_engine.py already built
    for this run (see arabic_glossary in core/state.py). This is free — no
    API call — and it's what keeps a term rendered identically in both
    documents; previously the CV said "بايثون" while the letter said
    "Python" for the same skill.

    Stage 2 handles anything the letter used that the CV didn't, by
    translating just those leftover terms. Both stages are best-effort: if
    translation fails the original text is kept, because a partly-mixed
    letter beats no letter at all.
    """
    if cv_language != "ar" or not text:
        return text

    if glossary:
        text = apply_glossary(text, glossary)

    leftover = find_latin_terms([text])
    if not leftover:
        logger.info("✅ Arabic cover letter is fully Arabic.")
        return text

    logger.warning(f"🔤 Arabic cover letter still contains Latin terms ({leftover[:8]}) — translating leftovers...")
    try:
        extra = build_glossary(leftover)
        if not extra:
            return text
        fixed = apply_glossary(text, extra)
        still = find_latin_terms([fixed])
        if still:
            logger.warning(f"🔤 Cover letter still has Latin terms after localization: {still[:6]}")
        else:
            logger.info("✅ Arabic cover letter localization complete.")
        return fixed
    except Exception as e:
        logger.error(f"🔤 Arabic cover letter localization failed: {e} — keeping best-effort original.")
        return text


def _strip_leaked_greeting_and_signoff(text: str, candidate_name: str) -> str:
    """
    Defensive safety net — mirrors the em-dash stripping below. The prompt
    now tells the model not to write a greeting/sign-off (the PDF/DOCX template
    already adds both), but LLM output isn't 100% guaranteed to follow that,
    so this catches a leaked "Dear ..." opening paragraph or a leaked
    "Sincerely, {name}" closing paragraph without touching real body content.
    """
    if not text:
        return text

    paragraphs = [p.strip() for p in text.split("\n") if p.strip()]
    if not paragraphs:
        return text

    # Drop a leading greeting paragraph, e.g. "Dear Hiring Manager,"
    if paragraphs and paragraphs[0].lower().startswith(_GREETING_PREFIXES):
        paragraphs = paragraphs[1:]

    # Drop trailing sign-off paragraph(s): a "Sincerely,"-style line, and/or
    # a short final line that's just the candidate's name (or a fragment of
    # it, e.g. a truncated "S" from a cut-off signature).
    name_norm = (candidate_name or "").strip().lower()
    while paragraphs:
        last = paragraphs[-1].strip().rstrip(",")
        last_lower = last.lower()
        is_signoff_word = any(m in last_lower for m in _SIGNOFF_MARKERS)
        is_name_fragment = bool(last) and len(last) <= max(len(name_norm), 3) and (
            name_norm.startswith(last_lower) or last_lower == name_norm
        )
        if is_signoff_word or is_name_fragment:
            paragraphs.pop()
        else:
            break

    return "\n".join(paragraphs).strip()


def generate_cover_letter(state: AgentState) -> str:
    """
    Agent 4a — Cover Letter Writer. Runs on core/llm_config.WRITING_MODEL.
    Retry/backoff logic for transient errors lives in generate_writing_text.
    """
    weight_factors = state["weight_factors"]
    facts_json     = state["facts_json"]
    cv_language    = state.get("cv_language", "en") or "en"

    language_instruction = (
        _AR_COVER_LETTER_LANGUAGE_INSTRUCTION
        if cv_language == "ar"
        else _EN_COVER_LETTER_LANGUAGE_INSTRUCTION
    )

    # AN UNNAMED EMPLOYER IS AN ABSENT FIELD, NOT A DESCRIPTION OF ONE.
    #
    # This used to substitute the string "the employer (not named in the
    # posting)". That stopped the letter being addressed to a company called
    # "Unknown", but it introduced a subtler defect: the model read the
    # parenthetical as something to acknowledge and wrote it into the letter —
    # "Since the employer is not named in the posting, I am addressing this
    # application to the organization recruiting for the role." A cover letter
    # that explains its own template is worse than one that simply does not
    # name a company. Found by reading a generated letter, same as the
    # "Unknown Recruitment Team" bug before it.
    company = real_company(weight_factors.get("company"))
    prompt = COVER_LETTER_USER_TEMPLATE.format(
        job_title       = weight_factors.get("job_title", "the role"),
        company         = company or "",
        employer_rule   = (
            ""
            if company else
            "\nTHE EMPLOYER IS NOT NAMED in this posting. Write the letter without naming a "
            "company, and do NOT mention or explain the absence — no 'the company', no 'your "
            "organisation', no remark about the posting not naming anyone. Simply write about "
            "the role and the candidate's work. The greeting is added separately and already "
            "handles an unknown recipient."
        ),
        culture_signals = ", ".join(weight_factors.get("culture_signals", [])),
        facts_json      = json.dumps(facts_json, ensure_ascii=False),
        weight_factors  = json.dumps(weight_factors, ensure_ascii=False),
        language_instruction = language_instruction,
    )

    logger.info(f"✍️  Agent 4a — Generating cover letter via {WRITING_MODEL}...")

    try:
        # 800 -> 2000: every current writing model reasons before it answers
        # and those tokens come out of the same budget as the visible text
        # (Anthropic calls it adaptive thinking, OpenAI reports it as
        # completion_tokens_details.reasoning_tokens — same accounting either
        # way). 800 was sized for a generation that didn't think unless asked.
        # generate_writing_text also auto-escalates further if this still
        # isn't enough, so this is a safe starting point, not a hard ceiling.
        # Arabic needs roughly 2-3x the output budget for the same letter —
        # see WRITING_BUDGETS in core/llm_config.py. A flat 2000 was enough
        # for English and tight for Arabic.
        text = generate_writing_text(
            prompt,
            max_tokens=3500 if cv_language == "ar" else 2000,
            max_tokens_ceiling=8000,
            system=COVER_LETTER_SYSTEM_PROMPT,
        ).strip()
        # Defensive cleanup: strip any em/en dashes that slip through despite
        # the prompt rule, replacing with a comma so sentences stay readable
        # instead of just deleting the character and running words together.
        text = text.replace(" — ", ", ").replace(" – ", ", ").replace("—", ",").replace("–", "-")
        # Match against BOTH the profile name (what the letter is actually
        # signed with) and the parsed CV name (what the model is most likely to
        # have echoed), so a leaked signature is caught either way.
        text = _strip_leaked_greeting_and_signoff(text, resolve_candidate_name(state))
        text = _strip_leaked_greeting_and_signoff(text, (facts_json.get("personal", {}) or {}).get("name", ""))
        # No-op for English. See _enforce_arabic_letter_purity.
        text = _enforce_arabic_letter_purity(text, cv_language, state.get("arabic_glossary"))
        logger.info("✅ Cover letter generated.")
        return text
    except ProviderAPIError as e:
        # PROVIDER-NEUTRAL ON PURPOSE. This used to catch anthropic.APIError
        # only, so after the writing model moved to OpenAI it caught nothing:
        # a provider outage fell through to the bare `except Exception` below
        # and was logged as "Execution handling error", which names neither
        # the cause nor the provider. ProviderAPIError is the tuple of both
        # SDKs' base error classes — see core/llm_config.py — so this keeps
        # working whichever way WRITING_MODEL is set.
        logger.error(f"Critical model API error during cover letter generation: {e}")
        raise RuntimeError(f"Cover letter generation failed: {e}")
    except Exception as e:
        logger.error(f"Execution handling error: {e}")
        raise e


def run_document_generator(state: AgentState) -> dict:
    """
    LangGraph node for Agent 4.
    Generates cover letter text and stores it in state.
    PDF/DOCX rendering handled by utils/pdf_generator.py and utils/docx_generator.py.
    """
    # Every other node in the fan-out already had this guard; this one
    # didn't, so a run whose tailoring had permanently failed still paid for
    # a full model call here to write a cover letter for a CV that was
    # never produced. The orchestrator now stops before reaching this node
    # at all, but keep the guard so the node is safe to call directly and so
    # a future edge into it can't silently reintroduce the cost.
    if state.get("error") or state.get("fatal_error_code"):
        return {}

    cover_letter_text = generate_cover_letter(state)
    return {"cover_letter_text": cover_letter_text}

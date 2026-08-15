# utils/cv_context.py
"""
Builds the render context both generators need from LangGraph state:
  - utils/pdf_generator.py (Jinja2 + WeasyPrint, template-driven)
  - utils/docx_generator.py (python-docx, style-preset-driven)

This used to be duplicated inline in both files (bullet_lookup /
project_lookup built twice, slightly differently). Centralizing it means a
future bug fix to "how do we match a tailored bullet back to its section"
only has to happen once, and PDF/DOCX can't drift out of sync again.
"""

from loguru import logger

from core.profile_names import has_arabic, has_latin
from utils.skills import has_skills
from utils.template_registry import DEFAULT_TEMPLATE_ID
from utils.arabic_localizer import apply_glossary, localize_date, to_eastern_arabic_numerals


def _s(value) -> str:
    """
    String-coalesce: `None` -> "", anything else -> str(value) unchanged.
    Exists because `dict.get(key, default)` is a no-op whenever `key` IS
    present with an explicit `None` value (Pydantic's model_dump() always
    includes Optional fields, even unset ones) — `.get()`'s default only
    kicks in when the key is missing entirely. Every Optional field coming
    out of facts_json/tailored_* must be routed through this (or `or ""`)
    before it reaches a template or docx run, otherwise Jinja/f-strings
    print the literal text "None" for an unset field — see the CV/DOCX
    "None" rendering bug this fixes.
    """
    return "" if value is None else str(value)


# ─── TEMPLATE CHROME ────────────────────────────────────────────────────────
# Section headings and field labels were hardcoded English literals inside
# all 12 Jinja templates ("Skills", "Languages:", "GPA", ...). Since they
# live in the template rather than in the generated content, no amount of
# Arabic localization in the pipeline could reach them — an Arabic CV came
# out with fully Arabic prose sitting under English headings.
#
# Both variants live here, in one place, so a template can render either
# language without knowing anything about which one it's in, and so a new
# label can't be added to one language and forgotten in the other.
_LABELS_EN = {
    "profile": "Profile",
    "summary": "Summary",
    "professional_summary": "Professional Summary",
    "experience": "Experience",
    "work_experience": "Work Experience",
    "professional_experience": "Professional Experience",
    "projects": "Projects",
    "skills": "Skills",
    "education": "Education",
    "certifications": "Certifications",
    "volunteer": "Volunteer Work",
    "contact": "Contact",
    "languages": "Languages",
    "frameworks": "Frameworks",
    "frameworks_libraries": "Frameworks & Libraries",
    "tools": "Tools",
    "soft_skills": "Soft Skills",
    "other_skills": "Other",
    "gpa": "GPA",
    "coursework": "Relevant Coursework",
}

_LABELS_AR = {
    "profile": "نبذة",
    "summary": "الملخص",
    "professional_summary": "الملخص المهني",
    "experience": "الخبرات",
    "work_experience": "الخبرات العملية",
    "professional_experience": "الخبرات المهنية",
    "projects": "المشاريع",
    "skills": "المهارات",
    "education": "التعليم",
    "certifications": "الشهادات",
    "volunteer": "العمل التطوعي",
    "contact": "معلومات التواصل",
    "languages": "لغات البرمجة",
    "frameworks": "الأطر والمكتبات",
    "frameworks_libraries": "الأطر والمكتبات",
    "tools": "الأدوات",
    "soft_skills": "المهارات الشخصية",
    "other_skills": "مهارات أخرى",
    "gpa": "المعدل التراكمي",
    "coursework": "المواد الدراسية ذات الصلة",
}


def _script_matches_output(name: str, is_arabic: bool) -> bool:
    """
    Is this name written in the script the document is being rendered in?

    Deliberately strict — a name must be PURELY the target script to count.
    A mixed-script string ("Abdulmalik عبدالملك", or an Arabic name with a
    Latin middle initial) is ambiguous about which spelling its owner
    considers theirs, so it defers to the profile field rather than guessing.
    Conservative in the safe direction: the profile value is always something
    the user typed themselves.
    """
    arabic, latin = has_arabic(name), has_latin(name)
    return (arabic and not latin) if is_arabic else (latin and not arabic)


def resolve_candidate_name(state: dict) -> str:
    """
    The candidate's name for this run. Never machine-translated, and now
    preferring the name on the CV they actually uploaded.

    WHY THIS ORDER CHANGED. The profile field used to win unconditionally,
    and because main.py's apply_candidate_names() refuses the run outright
    when that field is empty, the parsed CV name was structurally
    unreachable — every CV rendered with the account's settings name on it,
    even when the uploaded document said something else. That is the
    reported bug: upload a CV under an account whose profile name differs,
    and the wrong person's name comes out on the document.

    WHY IT IS NOT SIMPLY "PARSED NAME FIRST". A name has several valid
    spellings across scripts and only its owner knows which is theirs, which
    is the whole reason profiles.name_ar / name_en exist (see
    core/profile_names.py). Taking the parsed name unconditionally would put
    a Latin name on an Arabic CV whenever someone uploads an English CV and
    asks for Arabic output — reintroducing exactly what those fields fixed.

    So the test is SCRIPT MATCH, not source precedence. When the uploaded CV
    is already written in the output language, its name is the most
    authoritative spelling available — profile_names.py makes this same
    argument itself about Arabic CVs: the document "already contains the
    candidate's own Arabic spelling, which is authoritative in a way a
    machine transliteration never is." When the scripts differ, no
    authoritative spelling exists in the CV and the profile field is the
    only real answer.

    RESOLUTION ORDER, most to least authoritative:
      1. The parsed CV name, IF it is written in the output language's
         script. Verbatim, no glossary.
      2. The profile field for this output language — the user typed it.
      3. The other language's profile field, used as-is. Still a real name
         the user typed, just in the other script.
      4. The parsed CV name, glossary-translated. LEGACY path, reachable
         only when the user explicitly opted out of the name prompt —
         main.py sets name_fallback_used so it stays visible.

    Resolution matrix:
      EN CV -> EN doc : parsed name      (1)
      AR CV -> AR doc : parsed name      (1)
      EN CV -> AR doc : profile name_ar  (2)  no Latin name on an Arabic CV
      AR CV -> EN doc : profile name_en  (2)

    Shared by build_cv_context and pdf_generator's cover letter so the CV,
    the DOCX and the letter can never disagree about what the candidate is
    called. Manual-entry runs resolve identically: run_manual_cv_parser
    produces the same facts_json shape from the typed form.
    """
    is_arabic = str(state.get("cv_language", "en")).lower().startswith("ar")

    parsed = _s(((state.get("facts_json", {}) or {}).get("personal", {}) or {}).get("name")).strip()
    preferred = ((state.get("profile_name_ar") if is_arabic else state.get("profile_name_en")) or "").strip()
    other = ((state.get("profile_name_en") if is_arabic else state.get("profile_name_ar")) or "").strip()

    if parsed and _script_matches_output(parsed, is_arabic):
        return parsed

    # Everything below here is a fallback, and the brief asks that none of
    # them be silent. Two distinct situations, logged differently on purpose:
    #
    #   · No parsed name at all. Agent 1 is REQUIRED to return one
    #     (facts_schema.PersonalInfo.name is non-optional) and main.py's
    #     _pipeline_produced_usable_cv gates the whole run on it, so reaching
    #     here means something upstream went wrong in a way those checks
    #     missed — a partial extraction. WARNING: this one is a defect
    #     signal, and it is the line to grep for when a rendered CV has an
    #     unexpected name on it.
    #
    #   · A parsed name in the other script. Entirely expected (an English
    #     CV asked to render in Arabic) and the correct behaviour, so it is
    #     INFO, not a warning. Still recorded, because it explains why the
    #     document does not carry the name printed on the uploaded file.
    user_id = state.get("user_id") or "unknown"
    target_script = "Arabic" if is_arabic else "Latin"
    if not parsed:
        logger.warning(
            f"👤 NAME FALLBACK (no parsed name): Agent 1 returned no personal.name for user "
            f"{user_id}, falling back to the profile name for a '{'ar' if is_arabic else 'en'}' CV. "
            f"This should not happen — treat it as a partial extraction."
        )
    else:
        logger.info(
            f"👤 Name fallback (script mismatch): the uploaded CV's name is not {target_script} "
            f"script, so the {target_script} profile name is used for this "
            f"'{'ar' if is_arabic else 'en'}' CV (user {user_id})."
        )

    if preferred:
        return preferred

    if other:
        logger.warning(
            f"👤 NAME FALLBACK (other script): no {target_script} profile name on file for user "
            f"{user_id} — rendering the other language's profile name as-is."
        )
        return other

    glossary = (state.get("arabic_glossary") or {}) if is_arabic else {}
    logger.warning(
        f"👤 LEGACY NAME PATH: no profile name in either language for user {user_id}; "
        f"using the CV's parsed name{' via the Arabic glossary' if glossary else ''}. "
        f"See apply_candidate_names in main.py."
    )
    return apply_glossary(parsed, glossary) if glossary else parsed


def build_cv_context(state: dict, template_id: str | None = None) -> dict:
    facts = state.get("facts_json", {}) or {}
    personal = facts.get("personal", {}) or {}
    is_arabic = state.get("cv_language", "en") == "ar"

    # Arabic term glossary built by tailoring_engine.py — see the
    # arabic_glossary note in core/state.py. `ar()` is the single place raw
    # facts_json text gets localized on its way into the render context.
    #
    # This is what fixes the largest remaining source of English on an
    # "Arabic" CV: the tailored bullets were translated, but the employer,
    # university, degree and certifications printed directly around them
    # came straight out of facts_json and no agent ever touched them.
    # Purely a dictionary substitution — no LLM call happens here, which
    # matters because this runs inside the render thread pool.
    #
    # Identifier fields (email / phone / linkedin / github) are NEVER routed
    # through this. apply_glossary defends itself against them too, but the
    # real guarantee is that they simply aren't passed in.
    glossary = (state.get("arabic_glossary") or {}) if is_arabic else {}

    def ar(value) -> str:
        return apply_glossary(_s(value), glossary) if glossary else _s(value)

    def ar_list(values) -> list:
        return [ar(v) for v in (values or [])]


    # WHICH SKILLS ACTUALLY GET PRINTED.
    #
    # This was `state.get("tailored_skills") or facts.get("skills", {})`, and
    # that `or` is why CVs shipped with no Skills section at all: Agent 3
    # returns the five categories present-and-empty when it produced no
    # skills, which is truthy, so the raw parsed skills were never reached.
    # has_skills asks the question the code actually means. See utils/skills.py.
    #
    # Whether we fell back also decides localization: a tailored set is
    # already Arabic, the raw facts set is still English and has to go
    # through the glossary or an Arabic CV prints an English skills column.
    agent_skills = state.get("tailored_skills")
    if has_skills(agent_skills):
        tailored_skills = agent_skills
    elif has_skills(facts.get("skills")):
        raw_skills = facts.get("skills") or {}
        tailored_skills = (
            {
                category: ar_list(items) if isinstance(items, list) else items
                for category, items in raw_skills.items()
            }
            if glossary
            else raw_skills
        )
    else:
        tailored_skills = {}

    bullet_lookup = {
        (b.get("original") or "").strip(): (b.get("tailored") or "").strip()
        for b in state.get("tailored_bullets", []) or []
        if b.get("original") and b.get("tailored")
    }
    project_lookup = {
        (p.get("name") or "").strip(): p
        for p in state.get("tailored_projects", []) or []
        if p.get("name")
    }
    # Job titles: tailoring_engine.py now returns a localized title per
    # experience entry (see tailored_experience_titles), matched back by the
    # "company" field the same way tailored_projects matches by "name". This
    # exists specifically for Arabic CVs — without it, the title would stay
    # in whatever language the original uploaded CV was written in, even
    # while the bullets underneath it were freshly translated to Arabic.
    title_lookup = {
        (t.get("company") or "").strip(): (t.get("title") or "").strip()
        for t in state.get("tailored_experience_titles", []) or []
        if t.get("company") and t.get("title")
    }
    raw_volunteer_work = facts.get("volunteer_work", []) or []
    tailored_volunteer_work = state.get("tailored_volunteer_work", []) or []
    display_volunteer = (
        tailored_volunteer_work
        if len(tailored_volunteer_work) == len(raw_volunteer_work)
        else raw_volunteer_work
    )

    # Experience: attach each raw bullet's tailored replacement, in order,
    # as a plain list of strings — matches the real data shape (bullets
    # live inline on the experience entry, there's no separate "section"
    # tag to filter on).
    experience = []
    for exp in facts.get("experience", []) or []:
        # IMPORTANT: only the RAW fallback goes through ar(). A bullet that
        # came from bullet_lookup was already localized inside
        # tailoring_engine, and running the glossary over it a second time
        # can nest a substitution inside itself when a translation happens
        # to still contain its own Latin term (e.g. "بايثون (Python)").
        # Same reasoning applies to the title, projects and volunteer work
        # below: localize the fallback, never the already-tailored value.
        resolved_bullets = []
        for raw in (exp.get("bullets", []) or []):
            if not raw or not raw.strip():
                continue
            tailored = bullet_lookup.get(raw.strip())
            resolved_bullets.append(tailored if tailored is not None else ar(raw))

        experience.append({
            "title": title_lookup.get((exp.get("company") or "").strip()) or ar(exp.get("title")),
            "company": ar(exp.get("company")),
            # Month names and digits — see localize_date. Previously this
            # only happened inside pdf_generator, so the DOCX kept English
            # month names on an otherwise Arabic CV.
            "dates": localize_date(exp.get("dates")) if is_arabic else _s(exp.get("dates")),
            "bullets": resolved_bullets,
        })

    # Projects: a single tailored paragraph per project (tailored_description),
    # not a bullet list — matches tailoring_engine.py's actual output shape.
    projects = []
    for proj in facts.get("projects", []) or []:
        name = (proj.get("name") or "").strip()
        tailored = project_lookup.get(name)
        # tailored.tech_stack is tailoring_engine.py's cleaned/inferred version
        # (also translated for Arabic) — prefer it over the raw facts_json
        # pass-through, same "prefer the tailored version, fall back to raw"
        # pattern used for title/description just above. Only fall back if
        # tailoring_engine genuinely returned nothing usable.
        tailored_tech = (tailored or {}).get("tech_stack") or []
        if tailored_tech:
            # Already localized by tailoring_engine — do not re-apply.
            tech_items = [_s(t).strip() for t in tailored_tech if _s(t).strip()]
        else:
            raw_tech = proj.get("tech_stack") or proj.get("technologies") or []
            if isinstance(raw_tech, str):
                raw_tech = [t.strip() for t in raw_tech.split(",") if t.strip()]
            tech_items = [ar(t).strip() for t in raw_tech if _s(t).strip()]
        projects.append({
            # `name` here is the raw facts_json project name used as the
            # display fallback — localize it. The join key itself (matched
            # in project_lookup above) is deliberately left untranslated.
            "name": (tailored.get("display_name") if tailored else None) or ar(name),
            "tech_stack": tech_items,
            "description": (tailored.get("tailored_description") if tailored else None)
                            or ar(proj.get("description")),
        })

    education = [
        {
            "institution": ar(edu.get("institution")),
            "degree": ar(edu.get("degree")),
            # GPA is a number; graduation_year can carry "2022-Current".
            "gpa": to_eastern_arabic_numerals(_s(edu.get("gpa"))) if is_arabic else _s(edu.get("gpa")),
            "graduation_year": localize_date(edu.get("graduation_year")) if is_arabic else _s(edu.get("graduation_year")),
            "distinctions": ar_list(edu.get("distinctions")),
            "relevant_coursework": ar_list(edu.get("relevant_coursework")),
        }
        for edu in (facts.get("education", []) or [])
    ]

    return {
        "personal": {
            # name comes verbatim from the uploaded CV when its script
            # matches this document's, and from the profile otherwise —
            # see resolve_candidate_name. Never glossary-translated on
            # either path. location is prose and gets localized.
            # email / phone / linkedin / github are IDENTIFIERS and must
            # render byte-for-byte — same rule pdf_generator.py's
            # _arabicize_prose already enforces for its own fields.
            "name": resolve_candidate_name(state),
            "email": _s(personal.get("email")),
            "phone": _s(personal.get("phone")),
            "location": ar(personal.get("location")),
            "linkedin": _s(personal.get("linkedin")),
            "github": _s(personal.get("github")),
        },
        "tagline": state.get("tagline") or None,
        "tailored_summary": state.get("tailored_summary") or ar(facts.get("summary")),
        "experience": experience,
        "projects": projects,
        "skills": tailored_skills,
        "education": education,
        "certifications": ar_list(facts.get("certifications")),
        # display_volunteer is tailoring_engine's already-localized list when
        # the counts line up, and the raw facts list otherwise — only the
        # latter needs the glossary. See the note in the experience loop.
        "volunteer_work": (
            display_volunteer
            if display_volunteer is tailored_volunteer_work
            else ar_list(display_volunteer)
        ),
        "is_arabic": is_arabic,
        # Section headings / field labels for whichever language this CV is
        # in — see _LABELS_EN / _LABELS_AR. Templates must read these rather
        # than hardcoding English text.
        "labels": _LABELS_AR if is_arabic else _LABELS_EN,
        "template_id": template_id or DEFAULT_TEMPLATE_ID,
    }

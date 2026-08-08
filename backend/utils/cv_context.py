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


def resolve_candidate_name(state: dict) -> str:
    """
    The candidate's name for this run, taken VERBATIM from the profile field
    matching the output language — never machine-translated.

    A personal name has no single correct translation: the same name maps to
    several valid Arabic spellings, and only its owner knows which is theirs.
    Running it through the Arabic glossary produced names that were simply
    wrong, so it now follows the same preserve-as-is rule that already
    protects email / phone / LinkedIn / GitHub, sourced from
    profiles.name_ar / profiles.name_en (see core/profile_names.py).

    FALLBACK ORDER, most to least authoritative:
      1. The profile field for this output language — the user typed it.
      2. The other language's profile field, used as-is. Still a real name
         the user typed, just in the other script; showing that beats
         inventing a spelling for them.
      3. The name parsed from the CV, glossary-translated. This is the
         LEGACY path and only happens when the user explicitly chose to
         generate without filling the field in — main.py sets
         name_fallback_used in that case so it stays visible.

    Shared by build_cv_context and pdf_generator's cover letter so the two
    documents can never disagree about what the candidate is called.
    """
    is_arabic = str(state.get("cv_language", "en")).lower().startswith("ar")

    preferred = (state.get("profile_name_ar") if is_arabic else state.get("profile_name_en")) or ""
    if preferred.strip():
        return preferred.strip()

    other = (state.get("profile_name_en") if is_arabic else state.get("profile_name_ar")) or ""
    if other.strip():
        return other.strip()

    raw_name = ((state.get("facts_json", {}) or {}).get("personal", {}) or {}).get("name")
    glossary = (state.get("arabic_glossary") or {}) if is_arabic else {}
    return apply_glossary(_s(raw_name), glossary) if glossary else _s(raw_name)


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


    tailored_skills = state.get("tailored_skills") or facts.get("skills", {}) or {}
    # The skills fallback above can hand back the RAW English facts_json
    # skills when Agent 3 didn't return a tailored set — localize those too
    # rather than printing an English skills column on an Arabic CV.
    if glossary and not state.get("tailored_skills"):
        tailored_skills = {
            category: ar_list(items) if isinstance(items, list) else items
            for category, items in (tailored_skills or {}).items()
        }

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
            # name comes verbatim from the profile — see
            # resolve_candidate_name. location is prose and gets localized.
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
        "template_id": template_id or DEFAULT_TEMPLATE_ID,
    }

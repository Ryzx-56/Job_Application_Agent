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


def build_cv_context(state: dict, template_id: str | None = None) -> dict:
    facts = state.get("facts_json", {}) or {}
    personal = facts.get("personal", {}) or {}
    is_arabic = state.get("cv_language", "en") == "ar"

    tailored_skills = state.get("tailored_skills") or facts.get("skills", {}) or {}

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
        resolved_bullets = [
            bullet_lookup.get(raw.strip(), raw)
            for raw in (exp.get("bullets", []) or [])
            if raw and raw.strip()
        ]
        fallback_title = _s(exp.get("title"))
        experience.append({
            "title": title_lookup.get((exp.get("company") or "").strip()) or fallback_title,
            "company": _s(exp.get("company")),
            "dates": _s(exp.get("dates")),
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
            tech_items = tailored_tech
        else:
            tech_items = proj.get("tech_stack") or proj.get("technologies") or []
            if isinstance(tech_items, str):
                tech_items = [t.strip() for t in tech_items.split(",") if t.strip()]
        projects.append({
            "name": (tailored.get("display_name") if tailored else None) or name,
            "tech_stack": [str(t).strip() for t in tech_items if str(t).strip()],
            "description": (tailored.get("tailored_description") if tailored else None)
                            or _s(proj.get("description")),
        })

    education = [
        {
            "institution": _s(edu.get("institution")),
            "degree": _s(edu.get("degree")),
            "gpa": _s(edu.get("gpa")),
            "graduation_year": _s(edu.get("graduation_year")),
            "distinctions": edu.get("distinctions") or [],
            "relevant_coursework": edu.get("relevant_coursework") or [],
        }
        for edu in (facts.get("education", []) or [])
    ]

    return {
        "personal": {
            "name": _s(personal.get("name")),
            "email": _s(personal.get("email")),
            "phone": _s(personal.get("phone")),
            "location": _s(personal.get("location")),
            "linkedin": _s(personal.get("linkedin")),
            "github": _s(personal.get("github")),
        },
        "tagline": state.get("tagline") or None,
        "tailored_summary": state.get("tailored_summary") or _s(facts.get("summary")),
        "experience": experience,
        "projects": projects,
        "skills": tailored_skills,
        "education": education,
        "certifications": facts.get("certifications", []) or [],
        "volunteer_work": display_volunteer,
        "is_arabic": is_arabic,
        "template_id": template_id or DEFAULT_TEMPLATE_ID,
    }

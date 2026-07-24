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
        experience.append({
            "title": exp.get("title", ""),
            "company": exp.get("company", ""),
            "dates": exp.get("dates", ""),
            "bullets": resolved_bullets,
        })

    # Projects: a single tailored paragraph per project (tailored_description),
    # not a bullet list — matches tailoring_engine.py's actual output shape.
    projects = []
    for proj in facts.get("projects", []) or []:
        name = (proj.get("name") or "").strip()
        tailored = project_lookup.get(name)
        tech_items = proj.get("tech_stack") or proj.get("technologies") or []
        if isinstance(tech_items, str):
            tech_items = [t.strip() for t in tech_items.split(",") if t.strip()]
        projects.append({
            "name": (tailored.get("display_name") if tailored else None) or name,
            "tech_stack": [str(t).strip() for t in tech_items if str(t).strip()],
            "description": (tailored.get("tailored_description") if tailored else None)
                            or proj.get("description", ""),
        })

    return {
        "personal": {
            "name": personal.get("name", ""),
            "email": personal.get("email", ""),
            "phone": personal.get("phone", ""),
            "location": personal.get("location", ""),
            "linkedin": personal.get("linkedin", ""),
            "github": personal.get("github", ""),
        },
        "tagline": state.get("tagline") or None,
        "tailored_summary": state.get("tailored_summary") or facts.get("summary", ""),
        "experience": experience,
        "projects": projects,
        "skills": tailored_skills,
        "education": facts.get("education", []) or [],
        "certifications": facts.get("certifications", []) or [],
        "volunteer_work": display_volunteer,
        "is_arabic": is_arabic,
        "template_id": template_id or DEFAULT_TEMPLATE_ID,
    }

# agents/cv_parser.py
import json
from pydantic import ValidationError
from schemas.facts_schema import FactsJSON
from utils.pdf_parser import extract_text_from_pdf
from core.llm_config import generate_gemini_json

CV_PARSER_PROMPT = """
You are a CV data extractor. Your ONLY job is to extract existing information from the CV text below.

STRICT RULES:
- Extract ONLY what is explicitly written in the CV
- Do NOT infer, guess, or add any information
- Do NOT rephrase or improve anything
- If a section is missing from the CV, return an empty list [] for it
- If a field is missing, return null for it
- All dates must be extracted exactly as written
- All bullets must be extracted word-for-word

EDUCATION vs EXPERIENCE — read carefully, this is a common mistake:
- An entry belongs under "education" if it describes the candidate's own enrollment, degree
  program, or student status at an institution — even if the CV lists it in a section titled
  "Experience" or similar. For example, a line like:
    Student — King Abdulaziz University    Jan 2022 – Feb 2024
  belongs under "education" (institution: "King Abdulaziz University"), NOT under "experience",
  even though "Student" might look like a job title at first glance.
- An entry belongs under "experience" ONLY if it describes actual work performed for an employer
  or organization — a job, internship, or freelance role where the candidate did tasks for that
  organization. "Intern" or "Internship" IS real experience and belongs under "experience", even
  if it happened during or alongside a degree program — do not merge it into the education entry
  or drop it.
- A good test: if the line is just describing academic enrollment (no employer, no job duties),
  it's education. If it describes tasks/responsibilities performed for an organization, it's
  experience — regardless of which section heading the CV author put it under.

DATES — read carefully, this is a common mistake:
- Always extract the FULL date range exactly as written in the CV, including both the start and
  end (e.g. "Jan 2022 – Feb 2024" or "June 2025 – August 2025"), not just a single year.
- Do NOT substitute a graduation year or any other single year for the actual date range that
  appears next to the entry. If the CV shows both a graduation year AND a separate date range for
  an experience or education entry, use the date range that is actually attached to that specific
  entry — do not pull in a graduation year from elsewhere in the CV instead.
- If only a single date is genuinely written for an entry (no range), extract exactly that single
  date — do not invent an end date.

EXPERIENCE BULLETS — read carefully, this is a common mistake:
- "bullets" must ONLY contain lines that describe an action, responsibility, or achievement —
  typically a sentence starting with a verb, or a line marked with a bullet symbol (•, -, ➢, *)
  that describes something the candidate DID.
- Do NOT include a venue name, department name, or location sub-line as a bullet. For example, if
  the CV shows:
    Sales Associate — Acme Corp    June 2025 – August 2025
    Acme Flagship Store, Jeddah
    ➢ Managed reception operations...
  then "Acme Flagship Store, Jeddah" is NOT a bullet — it is a location/venue detail. Append it to
  the "company" field instead, separated by " — " (e.g. "company": "Acme Corp — Acme Flagship Store,
  Jeddah"). Only "➢ Managed reception operations..." belongs in "bullets".
- A good test: if a line has no verb and is just a proper-noun name/place, it is NOT a bullet.

Return your response as a single valid JSON object matching this exact structure:
{{
  "personal": {{
    "name": "string — REQUIRED",
    "email": "string or null",
    "phone": "string or null",
    "linkedin": "string or null",
    "github": "string or null",
    "location": "string or null",
    "portfolio": "string or null"
  }},
  "education": [{{
    "institution": "string",
    "degree": "string",
    "gpa": "string or null",
    "graduation_year": "string or null",
    "distinctions": ["list of strings or empty list"],
    "relevant_coursework": ["list of strings or empty list"]
  }}],
  "experience": [{{
    "company": "string — include venue/location sub-line here (see rule above) if present, do NOT put it in bullets",
    "title": "string",
    "dates": "string or null",
    "bullets": ["exact action/responsibility bullet text only — see rule above — or empty list"],
    "metrics": ["any quantified achievements or empty list"]
  }}],
  "skills": {{
    "languages": ["programming languages or empty list"],
    "frameworks": ["frameworks and libraries or empty list"],
    "tools": ["tools and platforms or empty list"],
    "soft_skills": ["soft skills or empty list"],
    "other": ["anything that does not fit above categories or empty list"]
  }},
  "projects": [{{
    "name": "string",
    "tech_stack": ["technologies used or empty list"],
    "description": "string or null",
    "metrics": ["any quantified results or empty list"],
    "url": "string or null"
  }}],
  "certifications": ["list of certification names or empty list"],
  "languages_spoken": ["human languages spoken, NOT programming languages or empty list"],
  "volunteer_work": ["list of volunteer work descriptions or empty list"],
  "awards": ["list of awards or empty list"]
}}

IMPORTANT: 
- "languages" under skills = programming languages like Python, Java
- "languages_spoken" at the top level = human languages like Arabic, English, French
- Never confuse these two

CV TEXT:
{cv_text}

Return ONLY the JSON object. No explanation, no markdown, no extra text.
"""

def parse_cv(cv_path: str, max_retries: int = 3) -> FactsJSON:
    """
    Extracts facts from a CV PDF and returns a validated FactsJSON object.
    Retries up to max_retries times if Pydantic validation fails.
    Only personal.name is required — all other sections are optional.
    """
    return parse_cv_text(extract_text_from_pdf(cv_path), max_retries=max_retries)


def parse_cv_text(cv_text: str, max_retries: int = 3) -> FactsJSON:
    """Extract facts from raw CV text."""
    last_error = None

    for attempt in range(1, max_retries + 1):
        print(f"[Agent 1] Attempt {attempt}/{max_retries}")

        try:
            raw_json = generate_gemini_json(CV_PARSER_PROMPT.format(cv_text=cv_text))
            data = json.loads(raw_json)
            facts = FactsJSON.model_validate(data)

            print(f"[Agent 1] ✅ Extraction successful on attempt {attempt}")
            _print_summary(facts)
            return facts

        except (json.JSONDecodeError, ValidationError) as e:
            last_error = e
            print(f"[Agent 1] ❌ Attempt {attempt} failed: {e}")
            continue

    raise RuntimeError(
        f"[Agent 1] CV parsing failed after {max_retries} attempts. "
        f"Last error: {last_error}"
    )


def run_cv_parser(state: dict) -> dict:
    """LangGraph node: parse raw_cv_text into facts_json."""
    try:
        cv_text = state["raw_cv_text"]
        additional_info = (state.get("additional_info") or "").strip()
        if additional_info:
            cv_text += "\n\nADDITIONAL INFORMATION FROM CANDIDATE:\n" + additional_info

        facts = parse_cv_text(cv_text)
        return {"facts_json": facts.model_dump(), "error": None}
    except Exception as e:
        return {"error": f"Agent 1 failed: {e}"}


def serialize_manual_cv(form_data: dict, additional_info: str = "") -> str:
    """
    Converts structured 'Create New CV' form data into a plain-text block
    shaped like a real CV, so it can run through the exact same Gemini
    extraction pipeline (parse_cv_text) as an uploaded PDF — keeping
    facts_json output consistent no matter which input method was used.
    """
    lines: list[str] = []

    personal = form_data.get("personal", {}) or {}
    lines.append(f"Name: {personal.get('name', '')}")
    for label, key in [("Email", "email"), ("Phone", "phone"), ("LinkedIn", "linkedin"),
                        ("GitHub", "github"), ("Location", "location"), ("Portfolio", "portfolio")]:
        if personal.get(key):
            lines.append(f"{label}: {personal[key]}")

    education = form_data.get("education") or []
    if education:
        lines.append("\nEDUCATION:")
        for edu in education:
            line = f"- {edu.get('institution', '')}, {edu.get('degree', '')}"
            if edu.get("gpa"):
                line += f", GPA: {edu['gpa']}"
            if edu.get("graduation_year"):
                line += f", {edu['graduation_year']}"
            lines.append(line)
            if edu.get("distinctions"):
                lines.append(f"  Distinctions: {', '.join(edu['distinctions'])}")
            if edu.get("relevant_coursework"):
                lines.append(f"  Relevant coursework: {', '.join(edu['relevant_coursework'])}")

    experience = form_data.get("experience") or []
    if experience:
        lines.append("\nEXPERIENCE:")
        for exp in experience:
            lines.append(f"- {exp.get('title', '')} at {exp.get('company', '')} ({exp.get('dates', '')})")
            for bullet in exp.get("bullets", []) or []:
                if bullet and bullet.strip():
                    lines.append(f"  • {bullet.strip()}")

    projects = form_data.get("projects") or []
    if projects:
        lines.append("\nPROJECTS:")
        for proj in projects:
            line = f"- {proj.get('name', '')}"
            if proj.get("tech_stack"):
                line += f" ({', '.join(proj['tech_stack'])})"
            lines.append(line)
            if proj.get("description"):
                lines.append(f"  {proj['description']}")
            if proj.get("metrics"):
                lines.append(f"  Results: {', '.join(proj['metrics'])}")
            if proj.get("url"):
                lines.append(f"  URL: {proj['url']}")

    skills = form_data.get("skills") or {}
    if any(skills.values()):
        lines.append("\nSKILLS:")
        for category, items in skills.items():
            if items:
                lines.append(f"- {category}: {', '.join(items)}")

    certifications = form_data.get("certifications") or []
    if certifications:
        lines.append("\nCERTIFICATIONS:")
        for cert in certifications:
            lines.append(f"- {cert}")

    languages_spoken = form_data.get("languages_spoken") or []
    if languages_spoken:
        lines.append(f"\nLANGUAGES SPOKEN: {', '.join(languages_spoken)}")

    awards = form_data.get("awards") or []
    if awards:
        lines.append("\nAWARDS:")
        for award in awards:
            lines.append(f"- {award}")

    if additional_info and additional_info.strip():
        lines.append("\nADDITIONAL INFORMATION FROM CANDIDATE:")
        lines.append(additional_info.strip())

    return "\n".join(lines)


def run_manual_cv_parser(state: dict) -> dict:
    """
    LangGraph node for the 'Create New CV' flow. Reuses the exact same
    Gemini extraction pipeline as an uploaded PDF (parse_cv_text) — just
    fed a serialized version of the structured form instead of raw PDF
    text, so downstream nodes see an identical facts_json shape either way.
    """
    try:
        manual_data = state.get("manual_cv_data", {}) or {}
        additional_info = state.get("additional_info", "") or ""
        serialized = serialize_manual_cv(manual_data, additional_info)
        facts = parse_cv_text(serialized)
        return {"facts_json": facts.model_dump(), "error": None}
    except Exception as e:
        return {"error": f"Manual CV parsing failed: {e}"}


def _print_summary(facts: FactsJSON):
    print(f"  → Name: {facts.personal.name}")
    print(f"  → Education entries: {len(facts.education)}")
    print(f"  → Experience entries: {len(facts.experience)}")
    print(f"  → Projects: {len(facts.projects)}")
    print(f"  → Skills (languages): {facts.skills.languages}")
    print(f"  → Skills (frameworks): {facts.skills.frameworks}")
    print(f"  → Skills (tools): {facts.skills.tools}")
    print(f"  → Skills (soft): {facts.skills.soft_skills}")
    print(f"  → Skills (other): {facts.skills.other}")
    print(f"  → Certifications: {facts.certifications}")
    print(f"  → Languages spoken: {facts.languages_spoken}")
    print(f"  → Volunteer work: {len(facts.volunteer_work)} entries")
    print(f"  → Awards: {facts.awards}")

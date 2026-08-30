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
- LOCATION — read carefully, this is a common mistake: "personal.location" is not always next
  to a "Location:" label or grouped with the other contact details at the top. It's often just a
  bare city/country name (e.g. "Jeddah" or "Jeddah, Saudi Arabia") sitting on its own line
  anywhere in the document — near the name, in a footer, under an address heading, or elsewhere.
  Scan the ENTIRE document text for a standalone city/region/country name before concluding there
  is no location — do not only check the lines immediately next to email/phone. Only return null
  if no such text appears anywhere in the CV.
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
- IN-PROGRESS / ONGOING ENTRIES: an entry is not "missing" a date just because it hasn't finished
  yet. If the CV shows an open-ended range for a still-ongoing degree or job — e.g.
  "2022-Current", "2022 - Present", "Jan 2024 – Ongoing" — extract the ENTIRE range exactly as
  written, including the "Current"/"Present"/"Ongoing" token (e.g. "2022-Current"), into that
  entry's date field ("graduation_year" for education, "dates" for experience). Do NOT drop the
  end token, do NOT truncate it to just the start year, and do NOT return null for a degree or job
  that is clearly still in progress — a null/missing date here is only correct when the CV
  genuinely shows no date information at all for that entry.

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
- STRIP any bullet/marker glyph from the START of the extracted text itself (•, ➢, -, *, ●, §, a
  leading ".", or a number like "1)"/"1."). The "bullets" list is rendered inside a template that
  already draws its own bullet marker in front of each item — if the extracted text also starts
  with one of these symbols, the final CV shows two markers stacked together (e.g. "• • Performing
  maintenance..."). Extract ONLY the sentence content, with no leading symbol of any kind.
- Do NOT split ONE logical bullet point across multiple entries in the "bullets" list just because
  it wraps onto several lines in the source PDF, or contains an internal comma/colon. If a single
  bullet marker in the source CV is followed by one continuous sentence (even if that sentence
  spans 2-3 lines of wrapped text), extract it as ONE bullet string, not several. A wrong example:
  splitting "During the training period, I participated in a variety of technical and
  administrative tasks, including:" and "Providing technical support to employees..." into two
  separate bullets when the source only had one bullet marker in front of that whole passage.
- Do NOT create a bullet out of a lead-in clause that only announces a list without describing a
  concrete action itself — e.g. a line ending in "including:" or "as follows:" that exists purely
  to introduce the bullets that come after it. Skip it; the itemized bullets that follow already
  carry the actual information, and keeping the lead-in as its own bullet just duplicates it.
- If you find yourself extracting more than 6-7 bullets for a single experience entry, stop and
  re-check: it's more likely you've fragmented a smaller number of real bullets than that the
  candidate genuinely wrote that many distinct points. Merge fragments of the same sentence back
  together before finalizing.

NOTHING IN THE CV MAY BE DROPPED — read this carefully, it is the most common failure:
- Every section of the CV must end up somewhere in the JSON. If a section's content doesn't
  match any named field below, it goes in "additional_sections" under the CV's own heading.
  "There was no field for it" is never a reason to leave content out.
- Use a NAMED field when the content clearly belongs to it (see the routing rules below).
  Otherwise use "additional_sections". Do not force content into a named field that doesn't
  fit it, and do not invent a new top-level field name.
- Each piece of content goes in EXACTLY ONE place. Never copy the same entry into both a named
  field and "additional_sections" — it would then be printed twice on the finished CV.

ROUTING THE NAMED FIELDS — what belongs in each:
- "summary": the candidate's own profile / objective / "about me" / personal statement
  paragraph, copied VERBATIM and IN FULL. Do not shorten it, do not rewrite it, do not
  summarize the summary. If the CV has no such paragraph, return null.
- "major_achievements": a standalone achievements/accomplishments section — lines the CV
  presents as notable results in their own right, not as duties under a specific job. A bullet
  that sits under a job entry stays in that job's "bullets"; it does not move here.
- "education": EVERY educational entry the CV lists, not only the highest or most recent
  degree. Earlier schooling, diplomas, secondary/high school, preparatory years and foundation
  programmes all get their own entry when the CV mentions them.
- "training_courses": courses, workshops, training programmes and short professional
  development. DISTINCT from "certifications": a certification is a credential the candidate
  holds (name it in "certifications"); a course is something they attended.
- "participation": conferences, committees, symposia, programmes, events and memberships the
  candidate took part in. Saudi and academic CVs commonly split these into "local" and
  "international" — put that word in "scope" when the CV states it, and null otherwise.
  "role" is how they took part (attendee, speaker, organizer, committee member) if stated.
- "awards": awards, honours, prizes, medals, recognitions.
- "teaching_and_editorial": teaching or lecturing appointments, supervision/mentoring roles,
  and membership of editorial boards, review panels or scientific committees of journals.
- "publications": papers, articles, book chapters, books, abstracts, posters. Split into
  title/venue/year only when the split is obvious. If a citation doesn't split cleanly, put
  the ENTIRE citation line verbatim into "title" and leave the other fields null — never drop
  part of a citation to make it fit.

"additional_sections" — THE CATCH-ALL, use it freely:
- For any CV section that doesn't clearly match a named field. Examples of what belongs here:
  a surgeon's procedure/outcome counts, a pilot's flight hours, a researcher's grants or
  funding, patents, references, memberships, personal details (nationality, date of birth,
  marital status), hobbies, driving licence, military service, media appearances — anything.
- "section_title" must be the CV's OWN heading for that section, copied exactly as written
  (e.g. "Surgical Outcomes", "Flight Hours", "المشاركات المجتمعية"). Do not translate it, do
  not tidy it, do not replace it with a heading you think is better.
- "entries" must be the section's lines copied VERBATIM, one string per line/bullet, keeping
  the original structure as closely as reasonable. Strip only a leading bullet glyph (•, ➢, -,
  *, ●), exactly as with experience bullets. If a line is a label/value pair ("Nationality:
  Saudi"), keep it as one string with the label intact.
- NUMBERS IN THESE ENTRIES ARE FACTS AND MUST BE COPIED EXACTLY. "1,240 procedures", "4,800
  flight hours", "SAR 2.3M in funding" — never round them, never reformat them, never
  recalculate them, never convert units.

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
  "summary": "the candidate's own profile/objective paragraph, verbatim and complete, or null",
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
  "awards": ["list of awards, honours and prizes or empty list"],
  "major_achievements": ["standalone achievement lines, verbatim, or empty list"],
  "training_courses": [{{
    "name": "course/workshop/training programme name",
    "provider": "who ran it, or null",
    "date": "exactly as written, or null"
  }}],
  "participation": [{{
    "title": "conference/committee/programme/event name",
    "role": "attendee, speaker, organizer, member... only if stated, else null",
    "organization": "string or null",
    "scope": "\\"local\\" or \\"international\\" ONLY if the CV says so, else null",
    "date": "exactly as written, or null"
  }}],
  "publications": [{{
    "title": "paper title, or the ENTIRE citation verbatim if it does not split cleanly",
    "venue": "journal / conference / publisher, or null",
    "year": "string or null",
    "url": "string or null"
  }}],
  "teaching_and_editorial": ["teaching posts, supervision, editorial/review board memberships, or empty list"],
  "additional_sections": [{{
    "section_title": "the CV's OWN heading for a section that fits none of the fields above",
    "entries": ["that section's lines, verbatim, one string per line"]
  }}]
}}

IMPORTANT: 
- "languages" under skills = programming languages like Python, Java
- "languages_spoken" at the top level = human languages like Arabic, English, French
- Never confuse these two

CV TEXT:
{cv_text}

Return ONLY the JSON object. No explanation, no markdown, no extra text.
"""

def _tag(request_id: str = "") -> str:
    """This agent's log prefix, carrying the request id when there is one.

    Every line Agent 1 emits is otherwise identical between runs, so two
    requests in flight at once — or one CV resubmitted after a failure —
    produce two interleaved sets of indistinguishable lines. That made a
    real discrepancy impossible to diagnose: Agent 1 reported 16 experience
    entries and the usable-CV gate in main.py reported 15 a few lines
    later, with no way to tell from the log whether those were even the
    same run. The id is the same one that names this request's output files
    (see output_paths in main.py). Empty for direct callers like the tests,
    which run one at a time.
    """
    return f"[Agent 1][req {request_id}]" if request_id else "[Agent 1]"


def parse_cv(cv_path: str, max_retries: int = 3, request_id: str = "") -> FactsJSON:
    """
    Extracts facts from a CV PDF and returns a validated FactsJSON object.
    Retries up to max_retries times if Pydantic validation fails.
    Only personal.name is required — all other sections are optional.
    """
    return parse_cv_text(
        extract_text_from_pdf(cv_path), max_retries=max_retries, request_id=request_id
    )


def parse_cv_text(cv_text: str, max_retries: int = 3, request_id: str = "") -> FactsJSON:
    """Extract facts from raw CV text."""
    last_error = None
    tag = _tag(request_id)

    for attempt in range(1, max_retries + 1):
        print(f"{tag} Attempt {attempt}/{max_retries} ({len(cv_text)} chars of CV text)")

        try:
            raw_json = generate_gemini_json(CV_PARSER_PROMPT.format(cv_text=cv_text))
            data = json.loads(raw_json)
            facts = FactsJSON.model_validate(data)

            print(f"{tag} ✅ Extraction successful on attempt {attempt}")
            _print_summary(facts, tag)
            return facts

        except (json.JSONDecodeError, ValidationError) as e:
            last_error = e
            print(f"{tag} ❌ Attempt {attempt} failed: {e}")
            continue

    raise RuntimeError(
        f"{tag} CV parsing failed after {max_retries} attempts. "
        f"Last error: {last_error}"
    )


def run_cv_parser(state: dict) -> dict:
    """LangGraph node: parse raw_cv_text into facts_json."""
    try:
        cv_text = state["raw_cv_text"]
        additional_info = (state.get("additional_info") or "").strip()
        if additional_info:
            cv_text += "\n\nADDITIONAL INFORMATION FROM CANDIDATE:\n" + additional_info

        facts = parse_cv_text(cv_text, request_id=state.get("request_id", "") or "")
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

    summary = (form_data.get("summary") or "").strip()
    if summary:
        lines.append("\nPROFILE:")
        lines.append(summary)

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

    # ── The categories added with the FactsJSON expansion ─────────────────
    # Written under the same headings a real CV uses, because this text goes
    # straight back through parse_cv_text (the SAME Gemini extraction an
    # uploaded PDF gets). The headings are what route each block to the right
    # field, so they deliberately match the wording in CV_PARSER_PROMPT's
    # routing rules rather than the form's field names.
    def _joined(*parts) -> str:
        return ", ".join(str(p).strip() for p in parts if str(p or "").strip())

    achievements = form_data.get("major_achievements") or []
    if achievements:
        lines.append("\nMAJOR ACHIEVEMENTS:")
        for item in achievements:
            lines.append(f"- {item}")

    training_courses = form_data.get("training_courses") or []
    if training_courses:
        lines.append("\nTRAINING AND COURSES:")
        for course in training_courses:
            line = _joined(course.get("name"), course.get("provider"), course.get("date"))
            if line:
                lines.append(f"- {line}")

    participation = form_data.get("participation") or []
    if participation:
        lines.append("\nLOCAL AND INTERNATIONAL PARTICIPATION:")
        for item in participation:
            line = _joined(item.get("title"), item.get("role"),
                           item.get("organization"), item.get("scope"), item.get("date"))
            if line:
                lines.append(f"- {line}")

    publications = form_data.get("publications") or []
    if publications:
        lines.append("\nPUBLICATIONS:")
        for pub in publications:
            line = _joined(pub.get("title"), pub.get("venue"), pub.get("year"))
            if line:
                lines.append(f"- {line}")

    teaching = form_data.get("teaching_and_editorial") or []
    if teaching:
        lines.append("\nTEACHING AND EDITORIAL BOARD MEMBERSHIP:")
        for item in teaching:
            lines.append(f"- {item}")

    # The catch-all, under the heading the USER typed. Emitted last and
    # verbatim, so a section the form has no field for ("Surgical Outcomes",
    # "Flight Hours") reaches facts_json.additional_sections exactly as it
    # would from an uploaded CV.
    for section in form_data.get("additional_sections") or []:
        title = (section.get("section_title") or "").strip()
        entries = [str(e).strip() for e in (section.get("entries") or []) if str(e).strip()]
        if not entries:
            continue
        lines.append(f"\n{title.upper() if title else 'ADDITIONAL INFORMATION'}:")
        for entry in entries:
            lines.append(f"- {entry}")

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
        facts = parse_cv_text(serialized, request_id=state.get("request_id", "") or "")
        return {"facts_json": facts.model_dump(), "error": None}
    except Exception as e:
        return {"error": f"Manual CV parsing failed: {e}"}


def _print_summary(facts: FactsJSON, tag: str = "[Agent 1]"):
    # Every line carries the tag, not just the header — these lines are what
    # interleave with another concurrent run's, and a summary whose header
    # alone is identifiable is no easier to attribute than one without.
    print(f"{tag}   → Name: {facts.personal.name}")
    print(f"{tag}   → Education entries: {len(facts.education)}")
    print(f"{tag}   → Experience entries: {len(facts.experience)}")
    print(f"{tag}   → Projects: {len(facts.projects)}")
    print(f"{tag}   → Skills (languages): {facts.skills.languages}")
    print(f"{tag}   → Skills (frameworks): {facts.skills.frameworks}")
    print(f"{tag}   → Skills (tools): {facts.skills.tools}")
    print(f"{tag}   → Skills (soft): {facts.skills.soft_skills}")
    print(f"{tag}   → Skills (other): {facts.skills.other}")
    print(f"{tag}   → Certifications: {facts.certifications}")
    print(f"{tag}   → Languages spoken: {facts.languages_spoken}")
    print(f"{tag}   → Volunteer work: {len(facts.volunteer_work)} entries")
    print(f"{tag}   → Awards: {facts.awards}")
    print(f"{tag}   → Summary: {'yes' if (facts.summary or '').strip() else 'none'}")
    print(f"{tag}   → Major achievements: {len(facts.major_achievements)} entries")
    print(f"{tag}   → Training/courses: {len(facts.training_courses)} entries")
    print(f"{tag}   → Participation: {len(facts.participation)} entries")
    print(f"{tag}   → Publications: {len(facts.publications)} entries")
    print(f"{tag}   → Teaching/editorial: {len(facts.teaching_and_editorial)} entries")
    # The catch-all is worth naming individually, not just counting: its
    # headings are the only visible evidence of what the CV contained that no
    # named field covers, which is exactly what you want to see when someone
    # reports a missing section.
    for section in facts.additional_sections:
        print(f"{tag}   → Additional section '{section.section_title}': {len(section.entries)} entries")

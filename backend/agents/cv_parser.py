# agents/cv_parser.py
import json
import os
from pydantic import ValidationError
from google import genai
from google.genai import types
from schemas.facts_schema import FactsJSON
from utils.pdf_parser import extract_text_from_pdf

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

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
    "company": "string",
    "title": "string",
    "dates": "string or null",
    "bullets": ["exact bullet text or empty list"],
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
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=CV_PARSER_PROMPT.format(cv_text=cv_text),
                config=types.GenerateContentConfig(
                    response_mime_type="application/json"
                )
            )

            raw_json = response.text
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
        facts = parse_cv_text(state["raw_cv_text"])
        state["facts_json"] = facts.model_dump()
        state["error"] = None
    except Exception as e:
        state["error"] = f"Agent 1 failed: {e}"
    return state


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
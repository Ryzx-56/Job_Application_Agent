import json
import random
import time

from pydantic import ValidationError

from core.llm_config import generate_gemini_json
from schemas.jd_schema import WeightFactors
from core.state import AgentState

JD_ANALYSIS_PROMPT = """
You are an expert job description analyst.

Your task: extract structured data from the job description below.

RULES:
- Separate REQUIRED skills (explicitly stated as required/must-have) from PREFERRED skills (nice-to-have/bonus)
- ATS keywords HIGH = exact phrases an ATS system would scan for (copy phrasing from the JD)
- ATS keywords MEDIUM = related terms that appear in the JD but less critical
- Culture signals = tone words like "fast-paced", "ownership", "collaborative", "startup", "enterprise"
- Red flags = things like "10+ years required for a junior role", "unpaid", "equity only"
- Cover letter tone = a one-sentence instruction for how the cover letter should sound
- If company is not mentioned, use "Unknown"

JOB DESCRIPTION:
{job_description}

Respond ONLY in valid JSON matching this exact structure:
{{
  "job_title": "...",
  "company": "...",
  "seniority_level": "junior|mid|senior|lead",
  "required_skills": [...],
  "preferred_skills": [...],
  "years_experience_required": null or integer,
  "ats_keywords_high": [...],
  "ats_keywords_medium": [...],
  "culture_signals": [...],
  "education_requirement": "...",
  "red_flags": [...],
  "cover_letter_tone": "..."
}}
"""


def run_jd_analyzer(state: AgentState) -> dict:
    job_description = state["job_description"]
    max_retries = 3
    last_error = None

    # cv_parser fires its Gemini call in the same LangGraph step. A $0-balance
    # account enforces a burst limit on concurrent requests within the same
    # second — this small jitter desyncs the two calls to avoid tripping it.
    time.sleep(random.uniform(0.6, 1.4))

    for attempt in range(1, max_retries + 1):
        try:
            raw_text = generate_gemini_json(
                JD_ANALYSIS_PROMPT.format(job_description=job_description)
            )
            data = json.loads(raw_text)
            weight_factors = WeightFactors.model_validate(data)

            print(f"[Agent 2] JD analyzed successfully on attempt {attempt}")
            return {"weight_factors": weight_factors.model_dump(), "error": None}

        except (json.JSONDecodeError, ValidationError) as e:
            last_error = e
            print(f"[Agent 2] Attempt {attempt} failed validation: {e}")

        except Exception as e:
            last_error = e
            print(f"[Agent 2] Attempt {attempt} failed: {e}")
            if attempt < max_retries:
                time.sleep(3)  # short, burst-limit-appropriate pause before retrying

    return {"error": f"Agent 2 failed after {max_retries} attempts: {last_error}"}

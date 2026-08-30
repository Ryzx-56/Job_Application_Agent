"""
The "Create New CV" flow: someone typing their CV in by hand must be able to
reach every section an uploaded CV can, including sections we never named.

The payload below is the shape frontend/src/app/dashboard/page.tsx posts
(buildManualPayload). Keeping a copy here is the point: it fails at test time
if the two drift apart, instead of as a 422 the user sees after filling in a
long form.

serialize_manual_cv turns that payload back into CV-shaped text and feeds it
to the SAME Gemini extraction an uploaded PDF gets, so the headings it writes
are what route each block. Asserting on that text keeps this suite free and
deterministic; the one test that actually calls Agent 1 is marked
`extra_api_call` and excluded by default (see pytest.ini).
"""
import pytest

from agents.cv_parser import run_manual_cv_parser, serialize_manual_cv
from schemas.manual_cv_request import ManualCVRequest

PAYLOAD = {
    "personal": {"name": "Yousef Al-Harbi", "email": "yousef@example.com",
                 "phone": "+966 55-123-4567",
                 "linkedin": "https://www.linkedin.com/in/yousef-alharbi/",
                 "location": "Riyadh, Saudi Arabia"},
    "summary": "Consultant cardiothoracic surgeon with 11 years of operative experience.",
    "education": [{"institution": "King Saud University", "degree": "MBBS",
                   "gpa": "4.6", "graduation_year": "2011"}],
    "experience": [{"company": "King Faisal Specialist Hospital",
                    "title": "Consultant Surgeon", "dates": "2018 - Present",
                    "bullets": ["Led the adult cardiac surgery service"]}],
    "projects": [],
    "certifications": ["Saudi Board of Cardiothoracic Surgery"],
    "skills": {"other": ["Valve repair", "Clinical audit"]},
    "languages_spoken": ["Arabic (native)", "English (fluent)"],
    "major_achievements": ["Established the first minimally invasive valve programme"],
    "training_courses": [{"name": "Advanced Trauma Life Support",
                          "provider": "American College of Surgeons", "date": "2023"}],
    "participation": [{"title": "Saudi Heart Association Conference", "role": "Speaker",
                       "organization": "Saudi Heart Association", "scope": "local",
                       "date": "2024"}],
    "publications": [{"title": "Outcomes of Minimally Invasive Mitral Valve Repair",
                      "venue": "Saudi Medical Journal", "year": "2024"}],
    "teaching_and_editorial": ["Clinical lecturer, King Saud University, 2019-Present"],
    "awards": ["Ministry of Health Excellence Award, 2022"],
    # TWO free-form sections, each with a heading the user wrote themselves.
    "additional_sections": [
        {"section_title": "Surgical Outcomes",
         "entries": ["1,240 procedures performed as primary operator between 2019 and 2024.",
                     "0.8% 30-day complication rate across all cardiothoracic cases."]},
        {"section_title": "Flight Operations Record",
         "entries": ["4,800 total flight hours, of which 1,150 as pilot in command."]},
    ],
    "additional_info": "",
    "job_description": "Consultant Cardiothoracic Surgeon, Riyadh.",
    "cv_language": "en",
    "template_id": None,
    "allow_name_fallback": False,
}


@pytest.fixture(scope="module")
def request_model() -> ManualCVRequest:
    return ManualCVRequest.model_validate(PAYLOAD)


def test_the_api_accepts_what_the_form_posts(request_model):
    assert request_model.summary
    assert len(request_model.major_achievements) == 1
    assert len(request_model.training_courses) == 1
    assert len(request_model.participation) == 1
    assert len(request_model.publications) == 1
    assert len(request_model.teaching_and_editorial) == 1
    assert len(request_model.languages_spoken) == 2
    assert len(request_model.additional_sections) == 2


def test_serialized_text_uses_the_headings_the_extraction_prompt_routes_on(request_model):
    text = serialize_manual_cv(request_model.model_dump(), "")
    for heading in ("PROFILE:", "EDUCATION:", "EXPERIENCE:", "CERTIFICATIONS:",
                    "LANGUAGES SPOKEN:", "AWARDS:", "MAJOR ACHIEVEMENTS:",
                    "TRAINING AND COURSES:", "LOCAL AND INTERNATIONAL PARTICIPATION:",
                    "PUBLICATIONS:", "TEACHING AND EDITORIAL BOARD MEMBERSHIP:"):
        assert heading in text, f"{heading} missing from the serialized CV"


def test_every_free_form_section_survives_serialization(request_model):
    """The escape hatch: as many sections as the candidate wants, each under
    the heading they typed. Losing the second one would look like the form
    supporting exactly one custom section, which is what it must not be."""
    text = serialize_manual_cv(request_model.model_dump(), "")
    assert "SURGICAL OUTCOMES:" in text and "FLIGHT OPERATIONS RECORD:" in text
    for figure in ("1,240", "0.8%", "4,800", "1,150"):
        assert figure in text, f"{figure} was altered or dropped during serialization"


def test_an_empty_custom_section_is_skipped_rather_than_titled():
    """The form seeds one blank custom section, so an untouched form must not
    emit a heading with nothing under it."""
    payload = {**PAYLOAD, "additional_sections": [{"section_title": "", "entries": []}]}
    text = serialize_manual_cv(ManualCVRequest.model_validate(payload).model_dump(), "")
    assert "ADDITIONAL INFORMATION:" not in text


@pytest.mark.extra_api_call
def test_manual_entry_reaches_facts_json_through_the_real_extraction(request_model):
    result = run_manual_cv_parser(
        {"manual_cv_data": request_model.model_dump(), "additional_info": "",
         "request_id": "manual-test"})
    assert not result.get("error"), result.get("error")
    facts = result["facts_json"]

    assert facts["summary"] and facts["major_achievements"] and facts["training_courses"]
    assert facts["publications"] and facts["teaching_and_editorial"]
    assert facts["languages_spoken"]

    headings = [s["section_title"].lower() for s in facts["additional_sections"]]
    assert any("surgic" in h for h in headings), headings
    assert any("flight" in h for h in headings), headings
    body = " ".join(e for s in facts["additional_sections"] for e in s["entries"])
    assert "1,240" in body and "4,800" in body

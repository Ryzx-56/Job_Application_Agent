# tests/test_document_generator.py
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from agents.document_generator import run_document_generator
from utils.pdf_generator import render_cv_pdf, render_cover_letter_pdf
from utils.docx_generator import generate_cv_docx

# ── MOCK STATE ────────────────────────────────────────────────────────────────

MOCK_STATE = {
    "facts_json": {
        "personal": {
            "name": "Abdulmalik Hawsawi",
            "email": "abdulmalik@example.com",
            "phone": "+966 5X XXX XXXX",
            "linkedin": "in/abdulmalik-hawsawi",
            "github": "Ryzx-56",
            "location": "Jeddah, Saudi Arabia"
        },
        "education": [{
            "institution": "University of Jeddah",
            "degree": "B.Sc. Artificial Intelligence",
            "gpa": "4.23",
            "graduation_year": "2026",
            "distinctions": ["Excellence Certificate 2022-2023"]
        }],
        "experience": [{
            "company": "TeamLab Borderless",
            "title": "Sales & Customer Service Associate",
            "dates": "2023 - 2024",
            "bullets": [
                "Assisted international visitors with product selection and experience navigation",
                "Handled high-volume customer inquiries in a fast-paced environment"
            ],
            "metrics": []
        }],
        "skills": {
            "languages": ["Python", "Java", "SQL"],
            "frameworks": ["LangGraph", "TensorFlow", "Flask", "Pydantic"],
            "tools": ["Git", "Docker", "Jupyter", "PyMuPDF"],
            "soft_skills": [],
            "other": []
        },
        "projects": [
            {
                "name": "Job Application Agent (JBAA)",
                "tech_stack": ["Python", "LangGraph", "Gemini API", "Claude API", "FastAPI"],
                "description": "Multi-agent LangGraph pipeline that tailors CVs and generates cover letters autonomously",
                "metrics": [],
                "url": "github.com/Ryzx-56"
            },
            {
                "name": "Flight Route Demand Prediction",
                "tech_stack": ["Python", "XGBoost", "GRU", "LSTM"],
                "description": "ML pipeline comparing GMM, GRU, XGBoost, DQN on 880K rows of airline data",
                "metrics": [],
                "url": "github.com/Ryzx-56/Flight_Route_Demand_Prediction"
            }
        ],
        "certifications": [],
        "languages_spoken": ["Arabic", "English"],
        "volunteer_work": [],
        "awards": []
    },

    "weight_factors": {
        "job_title": "AI Engineer Intern",
        "company": "Lockheed Martin",
        "seniority_level": "intern",
        "required_skills": ["Python", "Machine Learning", "LangGraph"],
        "preferred_skills": ["Docker", "FastAPI"],
        "years_experience_required": 0,
        "ats_keywords_high": ["machine learning", "AI pipeline", "Python", "LangGraph"],
        "ats_keywords_medium": ["NLP", "deep learning", "model deployment"],
        "culture_signals": ["fast-paced", "ownership", "collaborative"],
        "education_requirement": "B.Sc. Computer Science or related",
        "red_flags": [],
        "cover_letter_tone": "confident and direct"
    },

    "tailored_bullets": [
        {"section": "experience", "text": "Delivered fast-paced customer solutions for 500+ daily visitors in a high-ownership environment at TeamLab Borderless"},
        {"section": "experience", "text": "Collaborated cross-functionally to resolve product and service issues under tight time constraints"},
        {"section": "project",    "text": "Built a production-grade multi-agent LangGraph pipeline (JBAA) orchestrating Gemini and Claude APIs across 6 specialized agents with automated hallucination detection"},
        {"section": "project",    "text": "Engineered an ML pipeline comparing GRU, XGBoost, DQN, and hybrid LSTM models on 880K rows of international airline route data"},
    ],

    "tailored_summary": (
        "AI engineering student with hands-on experience building production-grade multi-agent "
        "LangGraph pipelines and ML systems. Proven ability to deliver real AI products under "
        "fast-paced conditions. Seeking to bring autonomous AI pipeline expertise to Lockheed Martin's "
        "engineering team."
    ),

    "cover_letter_text": "",
    "cv_pdf_path": "",
    "cover_letter_pdf_path": "",
}


# ── TESTS ─────────────────────────────────────────────────────────────────────

def test_cover_letter_generation():
    print("\n🧪 Test 1: Cover Letter Generation (Gemini Flash)")
    result = run_document_generator(MOCK_STATE)
    text   = result["cover_letter_text"]

    assert len(text) > 100,                   "Cover letter too short"
    assert "Lockheed Martin" in text,          "Company name missing"
    assert "passion for" not in text.lower(),  "Hard rule violated: 'passion for'"
    assert not text.lower().startswith("i am writing to express"), "Hard rule violated: banned opener"

    print("✅ Passed")
    print(f"\n--- COVER LETTER PREVIEW ---\n{text[:500]}...\n")
    return text


def test_cv_pdf(cover_letter_text):
    print("🧪 Test 2: CV PDF Generation (WeasyPrint)")
    state = {**MOCK_STATE, "cover_letter_text": cover_letter_text}
    path  = render_cv_pdf(state)

    assert os.path.exists(path),      f"PDF not found at {path}"
    assert os.path.getsize(path) > 0, "PDF is empty"

    print(f"✅ Passed — saved to {path} ({os.path.getsize(path):,} bytes)")
    return state


def test_cover_letter_pdf(state):
    print("🧪 Test 3: Cover Letter PDF Generation (WeasyPrint)")
    path = render_cover_letter_pdf(state)

    assert os.path.exists(path),      f"PDF not found at {path}"
    assert os.path.getsize(path) > 0, "PDF is empty"

    print(f"✅ Passed — saved to {path} ({os.path.getsize(path):,} bytes)")


def test_cv_docx(state):
    print("🧪 Test 4: CV DOCX Generation (python-docx)")
    path = generate_cv_docx(state)

    assert os.path.exists(path),      f"DOCX not found at {path}"
    assert os.path.getsize(path) > 0, "DOCX is empty"

    print(f"✅ Passed — saved to {path} ({os.path.getsize(path):,} bytes)")


# ── RUN ALL ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 55)
    print("  Day 15-16 Test — Document Generator Pipeline")
    print("=" * 55)

    cover_letter_text = test_cover_letter_generation()
    state             = test_cv_pdf(cover_letter_text)
    test_cover_letter_pdf(state)
    test_cv_docx(state)

    print("\n" + "=" * 55)
    print("  All tests passed ✅")
    print(f"  Check outputs/ folder for your generated files")
    print("=" * 55)
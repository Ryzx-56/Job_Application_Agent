import json

from dotenv import load_dotenv

load_dotenv()

from utils.pdf_parser import extract_text_from_pdf
from core.state import AgentState
from core.orchestrator import build_graph

CV_PATH = "tests/sample_data/Abdulmalik_Hawsawi_CV.pdf"

SAMPLE_JD = """
Job Description
Bank Syariah Indonesia (BSI), Indonesia’s largest Islamic bank, is deeply committed to delivering impactful financial solutions grounded in Islamic ethical principles—prioritizing fairness, transparency, and mutually beneficial partnerships while strictly avoiding riba (interest), gharar (uncertainty), and maysir (gambling). As we continue to expand our global footprint, we are seeking an exceptional and highly ethical professional to join our international team at the BSI Overseas Branch in the Kingdom of Saudi Arabia (KSA).



About the Role

In this critical position, you will do planning, developing, and operate IT Security at BSI Overseas Branch - KSA in accordance with the operational of bank business and providing services for customer, as well as complying with regulations. 



Key Responsibilities

Developing and implementing a comprehensive cyber security strategy to protect IT infrastructure, networks, and data. 
Conducting security assessment, hardening, and patch management on systems, networks, infrastructure, and endpoint devices. 
Performing comprehensive monitoring and controlling of IT security through the collection and analysis of supporting data. 
Overseeing the monitoring of systems for security breaches, investigating incidents, and implementing security measures to prevent future breaches. 
Implementing partnerships with various parties for IT Security and evaluating these collaboration processes to ensure effective and efficient operation. 
Coordinating with the central office's IT Security unit.
Skills
Qualifications & Requirements

• Nationality: Saudi Arabian citizen (Required).

• Education: Bachelor’s degree minimum.

• Experience: Experienced in a similar industry and has held an equivalent level position, having handled responsibilities for at least 7 years.

• Subject Matter Expertise: Deeply well-versed in IT Security, Risk Management.

• Leadership Skills: Demonstrated track record of successfully leading teams, developing strategic work plans, and executing operational goals.

• Interpersonal Abilities: Exceptional communication, negotiation, and relationship-building skills to manage diverse stakeholders effectively.

• Executive Presence: Highly capable of delivering engaging and persuasive professional presentations.

• Language: English, (Preferable if can speak Indonesian).
"""


def make_initial_state(cv_text: str, jd_text: str) -> AgentState:
    return AgentState(
        raw_cv_text=cv_text,
        job_description=jd_text,
        facts_json={},
        weight_factors={},
        tailored_bullets=[],
        tailored_summary="",
        hallucination_flags=[],
        fact_check_passed=False,
        cover_letter_text="",
        cv_pdf_path="",
        cover_letter_pdf_path="",
        ats_score=0,
        score_breakdown={},
        gap_analysis=[],
        similar_jobs=[],
        error=None,
        current_step="start",
    )


if __name__ == "__main__":
    state = make_initial_state(
        extract_text_from_pdf(CV_PATH),
        SAMPLE_JD,
    )
    result = build_graph().invoke(state)

    print("\n=== FACTS JSON ===")
    print(json.dumps(result["facts_json"], indent=2))
    print("\n=== WEIGHT FACTORS ===")
    print(json.dumps(result["weight_factors"], indent=2))
    print("\n=== PROFESSIONAL SUMMARY ===")
    print(result["tailored_summary"])
    print("\n=== TAILORED BULLETS ===")
    for i, bullet in enumerate(result["tailored_bullets"]):
        print(f"\n[{i + 1}] Score: {bullet.get('relevance_score', 'n/a')}")
        print(f"  ORIGINAL : {bullet.get('original', bullet.get('text', ''))}")
        print(f"  TAILORED : {bullet.get('tailored', bullet.get('text', ''))}")
    print("\n=== FACT CHECK ===")
    print(f"Passed: {result['fact_check_passed']}")
    if result["hallucination_flags"]:
        print(json.dumps(result["hallucination_flags"], indent=2))
    print("\n=== ERRORS ===")
    print(result["error"])

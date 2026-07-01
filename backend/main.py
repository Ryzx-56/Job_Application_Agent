import os
import json
import uvicorn
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from loguru import logger

# Initialize environment variables from .env immediately
from dotenv import load_dotenv, find_dotenv
load_dotenv(find_dotenv(), override=True)


# Import pipeline structures
from core.state import AgentState
from core.orchestrator import app as graph
from utils.pdf_parser import extract_text_from_pdf
from utils.pdf_generator import render_cv_pdf, render_cover_letter_pdf

# 1. Initialize FastAPI Application Instance
app = FastAPI(
    title="Job Application Multi-Agent Pipeline API",
    description="Production-grade backend orchestration engine for automated application tailoring.",
    version="1.0.0"
)

# 2. Configure Cross-Origin Resource Sharing (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SHORT_SAMPLE_JD = """
Position: Machine Learning Engineer (AI Systems)
Location: Jeddah, Saudi Arabia

Key Responsibilities:
- Design, build, and optimize scalable Machine Learning and Deep Learning models.
- Implement structured pipelines using NLP techniques, clustering (GMM), and sequence modeling (LSTM/GRU).
- Extract and process insights from raw unstructured text data or structured JSON frames.
- Collaborate with software development teams to integrate predictive endpoints into production APIs.
"""

def make_initial_state(cv_text: str, jd_text: str) -> AgentState:
    """Instantiates a structured state map adhering strictly to the AgentState definition."""
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

@app.get("/health", status_code=status.HTTP_200_OK, tags=["System Health"])
async def health_check():
    return {"status": "healthy", "environment": os.getenv("ENVIRONMENT", "development")}

@app.post("/api/v1/optimize", tags=["Agent Core"])
async def optimize_application(cv_text: str = None, job_description: str = None):
    logger.info("🚀 API Gateway received an application optimization request.")
    
    final_cv_text = cv_text or extract_text_from_pdf("tests/sample_data/Abdulmalik_Hawsawi_CV.pdf")
    final_jd_text = job_description or SHORT_SAMPLE_JD

    initial_state = make_initial_state(final_cv_text, final_jd_text)
    
    try:
        # Pipeline execution: graph.invoke is the standard LangGraph method
        logger.info("🧠 Commencing agent graph routing lifecycle...")
        result = graph.invoke(initial_state)
        logger.info("✅ Multi-agent execution phase completed.")
        
        cv_pdf_path = render_cv_pdf(result)
        cl_pdf_path = render_cover_letter_pdf(result)
        
        return {
            "success": True,
            "match_score": result.get("ats_score", 0),
            "tailored_summary": result.get("tailored_summary", ""),
            "tailored_bullets": result.get("tailored_bullets", []),
            "cover_letter_text": result.get("cover_letter_text", ""),
            "similar_jobs": result.get("similar_jobs", []),
            "fact_check_passed": result.get("fact_check_passed", False),
            "generated_cv_pdf": cv_pdf_path,
            "generated_cl_pdf": cl_pdf_path,
            "error": result.get("error", None)
        }
        
    except Exception as err:
        logger.error(f"❌ Pipeline Failure: {err}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An execution failure hit a core agent module: {str(err)}"
        )

if __name__ == "__main__":
    logger.info("🔥 Starting local development API server via Uvicorn...")
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
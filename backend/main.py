import os
import json
import uvicorn
from fastapi import FastAPI, HTTPException, status, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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
from schemas.manual_cv_request import ManualCVRequest

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

# Must stay in sync with utils/pdf_generator.py — both generator functions
# always write to these exact paths (OUTPUT_DIR="outputs", fixed filenames).
RESUME_PDF_PATH = os.path.join("outputs", "tailored_cv.pdf")
COVER_LETTER_PDF_PATH = os.path.join("outputs", "cover_letter.pdf")

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
        input_mode="upload",
        manual_cv_data={},
        additional_info="",
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
        job_match_score=0,
        job_match_reason="",
        similar_jobs=[],
        tailoring_attempts=0,
        error=None,
        current_step="start",
    )

@app.get("/health", status_code=status.HTTP_200_OK, tags=["System Health"])
async def health_check():
    return {"status": "healthy", "environment": os.getenv("ENVIRONMENT", "development")}

@app.get("/api/v1/download/cv", tags=["Downloads"])
async def download_cv():
    """Serves the most recently generated tailored CV as a downloadable file."""
    if not os.path.exists(RESUME_PDF_PATH):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No generated CV found yet. Run /api/v1/optimize first.",
        )
    return FileResponse(
        RESUME_PDF_PATH,
        media_type="application/pdf",
        filename="tailored_cv.pdf",
        headers={"Content-Disposition": "attachment; filename=tailored_cv.pdf"},
    )


@app.get("/api/v1/download/cover-letter", tags=["Downloads"])
async def download_cover_letter():
    """Serves the most recently generated cover letter as a downloadable file."""
    if not os.path.exists(COVER_LETTER_PDF_PATH):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No generated cover letter found yet. Run /api/v1/optimize first.",
        )
    return FileResponse(
        COVER_LETTER_PDF_PATH,
        media_type="application/pdf",
        filename="cover_letter.pdf",
        headers={"Content-Disposition": "attachment; filename=cover_letter.pdf"},
    )


@app.get("/api/v1/preview/cv", tags=["Downloads"])
async def preview_cv():
    """Serves the tailored CV inline so the browser opens/renders it instead of downloading it."""
    if not os.path.exists(RESUME_PDF_PATH):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No generated CV found yet. Run /api/v1/optimize first.",
        )
    return FileResponse(
        RESUME_PDF_PATH,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=tailored_cv.pdf"},
    )


@app.get("/api/v1/preview/cover-letter", tags=["Downloads"])
async def preview_cover_letter():
    """Serves the cover letter inline so the browser opens/renders it instead of downloading it."""
    if not os.path.exists(COVER_LETTER_PDF_PATH):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No generated cover letter found yet. Run /api/v1/optimize first.",
        )
    return FileResponse(
        COVER_LETTER_PDF_PATH,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=cover_letter.pdf"},
    )


@app.post("/api/v1/optimize", tags=["Agent Core"])
async def optimize_application(
    cv: UploadFile = File(...),
    job_description: str = Form(...),
    additional_info: str = Form(""),
):
    logger.info("🚀 API Gateway received an application optimization request.")

    cv_bytes = await cv.read()
    final_cv_text = extract_text_from_pdf(pdf_bytes=cv_bytes)
    final_jd_text = job_description or SHORT_SAMPLE_JD

    initial_state = make_initial_state(final_cv_text, final_jd_text)
    initial_state["input_mode"] = "upload"
    initial_state["additional_info"] = additional_info or ""
    
    try:
        # Pipeline execution: graph.invoke is the standard LangGraph method
        logger.info("🧠 Commencing agent graph routing lifecycle...")
        result = graph.invoke(initial_state)
        logger.info("✅ Multi-agent execution phase completed.")
        
        cv_pdf_path = render_cv_pdf(result)
        cl_pdf_path = render_cover_letter_pdf(result)
        
        return {
            "success": True,
            "ats_score": result.get("ats_score", 0),
            "ats_breakdown": result.get("score_breakdown", {}),
            "job_match_score": result.get("job_match_score", 0),
            "job_match_reason": result.get("job_match_reason", ""),
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


@app.post("/api/v1/optimize-manual", tags=["Agent Core"])
async def optimize_manual_application(payload: ManualCVRequest):
    """
    Same pipeline as /api/v1/optimize, but for the 'Create New CV' flow —
    structured form data instead of an uploaded PDF. Both routes converge
    on the same LangGraph, just entering through a different parser node
    (see core/orchestrator.py's route_cv_input).
    """
    logger.info("🚀 API Gateway received a MANUAL CV optimization request.")

    manual_data = payload.model_dump(exclude={"job_description", "additional_info"})
    final_jd_text = payload.job_description or SHORT_SAMPLE_JD

    initial_state = make_initial_state("", final_jd_text)
    initial_state["input_mode"] = "manual"
    initial_state["manual_cv_data"] = manual_data
    initial_state["additional_info"] = payload.additional_info or ""

    try:
        logger.info("🧠 Commencing agent graph routing lifecycle (manual entry)...")
        result = graph.invoke(initial_state)
        logger.info("✅ Multi-agent execution phase completed.")

        cv_pdf_path = render_cv_pdf(result)
        cl_pdf_path = render_cover_letter_pdf(result)

        return {
            "success": True,
            "ats_score": result.get("ats_score", 0),
            "ats_breakdown": result.get("score_breakdown", {}),
            "job_match_score": result.get("job_match_score", 0),
            "job_match_reason": result.get("job_match_reason", ""),
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
        logger.error(f"❌ Pipeline Failure (manual): {err}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An execution failure hit a core agent module: {str(err)}"
        )


if __name__ == "__main__":
    logger.info("🔥 Starting local development API server via Uvicorn...")
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)

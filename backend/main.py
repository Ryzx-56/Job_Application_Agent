import os
import json
import uvicorn
from fastapi import FastAPI, HTTPException, status, UploadFile, File, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from dotenv import load_dotenv
from loguru import logger

# Initialize environment variables from .env immediately
from dotenv import load_dotenv, find_dotenv
load_dotenv(find_dotenv(), override=True)


# Import pipeline structures
from core.state import AgentState
from core.orchestrator import app as graph
from core.auth import get_current_user_id, get_current_user_id_query_or_header
from core.credits import reserve_credits, refund_credits, get_credits, normalize_cv_language
from core.subscription import cancel_subscription, resume_subscription
from utils.pdf_parser import extract_text_from_pdf
from utils.pdf_generator import render_cv_pdf, render_cover_letter_pdf
from utils.docx_generator import generate_cv_docx
from utils.template_registry import DEFAULT_TEMPLATE_ID
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

# Must stay in sync with utils/pdf_generator.py / utils/docx_generator.py —
# all three generator functions always write to these exact paths
# (OUTPUT_DIR="outputs", fixed filenames).
RESUME_PDF_PATH = os.path.join("outputs", "tailored_cv.pdf")
RESUME_DOCX_PATH = os.path.join("outputs", "tailored_cv.docx")
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

def make_initial_state(cv_text: str, jd_text: str, template_id: str = DEFAULT_TEMPLATE_ID) -> AgentState:
    """Instantiates a structured state map adhering strictly to the AgentState definition."""
    return AgentState(
        raw_cv_text=cv_text,
        job_description=jd_text,
        input_mode="upload",
        manual_cv_data={},
        additional_info="",
        cv_language="en",
        template_id=template_id or DEFAULT_TEMPLATE_ID,
        facts_json={},
        weight_factors={},
        tailored_bullets=[],
        tailored_summary="",
        tailored_projects=[],
        tailored_volunteer_work=[],
        tailored_skills={},
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
        overall_recommendation="",
        similar_jobs=[],
        tailoring_attempts=0,
        error=None,
        current_step="start",
    )


def _pipeline_produced_usable_cv(result_state: dict) -> bool:
    """
    True signal that Agent 1 (cv_parser / manual_cv_parser) actually
    extracted real data, rather than the pipeline running end-to-end on an
    empty facts_json after a silent upstream failure (e.g. Gemini rate
    limit exhausted all retries). personal.name is the one field Agent 1
    is required to populate — checking it is a general, non-hardcoded
    signal that works no matter *why* Agent 1 failed.
    """
    facts = result_state.get("facts_json") or {}
    personal = facts.get("personal") or {}
    return bool((personal.get("name") or "").strip())


def _weight_factors_usable(result_state: dict) -> bool:
    """
    Same idea as _pipeline_produced_usable_cv, but for Agent 2
    (jd_analyzer). job_title is the one field that's always meaningful
    when the JD was genuinely parsed — required_skills / ats_keywords
    being empty can legitimately happen on a very thin real JD, so
    job_title is the safer signal that Agent 2 actually ran, rather than
    silently shipping a CV that was never tailored to the job at all.
    Without this check, a failed Agent 2 could even show a *misleadingly
    high* ATS score, since ats_scorer.py's keyword-match rate defaults to
    a perfect 1.0 when there are zero keywords to check against.
    """
    weight_factors = result_state.get("weight_factors") or {}
    job_title = (weight_factors.get("job_title") or "").strip()
    return bool(job_title)


def _pipeline_ready(result_state: dict) -> tuple[bool, str]:
    """
    True only if BOTH Agent 1 and Agent 2 actually produced usable data.
    Returns (ready, user_facing_error_message) so callers can raise/emit
    a specific, honest message instead of a generic failure.
    """
    if not _pipeline_produced_usable_cv(result_state):
        return False, "We couldn't read your CV — please try again in a moment."
    if not _weight_factors_usable(result_state):
        return False, "We couldn't analyze the job description — please try again in a moment."
    return True, ""


# ─── LIVE PROGRESS STREAMING (dashboard "Agent N" UI) ─────────────────────
#
# Maps LangGraph node names -> a stable "Agent N" number the frontend shows.
# This is deliberately NOT 1:1 with orchestrator.py's node names in either
# count or order of execution:
#   - cv_parser / manual_cv_parser collapse to the same Agent 1 (only one of
#     the two ever runs per request, depending on input_mode).
#   - tailoring_engine can loop back on itself via fact_checker (see
#     route_after_fact_check in orchestrator.py) — repeated completions of
#     the same node are ignored here so the frontend only ever sees it go
#     from running -> done once, not flicker on retries.
#   - ats_scorer / document_generator / jobs_finder run in TRUE parallel
#     (LangGraph fan-out), so they can complete in any order. Each is still
#     reported under its own fixed Agent number the moment IT finishes,
#     regardless of the order events actually arrive in.
# The label strings are intentionally generic ("Reading your CV") — no
# model names, no internal node names — that's the whole point of this
# endpoint vs. what you see in the local dev logs.
_STEP_NODE_TO_AGENT = {
    "cv_parser": (1, "cvParse"),
    "manual_cv_parser": (1, "cvParse"),
    "jd_analyzer": (2, "jdAnalyze"),
    "tailoring_engine": (3, "tailor"),
    "fact_checker": (4, "factCheck"),
    "ats_scorer": (5, "atsScore"),
    "document_generator": (6, "coverLetter"),
    "match_scorer": (7, "matchScore"),
    "jobs_finder": (8, "similarJobs"),
}


def _sse(event: str, data: dict) -> str:
    """Formats one Server-Sent Event frame."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _stream_pipeline(initial_state: AgentState, user_id: str, reserved_amount: int):
    """
    Shared generator for both streaming endpoints below. Runs the exact same
    LangGraph as the blocking /optimize routes, just via .stream() instead
    of .invoke() so we can emit a `step` event after each node completes.
    Ends with one `complete` event carrying the identical payload shape
    /optimize already returns (or an `error` event on failure), so the
    frontend can reuse its existing result-rendering code either way.
    """
    seen_agents = set()
    result_state = dict(initial_state)

    try:
        for update in graph.stream(initial_state, stream_mode="updates"):
            for node_name, partial in update.items():
                if partial:
                    result_state.update(partial)

                step = _STEP_NODE_TO_AGENT.get(node_name)
                if not step:
                    continue
                agent_num, step_key = step
                if agent_num in seen_agents:
                    continue
                seen_agents.add(agent_num)
                yield _sse("step", {"agent": agent_num, "step": step_key})

        logger.info("✅ Multi-agent execution phase completed (stream).")

        # Don't render/return a fake success if Agent 1 never actually
        # extracted usable data (e.g. Gemini rate-limited out after all
        # retries) — see _pipeline_produced_usable_cv for why this check
        # is the reliable signal rather than just checking state["error"].
        ready, error_detail = _pipeline_ready(result_state)
        if not ready:
            logger.error(f"❌ Pipeline did not produce usable output (stream): {error_detail} | state error: {result_state.get('error')}")
            refund_credits(user_id, reserved_amount)
            yield _sse("error", {"detail": error_detail})
            return

        cv_pdf_path = render_cv_pdf(result_state, template_id=result_state.get("template_id"))
        cv_docx_path = generate_cv_docx(result_state, template_id=result_state.get("template_id"))
        cl_pdf_path = render_cover_letter_pdf(result_state)

        payload = {
            "success": True,
            "ats_score": result_state.get("ats_score", 0),
            "ats_breakdown": result_state.get("score_breakdown", {}),
            "job_match_score": result_state.get("job_match_score", 0),
            "job_match_reason": result_state.get("job_match_reason", ""),
            "gap_analysis": result_state.get("gap_analysis", []),
            "overall_recommendation": result_state.get("overall_recommendation", ""),
            "tailored_summary": result_state.get("tailored_summary", ""),
            "tailored_bullets": result_state.get("tailored_bullets", []),
            "cover_letter_text": result_state.get("cover_letter_text", ""),
            "similar_jobs": result_state.get("similar_jobs", []),
            "fact_check_passed": result_state.get("fact_check_passed", False),
            "job_title": result_state.get("weight_factors", {}).get("job_title", ""),
            "company": result_state.get("weight_factors", {}).get("company", ""),
            "cv_language": result_state.get("cv_language", "en"),
            "generated_cv_pdf": cv_pdf_path,
            "generated_cv_docx": cv_docx_path,
            "generated_cl_pdf": cl_pdf_path,
            "error": result_state.get("error", None),
            "credits_charged": reserved_amount,
        }
        yield _sse("complete", payload)

    except Exception as err:
        logger.error(f"❌ Pipeline Failure (stream): {err}")
        refund_credits(user_id, reserved_amount)
        yield _sse("error", {"detail": f"An execution failure hit a core agent module: {str(err)}"})


@app.get("/health", status_code=status.HTTP_200_OK, tags=["System Health"])
async def health_check():
    return {"status": "healthy", "environment": os.getenv("ENVIRONMENT", "development")}

@app.get("/api/v1/download/cv", tags=["Downloads"])
async def download_cv(user_id: str = Depends(get_current_user_id_query_or_header)):
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


@app.get("/api/v1/download/cv-docx", tags=["Downloads"])
async def download_cv_docx(user_id: str = Depends(get_current_user_id_query_or_header)):
    """
    Serves the most recently generated tailored CV as a downloadable Word
    file. Same ?token= auth pattern as download_cv above — see BUG #14 FIX
    note in page.tsx for why this is a plain <a href download> target
    rather than a JS fetch+blob download.
    """
    if not os.path.exists(RESUME_DOCX_PATH):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No generated CV found yet. Run /api/v1/optimize first.",
        )
    return FileResponse(
        RESUME_DOCX_PATH,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename="tailored_cv.docx",
        headers={"Content-Disposition": "attachment; filename=tailored_cv.docx"},
    )


@app.get("/api/v1/download/cover-letter", tags=["Downloads"])
async def download_cover_letter(user_id: str = Depends(get_current_user_id_query_or_header)):
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
async def preview_cv(user_id: str = Depends(get_current_user_id)):
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
async def preview_cover_letter(user_id: str = Depends(get_current_user_id)):
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


@app.get("/api/v1/credits", tags=["Credits"])
async def get_credits_balance(user_id: str = Depends(get_current_user_id)):
    """Current tier + credit balance for the logged-in user. Read-only —
    all writes happen server-side inside reserve_credits()/refund_credits()."""
    return get_credits(user_id)

@app.get("/")
async def root():
    return {"message": "Job Application Agent API is running", "docs": "/docs"}

@app.post("/api/v1/subscription/cancel", tags=["Credits"])
async def cancel_subscription_endpoint(user_id: str = Depends(get_current_user_id)):
    """
    Schedules a downgrade to Free at the end of the current cycle. Does NOT
    touch tier or credits immediately — see core/subscription.py.
    """
    return cancel_subscription(user_id)


@app.post("/api/v1/subscription/resume", tags=["Credits"])
async def resume_subscription_endpoint(user_id: str = Depends(get_current_user_id)):
    """Undoes a scheduled cancellation/downgrade."""
    return resume_subscription(user_id)


@app.post("/api/v1/optimize", tags=["Agent Core"])
async def optimize_application(
    cv: UploadFile = File(...),
    job_description: str = Form(...),
    additional_info: str = Form(""),
    cv_language: str = Form("en"),
    template_id: str = Form(DEFAULT_TEMPLATE_ID),
    user_id: str = Depends(get_current_user_id),
):
    logger.info("🚀 API Gateway received an application optimization request.")

    cv_bytes = await cv.read()
    final_cv_text = extract_text_from_pdf(pdf_bytes=cv_bytes)
    final_jd_text = job_description or SHORT_SAMPLE_JD

    initial_state = make_initial_state(final_cv_text, final_jd_text, template_id=template_id)
    initial_state["input_mode"] = "upload"
    initial_state["additional_info"] = additional_info or ""
    initial_state["cv_language"] = normalize_cv_language(cv_language)

    # Reserve credits BEFORE running the (expensive) pipeline. Atomic against
    # concurrent requests — see reserve_credits() in core/credits.py.
    # Raises 402 automatically if the user doesn't have enough.
    reserved_amount = reserve_credits(user_id, initial_state["cv_language"])

    try:
        # Pipeline execution: graph.invoke is the standard LangGraph method
        logger.info("🧠 Commencing agent graph routing lifecycle...")
        result = graph.invoke(initial_state)
        logger.info("✅ Multi-agent execution phase completed.")

        # Don't return a fake "success" if Agent 1 never actually extracted
        # usable data — see _pipeline_produced_usable_cv for why this is the
        # reliable check rather than just looking at state["error"].
        ready, error_detail = _pipeline_ready(result)
        if not ready:
            logger.error(f"❌ Pipeline did not produce usable output: {error_detail} | state error: {result.get('error')}")
            refund_credits(user_id, reserved_amount)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=error_detail,
            )

        cv_pdf_path = render_cv_pdf(result, template_id=result.get("template_id"))
        cv_docx_path = generate_cv_docx(result, template_id=result.get("template_id"))
        cl_pdf_path = render_cover_letter_pdf(result)
        
        return {
            "success": True,
            "ats_score": result.get("ats_score", 0),
            "ats_breakdown": result.get("score_breakdown", {}),
            "job_match_score": result.get("job_match_score", 0),
            "job_match_reason": result.get("job_match_reason", ""),
            "gap_analysis": result.get("gap_analysis", []),
            "overall_recommendation": result.get("overall_recommendation", ""),
            "tailored_summary": result.get("tailored_summary", ""),
            "tailored_bullets": result.get("tailored_bullets", []),
            "cover_letter_text": result.get("cover_letter_text", ""),
            "similar_jobs": result.get("similar_jobs", []),
            "fact_check_passed": result.get("fact_check_passed", False),
            "job_title": result.get("weight_factors", {}).get("job_title", ""),
            "company": result.get("weight_factors", {}).get("company", ""),
            "cv_language": result.get("cv_language", "en"),
            "generated_cv_pdf": cv_pdf_path,
            "generated_cv_docx": cv_docx_path,
            "generated_cl_pdf": cl_pdf_path,
            "error": result.get("error", None),
            "credits_charged": reserved_amount,
        }

    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"❌ Pipeline Failure: {err}")
        refund_credits(user_id, reserved_amount)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An execution failure hit a core agent module: {str(err)}"
        )


@app.post("/api/v1/optimize/stream", tags=["Agent Core"])
async def optimize_application_stream(
    cv: UploadFile = File(...),
    job_description: str = Form(...),
    additional_info: str = Form(""),
    cv_language: str = Form("en"),
    template_id: str = Form(DEFAULT_TEMPLATE_ID),
    user_id: str = Depends(get_current_user_id),
):
    """
    Same pipeline as /api/v1/optimize, but streams progress over
    Server-Sent Events instead of blocking until everything is done.
    Powers the dashboard's live "Agent N" progress UI. Emits a `step` event
    each time a pipeline stage completes, then one final `complete` event
    with the exact same payload /optimize returns (or an `error` event).

    Credits are reserved up front exactly like /optimize; refunds on
    failure happen inside _stream_pipeline.
    """
    logger.info("🚀 API Gateway received a STREAMING application optimization request.")

    cv_bytes = await cv.read()
    final_cv_text = extract_text_from_pdf(pdf_bytes=cv_bytes)
    final_jd_text = job_description or SHORT_SAMPLE_JD

    initial_state = make_initial_state(final_cv_text, final_jd_text, template_id=template_id)
    initial_state["input_mode"] = "upload"
    initial_state["additional_info"] = additional_info or ""
    initial_state["cv_language"] = normalize_cv_language(cv_language)

    reserved_amount = reserve_credits(user_id, initial_state["cv_language"])

    return StreamingResponse(
        _stream_pipeline(initial_state, user_id, reserved_amount),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # Disable proxy/CDN buffering (nginx in particular) so events
            # flush to the client as they're generated instead of arriving
            # all at once at the end, which would defeat the whole feature.
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.post("/api/v1/optimize-manual/stream", tags=["Agent Core"])
async def optimize_manual_application_stream(
    payload: ManualCVRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Streaming variant of /api/v1/optimize-manual — see optimize_application_stream."""
    logger.info("🚀 API Gateway received a STREAMING manual optimization request.")

    manual_data = payload.model_dump(exclude={"job_description", "additional_info", "cv_language", "template_id"})
    final_jd_text = payload.job_description or SHORT_SAMPLE_JD

    initial_state = make_initial_state("", final_jd_text, template_id=getattr(payload, "template_id", None))
    initial_state["input_mode"] = "manual"
    initial_state["manual_cv_data"] = manual_data
    initial_state["additional_info"] = payload.additional_info or ""
    initial_state["cv_language"] = normalize_cv_language(payload.cv_language or "en")

    reserved_amount = reserve_credits(user_id, initial_state["cv_language"])

    return StreamingResponse(
        _stream_pipeline(initial_state, user_id, reserved_amount),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.post("/api/v1/optimize-manual", tags=["Agent Core"])
async def optimize_manual_application(
    payload: ManualCVRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Same pipeline as /api/v1/optimize, but for the 'Create New CV' flow —
    structured form data instead of an uploaded PDF. Both routes converge
    on the same LangGraph, just entering through a different parser node
    (see core/orchestrator.py's route_cv_input).
    """
    logger.info("🚀 API Gateway received a MANUAL CV optimization request.")

    manual_data = payload.model_dump(exclude={"job_description", "additional_info", "cv_language", "template_id"})
    final_jd_text = payload.job_description or SHORT_SAMPLE_JD

    initial_state = make_initial_state("", final_jd_text, template_id=getattr(payload, "template_id", None))
    initial_state["input_mode"] = "manual"
    initial_state["manual_cv_data"] = manual_data
    initial_state["additional_info"] = payload.additional_info or ""
    initial_state["cv_language"] = normalize_cv_language(payload.cv_language or "en")

    reserved_amount = reserve_credits(user_id, initial_state["cv_language"])

    try:
        logger.info("🧠 Commencing agent graph routing lifecycle (manual entry)...")
        result = graph.invoke(initial_state)
        logger.info("✅ Multi-agent execution phase completed.")

        ready, error_detail = _pipeline_ready(result)
        if not ready:
            logger.error(f"❌ Pipeline did not produce usable output (manual): {error_detail} | state error: {result.get('error')}")
            refund_credits(user_id, reserved_amount)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=error_detail,
            )

        cv_pdf_path = render_cv_pdf(result, template_id=result.get("template_id"))
        cv_docx_path = generate_cv_docx(result, template_id=result.get("template_id"))
        cl_pdf_path = render_cover_letter_pdf(result)

        return {
            "success": True,
            "ats_score": result.get("ats_score", 0),
            "ats_breakdown": result.get("score_breakdown", {}),
            "job_match_score": result.get("job_match_score", 0),
            "job_match_reason": result.get("job_match_reason", ""),
            "gap_analysis": result.get("gap_analysis", []),
            "overall_recommendation": result.get("overall_recommendation", ""),
            "tailored_summary": result.get("tailored_summary", ""),
            "tailored_bullets": result.get("tailored_bullets", []),
            "cover_letter_text": result.get("cover_letter_text", ""),
            "similar_jobs": result.get("similar_jobs", []),
            "fact_check_passed": result.get("fact_check_passed", False),
            "job_title": result.get("weight_factors", {}).get("job_title", ""),
            "company": result.get("weight_factors", {}).get("company", ""),
            "cv_language": result.get("cv_language", "en"),
            "generated_cv_pdf": cv_pdf_path,
            "generated_cv_docx": cv_docx_path,
            "generated_cl_pdf": cl_pdf_path,
            "error": result.get("error", None),
            "credits_charged": reserved_amount,
        }

    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"❌ Pipeline Failure (manual): {err}")
        refund_credits(user_id, reserved_amount)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An execution failure hit a core agent module: {str(err)}"
        )


if __name__ == "__main__":
    logger.info("🔥 Starting local development API server via Uvicorn...")
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)

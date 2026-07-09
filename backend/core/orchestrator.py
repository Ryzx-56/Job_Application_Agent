# core/orchestrator.py
from langgraph.graph import StateGraph, END, START
from core.state import AgentState

# Import node wrappers
from agents.cv_parser import run_cv_parser, run_manual_cv_parser  # Agent 1 (upload) + manual-entry variant
from agents.jd_analyzer import run_jd_analyzer      # Agent 2
from agents.tailoring_engine import run_tailoring_engine   # Agent 3 
from core.fact_checker import run_fact_checker      # Validation Node
from agents.document_generator import run_document_generator  # Agent 4
from agents.match_scorer import run_match_scorer    # Agent 5
from utils.ats_scorer import run_ats_scorer          # Deterministic ATS keyword/skills/education/experience match
from agents.jobs_finder import run_jobs_finder      # Agent 6 

# 1. Initialize State Graph Engine
workflow = StateGraph(AgentState)

# 2. Register Processing Nodes
workflow.add_node("cv_parser", run_cv_parser)
workflow.add_node("manual_cv_parser", run_manual_cv_parser)
workflow.add_node("jd_analyzer", run_jd_analyzer)
workflow.add_node("tailoring_engine", run_tailoring_engine) # Updated node reference
workflow.add_node("fact_checker", run_fact_checker)
workflow.add_node("document_generator", run_document_generator)
workflow.add_node("match_scorer", run_match_scorer)
workflow.add_node("ats_scorer", run_ats_scorer)
workflow.add_node("jobs_finder", run_jobs_finder) # Registering the new node

# jd_analyzer always runs — JD analysis doesn't depend on how the CV
# was provided.
workflow.add_edge(START, "jd_analyzer")

# CV parsing branches on input_mode: an uploaded PDF goes through cv_parser
# (Gemini extraction from raw text); a manually-filled form goes through
# manual_cv_parser (same Gemini extraction, fed a serialized version of
# the form instead). Only one branch actually runs per request.
def route_cv_input(state: AgentState) -> str:
    return "manual" if state.get("input_mode") == "manual" else "upload"

workflow.add_conditional_edges(
    START,
    route_cv_input,
    {
        "upload": "cv_parser",
        "manual": "manual_cv_parser",
    }
)

workflow.add_edge("cv_parser", "tailoring_engine")
workflow.add_edge("manual_cv_parser", "tailoring_engine")
workflow.add_edge("jd_analyzer", "tailoring_engine")

workflow.add_edge("tailoring_engine", "fact_checker")

# Conditional Router Logic block if check fails
MAX_TAILORING_ATTEMPTS = 2  # hard ceiling — if fact-checking still hasn't
                             # passed after this many rewrites, stop looping
                             # and proceed with whatever survived instead of
                             # retrying forever (e.g. if Gemini is down/exhausted)

def route_after_fact_check(state: AgentState):
    if state.get("fact_check_passed", False):
        # Trigger Document Generator, Match Scorer, ATS Scorer, AND Jobs Finder in PARALLEL
        return ["document_generator", "match_scorer", "ats_scorer", "jobs_finder"]

    if state.get("tailoring_attempts", 0) >= MAX_TAILORING_ATTEMPTS:
        # Give up looping — proceed with best-effort results rather than
        # retrying indefinitely. fact_check_passed=False is still visible
        # to the frontend so the user knows to double check the output.
        return ["document_generator", "match_scorer", "ats_scorer", "jobs_finder"]

    return "tailoring_engine" # Loop back to rewrite hallucinations

workflow.add_conditional_edges(
    "fact_checker",
    route_after_fact_check,
    {
        "document_generator": "document_generator",
        "match_scorer": "match_scorer",
        "ats_scorer": "ats_scorer",
        "jobs_finder": "jobs_finder",
        "tailoring_engine": "tailoring_engine"
    }
)

# Connect everything out to final execution sink step
workflow.add_edge("document_generator", END)
workflow.add_edge("match_scorer", END)
workflow.add_edge("ats_scorer", END)
workflow.add_edge("jobs_finder", END)

# Compile Graph Structure
app = workflow.compile()
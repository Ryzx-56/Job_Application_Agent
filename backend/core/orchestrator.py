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
from agents.jobs_finder import run_jobs_finder       # Agent 6 — automatic per-CV job match
from utils.ats_scorer import run_ats_scorer          # Deterministic ATS keyword/skills/education/experience match

# 1. Initialize State Graph Engine
workflow = StateGraph(AgentState)

# 2. Register Processing Nodes
workflow.add_node("cv_parser", run_cv_parser)
workflow.add_node("manual_cv_parser", run_manual_cv_parser)
workflow.add_node("jd_analyzer", run_jd_analyzer)
workflow.add_node("tailoring_engine", run_tailoring_engine) # Updated node reference
workflow.add_node("fact_checker", run_fact_checker)
workflow.add_node("document_generator", run_document_generator)
workflow.add_node("jobs_finder", run_jobs_finder)

# SPEED: ats_scorer and match_scorer are ONE node.
#
# They used to be two, wired ats_scorer -> match_scorer as a sequential
# edge, because match_scorer reads state["score_breakdown"] which ats_scorer
# writes. That was correct but expensive: LangGraph runs in supersteps, and
# a superstep cannot begin until EVERY node in the previous one has
# finished. match_scorer therefore waited not just for ats_scorer (22ms,
# it's pure Python) but for the whole parallel batch beside it — including
# the 25-second cover letter. Measured on a real Arabic run:
#
#   16:00:56.636  document_generator starts
#   16:00:56.658  ats_scorer done      (22ms)
#   16:01:21.888  cover letter done    (25s)
#   16:01:21.889  match_scorer STARTS  <- 1ms later, having idled ~25s
#
# Collapsing them into a single node puts the scoring work INSIDE the
# parallel fan-out, so it runs alongside the cover letter instead of after
# it. Same execution order internally (ATS first, then match scoring on its
# output), roughly 20-25 seconds off every run.
def run_scoring(state: AgentState) -> dict:
    """Agent 5 + Agent 7. ATS scoring is pure Python and instant; the match
    scorer needs its output, so they run back to back here rather than as
    two graph nodes."""
    ats_update = run_ats_scorer(state) or {}
    # match_scorer reads score_breakdown/ats_score, which only exist in the
    # update dict at this point — merge before handing it over.
    match_update = run_match_scorer({**state, **ats_update}) or {}
    return {**ats_update, **match_update}


workflow.add_node("scoring", run_scoring)

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

# FAIL FAST #1 — between Agent 3 and the fact checker.
#
# tailoring_engine sets fatal_error_code when it has permanently failed
# (exhausted retries, or produced output too large to ever fit the token
# ceiling). Everything downstream reads the tailored CV it never produced,
# so continuing only buys an empty document at full price. Previously the
# graph ran on regardless: the fact checker no-oped, ats_scorer and
# match_scorer no-oped to 0, and document_generator STILL made a full model
# call for a cover letter attached to a CV that didn't exist. That is the
# "burned tokens for ~5 minutes and returned 0% / 0% / no content" report.
def route_after_tailoring(state: AgentState) -> str:
    if state.get("fatal_error_code"):
        return "abort"
    return "fact_checker"


workflow.add_conditional_edges(
    "tailoring_engine",
    route_after_tailoring,
    {
        "fact_checker": "fact_checker",
        "abort": END,
    }
)

# Conditional Router Logic block if check fails
MAX_TAILORING_ATTEMPTS = 2  # hard ceiling — if fact-checking still hasn't
                             # passed after this many rewrites, stop looping
                             # and proceed with whatever survived instead of
                             # retrying forever (e.g. if Gemini is down/exhausted)

def route_after_fact_check(state: AgentState):
    # NOTE: parallel siblings in a fan-out all read the SAME state snapshot
    # and never see each other's writes until the batch finishes. That's why
    # match scoring can't be its own sibling here — it needs ats_scorer's
    # output. It's folded into the "scoring" node instead (see run_scoring),
    # which keeps the ordering guarantee AND the parallelism.
    if state.get("fact_check_passed", False):
        # Cover letter and scoring (ATS + match) run in PARALLEL — they're
        # independent of each other. See run_scoring for why the two scorers
        # are one node rather than two.
        #
        # ⚠️ jobs_finder IS BACK — as a DIFFERENT, much smaller search.
        #
        # THE HISTORY MATTERS, because the obvious mistake here is to restore
        # what was removed. What was removed was this node calling
        # find_similar_jobs unconditionally: 8 Tavily credits on every CV
        # whether or not anyone scrolled to the panel. Measured at the time:
        # 0.24 SAR of Tavily against 0.0133 SAR of model on the same English
        # CV — Tavily was 95% of the cost of generating a CV. find_similar_jobs
        # has since grown to four lanes and a four-pass ladder, so restoring
        # it verbatim would now cost 7-28 credits per generation, several
        # times worse than the version that was pulled.
        #
        # What runs here instead is find_matching_jobs_for_cv: one query, two
        # pre-vetted lanes, five results, and the 48h shared cache checked
        # first — 3 credits on a miss and 0 on a hit. The panel is a marketed
        # feature (it is on the landing page and in the video), so it is back
        # on by default for every tier; the two PAID surfaces are untouched
        # and keep their own metering:
        #
        #   · /dashboard/job-search  — the Job Search page, 12 results,
        #     adjacent titles, a monthly allowance.
        #   · "Find matching jobs"   — POST /api/v1/resumes/{id}/find-jobs,
        #     find_similar_jobs, same allowance.
        #
        # It is a parallel sibling, so it costs no wall-clock time the cover
        # letter was not already spending, and it CANNOT fail the run:
        # find_matching_jobs_for_cv swallows everything and reports a status
        # instead. See its docstring.
        return ["document_generator", "scoring", "jobs_finder"]

    # FAIL FAST #2 — the checker itself couldn't run (see
    # FactCheckerUnavailable in core/fact_checker.py). Nothing downstream
    # can improve on that, so stop and let main.py refund.
    if state.get("fatal_error_code"):
        return "abort"

    if state.get("error"):
        # tailoring_engine already exhausted its own internal retries and
        # permanently failed — it now no-ops on every further call (see its
        # `if state.get("error"): return {}` guard), which means
        # tailoring_attempts would never increment again and this router
        # would loop back to it forever. Stop, rather than paying for the
        # remaining agents to produce an empty document.
        return "abort"

    if state.get("tailoring_attempts", 0) >= MAX_TAILORING_ATTEMPTS:
        # Retries are exhausted and NOT ONE bullet survived fact-checking
        # (fact_check_passed is False here, and a CV with no bullets at all
        # already reports True — see run_fact_checker). Rendering now would
        # produce exactly the failure that was reported: a charged run whose
        # CV falls back to the untailored source text, with a 0% ATS score,
        # a 0% match score and an empty tailored summary. Abort instead so
        # main.py refunds the credit and returns a real error.
        return "abort"

    return "tailoring_engine" # Loop back to rewrite hallucinations

workflow.add_conditional_edges(
    "fact_checker",
    route_after_fact_check,
    {
        "document_generator": "document_generator",
        "scoring": "scoring",
        "jobs_finder": "jobs_finder",
        "tailoring_engine": "tailoring_engine",
        "abort": END,
    }
)



# Connect everything out to final execution sink step
workflow.add_edge("document_generator", END)
workflow.add_edge("scoring", END)
workflow.add_edge("jobs_finder", END)

# Compile Graph Structure
app = workflow.compile()

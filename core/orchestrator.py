from langgraph.graph import StateGraph, END

from core.state import AgentState
from agents.cv_parser import run_cv_parser
from agents.jd_analyzer import run_jd_analyzer
from agents.tailoring_engine import run_tailoring_engine, make_regeneration_fn
from core.fact_checker import run_fact_check_loop
from agents.document_generator import run_document_generator
from utils.pdf_generator import render_cv_pdf, render_cover_letter_pdf
from utils.docx_generator import generate_cv_docx


def fact_check_node(state: AgentState) -> AgentState:
    """LangGraph node: verify tailored bullets against facts_json."""
    if state.get("error"):
        return state

    if not state.get("tailored_bullets"):
        state["fact_check_passed"] = True
        return state

    regen_fn = make_regeneration_fn(state["facts_json"])
    verified_bullets, flags = run_fact_check_loop(
        bullets=state["tailored_bullets"],
        facts_json=state["facts_json"],
        tailoring_fn=regen_fn,
    )

    state["tailored_bullets"]    = verified_bullets
    state["hallucination_flags"] = flags
    state["fact_check_passed"]   = not any(f.get("excluded") for f in flags)
    return state


def agent4_node(state: AgentState) -> AgentState:
    """LangGraph node: generate cover letter + render PDF/DOCX files."""
    if state.get("error"):
        return state

    # 4a: Cover letter text via Gemini Flash
    result = run_document_generator(state)
    state  = {**state, **result}

    # 4b: Render all output files
    cv_pdf_path           = render_cv_pdf(state)
    cover_letter_pdf_path = render_cover_letter_pdf(state)
    generate_cv_docx(state)

    state["cv_pdf_path"]           = cv_pdf_path
    state["cover_letter_pdf_path"] = cover_letter_pdf_path
    return state


def build_graph():
    graph = StateGraph(AgentState)

    graph.add_node("cv_parser",        run_cv_parser)
    graph.add_node("jd_analyzer",      run_jd_analyzer)
    graph.add_node("tailoring_engine", run_tailoring_engine)
    graph.add_node("fact_check",       fact_check_node)
    graph.add_node("agent4",           agent4_node)

    graph.set_entry_point("cv_parser")
    graph.add_edge("cv_parser",        "jd_analyzer")
    graph.add_edge("jd_analyzer",      "tailoring_engine")
    graph.add_edge("tailoring_engine", "fact_check")
    graph.add_edge("fact_check",       "agent4")
    graph.add_edge("agent4",           END)

    return graph.compile()
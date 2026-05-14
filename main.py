from langgraph.graph import StateGraph, END
from core.state import AgentState

# Two dummy nodes
def node_a(state: AgentState) -> AgentState:
  print(f"[Node A] received: {state['current_step']}")
  return {**state, "current_step": "node_a_done"}

def node_b(state: AgentState) -> AgentState:
  print(f"[Node B] received: {state['current_step']}")
  return {**state, "current_step": "node_b_done"}

#Build Graph 
builder = StateGraph(AgentState)
builder.add_node("node_a", node_a)
builder.add_node("node_b", node_b)

builder.set_entry_point("node_a")
builder.add_edge("node_a", "node_b")
builder.add_edge("node_b", END)

graph = builder.compile()

# RUN Test
if __name__ == "__main__":
  initial_state = AgentState(
    raw_cv_text="", job_description="", facts_json={},
    weight_factors={}, tailored_bullets=[], tailored_summary="",
    hallucination_flags=[], fact_check_passed=False, 
    cover_letter_text="", cv_pdf_path="", cover_letter_pdf_path="",
    ats_score=0, score_breakdown={}, gap_analysis=[],
    similar_jobs=[], error=None, current_step="start"
  )

  result = graph.invoke(initial_state)
  print(f"\n✅ LangGraph working! Final step: {result['current_step']}")
"""Explicit LangGraph workflow (spec §7.2).

START → input_validation → scope_classifier → security_guard → intent_router
  ├─ refuse        → safe_refusal ─────────────────────────────────────────────┐
  ├─ out_of_scope  → scope_refusal ────────────────────────────────────────────┤
  ├─ direct/deny   → direct_response ──────────────────────────────────────────┤
  ├─ employee      → mcp_employee_lookup ─(+policy?)→ hybrid_retrieval ...      │
  │                                     └→ evidence_check                      │
  └─ policy        → hybrid_retrieval → rerank_passages → evidence_check        │
                         evidence_check ─ sufficient → response_generation      │
                                        └ insufficient → human_escalation ──────┤
                         response_generation → output_guard ─ ok → final ───────┤
                                            └ llm down ┘    └ fail → human_escalation
                                                                    final_response → END
"""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from app.agent.nodes import AgentDeps, AgentNodes
from app.agent.state import AgentState


def build_graph(deps: AgentDeps):
    n = AgentNodes(deps)
    g = StateGraph(AgentState)
    for name in ("input_validation", "scope_classifier", "security_guard", "intent_router", "hybrid_retrieval", "rerank_passages",
                 "mcp_employee_lookup", "evidence_check", "response_generation", "output_guard", "human_escalation",
                 "safe_refusal", "scope_refusal", "direct_response", "final_response"):
        g.add_node(name, getattr(n, name))

    g.add_edge(START, "input_validation")
    g.add_conditional_edges("input_validation", lambda s: "ok" if s.get("input_valid") else "invalid",
                            {"ok": "scope_classifier", "invalid": "final_response"})
    g.add_edge("scope_classifier", "security_guard")
    g.add_edge("security_guard", "intent_router")
    g.add_conditional_edges("intent_router", lambda s: s["route"], {
        "refuse": "safe_refusal",
        "out_of_scope": "scope_refusal",
        "direct": "direct_response",
        "deny_cross": "direct_response",
        "employee": "mcp_employee_lookup",
        "policy": "hybrid_retrieval",
    })
    g.add_conditional_edges("mcp_employee_lookup",
                            lambda s: "policy" if s["classification"].get("also_needs_policy") and (s.get("mcp_result") or {}).get("status") == "ok" else "check",
                            {"policy": "hybrid_retrieval", "check": "evidence_check"})
    g.add_edge("hybrid_retrieval", "rerank_passages")
    g.add_edge("rerank_passages", "evidence_check")
    g.add_conditional_edges("evidence_check", lambda s: "generate" if s.get("evidence_sufficient") else "escalate",
                            {"generate": "response_generation", "escalate": "human_escalation"})
    g.add_conditional_edges("response_generation", lambda s: "escalate" if s.get("draft_status") == "llm_unavailable" else "guard",
                            {"guard": "output_guard", "escalate": "human_escalation"})
    g.add_conditional_edges("output_guard", lambda s: "escalate" if s.get("escalation_reason") in ("guard_failed", "secret_leak") else "ok",
                            {"ok": "final_response", "escalate": "human_escalation"})
    for name in ("human_escalation", "safe_refusal", "scope_refusal", "direct_response"):
        g.add_edge(name, "final_response")
    g.add_edge("final_response", END)
    return g.compile()

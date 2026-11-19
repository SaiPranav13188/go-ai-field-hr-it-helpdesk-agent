"""LangGraph state (spec §7.3).

`authenticated_subject_id` and `user_role` are set by the API from the verified session token
before the graph starts; no node ever derives identity from `user_message`. No secrets, API
keys or raw tokens are stored in state.
"""

from __future__ import annotations

from typing import Any, TypedDict


class AgentState(TypedDict, total=False):
    # identity & request (trusted, server-side)
    request_id: str
    conversation_id: str
    authenticated_subject_id: str
    user_role: str
    user_display_name: str

    # input
    user_message: str
    history: list[dict]
    sanitized_message: str
    quoted_content: str | None
    input_valid: bool
    input_error: str | None
    notices: list[str]

    # understanding & security
    classification: dict
    classifier_source: str
    intent: str
    scope_decision: str
    security_flags: list[dict]
    block_category: str | None
    route: str

    # retrieval
    retrieval_query: str
    retrieval: Any  # RetrievalResult (in-memory only; no checkpointer is used)
    retrieved_chunks: list[dict]
    reranked_chunks: list[dict]
    evidence: list[Any]  # list[Candidate]
    evidence_sufficient: bool

    # tools
    mcp_result: dict | None
    tool_calls: list[dict]

    # answer
    draft_answer: str
    draft_status: str
    output_flags: list[str]
    redacted_answer: str
    citations: list[dict]
    escalation_reason: str | None
    escalation: dict | None
    final: dict
    timings: dict[str, float]

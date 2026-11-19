"""LangGraph node implementations (spec §7.1).

Each node is a small, explicit, testable step. Security decisions that matter (blocking,
authorization, output validation) are made in deterministic code — the LLM only classifies
and phrases answers from supplied evidence.
"""

from __future__ import annotations

import functools
import logging
import re
import time
from dataclasses import dataclass
from typing import Awaitable, Callable

from langgraph.config import get_stream_writer

from app.agent import prompts as P
from app.agent.llm import GeminiLLM, LLMUnavailable
from app.agent.mcp_client import McpGateway, ToolUnavailable
from app.agent.state import AgentState
from app.config import Settings
from app.retrieval.hybrid_search import Candidate, HybridRetriever, prepare_query
from app.security.identity import Principal, issue_mcp_assertion
from app.security.injection import scan, scan_retrieved_text, strip_invisible
from app.security.output_validation import CITATION_RE, validate_output
from app.security.pii import contains_secret, redact
from app.security.scope import EMPLOYEE_ID, LEAVE_TYPES, heuristic_classify

log = logging.getLogger(__name__)

NODE_LABELS = {
    "input_validation": "Validating input",
    "scope_classifier": "Understanding the question",
    "security_guard": "Security screening",
    "intent_router": "Routing",
    "hybrid_retrieval": "Hybrid search · BGE-M3 + BM25 → RRF",
    "rerank_passages": "Reranking · bge-reranker-v2-m3",
    "mcp_employee_lookup": "Checking your leave balance via MCP",
    "evidence_check": "Verifying evidence",
    "response_generation": "Composing a grounded answer",
    "output_guard": "Validating citations, numbers & PII",
    "human_escalation": "Preparing a safe fallback",
    "safe_refusal": "Blocking unsafe request",
    "scope_refusal": "Outside HR & IT scope",
    "direct_response": "Responding",
    "final_response": "Finalising",
}

BLOCK_PRIORITY = ["bulk_personal_data", "secret_extraction", "sql_injection", "role_escalation", "instruction_override"]
INTENT_TO_BLOCK = {"prompt_injection": "instruction_override", "secret_extraction": "secret_extraction", "bulk_data_request": "bulk_personal_data"}
BLOCK_TEMPLATE = {
    "bulk_personal_data": "refuse_bulk",
    "secret_extraction": "refuse_secrets",
    "sql_injection": "refuse_sql",
    "role_escalation": "refuse_role",
    "instruction_override": "refuse_injection",
}
_QUOTED_RE = re.compile(r'"([^"]{12,})"|“([^”]{12,})”|```(.+?)```', re.S)


@dataclass
class AgentDeps:
    settings: Settings
    retriever: HybridRetriever
    llm: GeminiLLM | None
    mcp: McpGateway


def traced(name: str):
    """Emit start/done stage events (for the live pipeline UI) and record node timings."""

    def deco(fn: Callable[..., Awaitable[dict]]):
        @functools.wraps(fn)
        async def wrapper(self, state: AgentState) -> dict:
            writer = get_stream_writer()
            writer({"type": "stage", "node": name, "status": "start", "label": NODE_LABELS[name]})
            t = time.perf_counter()
            update = await fn(self, state) or {}
            ms = round((time.perf_counter() - t) * 1000, 1)
            detail = update.pop("_detail", None)
            writer({"type": "stage", "node": name, "status": "done", "label": NODE_LABELS[name], "ms": ms, "detail": detail})
            update["timings"] = {**state.get("timings", {}), name: ms}
            return update

        return wrapper

    return deco


def _principal(state: AgentState) -> Principal:
    return Principal(subject_id=state["authenticated_subject_id"], role=state.get("user_role", "employee"))


def _team(state: AgentState) -> str:
    intent = state.get("intent", "")
    if intent == "security_incident":
        return "the IT Security queue"
    res = state.get("retrieval")
    if res is not None and res.ranked:
        top = res.ranked[0].payload.get("document_id", "")
        if top.startswith("IT-"):
            return "the IT helpdesk"
        if top == "HR-POL-006":
            return "HR (or your insurer’s current plan documents)"
    if any(w in state.get("sanitized_message", "").lower() for w in ("vpn", "wifi", "wi-fi", "laptop", "password", "software", "mfa", "device", "network")):
        return "the IT helpdesk"
    return "HR"


class AgentNodes:
    def __init__(self, deps: AgentDeps):
        self.d = deps
        self.s = deps.settings

    # ------------------------------------------------------------------ 1. input_validation
    @traced("input_validation")
    async def input_validation(self, state: AgentState) -> dict:
        raw = state.get("user_message") or ""
        cleaned, had_invisible = strip_invisible(raw)
        cleaned = re.sub(r"[ \t]{2,}", " ", cleaned).strip()
        notices: list[str] = []
        if not cleaned:
            return {"input_valid": False, "input_error": "invalid_empty", "sanitized_message": "", "notices": notices, "_detail": "empty message"}
        if len(cleaned) > self.s.max_message_chars:
            return {"input_valid": False, "input_error": "invalid_too_long", "sanitized_message": "", "notices": notices,
                    "_detail": f"{len(cleaned)} chars > {self.s.max_message_chars}"}
        # Data minimisation: PII/secrets are redacted BEFORE anything reaches the model or logs.
        secret_kinds = contains_secret(cleaned)
        redacted, counts = redact(cleaned)
        if secret_kinds:
            notices.append(P.TEMPLATES["secret_notice"])
        history = []
        for turn in (state.get("history") or [])[-6:]:
            if turn.get("role") in ("user", "assistant") and isinstance(turn.get("content"), str):
                history.append({"role": turn["role"], "content": redact(strip_invisible(turn["content"])[0][:1500])[0]})
        detail = "ok" + (f" · redacted {dict(counts)}" if counts else "") + (" · removed invisible chars" if had_invisible else "")
        return {"input_valid": True, "input_error": None, "sanitized_message": redacted, "history": history, "notices": notices, "_detail": detail}

    # ------------------------------------------------------------------ 2. scope_classifier
    @traced("scope_classifier")
    async def scope_classifier(self, state: AgentState) -> dict:
        msg = state["sanitized_message"]
        own = state["authenticated_subject_id"]
        source = "llm"
        try:
            if self.d.llm is None:
                raise LLMUnavailable("not configured")
            c = await self.d.llm.structured(system=P.CLASSIFIER_SYSTEM, prompt=P.classifier_prompt(msg, state.get("history", [])),
                                            schema=P.Classification, classifier=True, temperature=0.0)
            cls = c.model_dump()
        except LLMUnavailable:
            cls, source = heuristic_classify(msg, own), "heuristic"

        # Deterministic cross-checks the model cannot talk its way out of.
        other_ids = [e for e in EMPLOYEE_ID.findall(msg.upper()) if e != own]
        if other_ids and cls["intent"] not in ("prompt_injection", "secret_extraction", "bulk_data_request"):
            cls["intent"], cls["target_employee_id"] = "other_employee_data", other_ids[0]
        if cls.get("target_employee_id") and cls["target_employee_id"] == own and cls["intent"] == "other_employee_data":
            cls["intent"] = "personal_leave_balance"
        cls["leave_types"] = sorted(set(cls.get("leave_types") or []) | {k for k, rx in LEAVE_TYPES.items() if rx.search(msg)}) if cls["intent"] in ("personal_leave_balance", "other_employee_data") else cls.get("leave_types", [])
        cls["standalone_query"] = (cls.get("standalone_query") or msg)[:500]
        scope = "out_of_scope" if cls["intent"] == "out_of_scope" else "in_scope"
        return {"classification": cls, "classifier_source": source, "intent": cls["intent"], "scope_decision": scope,
                "_detail": f"{cls['intent']} ({source})"}

    # ------------------------------------------------------------------ 3. security_guard
    @traced("security_guard")
    async def security_guard(self, state: AgentState) -> dict:
        msg = state["sanitized_message"]
        flags = scan(msg)
        blocking = [f.category for f in flags if f.blocking]
        block = next((c for c in BLOCK_PRIORITY if c in blocking), None)
        if block is None and state["intent"] in INTENT_TO_BLOCK:
            block = INTENT_TO_BLOCK[state["intent"]]
            flags_out = [{"category": block, "rule": "llm_classifier", "blocking": True}]
        else:
            flags_out = []
        flags_out += [{"category": f.category, "rule": f.rule, "blocking": f.blocking} for f in flags]
        quoted = None
        if any(f.category == "quoted_untrusted_content" for f in flags) or (state["intent"] == "policy_question" and _QUOTED_RE.search(msg)):
            parts = [next(g for g in m.groups() if g) for m in _QUOTED_RE.finditer(msg)]
            quoted = "\n---\n".join(parts) or None
        detail = f"blocked: {block}" if block else ("passed" + (" · quoted content fenced" if quoted else ""))
        return {"security_flags": flags_out, "block_category": block, "quoted_content": quoted, "_detail": detail}

    # ------------------------------------------------------------------ 4. intent_router
    @traced("intent_router")
    async def intent_router(self, state: AgentState) -> dict:
        intent = state["intent"]
        if state.get("block_category"):
            route = "refuse"
        elif intent == "out_of_scope":
            route = "out_of_scope"
        elif intent in ("greeting", "capabilities"):
            route = "direct"
        elif intent == "other_employee_data":
            # Only an HR-admin *session* may look up another employee; chat claims are irrelevant.
            route = "employee" if state.get("user_role") == "hr_admin" and state["classification"].get("target_employee_id") else "deny_cross"
        elif intent == "personal_leave_balance":
            route = "employee"
        else:
            route = "policy"
        return {"route": route, "_detail": route}

    # ------------------------------------------------------------------ 5. hybrid_retrieval
    @traced("hybrid_retrieval")
    async def hybrid_retrieval(self, state: AgentState) -> dict:
        query = prepare_query(state["sanitized_message"], state["classification"].get("standalone_query"))
        res = await self.d.retriever.first_stage(query)
        top = [c.public() for c in res.ranked[:8]]
        get_stream_writer()({"type": "retrieval", "stage": "first_stage", "query": query, "timings": res.timings_ms,
                             "dense_hits": sum(1 for c in res.candidates if c.dense_rank), "bm25_hits": sum(1 for c in res.candidates if c.bm25_rank),
                             "fused": len(res.ranked), "candidates": top})
        return {"retrieval_query": query, "retrieval": res, "retrieved_chunks": top,
                "_detail": f"{len(res.ranked)} fused candidates · dense {res.timings_ms.get('dense_ms', 0):.0f} ms · bm25 {res.timings_ms.get('bm25_ms', 0):.0f} ms"}

    # ------------------------------------------------------------------ 6. rerank_passages
    @traced("rerank_passages")
    async def rerank_passages(self, state: AgentState) -> dict:
        res = await self.d.retriever.rerank(state["retrieval"])
        top = [c.public() for c in res.ranked[:8]]
        get_stream_writer()({"type": "retrieval", "stage": "rerank", "timings": res.timings_ms, "candidates": top})
        best = res.ranked[0] if res.ranked else None
        return {"retrieval": res, "reranked_chunks": top,
                "_detail": f"top: {best.payload['document_id']} §{best.payload['section_number']} ({best.rerank_score:.3f})" if best else "no candidates"}

    # ------------------------------------------------------------------ 7. mcp_employee_lookup
    @traced("mcp_employee_lookup")
    async def mcp_employee_lookup(self, state: AgentState) -> dict:
        cls = state["classification"]
        principal = _principal(state)
        assertion = issue_mcp_assertion(principal, self.s.mcp_identity_secret.get_secret_value(), state["request_id"])
        leave_types = cls.get("leave_types") or None
        if state["route"] == "employee" and state["intent"] == "other_employee_data":
            tool, args = "get_employee_leave_balance_for_hr", {"identity_assertion": assertion, "target_employee_id": cls["target_employee_id"], "leave_types": leave_types}
        else:
            tool, args = "get_my_leave_balance", {"identity_assertion": assertion, "leave_types": leave_types}
        try:
            result, ms = await self.d.mcp.call(tool, args)
        except ToolUnavailable as exc:
            result, ms = {"status": "unavailable", "message": str(exc)}, 0.0
        call = {"tool": tool, "status": result.get("status"), "duration_ms": round(ms, 1),
                "fields_returned": sorted((result.get("balances") or {}).keys())}
        get_stream_writer()({"type": "tool", **call})
        return {"mcp_result": result, "tool_calls": [*state.get("tool_calls", []), call], "_detail": f"{tool} → {result.get('status')}"}

    # ------------------------------------------------------------------ 8. evidence_check
    @traced("evidence_check")
    async def evidence_check(self, state: AgentState) -> dict:
        flags = list(state.get("security_flags", []))
        mcp = state.get("mcp_result")
        res = state.get("retrieval")
        evidence: list[Candidate] = []
        policy_ok = False
        if res is not None:
            evidence, policy_ok = self.d.retriever.select_evidence(res)
            for c in evidence:
                for f in scan_retrieved_text(c.payload.get("text", "")):
                    flags.append({"category": f.category, "rule": f"{f.rule}@{c.chunk_id}", "blocking": False})
        if state["route"] == "employee":
            ok = bool(mcp and mcp.get("status") == "ok")
            reason = None if ok else f"mcp_{(mcp or {}).get('status', 'unavailable')}"
            detail = "authorised record returned" if ok else reason
        else:
            ok = policy_ok
            reason = None if ok else "insufficient_evidence"
            top = res.top_score if res is not None else 0.0
            detail = f"{len(evidence)} passages ≥ threshold (top {top:.3f})" if ok else f"top score {top:.3f} < {self.s.rerank_answer_threshold}"
        return {"evidence": evidence, "evidence_sufficient": ok, "escalation_reason": reason, "security_flags": flags, "_detail": detail}

    # ------------------------------------------------------------------ 9. response_generation
    @traced("response_generation")
    async def response_generation(self, state: AgentState) -> dict:
        mcp = state.get("mcp_result")
        cls = state["classification"]
        if state["route"] == "employee" and not cls.get("also_needs_policy"):
            # Personal data never needs an LLM: a deterministic template cannot hallucinate a number.
            return {"draft_answer": P.balance_answer(mcp["balances"], mcp.get("as_of")), "draft_status": "personal_data", "_detail": "template (no LLM)"}

        evidence: list[Candidate] = state.get("evidence", [])
        flagged = {f["rule"].split("@")[-1] for f in state.get("security_flags", []) if f["category"] == "indirect_injection"}
        blocks = []
        for i, c in enumerate(evidence, 1):
            p = c.payload
            attr = ' untrusted_instructions_detected="true"' if c.chunk_id in flagged else ""
            blocks.append(f'<passage id="S{i}" document="{p["document_title"]}" document_id="{p["document_id"]}" '
                          f'section="{p["section"]}" version="{p["version"]}" effective="{p["effective_date"]}"{attr}>\n{p["text"]}\n</passage>')
        notes = []
        intent = state["intent"]
        if intent in P.ROUTE_NOTES:
            notes.append(P.ROUTE_NOTES[intent])
        if state.get("quoted_content"):
            notes.append(P.ROUTE_NOTES["quoted_content"])
        record = None
        if mcp and mcp.get("status") == "ok":
            notes.append(P.ROUTE_NOTES["personal_and_policy"])
            record = ", ".join(f"{P.LEAVE_LABEL[t]} remaining: {P.fmt_days(v)} days" for t, v in mcp["balances"].items())
        prompt = P.generation_prompt(state["sanitized_message"], blocks, notes, record, state.get("quoted_content"))
        try:
            if self.d.llm is None:
                raise LLMUnavailable("not configured")
            draft = await self.d.llm.structured(system=P.GENERATION_SYSTEM, prompt=prompt, schema=P.DraftAnswer, temperature=0.1)
        except LLMUnavailable:
            return {"draft_answer": "", "draft_status": "llm_unavailable", "escalation_reason": "llm_unavailable", "_detail": "generation model unavailable"}
        return {"draft_answer": draft.answer, "draft_status": draft.status, "_detail": f"{draft.status} · {len(evidence)} passages"}

    # ------------------------------------------------------------------ 10. output_guard
    @traced("output_guard")
    async def output_guard(self, state: AgentState) -> dict:
        evidence: list[Candidate] = state.get("evidence", [])
        mcp = state.get("mcp_result") or {}
        grounding = "\n".join(
            f"{c.payload['document_id']} {c.payload['section']} v{c.payload['version']} {c.payload['effective_date']}\n{c.payload['text']}" for c in evidence
        )
        grounding += "\n" + " ".join(str(v) for v in (mcp.get("balances") or {}).values()) + " " + (mcp.get("as_of") or "")
        grounding += "\n" + state["sanitized_message"]
        is_policy_answer = state["draft_status"] == "answered"
        check = validate_output(state["draft_answer"], n_sources=len(evidence), grounding_text=grounding, canary=P.CANARY,
                                require_citation=is_policy_answer and bool(evidence))
        flags = check.flags
        failed = check.secret_leak or bool(check.action_claims) or bool(check.unsupported_numbers) or "<none-valid>" in check.removed_citations
        if failed:
            log.warning("output_guard_failed", extra={"flags": flags, "unsupported": check.unsupported_numbers})
            reason = "secret_leak" if check.secret_leak else "guard_failed"
            return {"output_flags": flags, "escalation_reason": reason, "redacted_answer": "", "_detail": "failed: " + ", ".join(flags or ["no valid citation"])}

        # Renumber [S#] → [n] in order of first use; keep only cited passages.
        order: list[int] = []
        for m in CITATION_RE.finditer(check.text):
            n = int(m.group(1))
            if n not in order:
                order.append(n)
        text = CITATION_RE.sub(lambda m: f"[{order.index(int(m.group(1))) + 1}]", check.text)
        text = re.sub(r"(\[\d+\])(?:\s*\1)+", r"\1", text)
        citations = []
        for new_n, old_n in enumerate(order, 1):
            c = evidence[old_n - 1]
            p = c.payload
            citations.append({"n": new_n, "chunk_id": c.chunk_id, "document_id": p["document_id"], "document_title": p["document_title"],
                              "section": p["section"], "section_number": p["section_number"], "version": p["version"],
                              "effective_date": p["effective_date"], "source_file": p["source_file"], "excerpt": p["text"],
                              "rerank_score": round(c.rerank_score or 0.0, 4)})
        return {"output_flags": flags, "redacted_answer": text, "citations": citations, "_detail": "passed" + (f" · {', '.join(flags)}" if flags else "")}

    # ------------------------------------------------------------------ 11. human_escalation
    @traced("human_escalation")
    async def human_escalation(self, state: AgentState) -> dict:
        reason = state.get("escalation_reason") or "insufficient_evidence"
        team = _team(state)
        citations: list[dict] = []
        if reason == "secret_leak":
            text = P.TEMPLATES["refuse_secrets"]
        elif reason.startswith("mcp_"):
            text = P.TEMPLATES.get(reason, P.TEMPLATES["mcp_unavailable"])
            team = "HR"
        elif reason == "llm_unavailable":
            text = P.TEMPLATES["llm_unavailable"].format(team=team)
            res = state.get("retrieval")
            for i, c in enumerate((res.ranked[:3] if res else []), 1):
                if (c.rerank_score or 0) >= self.s.rerank_answer_threshold:
                    p = c.payload
                    citations.append({"n": i, "chunk_id": c.chunk_id, "document_id": p["document_id"], "document_title": p["document_title"],
                                      "section": p["section"], "section_number": p["section_number"], "version": p["version"],
                                      "effective_date": p["effective_date"], "source_file": p["source_file"], "excerpt": p["text"],
                                      "rerank_score": round(c.rerank_score or 0.0, 4), "related_only": True})
        elif reason == "guard_failed":
            text = P.TEMPLATES["abstain_guard"].format(team=team)
        else:
            text = P.TEMPLATES["abstain"].format(team=team)
        escalation = {"team": team, "reason": reason, "ticket_created": False}
        return {"redacted_answer": text, "citations": citations, "escalation": escalation, "draft_status": "abstained", "_detail": f"{reason} → {team}"}

    # ------------------------------------------------------------------ refusals / direct
    @traced("safe_refusal")
    async def safe_refusal(self, state: AgentState) -> dict:
        cat = state["block_category"]
        return {"redacted_answer": P.TEMPLATES[BLOCK_TEMPLATE[cat]], "draft_status": "refused", "citations": [], "_detail": f"{cat} · no tools called"}

    @traced("scope_refusal")
    async def scope_refusal(self, state: AgentState) -> dict:
        return {"redacted_answer": P.TEMPLATES["out_of_scope"], "draft_status": "out_of_scope", "citations": [], "_detail": "no search performed"}

    @traced("direct_response")
    async def direct_response(self, state: AgentState) -> dict:
        key = {"greeting": "greeting", "capabilities": "capabilities"}.get(state["intent"], "deny_cross_employee")
        status = "denied" if key == "deny_cross_employee" else "info"
        return {"redacted_answer": P.TEMPLATES[key], "draft_status": status, "citations": [], "_detail": key}

    # ------------------------------------------------------------------ 12. final_response
    @traced("final_response")
    async def final_response(self, state: AgentState) -> dict:
        if not state.get("input_valid", True):
            key = state.get("input_error") or "invalid_empty"
            answer, status = P.TEMPLATES[key].format(limit=self.s.max_message_chars), "invalid"
        else:
            answer, status = state.get("redacted_answer", ""), state.get("draft_status", "answered")
        intent = state.get("intent")
        escalation = state.get("escalation")
        if intent == "security_incident" and status in ("answered", "partial"):
            escalation = {"team": "the IT Security queue", "reason": "possible_security_incident", "ticket_created": False}
        elif intent == "sensitive_hr" and status in ("answered", "partial"):
            escalation = {"team": "HR", "reason": "sensitive_employee_relations", "ticket_created": False}
        mcp = state.get("mcp_result") or {}
        personal = None
        if mcp.get("status") == "ok":
            personal = {"balances": mcp["balances"], "unit": mcp.get("unit"), "as_of": mcp.get("as_of"), "source": mcp.get("source")}
        final = {
            "request_id": state["request_id"],
            "status": status,
            "intent": intent,
            "route": state.get("route", "final"),
            "classifier": state.get("classifier_source"),
            "answer": answer,
            "citations": state.get("citations", []),
            "personal_data": personal,
            "tool_calls": state.get("tool_calls", []),
            "escalation": escalation,
            "notices": state.get("notices", []),
            "security": {
                "blocked": bool(state.get("block_category")),
                "category": state.get("block_category"),
                "flags": state.get("security_flags", []),
                "output_flags": state.get("output_flags", []),
            },
            "retrieval_query": state.get("retrieval_query"),
            "timings": state.get("timings", {}),
        }
        return {"final": final, "_detail": status}

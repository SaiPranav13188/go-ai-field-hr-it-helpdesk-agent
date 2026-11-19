"""Deterministic prompt-injection / abuse detection.

This is ONE layer of defence, deliberately not the only one (spec §8.1):
  1. these deterministic patterns (fast, explainable, cannot be talked out of),
  2. the LLM intent classifier (catches paraphrases the patterns miss),
  3. server-side authorization in the MCP server + Postgres RLS (holds even if 1 and 2 fail),
  4. output validation (citations, numbers, secrets, canary token).

Quoted content: when a user pastes a suspicious e-mail and asks "is this phishing?", the
injection text lives *inside the quote* and is data to analyse, not an instruction. Patterns
matched only inside quoted segments are downgraded to `quoted_untrusted_content`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

BLOCKING = {"instruction_override", "secret_extraction", "bulk_personal_data", "sql_injection", "role_escalation"}


@dataclass(frozen=True)
class SecurityFlag:
    category: str
    rule: str
    blocking: bool


_I = re.IGNORECASE
_RULES: list[tuple[str, str, re.Pattern]] = [
    # --- attempts to override the agent's rules -------------------------------------------
    ("instruction_override", "ignore_previous", re.compile(r"\b(ignore|disregard|forget|override|bypass)\b\s+((all|any|the|your|my|of|these|those|every|everything|above|that)\s+)*((previous|prior|above|earlier|preceding|original|initial|system|developer|existing|safety|security|hidden|current)\s+)*(instructions?|rules|guardrails|directives|guidelines|programming|restrictions|system prompt|prompts? above)\b", _I)),
    ("instruction_override", "persona_switch", re.compile(r"\b(you are now|from now on,? you|act as|pretend (to be|you are)|roleplay as|switch to)\b[\w\s-]{0,30}\b(unrestricted|unfiltered|jailbroken|dan|developer mode|god mode|admin|root|no (rules|limits|restrictions))\b", _I)),
    ("instruction_override", "jailbreak_keyword", re.compile(r"\b(jailbreak|dan mode|developer mode enabled|do anything now)\b", _I)),
    ("instruction_override", "fake_system_turn", re.compile(r"(^|\n)\s*(system|developer|assistant)\s*:|<\s*/?\s*(system|instructions?)\s*>|\[\s*(system|inst)\s*\]", _I)),
    # --- extraction of prompts / secrets ------------------------------------------------------
    ("secret_extraction", "system_prompt", re.compile(r"\b(system|hidden|initial|original|developer|secret)\s+(prompt|instructions?|message)\b", _I)),
    ("secret_extraction", "credentials", re.compile(r"\b(database (password|credentials?|connection string|url)|db (password|credentials?)|connection strings?|env(ironment)? variables?|\.env file|credentials? (file|store))\b|\bwhat(?:'s| is| are)\s+(your|the (agent|bot|system|server|app|backend|database|helpdesk|gemini|openai|qdrant|supabase)'?s?)\s+(api[\s_-]?keys?|access[\s_-]?tokens?|secret[\s_-]?keys?|private keys?|passwords?)\b|\b(print|show|reveal|display|dump|output|leak|expose|tell me|give me|send me|list)\b[\w\s,'-]{0,30}\b(api[\s_-]?keys?|access[\s_-]?tokens?|secret[\s_-]?keys?|bearer tokens?|private keys?|passwords? (of|for) (the )?(server|database|system|admin|backend))\b", _I)),
    ("secret_extraction", "reveal_your_config", re.compile(r"\b(print|show|reveal|display|dump|output|repeat|leak|expose|tell me|give me|what (is|are))\b[\w\s,'-]{0,30}\b(your|the agent'?s?|the bot'?s?)\s+(prompt|instructions|rules|config(uration)?|password|keys?|secrets?|tokens?)\b", _I)),
    # --- bulk / other people's personal data ---------------------------------------------------
    ("bulk_personal_data", "all_employees", re.compile(r"(\b(show|list|give|tell|display|reveal|dump|export|send|print|fetch|get|share|provide|compile|what(?:'s| is| are))\b[\w\s'-]{0,15}\b(every|all|each|other|the other|entire|whole)\b[\w\s'-]{0,20}\b(employees?|staff|users?|people|colleagues?|team ?members?|workforce)'?s?\b|\b(every|all|each|other)\s+(employee|staff|user|colleague|person|team member)'s\b|\b(all|other)\s+(employees|users|colleagues)'|\b(everyone|everybody)'s\b)[\w\s,'-]{0,50}\b(leave|balances?|e-?mails?|addresses|departments?|salar(y|ies)|phones?|records?|data|details|information|ids?)\b", _I)),
    ("bulk_personal_data", "all_records_reverse", re.compile(r"\b(leave balances?|e-?mail addresses|e-?mails|phone numbers|salar(y|ies)|personal (data|details)|records?|employee ids?)\b[\w\s,'-]{0,30}\b(of|for)\s+(every|all|each|other)\s+(employees?|staff|users?|people|colleagues?)\b", _I)),
    ("bulk_personal_data", "dump_table", re.compile(r"\b(dump|export|list|download|extract|show)\b[\w\s-]{0,20}\b(employee|staff|user|hr|leave)\s+(database|table|records|list|directory|data)\b", _I)),
    # --- SQL / tool abuse ----------------------------------------------------------------------
    ("sql_injection", "sql", re.compile(r"(\bunion\s+select\b|\bselect\s+\*\s+from\b|\bdrop\s+table\b|\binsert\s+into\b|\bdelete\s+from\b|\bupdate\s+\w+\s+set\b|;\s*--|'\s*or\s+'?1'?\s*=\s*'?1|\bpg_sleep\b|\binformation_schema\b)", _I)),
    # --- claims of elevated identity inside chat (identity only comes from the session) -------
    ("role_escalation", "claimed_role", re.compile(r"\b(i am|i'm|as)\s+(an?\s+)?(hr\s*(admin|manager|administrator)|administrator|admin|superuser|root|system owner)\b[\w\s,]{0,40}\b(show|give|grant|access|reveal|list|override|bypass)\b", _I)),
    ("role_escalation", "grant_access", re.compile(r"\b(grant|give|elevate|escalate)\s+(me\s+)?(admin|hr|root|elevated|full)\s+(access|privileges?|role|permissions?)\b", _I)),
]

_QUOTE_RE = re.compile(r'"[^"]{12,}"|“[^”]{12,}”|```.+?```|(^|\n)>[^\n]*', re.S)
_ANALYSE_RE = re.compile(r"\b(phishing|phish|suspicious|scam|spam|legit(imate)?|genuine|safe to (open|click)|analy[sz]e|is this (email|message|mail|link)|should i (open|click|reply|trust))\b", _I)
_ZERO_WIDTH = re.compile(r"[​-‏⁠-⁤﻿]")


def strip_invisible(text: str) -> tuple[str, bool]:
    cleaned = _ZERO_WIDTH.sub("", text)
    return cleaned, cleaned != text


def scan(text: str) -> list[SecurityFlag]:
    """Scan user-provided text. Returns de-duplicated flags."""
    quoted_spans = [m.span() for m in _QUOTE_RE.finditer(text)]
    asks_for_analysis = bool(_ANALYSE_RE.search(_remove_spans(text, quoted_spans)))
    flags: dict[tuple[str, str], SecurityFlag] = {}
    for category, rule, pattern in _RULES:
        for m in pattern.finditer(text):
            inside_quote = any(a <= m.start() and m.end() <= b for a, b in quoted_spans)
            if inside_quote and asks_for_analysis:
                flags[("quoted_untrusted_content", rule)] = SecurityFlag("quoted_untrusted_content", rule, blocking=False)
            else:
                flags[(category, rule)] = SecurityFlag(category, rule, blocking=category in BLOCKING)
            break
    return list(flags.values())


def scan_retrieved_text(text: str) -> list[SecurityFlag]:
    """Indirect injection: instructions embedded in retrieved documents. Never blocking —
    the passage is still usable as evidence — but it is flagged and fenced as untrusted."""
    out = []
    for category, rule, pattern in _RULES:
        if category in {"instruction_override", "secret_extraction"} and pattern.search(text):
            out.append(SecurityFlag("indirect_injection", rule, blocking=False))
    return out


def _remove_spans(text: str, spans: list[tuple[int, int]]) -> str:
    out, last = [], 0
    for a, b in sorted(spans):
        out.append(text[last:a])
        last = b
    out.append(text[last:])
    return " ".join(out)

"""Deterministic scope / intent heuristics.

Primary intent classification is done by the LLM classifier (structured output). This module
is the fallback when the generation provider is unavailable or rate-limited, and a
cross-check: a hard out-of-scope signal here wins only when no HR/IT signal is present.
"""

from __future__ import annotations

import re

_I = re.IGNORECASE

HR_IT_TERMS = re.compile(
    r"\b(leave|leaves|holiday|vacation|time off|sick|casual|earned|half[- ]day|attendance|working hours|shift|remote|hybrid|wfh|"
    r"work from home|reimburse\w*|expense\w*|claim\w*|receipt|internet|mobile data|travel|equipment|benefit\w*|insurance|health|"
    r"medical|dependent|enrol\w*|payroll|salary|compensation|probation|performance|handbook|policy|policies|conduct|harass\w*|"
    r"discriminat\w*|hr|human resources|manager|approval|approve\w*|onboarding|"
    r"it|vpn|wi-?fi|wifi|network|internet|password|mfa|2fa|multi-factor|authenticat\w*|login|log in|account|locked|lockout|"
    r"laptop|device|computer|phone|software|install\w*|licen[cs]e\w*|update|antivirus|endpoint|malware|virus|phishing|"
    r"suspicious|email|e-mail|security|data|confidential|breach|lost|stolen|ticket|helpdesk|help desk|portal|screen|printer|"
    r"slow|crash\w*|error|outlook|teams|zoom|storage|drive|backup)\b",
    _I,
)

OUT_OF_SCOPE = re.compile(
    r"\b(cricket|football|soccer|ipl|nba|fifa|match score|scores?|tournament|movie|film|netflix|song|music|celebrity|recipe|cook\w*|"
    r"weather|forecast|stock|share price|crypto|bitcoin|horoscope|astrology|joke|poem|story|riddle|election|vote|politic\w*|"
    r"prime minister|president|religion|dating|girlfriend|boyfriend|game|gaming|translate|homework|essay|capital of|"
    r"write (me )?(a |some )?(code|python|javascript|sql|function|script|program))\b",
    _I,
)

GREETING = re.compile(r"^\s*(hi|hello|hey|hiya|good (morning|afternoon|evening)|namaste|thanks|thank you|ok|okay|cool)\b[\s!.?]*$", _I)
CAPABILITIES = re.compile(r"\b(what can you (do|help)|how can you help|who are you|what are you|help me with what)\b", _I)

PERSONAL_BALANCE = re.compile(
    r"\b(my|i)\b[\w\s']{0,40}\b(leave balance|balance|leaves? (left|remaining|available|pending)|left|remaining|have (left|remaining)|"
    r"how many [\w\s-]{0,20}(leave|days)[\w\s]{0,20}(do i|have i|i have|left))\b|\bmy (earned|casual|sick)?\s*leave balance\b",
    _I,
)
STATUS = re.compile(r"\b(is|was|has)\b[\w\s']{0,30}\b(approved|rejected|pending|accepted|status)\b|\bstatus of my\b", _I)
ACTION = re.compile(r"\b(apply|book|submit|cancel|approve|raise|create|open|log|file|reset|unlock)\b[\w\s']{0,25}\b(leave|ticket|request|claim|password|account)\b\s*(for me)?", _I)
INCIDENT = re.compile(r"\b(lost|stolen|missing) (my )?(laptop|phone|device|badge|computer)|\b(malware|virus|ransomware|hacked|compromised|breach|clicked (a|on) (phishing|suspicious))\b", _I)
SENSITIVE_HR = re.compile(r"\b(harass\w*|discriminat\w*|bully\w*|hostile|retaliat\w*|abuse\w*|unsafe at work|assault\w*)\b", _I)
EMPLOYEE_ID = re.compile(r"\bE\d{3,6}\b")
LEAVE_TYPES = {"earned": re.compile(r"\bearned\b|\bannual\b|\bpaid\b|\bel\b", _I), "casual": re.compile(r"\bcasual\b|\bcl\b", _I), "sick": re.compile(r"\bsick\b|\bill(ness)?\b|\bsl\b|\bunwell\b", _I)}


def heuristic_classify(message: str, own_employee_id: str | None = None) -> dict:
    """Return a dict compatible with the LLM classifier's schema."""
    text = message.strip()
    leave_types = [k for k, rx in LEAVE_TYPES.items() if rx.search(text)]
    other_ids = [e for e in EMPLOYEE_ID.findall(text) if e != own_employee_id]
    hr_it = bool(HR_IT_TERMS.search(text))

    if GREETING.match(text):
        intent = "greeting"
    elif CAPABILITIES.search(text):
        intent = "capabilities"
    elif other_ids:
        intent = "other_employee_data"
    elif OUT_OF_SCOPE.search(text) and not hr_it:
        intent = "out_of_scope"
    elif SENSITIVE_HR.search(text):
        intent = "sensitive_hr"
    elif INCIDENT.search(text):
        intent = "security_incident"
    elif STATUS.search(text) and re.search(r"\b(leave|request|claim|reimbursement)\b", text, _I):
        intent = "leave_request_status"
    elif PERSONAL_BALANCE.search(text) and re.search(r"\bleaves?|days?|balance\b", text, _I):
        intent = "personal_leave_balance"
    elif ACTION.search(text):
        intent = "action_request"
    elif hr_it:
        intent = "policy_question"
    else:
        intent = "out_of_scope"

    return {
        "intent": intent,
        "leave_types": leave_types,
        "target_employee_id": other_ids[0] if other_ids else None,
        "also_needs_policy": False,
        "standalone_query": text,
        "reason": "heuristic classifier",
    }

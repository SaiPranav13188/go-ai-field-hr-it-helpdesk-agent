"""Output guard (spec §8.4): runs on every drafted answer before it reaches the user.

Checks:
  * citation integrity — every [S#] marker must map to a passage actually supplied to the
    model; unknown markers are removed, and a policy answer left with no valid citation is
    replaced by an abstention;
  * numeric grounding — every number in the answer must appear in the evidence or the
    authorised MCP result (catches invented limits, dates, balances, amounts);
  * unconfirmed actions — the agent cannot approve leave or create tickets, so claims that it
    did are blocked;
  * prompt/secret leakage — a canary token planted in the system prompt, plus secret
    patterns, must never appear in output;
  * PII redaction.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.security.pii import contains_secret, redact

CITATION_RE = re.compile(r"\[S(\d{1,2})\]")
_LIST_MARKER_RE = re.compile(r"(?m)^\s*\d+[.)]\s")
_NUMBER_RE = re.compile(r"(?<![A-Za-z\-])\d+(?:[.,]\d+)*(?!\w*-\d)")
_ACTION_CLAIM_RE = re.compile(
    r"\b(i('ve| have)|we('ve| have)|has been|have been|is now|was)\s+(successfully\s+)?"
    r"(approved|created|raised|submitted|filed|logged|opened|escalated|reset|sent|notified|processed|booked)\b"
    r"|\bticket (number|id|#)\s*[:#]?\s*\w*\d"
    r"|\byour (leave|request|claim) (is|has been) approved\b",
    re.IGNORECASE,
)
_NEGATION_RE = re.compile(r"\b(not|cannot|can't|unable|no|never|isn't|hasn't|haven't|won't|until)\b", re.IGNORECASE)


@dataclass
class OutputCheck:
    text: str
    valid_citations: list[int] = field(default_factory=list)
    removed_citations: list[str] = field(default_factory=list)
    unsupported_numbers: list[str] = field(default_factory=list)
    action_claims: list[str] = field(default_factory=list)
    redactions: dict[str, int] = field(default_factory=dict)
    secret_leak: bool = False

    @property
    def flags(self) -> list[str]:
        out = []
        if self.removed_citations:
            out.append("invalid_citation_removed")
        if self.unsupported_numbers:
            out.append("unsupported_number")
        if self.action_claims:
            out.append("unconfirmed_action_claim")
        if self.redactions:
            out.append("pii_redacted")
        if self.secret_leak:
            out.append("secret_leak_blocked")
        return out


def _norm_num(n: str) -> str:
    n = n.replace(",", "")
    return n.rstrip("0").rstrip(".") if "." in n else n


def numbers_in(text: str) -> set[str]:
    return {_norm_num(n) for n in _NUMBER_RE.findall(text)}


def normalise_lists(text: str) -> str:
    """Models sometimes write "steps: 1. a 2. b 3. c" on one line — split into a real markdown list."""
    if re.search(r"(?m)^\s*\d+\.\s", text):
        return text
    if len(re.findall(r"(?:^|[\s:])(\d{1,2})\.\s+[A-Z]", text)) >= 2:
        text = re.sub(r"(?<=[.:\]])\s+(\d{1,2})\.\s+(?=[A-Z])", r"\n\1. ", text)
        text = re.sub(r"(?m)^(\d{1,2}\. .*?\.(?:\s*\[S\d+\])*)\s+(?=[A-Z][a-z])(?!\d)", r"\1\n\n", text)
        text = re.sub(r":\n1\. ", ":\n\n1. ", text)
    return text


def validate_output(
    answer: str,
    *,
    n_sources: int,
    grounding_text: str,
    canary: str,
    require_citation: bool,
    allow_pii: set[str] | None = None,
) -> OutputCheck:
    answer = normalise_lists(answer)
    check = OutputCheck(text=answer)

    # 1. secrets / prompt leakage
    if canary and canary in answer:
        check.secret_leak = True
    if contains_secret(answer) - contains_secret(grounding_text):
        check.secret_leak = True

    # 2. citation integrity
    def _cite(m: re.Match) -> str:
        idx = int(m.group(1))
        if 1 <= idx <= n_sources:
            if idx not in check.valid_citations:
                check.valid_citations.append(idx)
            return m.group(0)
        check.removed_citations.append(m.group(0))
        return ""

    text = CITATION_RE.sub(_cite, answer)

    # 3. PII redaction (before numeric checks, so phone/ID digits are not mistaken for facts)
    text, counts = redact(text, allow=allow_pii)
    check.redactions = dict(counts)

    # 4. numeric grounding (ignore list markers and citation markers)
    body = _LIST_MARKER_RE.sub(" ", CITATION_RE.sub(" ", re.sub(r"\[REDACTED:[A-Z_]+\]", " ", text)))
    allowed = numbers_in(grounding_text)
    check.unsupported_numbers = sorted(n for n in numbers_in(body) if n not in allowed)

    # 5. claims of actions that never happened
    for m in _ACTION_CLAIM_RE.finditer(text):
        window = text[max(0, m.start() - 40) : m.start()]
        if not _NEGATION_RE.search(window) and not _NEGATION_RE.search(m.group(0)):
            check.action_claims.append(m.group(0))

    check.text = re.sub(r"[ \t]+([.,;:])", r"\1", text).strip()

    if require_citation and not check.valid_citations:
        check.removed_citations.append("<none-valid>")
    return check

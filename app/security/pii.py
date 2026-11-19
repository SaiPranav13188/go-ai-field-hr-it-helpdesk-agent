"""PII and secret detection / redaction for user-visible output, model input and logs.

Patterns are tuned to avoid destroying legitimate policy content: policy IDs (HR-POL-001),
amounts (INR 1,000), section numbers (3.28) and synthetic employee IDs (E102) are untouched.
"""

from __future__ import annotations

import re
from collections import Counter

_I = re.IGNORECASE

# Order matters: secrets first (most specific), then identifiers, then contact details.
_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("PRIVATE_KEY", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----")),
    ("CONNECTION_STRING", re.compile(r"\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp)://[^\s'\"]+", _I)),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")),
    ("API_KEY", re.compile(r"\b(sk-(ant-|proj-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|hf_[A-Za-z0-9]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|sb_secret_[A-Za-z0-9_-]{20,})\b")),
    ("PASSWORD", re.compile(r"(?<=\b)(pass(word|wd|code)?|pwd)\s*(is|:|=|-)\s*\S+", _I)),
    ("OTP", re.compile(r"\b(otp|one[- ]time (pass)?code|mfa code|2fa code|verification code|auth(entication)? code)\s*(is|:|=)?\s*\d{4,8}\b", _I)),
    ("CARD_NUMBER", re.compile(r"\b\d(?:[ -]?\d){12,18}\b")),
    ("AADHAAR", re.compile(r"\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b")),
    ("PAN", re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")),
    ("IFSC", re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b")),
    ("EMAIL", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")),
    ("PHONE", re.compile(r"(?<![\w.,/-])\+?\(?\d(?:[\s()-]{0,2}\d){9,12}(?![\w,/-]|\.\d)")),
]


def _luhn_ok(digits: str) -> bool:
    nums = [int(c) for c in digits][::-1]
    total = sum(n if i % 2 == 0 else (n * 2 - 9 if n * 2 > 9 else n * 2) for i, n in enumerate(nums))
    return total % 10 == 0


def _is_real_match(kind: str, value: str) -> bool:
    digits = re.sub(r"\D", "", value)
    if kind == "CARD_NUMBER":
        return 13 <= len(digits) <= 19 and _luhn_ok(digits)
    if kind == "PHONE":
        return 10 <= len(digits) <= 13
    return True


def find_pii(text: str) -> Counter:
    found: Counter = Counter()
    for kind, pat in _PATTERNS:
        for m in pat.finditer(text):
            if _is_real_match(kind, m.group(0)):
                found[kind] += 1
    return found


def redact(text: str, allow: set[str] | None = None) -> tuple[str, Counter]:
    """Replace sensitive spans with [REDACTED:<TYPE>]. `allow` lists exact strings that are
    authorised for this response (e.g. data the signed-in user is entitled to see)."""
    allow = allow or set()
    counts: Counter = Counter()

    for kind, pat in _PATTERNS:
        def _sub(m: re.Match, kind=kind) -> str:
            value = m.group(0)
            if value in allow or not _is_real_match(kind, value) or "[REDACTED" in value:
                return value
            counts[kind] += 1
            return f"[REDACTED:{kind}]"

        text = pat.sub(_sub, text)
    return text, counts


SECRET_KINDS = {"PRIVATE_KEY", "CONNECTION_STRING", "JWT", "API_KEY", "PASSWORD", "OTP"}


def contains_secret(text: str) -> set[str]:
    return {k for k in find_pii(text) if k in SECRET_KINDS}

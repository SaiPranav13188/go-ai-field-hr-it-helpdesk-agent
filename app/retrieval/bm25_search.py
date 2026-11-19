"""BM25 lexical retrieval stored in Qdrant as sparse vectors.

How BM25 maps onto Qdrant:
    score(q, d) = Σ_t∈q  IDF(t) · tf(t,d)·(k1+1) / (tf(t,d) + k1·(1 − b + b·|d|/avgdl))

* The document-side term weight (the TF-saturation fraction) is computed here at ingestion
  time and stored as the sparse vector value.
* IDF is computed server-side by Qdrant (`modifier=IDF` on the sparse vector config), using
  the BM25 IDF formula ln(1 + (N − n + 0.5)/(n + 0.5)), so it stays correct as the corpus grows.
* The query vector is the set of query term IDs with weight 1 (dot product ⇒ Σ IDF·TF part).

The tokenizer is designed for policy text: it keeps identifiers such as `HR-POL-001`,
`VPN-809`, `Wi-Fi` or `3.28` as whole tokens (and also emits their parts), lower-cases,
removes stop-words and applies Snowball stemming so "claims"/"claim" match.
"""

from __future__ import annotations

import re
import zlib
from collections import Counter

import snowballstemmer

K1 = 1.2
B = 0.75

_stemmer = snowballstemmer.stemmer("english")
_TOKEN_RE = re.compile(r"[a-z0-9]+(?:[-_.][a-z0-9]+)*")
_STOPWORDS = frozenset(
    """a about above after again against all am an and any are as at be because been before being below
    between both but by can could did do does doing down during each few for from further had has have
    having he her here hers herself him himself his how i if in into is it its itself just me more most
    my myself no nor not now of off on once only or other our ours ourselves out over own same she should
    so some such than that the their theirs them themselves then there these they this those through to
    too under until up very was we were what when where which while who whom why will with would you your
    yours yourself yourselves i'm i've what's please tell know""".split()
)


def _norm(token: str) -> str:
    return _stemmer.stemWord(token) if token.isalpha() else token


def tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for raw in _TOKEN_RE.findall(text.lower()):
        raw = raw.strip("._-")
        if not raw:
            continue
        compound = any(sep in raw for sep in "-_.")
        if compound:
            tokens.append(raw)  # exact identifier, e.g. "hr-pol-001", "vpn-809", "3.28"
            parts = [p for p in re.split(r"[-_.]", raw) if p]
            tokens.extend(_norm(p) for p in parts if p not in _STOPWORDS and (len(p) > 1 or p.isdigit()))
        elif raw not in _STOPWORDS:
            tokens.append(_norm(raw))
    return tokens


def term_id(token: str) -> int:
    """Stable 32-bit term id (crc32) — deterministic across processes and machines."""
    return zlib.crc32(token.encode("utf-8"))


def document_sparse_vector(text: str, avgdl: float) -> tuple[list[int], list[float]]:
    tokens = tokenize(text)
    dl = len(tokens) or 1
    counts = Counter(tokens)
    weights: dict[int, float] = {}
    for tok, tf in counts.items():
        tid = term_id(tok)
        w = tf * (K1 + 1) / (tf + K1 * (1 - B + B * dl / avgdl))
        weights[tid] = weights.get(tid, 0.0) + w
    ids = sorted(weights)
    return ids, [weights[i] for i in ids]


def query_sparse_vector(text: str) -> tuple[list[int], list[float]]:
    ids = sorted({term_id(t) for t in tokenize(text)})
    return ids, [1.0] * len(ids)


def average_doc_length(texts: list[str]) -> float:
    lengths = [len(tokenize(t)) for t in texts]
    return (sum(lengths) / len(lengths)) if lengths else 1.0

"""Reciprocal Rank Fusion (Cormack et al., 2009).

RRF(d) = Σ_r 1 / (k + rank_r(d))   with 1-based ranks.

It fuses *ranks*, not raw scores, so cosine similarities and BM25 scores (incompatible
scales) never need to be compared directly.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class FusedHit:
    chunk_id: str
    rrf_score: float
    ranks: dict[str, int] = field(default_factory=dict)  # channel -> 1-based rank
    raw_scores: dict[str, float] = field(default_factory=dict)  # channel -> native score


def reciprocal_rank_fusion(
    ranked_lists: dict[str, list[tuple[str, float]]],
    k: int = 60,
    limit: int | None = None,
) -> list[FusedHit]:
    """ranked_lists: channel name -> [(chunk_id, native_score), ...] best first."""
    fused: dict[str, FusedHit] = {}
    for channel, hits in ranked_lists.items():
        seen: set[str] = set()
        rank = 0
        for chunk_id, score in hits:
            if chunk_id in seen:
                continue
            seen.add(chunk_id)
            rank += 1
            hit = fused.setdefault(chunk_id, FusedHit(chunk_id=chunk_id, rrf_score=0.0))
            hit.rrf_score += 1.0 / (k + rank)
            hit.ranks[channel] = rank
            hit.raw_scores[channel] = float(score)
    ordered = sorted(fused.values(), key=lambda h: (-h.rrf_score, min(h.ranks.values()), h.chunk_id))
    return ordered[:limit] if limit else ordered

"""Retrieval evaluation (spec §6.5) — every number in the report is measured by this script.

    uv run python -m evaluation.run_retrieval_eval

Baselines: BM25 only · BGE-M3 dense only · dense+BM25 with RRF · RRF + BGE reranker.
Metrics (primary = grade-2 labels):
  Recall@5  fraction of primary-relevant chunks retrieved in the top 5 (mean over queries)
  MRR@10    reciprocal rank of the first primary-relevant chunk within the top 10
  nDCG@10   graded (gain = 2^rel − 1) over all labelled chunks
Also: latency per stage, reranker gain, and evidence-gate threshold calibration on negatives.
"""

from __future__ import annotations

import asyncio
import json
import math
import statistics
import time
from collections import defaultdict

from app.config import EVALUATION_DIR, get_settings
from app.retrieval.bge_embeddings import build_embedder
from app.retrieval.hybrid_search import HybridRetriever
from app.retrieval.reranker import build_reranker
from app.retrieval.vector_store import async_client

MODES = ["bm25", "dense", "hybrid", "hybrid_rerank"]
LABEL = {"bm25": "BM25 only", "dense": "BGE-M3 dense only", "hybrid": "Dense + BM25 (RRF)", "hybrid_rerank": "RRF + BGE reranker v2 m3"}


def recall_at(ranked: list[str], rel: dict[str, int], k: int) -> float:
    primary = [c for c, g in rel.items() if g == 2]
    return sum(1 for c in primary if c in ranked[:k]) / len(primary)


def mrr_at(ranked: list[str], rel: dict[str, int], k: int) -> float:
    for i, c in enumerate(ranked[:k], 1):
        if rel.get(c) == 2:
            return 1 / i
    return 0.0


def ndcg_at(ranked: list[str], rel: dict[str, int], k: int) -> float:
    dcg = sum((2 ** rel.get(c, 0) - 1) / math.log2(i + 1) for i, c in enumerate(ranked[:k], 1))
    ideal = sorted(rel.values(), reverse=True)[:k]
    idcg = sum((2**g - 1) / math.log2(i + 1) for i, g in enumerate(ideal, 1))
    return dcg / idcg if idcg else 0.0


def pct(xs: list[float], p: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


async def main() -> None:
    s = get_settings()
    data = json.loads((EVALUATION_DIR / "retrieval_queries.json").read_text())
    r = HybridRetriever(s, async_client(s), build_embedder(s), build_reranker(s))
    await r.load()
    # warm-up so model-loading time is not counted as query latency
    await r.retrieve("warm up query", mode="hybrid_rerank")

    per_mode: dict[str, list[dict]] = {m: [] for m in MODES}
    stage_lat: dict[str, list[float]] = defaultdict(list)
    for q in data["queries"]:
        for mode in MODES:
            t = time.perf_counter()
            res = await r.retrieve(q["query"], mode=mode)
            ms = (time.perf_counter() - t) * 1000
            ranked = [c.chunk_id for c in res.ranked]
            per_mode[mode].append({
                "id": q["id"], "type": q["type"], "recall5": recall_at(ranked, q["relevant"], 5), "mrr10": mrr_at(ranked, q["relevant"], 10),
                "ndcg10": ndcg_at(ranked, q["relevant"], 10), "ms": ms, "top1": ranked[0] if ranked else None,
                "top_score": res.top_score if mode == "hybrid_rerank" else None,
                "primary_rank": next((i for i, c in enumerate(ranked, 1) if q["relevant"].get(c) == 2), None),
            })
            if mode == "hybrid_rerank":
                for k, v in res.timings_ms.items():
                    stage_lat[k].append(v)

    summary = {}
    for mode in MODES:
        rows = per_mode[mode]
        summary[mode] = {
            "label": LABEL[mode],
            "recall_at_5": round(statistics.mean(x["recall5"] for x in rows), 4),
            "mrr_at_10": round(statistics.mean(x["mrr10"] for x in rows), 4),
            "ndcg_at_10": round(statistics.mean(x["ndcg10"] for x in rows), 4),
            "hit_at_1": round(statistics.mean(1.0 if x["primary_rank"] == 1 else 0.0 for x in rows), 4),
            "latency_p50_ms": round(pct([x["ms"] for x in rows], 50), 1),
            "latency_p95_ms": round(pct([x["ms"] for x in rows], 95), 1),
        }

    by_type: dict[str, dict[str, float]] = defaultdict(dict)
    types = sorted({q["type"] for q in data["queries"]})
    for mode in MODES:
        for t in types:
            rows = [x for x in per_mode[mode] if x["type"] == t]
            by_type[t][mode] = round(statistics.mean(x["mrr10"] for x in rows), 3)
    type_counts = {t: sum(1 for q in data["queries"] if q["type"] == t) for t in types}

    # Reranker effect on primary-relevant rank (RRF → RRF+rerank)
    improved = worsened = same = 0
    for a, b in zip(per_mode["hybrid"], per_mode["hybrid_rerank"]):
        ra, rb = a["primary_rank"] or 99, b["primary_rank"] or 99
        improved += rb < ra
        worsened += rb > ra
        same += rb == ra

    # Evidence-gate calibration on top reranker scores
    pos = [x["top_score"] for x in per_mode["hybrid_rerank"]]
    neg_scores, hard_scores, neg_gate = [], [], []
    for n in data["negatives"]:
        res = await r.retrieve(n["query"], mode="hybrid_rerank")
        neg_scores.append(res.top_score)
        neg_gate.append(r.select_evidence(res)[1])
    for n in data["hard_negatives"]:
        res = await r.retrieve(n["query"], mode="hybrid_rerank")
        hard_scores.append({"query": n["query"], "top_score": round(res.top_score, 5), "gate_passes": r.select_evidence(res)[1]})
    pos_gate = []
    for q in data["queries"]:
        res = await r.retrieve(q["query"], mode="hybrid_rerank")
        ev, ok = r.select_evidence(res)
        pos_gate.append({"id": q["id"], "pass": ok, "primary_in_evidence": any(q["relevant"].get(c.chunk_id) == 2 for c in ev)})
    sweep = []
    for th in [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2]:
        tpr = sum(p >= th for p in pos) / len(pos)
        tnr = sum(n < th for n in neg_scores) / len(neg_scores)
        sweep.append({"threshold": th, "answerable_pass_rate": round(tpr, 3), "negative_reject_rate": round(tnr, 3), "balanced_accuracy": round((tpr + tnr) / 2, 3)})
    best = max(sweep, key=lambda x: (x["balanced_accuracy"], x["threshold"]))
    # Choose the threshold at the midpoint (geometric) between the highest negative and lowest positive
    # when the classes separate; otherwise take the sweep optimum.
    max_neg, min_pos = max(neg_scores), min(pos)
    chosen = round(math.sqrt(max_neg * min_pos), 5) if min_pos > max_neg and max_neg > 0 else best["threshold"]

    failures = [
        {"id": x["id"], "query": next(q["query"] for q in data["queries"] if q["id"] == x["id"]), "primary_rank": x["primary_rank"], "top1": x["top1"]}
        for x in per_mode["hybrid_rerank"] if x["primary_rank"] != 1
    ]

    out = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "corpus": {"chunks": len(r.chunks), "documents": len({p["document_id"] for p in r.chunks.values()})},
        "n_queries": len(data["queries"]), "n_negatives": len(data["negatives"]),
        "models": {"embedder": r.embedder.name, "reranker": r.reranker.name},
        "settings": {"dense_candidates": s.dense_candidates, "bm25_candidates": s.bm25_candidates, "rrf_k": s.rrf_k, "fused_candidates": s.fused_candidates},
        "summary": summary,
        "mrr_by_query_type": by_type, "query_type_counts": type_counts,
        "reranker_effect": {"improved": improved, "worsened": worsened, "unchanged": same},
        "stage_latency_ms": {k: {"p50": round(pct(v, 50), 1), "p95": round(pct(v, 95), 1)} for k, v in stage_lat.items()},
        "calibration": {"positive_top_scores": {"min": round(min(pos), 5), "p10": round(pct(pos, 10), 5), "median": round(pct(pos, 50), 5)},
                        "negative_top_scores": {"max": round(max(neg_scores), 6), "median": round(pct(neg_scores, 50), 6)},
                        "sweep": sweep, "chosen_threshold": chosen, "hard_negatives": hard_scores,
                        "configured_gate": {"answer_threshold": s.rerank_answer_threshold,
                                            "answerable_pass_rate": round(sum(g["pass"] for g in pos_gate) / len(pos_gate), 3),
                                            "primary_in_evidence_rate": round(sum(g["primary_in_evidence"] for g in pos_gate) / len(pos_gate), 3),
                                            "negative_reject_rate": round(1 - sum(neg_gate) / len(neg_gate), 3),
                                            "answerable_rejected": [g["id"] for g in pos_gate if not g["pass"]]}},
        "failures": failures,
    }
    (EVALUATION_DIR / "retrieval_metrics.json").write_text(json.dumps(out, indent=2))
    (EVALUATION_DIR / "retrieval_metrics.md").write_text(render_md(out))
    print(render_md(out))
    await r.client.close()


def render_md(o: dict) -> str:
    L = ["# Retrieval evaluation (measured)", "",
         f"Generated {o['generated_at']} by `evaluation/run_retrieval_eval.py` — {o['n_queries']} labelled queries over "
         f"{o['corpus']['chunks']} chunks / {o['corpus']['documents']} documents, plus {o['n_negatives']} out-of-corpus negatives.",
         f"Models: `{o['models']['embedder']}`, `{o['models']['reranker']}`. Candidates: dense {o['settings']['dense_candidates']}, "
         f"BM25 {o['settings']['bm25_candidates']}, RRF k={o['settings']['rrf_k']}, fused {o['settings']['fused_candidates']}.", "",
         "| Configuration | Recall@5 | MRR@10 | nDCG@10 | Hit@1 | p50 ms | p95 ms |", "|---|---:|---:|---:|---:|---:|---:|"]
    for m in MODES:
        x = o["summary"][m]
        L.append(f"| {x['label']} | {x['recall_at_5']:.3f} | {x['mrr_at_10']:.3f} | {x['ndcg_at_10']:.3f} | {x['hit_at_1']:.3f} | {x['latency_p50_ms']} | {x['latency_p95_ms']} |")
    L += ["", "## MRR@10 by query type", "", "| Type (n) | BM25 | Dense | RRF | RRF + rerank |", "|---|---:|---:|---:|---:|"]
    for t, v in o["mrr_by_query_type"].items():
        L.append(f"| {t} ({o['query_type_counts'][t]}) | {v['bm25']:.3f} | {v['dense']:.3f} | {v['hybrid']:.3f} | {v['hybrid_rerank']:.3f} |")
    e = o["reranker_effect"]
    L += ["", f"**Reranker effect** (rank of the primary passage, RRF → RRF+rerank): improved {e['improved']}, worsened {e['worsened']}, unchanged {e['unchanged']}.", "",
          "## Stage latency (RRF + rerank, local models)", "", "| Stage | p50 ms | p95 ms |", "|---|---:|---:|"]
    for k, v in o["stage_latency_ms"].items():
        L.append(f"| {k} | {v['p50']} | {v['p95']} |")
    c = o["calibration"]
    L += ["", "## Evidence-gate calibration", "",
          f"Top reranker score — answerable queries: min {c['positive_top_scores']['min']}, p10 {c['positive_top_scores']['p10']}, median {c['positive_top_scores']['median']}; "
          f"out-of-corpus negatives: max {c['negative_top_scores']['max']}, median {c['negative_top_scores']['median']}.", "",
          "| Threshold | Answerable pass | Negative reject | Balanced acc. |", "|---:|---:|---:|---:|"]
    for x in c["sweep"]:
        L.append(f"| {x['threshold']} | {x['answerable_pass_rate']:.3f} | {x['negative_reject_rate']:.3f} | {x['balanced_accuracy']:.3f} |")
    L += ["", f"Chosen `RERANK_ANSWER_THRESHOLD` = **{c['chosen_threshold']}**. Passing the gate only means *some relevant evidence exists*; "
          "whether that evidence contains the specific fact is decided by the grounded generator (which must answer `partial`/`not_in_documents` "
          "otherwise) and enforced by the output guard.", ""]
    g = c["configured_gate"]
    L += [f"**Configured gate** (threshold {g['answer_threshold']} + dense/BM25 #1-agreement rule for weak evidence): "
          f"answerable queries pass {g['answerable_pass_rate']:.1%} (primary passage inside the evidence set {g['primary_in_evidence_rate']:.1%}); "
          f"out-of-corpus negatives rejected {g['negative_reject_rate']:.1%}. Answerable queries rejected: {', '.join(g['answerable_rejected']) or 'none'}.", "",
          "Hard negatives (on-topic, fact absent):", ""]
    for h in c["hard_negatives"]:
        L.append(f"- {h['query']} → top score {h['top_score']}, gate {'passes (generator must say the fact is not specified)' if h['gate_passes'] else 'rejects (abstain)'}")
    L += ["", "## Failure cases (primary passage not ranked #1 after reranking)", ""]
    L += [f"- `{f['id']}` “{f['query']}” → primary at rank {f['primary_rank']}, top-1 `{f['top1']}`" for f in o["failures"]] or ["- none"]
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    asyncio.run(main())

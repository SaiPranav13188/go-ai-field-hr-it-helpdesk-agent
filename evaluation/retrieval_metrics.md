# Retrieval evaluation (measured)

Generated 2026-11-19 12:48:36 by `evaluation/run_retrieval_eval.py` — 48 labelled queries over 35 chunks / 6 documents, plus 12 out-of-corpus negatives.
Models: `local:BAAI/bge-m3`, `local:BAAI/bge-reranker-v2-m3`. Candidates: dense 20, BM25 20, RRF k=60, fused 25.

| Configuration | Recall@5 | MRR@10 | nDCG@10 | Hit@1 | p50 ms | p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| BM25 only | 0.875 | 0.792 | 0.813 | 0.729 | 0.4 | 0.5 |
| BGE-M3 dense only | 1.000 | 0.925 | 0.939 | 0.875 | 21.8 | 24.9 |
| Dense + BM25 (RRF) | 0.979 | 0.896 | 0.918 | 0.833 | 21.6 | 22.4 |
| RRF + BGE reranker v2 m3 | 1.000 | 0.929 | 0.947 | 0.875 | 681.5 | 748.6 |

## MRR@10 by query type

| Type (n) | BM25 | Dense | RRF | RRF + rerank |
|---|---:|---:|---:|---:|
| acronym (1) | 0.500 | 0.500 | 0.500 | 0.500 |
| assignment (5) | 0.840 | 0.867 | 0.867 | 0.900 |
| identifier (2) | 0.667 | 1.000 | 0.750 | 1.000 |
| keyword (4) | 1.000 | 1.000 | 1.000 | 1.000 |
| multilingual (1) | 0.000 | 1.000 | 1.000 | 1.000 |
| paraphrase (12) | 1.000 | 1.000 | 1.000 | 1.000 |
| semantic (23) | 0.695 | 0.895 | 0.855 | 0.895 |

**Reranker effect** (rank of the primary passage, RRF → RRF+rerank): improved 6, worsened 2, unchanged 40.

## Stage latency (RRF + rerank, local models)

| Stage | p50 ms | p95 ms |
|---|---:|---:|
| dense_ms | 21.4 | 22.0 |
| bm25_ms | 0.3 | 0.4 |
| first_stage_ms | 21.5 | 22.1 |
| rrf_ms | 0.0 | 0.0 |
| retrieval_total_ms | 681.4 | 748.5 |
| rerank_ms | 660.0 | 729.2 |

## Evidence-gate calibration

Top reranker score — answerable queries: min 9e-05, p10 0.00287, median 0.47529; out-of-corpus negatives: max 0.001237, median 9.6e-05.

| Threshold | Answerable pass | Negative reject | Balanced acc. |
|---:|---:|---:|---:|
| 0.0005 | 0.958 | 0.833 | 0.896 |
| 0.001 | 0.917 | 0.917 | 0.917 |
| 0.002 | 0.917 | 1.000 | 0.958 |
| 0.005 | 0.854 | 1.000 | 0.927 |
| 0.01 | 0.812 | 1.000 | 0.906 |
| 0.02 | 0.812 | 1.000 | 0.906 |
| 0.05 | 0.771 | 1.000 | 0.885 |
| 0.1 | 0.750 | 1.000 | 0.875 |
| 0.2 | 0.646 | 1.000 | 0.823 |

Chosen `RERANK_ANSWER_THRESHOLD` = **0.002**. Passing the gate only means *some relevant evidence exists*; whether that evidence contains the specific fact is decided by the grounded generator (which must answer `partial`/`not_in_documents` otherwise) and enforced by the output guard.

**Configured gate** (threshold 0.002 + dense/BM25 #1-agreement rule for weak evidence): answerable queries pass 95.8% (primary passage inside the evidence set 93.8%); out-of-corpus negatives rejected 100.0%. Answerable queries rejected: q12, q37.

Hard negatives (on-topic, fact absent):

- What is the maternity leave policy? → top score 0.00389, gate passes (generator must say the fact is not specified)
- Can I get reimbursed for a gym membership? → top score 0.00076, gate rejects (abstain)
- What is the dress code? → top score 0.00032, gate rejects (abstain)
- How many days of bereavement leave do I get? → top score 0.01868, gate passes (generator must say the fact is not specified)

## Failure cases (primary passage not ranked #1 after reranking)

- `q08` “I submitted leave for next Monday. Is it approved?” → primary at rank 2, top-1 `HR-POL-001-003`
- `q17` “Can I buy a monitor and get reimbursed?” → primary at rank 4, top-1 `HR-POL-003-006`
- `q31` “I forgot my password and I'm locked out” → primary at rank 2, top-1 `IT-GUIDE-005-001`
- `q36` “Can I share my OTP with a colleague?” → primary at rank 3, top-1 `HR-GUIDE-002-006`
- `q37` “Is it okay to turn off antivirus to speed up my PC?” → primary at rank 2, top-1 `IT-GUIDE-005-005`
- `q43` “MFA” → primary at rank 2, top-1 `IT-POL-004-007`

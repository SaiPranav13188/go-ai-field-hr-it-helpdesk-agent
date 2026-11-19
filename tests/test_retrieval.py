from pathlib import Path

from app.config import DOCUMENTS_DIR
from app.retrieval.bm25_search import query_sparse_vector, tokenize
from app.retrieval.chunking import chunk_document, load_corpus, parse_document
from app.retrieval.fusion import reciprocal_rank_fusion
from app.retrieval.hybrid_search import Candidate, prepare_query

COUNT = lambda t: len(t.split())  # noqa: E731


def test_corpus_parses_with_metadata():
    docs = load_corpus(DOCUMENTS_DIR)
    assert {d.document_id for d in docs} == {"HR-POL-001", "HR-GUIDE-002", "HR-POL-003", "IT-POL-004", "IT-GUIDE-005", "HR-POL-006"}
    for d in docs:
        assert d.version == "1.0" and d.effective_date == "2026-01-01" and "Fictional" in d.status
    total_sections = sum(len(d.sections) for d in docs)
    assert total_sections == 35  # §3.1–§3.35


def test_chunks_are_deterministic_and_keep_tables_with_headings():
    doc = parse_document(DOCUMENTS_DIR / "HR-POL-001_leave_policy.md")
    a, b = chunk_document(doc, COUNT), chunk_document(doc, COUNT)
    assert [c.chunk_id for c in a] == [c.chunk_id for c in b]
    assert a[1].chunk_id == "HR-POL-001-002" and a[1].section == "3.2 Annual leave entitlements"
    assert "| Earned leave | 18 working days |" in a[1].text  # table kept with its heading
    assert a[1].index_text.startswith("Leave Policy (HR-POL-001) — Section 3.2")
    assert a[1].content_hash == b[1].content_hash


def test_long_section_split_with_overlap(tmp_path: Path):
    body = "\n\n".join(f"Paragraph {i} " + "word " * 40 for i in range(10))
    (tmp_path / "X.md").write_text(
        "# Long Doc\n\n- **Document ID:** X-1\n- **Owner:** T\n- **Version:** 1.0\n- **Effective date:** 2026-01-01\n- **Status:** test\n\n## 1.1 Big\n" + body)
    chunks = chunk_document(parse_document(tmp_path / "X.md"), COUNT, max_tokens=120, overlap_tokens=50)
    assert len(chunks) > 1
    assert all(c.token_count <= 170 for c in chunks)
    assert all(c.section == "1.1 Big" for c in chunks)
    # overlap: the last paragraph of a piece reappears at the start of the next
    assert chunks[0].text.split("\n\n")[-1] in chunks[1].text


def test_tokenizer_preserves_identifiers():
    toks = tokenize("Error VPN-809 under HR-POL-001 §3.28 on Wi-Fi with MFA")
    for t in ("vpn-809", "hr-pol-001", "3.28", "wi-fi", "mfa", "vpn"):
        assert t in toks
    assert query_sparse_vector("the a of")[0] == []  # stop-words only


def test_rrf_math_and_ordering():
    fused = reciprocal_rank_fusion({"dense": [("a", 0.9), ("b", 0.8)], "bm25": [("b", 12.0), ("c", 3.0)]}, k=60)
    assert [h.chunk_id for h in fused] == ["b", "a", "c"]
    assert abs(fused[0].rrf_score - (1 / 62 + 1 / 61)) < 1e-12
    assert fused[0].ranks == {"dense": 2, "bm25": 1}


def test_prepare_query_keeps_identifiers():
    q = prepare_query("Getting VPN-809 on IT-GUIDE-005", "how to fix vpn error")
    assert "VPN-809" in q and "IT-GUIDE-005" in q


def test_metadata_constraints_prefer_active_latest_version(retriever):
    def cand(cid, version, status="Fictional sample policy", eff="2026-01-01"):
        return Candidate(chunk_id=cid, payload={"document_id": "HR-POL-001", "version": version, "status": status, "effective_date": eff})

    kept, dropped = retriever.apply_metadata_constraints([
        cand("old", "1.0"), cand("new", "1.1"), cand("future", "1.1", eff="2999-01-01"), cand("sup", "1.1", status="Superseded")])
    assert [c.chunk_id for c in kept] == ["new"]
    assert set(dropped) == {"old", "future", "sup"}


async def test_bm25_exact_identifier_and_acronym(retriever):
    hits, _ = await retriever.bm25_search("VPN client", 5)
    assert hits[0][0] == "IT-GUIDE-005-002"
    hits, _ = await retriever.bm25_search("HR-POL-003 submission", 5)
    assert hits[0][0].startswith("HR-POL-003")


async def test_full_pipeline_returns_traceable_candidates(retriever):
    res = await retriever.retrieve("How many earned leave days annual allowance", mode="hybrid_rerank")
    top = res.ranked[0]
    assert top.chunk_id == "HR-POL-001-002"
    assert top.rrf_rank is not None and top.rerank_score is not None
    assert {"first_stage_ms", "rerank_ms", "retrieval_total_ms"} <= set(res.timings_ms)
    evidence, ok = retriever.select_evidence(res)
    assert ok and evidence[0].chunk_id == "HR-POL-001-002"


async def test_no_evidence_for_unrelated_query(retriever):
    res = await retriever.retrieve("zebra quantum saxophone", mode="hybrid_rerank")
    assert retriever.select_evidence(res) == ([], False)

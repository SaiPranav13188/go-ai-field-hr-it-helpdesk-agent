"""Policy-document parsing and section-aware chunking.

Strategy (spec §6.1/§6.2):
1. Parse title + metadata header (document ID, owner, version, effective date, status).
2. Split on meaningful sections (`## 3.x Heading`) BEFORE any token-based splitting, so a
   heading is never separated from the table/list that defines it.
3. Only if a section exceeds `max_tokens` is it split further on paragraph boundaries,
   with `overlap_tokens` of trailing context carried into the next piece.
4. Every chunk carries full citation metadata and a deterministic ID + content hash.

Each chunk also gets a short *contextual header* (document title, ID, section) that is
prepended to the text used for embedding/BM25 — sections in this corpus are short, and the
header stops small chunks from losing their meaning ("Up to 5 unused days" of *what*?).
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable

_META_RE = re.compile(r"^-\s+\*\*(?P<key>[^*]+):\*\*\s*(?P<value>.+?)\s*$")
_SECTION_RE = re.compile(r"^##\s+(?P<num>\d+(?:\.\d+)*)\s+(?P<title>.+?)\s*$")


@dataclass(frozen=True)
class PolicyDocument:
    document_id: str
    title: str
    owner: str
    version: str
    effective_date: str
    status: str
    source_file: str
    content_hash: str
    sections: list[tuple[str, str, str]]  # (section_number, section_title, body_markdown)
    raw_markdown: str = field(repr=False)


@dataclass(frozen=True)
class Chunk:
    chunk_id: str
    document_id: str
    document_title: str
    section: str
    section_number: str
    section_title: str
    owner: str
    version: str
    effective_date: str
    status: str
    source_file: str
    doc_content_hash: str
    chunk_index: int
    part: int
    total_parts: int
    token_count: int
    text: str  # original section text (displayed in citations)

    @property
    def context_header(self) -> str:
        return f"{self.document_title} ({self.document_id}) — Section {self.section}"

    @property
    def index_text(self) -> str:
        """Text used for dense embedding, BM25 and reranking."""
        return f"{self.context_header}\n{self.text}"

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(self.index_text.encode("utf-8")).hexdigest()

    def payload(self) -> dict:
        data = asdict(self)
        data["content_hash"] = self.content_hash
        data["index_text"] = self.index_text
        return data


def parse_document(path: Path) -> PolicyDocument:
    raw = path.read_text(encoding="utf-8")
    lines = raw.splitlines()
    title = ""
    meta: dict[str, str] = {}
    sections: list[tuple[str, str, list[str]]] = []

    for line in lines:
        if not title and line.startswith("# "):
            title = line[2:].strip()
            continue
        sec = _SECTION_RE.match(line)
        if sec:
            sections.append((sec["num"], sec["title"], []))
            continue
        if sections:
            sections[-1][2].append(line)
            continue
        m = _META_RE.match(line)
        if m:
            meta[m["key"].strip().lower()] = m["value"].strip()

    required = ["document id", "owner", "version", "effective date", "status"]
    missing = [k for k in required if k not in meta]
    if not title or missing or not sections:
        raise ValueError(f"{path.name}: malformed policy document (title={bool(title)}, missing={missing})")

    return PolicyDocument(
        document_id=meta["document id"],
        title=title,
        owner=meta["owner"],
        version=meta["version"],
        effective_date=meta["effective date"],
        status=meta["status"],
        source_file=path.name,
        content_hash=hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        sections=[(n, t, "\n".join(body).strip()) for n, t, body in sections],
        raw_markdown=raw,
    )


def load_corpus(directory: Path) -> list[PolicyDocument]:
    docs = [parse_document(p) for p in sorted(directory.glob("*.md"))]
    ids = [d.document_id for d in docs]
    if len(ids) != len(set(ids)):
        raise ValueError(f"Duplicate document IDs in corpus: {ids}")
    return docs


def _split_long_section(body: str, count_tokens: Callable[[str], int], max_tokens: int, overlap_tokens: int) -> list[str]:
    """Split on paragraph/list-item boundaries; never splits inside a markdown table."""
    blocks: list[str] = []
    current: list[str] = []
    in_table = False
    for line in body.splitlines():
        is_table = line.lstrip().startswith("|")
        if not line.strip() and not in_table:
            if current:
                blocks.append("\n".join(current))
                current = []
            continue
        if current and not is_table and not in_table and re.match(r"^\s*(\d+\.|-)\s", line):
            blocks.append("\n".join(current))
            current = []
        current.append(line)
        in_table = is_table
    if current:
        blocks.append("\n".join(current))

    pieces: list[str] = []
    buf: list[str] = []
    for block in blocks:
        candidate = "\n\n".join(buf + [block])
        if buf and count_tokens(candidate) > max_tokens:
            pieces.append("\n\n".join(buf))
            # carry trailing context forward as overlap
            tail: list[str] = []
            for prev in reversed(buf):
                if count_tokens("\n\n".join([prev] + tail)) > overlap_tokens:
                    break
                tail.insert(0, prev)
            buf = tail + [block]
        else:
            buf.append(block)
    if buf:
        pieces.append("\n\n".join(buf))
    return pieces


def chunk_document(
    doc: PolicyDocument,
    count_tokens: Callable[[str], int],
    max_tokens: int = 650,
    overlap_tokens: int = 80,
) -> list[Chunk]:
    chunks: list[Chunk] = []
    idx = 0
    for number, sec_title, body in doc.sections:
        if not body:
            continue
        parts = [body] if count_tokens(body) <= max_tokens else _split_long_section(body, count_tokens, max_tokens, overlap_tokens)
        for p_i, part in enumerate(parts, start=1):
            idx += 1
            chunks.append(
                Chunk(
                    chunk_id=f"{doc.document_id}-{idx:03d}",
                    document_id=doc.document_id,
                    document_title=doc.title,
                    section=f"{number} {sec_title}",
                    section_number=number,
                    section_title=sec_title,
                    owner=doc.owner,
                    version=doc.version,
                    effective_date=doc.effective_date,
                    status=doc.status,
                    source_file=doc.source_file,
                    doc_content_hash=doc.content_hash,
                    chunk_index=idx,
                    part=p_i,
                    total_parts=len(parts),
                    token_count=count_tokens(part),
                    text=part,
                )
            )
    return chunks


def whitespace_token_count(text: str) -> int:
    """Cheap fallback token estimate (used only when the BGE-M3 tokenizer is unavailable)."""
    return max(1, int(len(re.findall(r"\S+", text)) * 1.3))


def bge_token_counter(model_name: str) -> Callable[[str], int]:
    """Token counter using the actual BGE-M3 tokenizer (XLM-RoBERTa sentencepiece)."""
    try:
        from huggingface_hub import hf_hub_download
        from tokenizers import Tokenizer

        tok = Tokenizer.from_file(hf_hub_download(model_name, "tokenizer.json"))
        return lambda text: len(tok.encode(text, add_special_tokens=False).ids)
    except Exception:  # pragma: no cover - offline fallback
        return whitespace_token_count

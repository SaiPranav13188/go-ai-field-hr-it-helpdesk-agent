"use client";

import { MotionConfig, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import Backdrop from "@/components/fx/Backdrop";
import { EASE, Reveal, TextReveal, cn } from "@/components/fx/primitives";
import Logo from "@/components/Logo";
import { api } from "@/lib/api";

type Row = { label: string; recall_at_5: number; mrr_at_10: number; ndcg_at_10: number; hit_at_1: number; latency_p50_ms: number; latency_p95_ms: number };
type EvalData = {
  available: boolean;
  generated_at?: string;
  n_queries?: number;
  n_negatives?: number;
  models?: { embedder: string; reranker: string };
  summary?: Record<string, Row>;
  mrr_by_query_type?: Record<string, Record<string, number>>;
  query_type_counts?: Record<string, number>;
  reranker_effect?: { improved: number; worsened: number; unchanged: number };
  calibration?: { chosen_threshold: number; configured_gate?: { answerable_pass_rate: number; negative_reject_rate: number; primary_in_evidence_rate: number; answerable_rejected: string[] }; sweep: { threshold: number; answerable_pass_rate: number; negative_reject_rate: number; balanced_accuracy: number }[] };
};

/* ---------------- animated system diagram ---------------- */
type N = { id: string; x: number; y: number; w: number; label: string; sub: string; c: string };
const NODES: N[] = [
  { id: "ui", x: 30, y: 200, w: 150, label: "Next.js UI", sub: "Vercel · SSE", c: "#9aa1b7" },
  { id: "api", x: 230, y: 200, w: 150, label: "FastAPI", sub: "session · rate limit", c: "#9aa1b7" },
  { id: "graph", x: 430, y: 200, w: 160, label: "LangGraph", sub: "validate · guard · route", c: "#3ee6a8" },
  { id: "dense", x: 650, y: 70, w: 150, label: "BGE-M3 dense", sub: "1024-d cosine", c: "#8b7bff" },
  { id: "bm25", x: 650, y: 160, w: 150, label: "BM25 sparse", sub: "Qdrant IDF", c: "#38d6f5" },
  { id: "rrf", x: 860, y: 115, w: 130, label: "RRF", sub: "k = 60", c: "#7aa2ff" },
  { id: "rerank", x: 1040, y: 115, w: 160, label: "Reranker", sub: "bge-reranker-v2-m3", c: "#c08bff" },
  { id: "mcp", x: 650, y: 300, w: 150, label: "MCP server", sub: "stdio · 2 tools", c: "#3ee6a8" },
  { id: "pg", x: 860, y: 300, w: 150, label: "PostgreSQL", sub: "Supabase · RLS", c: "#38d6f5" },
  { id: "llm", x: 1040, y: 230, w: 160, label: "Gemini", sub: "evidence-only answer", c: "#ffffff" },
  { id: "guard", x: 1040, y: 340, w: 160, label: "Output guard", sub: "cite · numbers · PII", c: "#ffbe5c" },
];
const EDGES: [string, string][] = [["ui", "api"], ["api", "graph"], ["graph", "dense"], ["graph", "bm25"], ["dense", "rrf"], ["bm25", "rrf"], ["rrf", "rerank"], ["rerank", "llm"], ["graph", "mcp"], ["mcp", "pg"], ["llm", "guard"], ["pg", "guard"]];
const H = 44;

function edgePath(a: N, b: N) {
  const x1 = a.x + a.w, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
  if (b.x <= a.x) {
    const ax = a.x + a.w / 2, bx = b.x + b.w / 2;
    return `M ${ax} ${a.y + H} C ${ax} ${a.y + H + 30}, ${bx} ${b.y - 30}, ${bx} ${b.y}`;
  }
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

function Diagram() {
  const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
  return (
    <div className="overflow-x-auto rounded-3xl p-4 glass">
      <svg viewBox="0 0 1230 400" className="min-w-[900px]">
        <defs>
          <linearGradient id="edge" x1="0" x2="1">
            <stop offset="0" stopColor="#8b7bff" stopOpacity="0.15" />
            <stop offset="1" stopColor="#38d6f5" stopOpacity="0.5" />
          </linearGradient>
        </defs>
        {EDGES.map(([a, b], i) => {
          const d = edgePath(byId[a], byId[b]);
          return (
            <g key={`${a}-${b}`}>
              <motion.path d={d} stroke="url(#edge)" strokeWidth="1.5" fill="none" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.2, delay: 0.2 + i * 0.08, ease: EASE }} />
              <circle r="3" fill="#cfc8ff">
                <animateMotion dur={`${2.4 + (i % 4) * 0.5}s`} repeatCount="indefinite" path={d} begin={`${i * 0.3}s`} />
                <animate attributeName="opacity" values="0;1;1;0" dur={`${2.4 + (i % 4) * 0.5}s`} repeatCount="indefinite" begin={`${i * 0.3}s`} />
              </circle>
            </g>
          );
        })}
        {NODES.map((n, i) => (
          <motion.g key={n.id} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, delay: i * 0.06, ease: EASE }}>
            <rect x={n.x} y={n.y} width={n.w} height={H} rx="12" fill="rgba(14,17,30,0.92)" stroke={n.c} strokeOpacity="0.45" />
            <circle cx={n.x + 14} cy={n.y + H / 2} r="3.5" fill={n.c} />
            <text x={n.x + 26} y={n.y + 19} fill="#fff" fontSize="12.5" fontWeight="600" fontFamily="var(--font-geist-sans)">{n.label}</text>
            <text x={n.x + 26} y={n.y + 34} fill="#8c93a8" fontSize="10" fontFamily="var(--font-geist-mono)">{n.sub}</text>
          </motion.g>
        ))}
        <text x="650" y="30" fill="#646b82" fontSize="10.5" fontFamily="var(--font-geist-mono)" letterSpacing="2">POLICY LANE</text>
        <text x="650" y="380" fill="#646b82" fontSize="10.5" fontFamily="var(--font-geist-mono)" letterSpacing="2">PERSONAL-DATA LANE</text>
      </svg>
    </div>
  );
}

export default function ArchitecturePage() {
  const [data, setData] = useState<EvalData | null>(null);
  useEffect(() => {
    api.evaluation().then((d) => setData(d as EvalData)).catch(() => setData({ available: false }));
  }, []);
  const modes = ["bm25", "dense", "hybrid", "hybrid_rerank"];

  return (
    <MotionConfig reducedMotion="user">
      <Backdrop intensity={0.7} />
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-6">
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-fg-muted transition hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> Back to helpdesk
          </Link>
          <Logo />
        </div>

        <header className="mt-16 max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-violet">Architecture & evaluation</p>
          <h1 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">
            <TextReveal text="How the agent decides" />{" "}
            <span className="font-display font-normal italic"><TextReveal text="what to trust." delay={0.3} wordClassName="text-gradient pr-[0.06em]" /></span>
          </h1>
          <p className="mt-5 text-fg-muted">Two lanes, one explicit graph. Policy questions run through hybrid retrieval; personal questions go through an authorised MCP tool. The language model only writes the answer, from evidence it is given, and its output is checked before you see it.</p>
        </header>

        <Reveal className="mt-14"><Diagram /></Reveal>

        <section className="mt-20">
          <Reveal>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Measured retrieval quality</h2>
            <p className="mt-2 text-sm text-fg-muted">
              {data?.available
                ? <>Generated {data.generated_at} · {data.n_queries} labelled queries · {data.n_negatives} out-of-corpus negatives · {data.models?.embedder} · {data.models?.reranker}</>
                : "Run evaluation/run_retrieval_eval.py to generate metrics."}
            </p>
          </Reveal>
          {data?.summary && (
            <Reveal delay={0.1}>
              <div className="mt-6 overflow-x-auto rounded-2xl glass">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.07] text-left text-[11px] uppercase tracking-[0.12em] text-fg-subtle">
                      <th className="px-5 py-3 font-medium">Configuration</th>
                      {["Recall@5", "MRR@10", "nDCG@10", "Hit@1", "p50 ms", "p95 ms"].map((h) => <th key={h} className="px-4 py-3 text-right font-medium">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {modes.map((m, i) => {
                      const r = data.summary![m];
                      const best = m === "hybrid_rerank";
                      return (
                        <motion.tr key={m} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08, duration: 0.6, ease: EASE }}
                          className={cn("border-b border-white/[0.04] last:border-0", best && "bg-violet/[0.07]")}>
                          <td className={cn("px-5 py-3", best ? "font-medium text-white" : "text-fg-muted")}>{r.label}</td>
                          {[r.recall_at_5, r.mrr_at_10, r.ndcg_at_10, r.hit_at_1].map((v, j) => <td key={j} className={cn("px-4 py-3 text-right font-mono tabular-nums", best ? "text-white" : "text-fg-muted")}>{v.toFixed(3)}</td>)}
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-fg-subtle">{r.latency_p50_ms}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-fg-subtle">{r.latency_p95_ms}</td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Reveal>
          )}
          {data?.mrr_by_query_type && (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Reveal delay={0.1}>
                <div className="h-full rounded-2xl p-5 glass">
                  <div className="text-sm font-medium">MRR@10 by query type</div>
                  <div className="mt-4 space-y-2.5">
                    {Object.entries(data.mrr_by_query_type).map(([t, v]) => (
                      <div key={t} className="grid grid-cols-[7.5rem_1fr] items-center gap-3 text-[12px]">
                        <span className="text-fg-muted">{t} <span className="text-fg-subtle">({data.query_type_counts?.[t]})</span></span>
                        <div className="grid grid-cols-4 gap-1">
                          {modes.map((m) => (
                            <div key={m} className="relative h-5 overflow-hidden rounded bg-white/[0.04]" title={`${m}: ${v[m]}`}>
                              <motion.div className={cn("absolute inset-y-0 left-0", m === "hybrid_rerank" ? "bg-gradient-to-r from-violet to-cyan" : "bg-white/20")} initial={{ width: 0 }} whileInView={{ width: `${v[m] * 100}%` }} viewport={{ once: true }} transition={{ duration: 1, ease: EASE }} />
                              <span className="relative px-1 font-mono text-[9.5px] leading-5 text-white/80">{v[m].toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 grid grid-cols-[7.5rem_1fr] gap-3 font-mono text-[9.5px] text-fg-subtle"><span /><div className="grid grid-cols-4 gap-1"><span>BM25</span><span>Dense</span><span>RRF</span><span>+Rerank</span></div></div>
                </div>
              </Reveal>
              <Reveal delay={0.15}>
                <div className="h-full rounded-2xl p-5 glass">
                  <div className="text-sm font-medium">Evidence gate (abstention) calibration</div>
                  {data.calibration?.configured_gate && (
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      {[["Answerable pass", data.calibration.configured_gate.answerable_pass_rate], ["Primary in evidence", data.calibration.configured_gate.primary_in_evidence_rate], ["Negatives rejected", data.calibration.configured_gate.negative_reject_rate]].map(([l, v]) => (
                        <div key={l as string} className="rounded-xl border border-white/[0.07] bg-white/[0.02] py-3">
                          <div className="font-display text-3xl text-white">{((v as number) * 100).toFixed(1)}%</div>
                          <div className="mt-1 text-[10.5px] text-fg-subtle">{l}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 space-y-1.5">
                    {data.calibration?.sweep.map((s) => (
                      <div key={s.threshold} className={cn("grid grid-cols-[4rem_1fr_3rem] items-center gap-2 font-mono text-[10.5px]", s.threshold === data.calibration?.chosen_threshold ? "text-white" : "text-fg-subtle")}>
                        <span>{s.threshold}</span>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                          <motion.div className={cn("h-full rounded-full", s.threshold === data.calibration?.chosen_threshold ? "bg-gradient-to-r from-amber to-mint" : "bg-white/20")} initial={{ width: 0 }} whileInView={{ width: `${s.balanced_accuracy * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.9, ease: EASE }} />
                        </div>
                        <span className="text-right">{s.balanced_accuracy.toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[11.5px] text-fg-subtle">Balanced accuracy of the top-reranker-score threshold. Chosen: {data.calibration?.chosen_threshold}, plus a dense/BM25 rank-1 agreement rule for weak evidence.</p>
                </div>
              </Reveal>
            </div>
          )}
        </section>

        <section className="mt-20 grid gap-4 md:grid-cols-3">
          {[
            ["Chunking", "Split on policy sections before any token-based splitting; tables stay with their headings. Every chunk gets a contextual header (title, ID, section) and a SHA-256 content hash, so unchanged chunks are never re-embedded."],
            ["Hybrid search", "BGE-M3 dense vectors and BM25 sparse vectors (IDF computed by Qdrant) are queried in parallel, then fused with Reciprocal Rank Fusion, which compares ranks rather than incompatible raw scores."],
            ["Reranking & gate", "The fused top 25 are scored by bge-reranker-v2-m3 together with the question. A calibrated gate decides whether any real evidence exists; otherwise the agent abstains."],
            ["MCP boundary", "Only the MCP child process has database credentials. Each call carries a signed, single-use, 60-second identity assertion; the read-only role has column-level grants and row-level security."],
            ["Guardrails", "Deterministic injection rules, an LLM intent classifier, fenced untrusted content, PII and secret redaction on input, output and logs, and a canary token for prompt leaks."],
            ["Output validation", "Citations must map to supplied chunks, every number must appear in the evidence, and claims of unconfirmed actions such as “approved” or “ticket created” are blocked."],
          ].map(([t, b], i) => (
            <Reveal key={t} delay={i * 0.05}>
              <div className="h-full rounded-2xl p-5 glass">
                <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-violet">{String(i + 1).padStart(2, "0")}</div>
                <div className="mt-2 font-medium text-white">{t}</div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">{b}</p>
              </div>
            </Reveal>
          ))}
        </section>
        <p className="mt-16 text-center text-xs text-fg-subtle">Fictional sample policies and synthetic employee records. Not connected to Go AI Field’s internal systems.</p>
      </div>
    </MotionConfig>
  );
}

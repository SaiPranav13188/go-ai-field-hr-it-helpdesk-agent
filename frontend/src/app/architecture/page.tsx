"use client";

import { MotionConfig, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { BackgroundVideo, EASE, LineReveal, Reveal, cn } from "@/components/fx/primitives";
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
  calibration?: { chosen_threshold: number; configured_gate?: { answerable_pass_rate: number; negative_reject_rate: number; primary_in_evidence_rate: number }; sweep: { threshold: number; answerable_pass_rate: number; negative_reject_rate: number; balanced_accuracy: number }[] };
};

type N = { id: string; x: number; y: number; w: number; label: string; sub: string; hot?: boolean };
const NODES: N[] = [
  { id: "ui", x: 20, y: 190, w: 150, label: "Next.js UI", sub: "Vercel · SSE" },
  { id: "api", x: 210, y: 190, w: 150, label: "FastAPI", sub: "Render · session" },
  { id: "graph", x: 400, y: 190, w: 170, label: "LangGraph", sub: "validate · guard · route", hot: true },
  { id: "dense", x: 620, y: 60, w: 150, label: "BGE-M3 dense", sub: "Qdrant cosine" },
  { id: "bm25", x: 620, y: 150, w: 150, label: "BM25 sparse", sub: "Qdrant IDF" },
  { id: "rrf", x: 820, y: 105, w: 120, label: "RRF", sub: "k = 60" },
  { id: "rerank", x: 990, y: 105, w: 180, label: "Reranker", sub: "bge-reranker-v2-m3" },
  { id: "mcp", x: 620, y: 300, w: 150, label: "MCP server", sub: "stdio · 2 tools", hot: true },
  { id: "pg", x: 820, y: 300, w: 150, label: "PostgreSQL", sub: "Supabase · RLS" },
  { id: "llm", x: 990, y: 215, w: 180, label: "Gemini", sub: "evidence-only answer" },
  { id: "guard", x: 990, y: 320, w: 180, label: "Output guard", sub: "cite · numbers · PII", hot: true },
];
const EDGES: [string, string][] = [["ui", "api"], ["api", "graph"], ["graph", "dense"], ["graph", "bm25"], ["dense", "rrf"], ["bm25", "rrf"], ["rrf", "rerank"], ["rerank", "llm"], ["graph", "mcp"], ["mcp", "pg"], ["llm", "guard"], ["pg", "guard"]];
const H = 46;

function edgePath(a: N, b: N) {
  if (b.x <= a.x) {
    const ax = a.x + a.w / 2, bx = b.x + b.w / 2;
    return `M ${ax} ${a.y + H} C ${ax} ${a.y + H + 30}, ${bx} ${b.y - 30}, ${bx} ${b.y}`;
  }
  const x1 = a.x + a.w, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

function Diagram() {
  const by = Object.fromEntries(NODES.map((n) => [n.id, n]));
  return (
    <div className="overflow-x-auto border border-rule bg-ink-2 p-4">
      <svg viewBox="0 0 1190 390" className="min-w-[900px]">
        {EDGES.map(([a, b], i) => {
          const d = edgePath(by[a], by[b]);
          return (
            <g key={`${a}-${b}`}>
              <motion.path d={d} stroke="rgba(236,233,226,0.22)" strokeWidth="1" fill="none" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.2, delay: 0.2 + i * 0.07, ease: EASE }} />
              <rect width="5" height="5" x="-2.5" y="-2.5" fill="#f2b544">
                <animateMotion dur={`${2.6 + (i % 4) * 0.5}s`} repeatCount="indefinite" path={d} begin={`${i * 0.3}s`} />
              </rect>
            </g>
          );
        })}
        {NODES.map((n, i) => (
          <motion.g key={n.id} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: i * 0.05 }}>
            <rect x={n.x} y={n.y} width={n.w} height={H} fill="#0a0a0b" stroke={n.hot ? "#f2b544" : "rgba(236,233,226,0.25)"} strokeWidth="1" />
            <text x={n.x + 12} y={n.y + 20} fill="#ece9e2" fontSize="13" fontWeight="600" fontFamily="var(--font-schibsted)">{n.label}</text>
            <text x={n.x + 12} y={n.y + 35} fill="#84817a" fontSize="10" fontFamily="var(--font-plex-mono)">{n.sub}</text>
          </motion.g>
        ))}
        <text x="620" y="35" fill="#57554f" fontSize="10" fontFamily="var(--font-plex-mono)" letterSpacing="1.5">POLICY LANE</text>
        <text x="620" y="378" fill="#57554f" fontSize="10" fontFamily="var(--font-plex-mono)" letterSpacing="1.5">PERSONAL-DATA LANE</text>
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
      <div className="min-h-screen bg-ink">
        <section className="relative h-[62svh] min-h-[440px] overflow-hidden border-b border-rule">
          <BackgroundVideo scale={1.2} overlayClassName="bg-[linear-gradient(180deg,rgba(10,10,11,0.75)_0%,rgba(10,10,11,0.35)_40%,#0a0a0b_100%)]" />
          <div className="relative z-10 mx-auto flex h-full max-w-[1440px] flex-col px-5 sm:px-8">
            <div className="flex items-center justify-between py-5">
              <Link href="/" className="flex items-center gap-2 text-[13.5px] text-paper-2 transition hover:text-paper">
                <ArrowLeft className="h-4 w-4" /> Back
              </Link>
              <Logo />
            </div>
            <div className="mt-auto pb-12">
              <span className="label text-paper-2">Architecture &amp; evaluation</span>
              <h1 className="mt-5 text-[clamp(2.6rem,6.5vw,6rem)] font-semibold leading-[0.92] tracking-[-0.05em]">
                <LineReveal lines={["How it decides", <span key="b" className="text-accent">what to trust.</span>]} />
              </h1>
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-[1440px] px-5 pb-24 sm:px-8">
          <section className="grid gap-10 py-20 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <span className="label"><span className="text-accent">01</span> — System</span>
              <p className="mt-5 text-[15px] leading-relaxed text-mute">
                Two lanes, one graph. Policy questions go through hybrid retrieval; personal questions go through an authorised MCP tool. The language model only writes the answer, from evidence it is given, and its output is checked before you see it. Amber marks the points where a decision is enforced in code.
              </p>
            </div>
            <Reveal className="lg:col-span-8"><Diagram /></Reveal>
          </section>

          <section className="border-t border-rule py-20">
            <div className="grid gap-6 lg:grid-cols-12">
              <div className="lg:col-span-4">
                <span className="label"><span className="text-accent">02</span> — Measured retrieval</span>
              </div>
              <p className="text-[14px] leading-relaxed text-mute lg:col-span-8">
                {data?.available
                  ? <>Generated {data.generated_at} · {data.n_queries} labelled queries · {data.n_negatives} out-of-corpus negatives · <span className="font-mono text-[12.5px] text-paper-2">{data.models?.embedder}</span> · <span className="font-mono text-[12.5px] text-paper-2">{data.models?.reranker}</span></>
                  : "Run evaluation/run_retrieval_eval.py to generate metrics."}
              </p>
            </div>
            {data?.summary && (
              <Reveal>
                <div className="mt-10 overflow-x-auto">
                  <table className="w-full min-w-[680px] text-[14px]">
                    <thead>
                      <tr className="border-b border-rule text-left">
                        <th className="label py-3 pr-4 font-normal">Configuration</th>
                        {["Recall@5", "MRR@10", "nDCG@10", "Hit@1", "p50 ms", "p95 ms"].map((h) => <th key={h} className="label py-3 pl-4 text-right font-normal">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {modes.map((m) => {
                        const r = data.summary![m];
                        const best = m === "hybrid_rerank";
                        return (
                          <tr key={m} className="border-b border-rule">
                            <td className={cn("py-4 pr-4", best ? "font-medium text-paper" : "text-mute")}>{r.label}</td>
                            {[r.recall_at_5, r.mrr_at_10, r.ndcg_at_10, r.hit_at_1].map((v, j) => <td key={j} className={cn("py-4 pl-4 text-right font-mono tabular-nums", best ? "text-accent" : "text-paper-2")}>{v.toFixed(3)}</td>)}
                            <td className="py-4 pl-4 text-right font-mono tabular-nums text-faint">{r.latency_p50_ms}</td>
                            <td className="py-4 pl-4 text-right font-mono tabular-nums text-faint">{r.latency_p95_ms}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Reveal>
            )}

            {data?.mrr_by_query_type && (
              <div className="mt-14 grid gap-12 lg:grid-cols-2">
                <Reveal>
                  <span className="label">MRR@10 by query type</span>
                  <div className="mt-4 border-t border-rule">
                    <div className="grid grid-cols-[8rem_repeat(4,1fr)] gap-2 border-b border-rule py-2 font-mono text-[10px] uppercase tracking-wider text-faint">
                      <span>type (n)</span><span className="text-right">BM25</span><span className="text-right">Dense</span><span className="text-right">RRF</span><span className="text-right">+Rerank</span>
                    </div>
                    {Object.entries(data.mrr_by_query_type).map(([t, v]) => (
                      <div key={t} className="grid grid-cols-[8rem_repeat(4,1fr)] gap-2 border-b border-rule py-2.5 font-mono text-[12px]">
                        <span className="text-paper-2">{t} <span className="text-faint">({data.query_type_counts?.[t]})</span></span>
                        {modes.map((m) => <span key={m} className={cn("text-right tabular-nums", m === "hybrid_rerank" ? "text-accent" : "text-mute")}>{v[m].toFixed(2)}</span>)}
                      </div>
                    ))}
                  </div>
                </Reveal>
                <Reveal delay={0.1}>
                  <span className="label">Evidence gate (abstention) calibration</span>
                  {data.calibration?.configured_gate && (
                    <div className="mt-4 grid grid-cols-3 border-l border-t border-rule">
                      {[["Answerable pass", data.calibration.configured_gate.answerable_pass_rate], ["Primary in evidence", data.calibration.configured_gate.primary_in_evidence_rate], ["Negatives rejected", data.calibration.configured_gate.negative_reject_rate]].map(([l, v]) => (
                        <div key={l as string} className="border-b border-r border-rule p-4">
                          <div className="text-[34px] font-semibold leading-none tracking-[-0.04em] text-paper">{((v as number) * 100).toFixed(1)}%</div>
                          <div className="label mt-2 text-[10px]">{l}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-6 space-y-2">
                    {data.calibration?.sweep.map((s) => {
                      const chosen = s.threshold === data.calibration?.chosen_threshold;
                      return (
                        <div key={s.threshold} className={cn("grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-3 font-mono text-[11px]", chosen ? "text-paper" : "text-faint")}>
                          <span>{s.threshold}</span>
                          <div className="h-[3px] bg-rule">
                            <motion.div className={cn("h-full", chosen ? "bg-accent" : "bg-paper-2/40")} initial={{ width: 0 }} whileInView={{ width: `${s.balanced_accuracy * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.9, ease: EASE }} />
                          </div>
                          <span className="text-right">{s.balanced_accuracy.toFixed(3)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-4 text-[12.5px] leading-relaxed text-faint">Balanced accuracy of the top reranker-score threshold. Chosen {data.calibration?.chosen_threshold}, plus a dense/BM25 rank-1 agreement rule for weak evidence.</p>
                </Reveal>
              </div>
            )}
          </section>

          <section className="border-t border-rule py-20">
            <span className="label"><span className="text-accent">03</span> — Design decisions</span>
            <div className="mt-8 grid gap-x-10 md:grid-cols-2 lg:grid-cols-3">
              {[
                ["Chunking", "Split on policy sections before any token-based splitting, so tables stay with their headings. Each chunk carries a contextual header and a content hash; unchanged chunks are never re-embedded."],
                ["Hybrid search", "BGE-M3 dense vectors and BM25 sparse vectors (IDF computed by Qdrant) are queried in parallel and fused with Reciprocal Rank Fusion, which compares ranks, not incompatible raw scores."],
                ["Reranking & gate", "The fused top 25 are scored by bge-reranker-v2-m3 against the question. A calibrated gate decides whether any real evidence exists; otherwise the agent abstains."],
                ["MCP boundary", "Only the MCP process holds database credentials. Each call carries a signed, single-use, 60-second identity assertion; the read-only role has column grants and row-level security."],
                ["Guardrails", "Deterministic injection rules, an intent classifier, fenced untrusted content, PII and secret redaction on input, output and logs, and a canary token for prompt leaks."],
                ["Output validation", "Citations must map to supplied chunks, every number must appear in the evidence, and claims such as “approved” or “ticket created” are blocked."],
              ].map(([t, b], i) => (
                <Reveal key={t} delay={(i % 3) * 0.06}>
                  <div className="border-t border-rule py-6">
                    <div className="flex items-baseline justify-between">
                      <h3 className="text-[18px] font-medium tracking-[-0.015em] text-paper">{t}</h3>
                      <span className="font-mono text-[10.5px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                    </div>
                    <p className="mt-3 text-[14px] leading-relaxed text-mute">{b}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </section>
          <p className="label border-t border-rule pt-6 text-faint">Fictional sample policies and synthetic employee records. Not connected to Go AI Field’s internal systems.</p>
        </div>
      </div>
    </MotionConfig>
  );
}

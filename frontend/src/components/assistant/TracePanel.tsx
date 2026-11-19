"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useState } from "react";
import { Activity, Check, Database, KeyRound, Radar, ShieldAlert, Sparkles } from "lucide-react";
import { EASE, cn } from "@/components/fx/primitives";
import type { CandidateRow, ChatMessage, StageEvent } from "@/lib/types";

const NODE_TONE: Record<string, string> = {
  input_validation: "#9aa1b7",
  scope_classifier: "#9aa1b7",
  security_guard: "#3ee6a8",
  intent_router: "#9aa1b7",
  hybrid_retrieval: "#8b7bff",
  rerank_passages: "#c08bff",
  mcp_employee_lookup: "#3ee6a8",
  evidence_check: "#ffbe5c",
  response_generation: "#ffffff",
  output_guard: "#3ee6a8",
  human_escalation: "#6cb6ff",
  safe_refusal: "#ff5c7a",
  scope_refusal: "#ffbe5c",
  direct_response: "#8b7bff",
  final_response: "#9aa1b7",
};

type Merged = { node: string; label: string; running: boolean; ms?: number; detail?: string | null };

function merge(stages: StageEvent[]): Merged[] {
  const out: Merged[] = [];
  for (const s of stages) {
    const ex = out.find((o) => o.node === s.node);
    if (s.status === "start" && !ex) out.push({ node: s.node, label: s.label, running: true });
    if (s.status === "done") {
      if (ex) Object.assign(ex, { running: false, ms: s.ms, detail: s.detail });
      else out.push({ node: s.node, label: s.label, running: false, ms: s.ms, detail: s.detail });
    }
  }
  return out;
}

export default function TracePanel({ msg, className }: { msg?: Extract<ChatMessage, { role: "assistant" }>; className?: string }) {
  const [tab, setTab] = useState<"rerank" | "first">("rerank");
  if (!msg) {
    return (
      <div className={cn("flex h-full flex-col items-center justify-center px-8 text-center", className)}>
        <div className="relative mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.03]">
          <Radar className="h-6 w-6 text-violet" />
          <span className="absolute inset-0 rounded-2xl border border-violet/30 animate-pulse-ring" />
        </div>
        <div className="text-sm font-medium text-white">Live agent trace</div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">Ask something. You’ll see every LangGraph node fire, the dense/BM25 candidates fuse, and the reranker reorder them in real time.</p>
      </div>
    );
  }
  const stages = merge(msg.trace.stages);
  const f = msg.final;
  const evidence = new Set(f?.citations.map((c) => c.chunk_id) ?? []);
  const rows: CandidateRow[] = (tab === "rerank" ? msg.trace.rerank?.candidates ?? msg.trace.firstStage?.candidates : msg.trace.firstStage?.candidates) ?? [];
  const fs = msg.trace.firstStage;
  const total = f?.timings.total_ms;

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Activity className="h-4 w-4 text-violet" /> Agent trace
        </div>
        <div className="font-mono text-[11px] text-fg-subtle">{f ? `${f.request_id} · ${((total ?? 0) / 1000).toFixed(2)}s` : "running…"}</div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {f && (
          <div className="flex flex-wrap gap-1.5">
            <Pill>intent · {f.intent ?? "—"}</Pill>
            <Pill>route · {f.route}</Pill>
            {f.classifier && <Pill>classifier · {f.classifier}</Pill>}
          </div>
        )}

        {/* timeline */}
        <div>
          <SectionTitle>LangGraph nodes</SectionTitle>
          <ol className="relative mt-3">
            <AnimatePresence initial={false}>
              {stages.map((s, i) => {
                const tone = NODE_TONE[s.node] ?? "#9aa1b7";
                return (
                  <motion.li key={s.node} layout initial={{ opacity: 0, x: -10, height: 0 }} animate={{ opacity: 1, x: 0, height: "auto" }} transition={{ duration: 0.4, ease: EASE }} className="relative pb-3.5 pl-7">
                    {i < stages.length - 1 && (
                      <motion.span className="absolute left-[7px] top-4 w-px origin-top" style={{ background: `linear-gradient(${tone}, rgba(255,255,255,0.08))`, bottom: 0 }} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.4 }} />
                    )}
                    <span className="absolute left-0 top-[3px] grid h-[15px] w-[15px] place-items-center rounded-full border" style={{ borderColor: tone, background: s.running ? "transparent" : `${tone}22` }}>
                      {s.running ? (
                        <>
                          <span className="absolute inset-0 rounded-full animate-pulse-ring" style={{ background: tone }} />
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
                        </>
                      ) : (
                        <Check className="h-2.5 w-2.5" style={{ color: tone }} strokeWidth={3} />
                      )}
                    </span>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className={cn("text-[13px]", s.running ? "shimmer-text font-medium" : "text-white")}>{s.label}</span>
                      {s.ms !== undefined && <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-fg-subtle">{s.ms < 1 ? "<1" : Math.round(s.ms)} ms</span>}
                    </div>
                    {s.detail && <div className="mt-0.5 break-words font-mono text-[10.5px] leading-relaxed text-fg-subtle">{s.detail}</div>}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
        </div>

        {/* MCP */}
        {msg.trace.tools.length > 0 && (
          <div>
            <SectionTitle>MCP tool calls</SectionTitle>
            {msg.trace.tools.map((t, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 rounded-xl border border-mint/20 bg-mint/[0.05] p-3">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-mint"><KeyRound className="h-3.5 w-3.5" /> {t.tool}</span>
                  <span className={cn("rounded-md px-1.5 py-0.5 font-mono text-[10px]", t.status === "ok" ? "bg-mint/15 text-mint" : "bg-rose/15 text-rose")}>{t.status}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[10.5px] text-fg-muted">
                  <span>fields: {t.fields_returned.join(", ") || "none"}</span>
                  <span className="text-right">{Math.round(t.duration_ms)} ms</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5 font-mono text-[10px] text-fg-subtle">
                  <Database className="h-3 w-3" /> signed 60s assertion → read-only role → RLS
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* retrieval */}
        {fs && (
          <div>
            <div className="flex items-center justify-between">
              <SectionTitle>Hybrid retrieval</SectionTitle>
              <div className="flex rounded-lg border border-white/10 p-0.5 text-[11px]">
                {(["first", "rerank"] as const).map((k) => (
                  <button key={k} onClick={() => setTab(k)} className={cn("relative rounded-md px-2 py-0.5 transition", tab === k ? "text-white" : "text-fg-subtle hover:text-fg")}>
                    {tab === k && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-md bg-white/10" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}
                    <span className="relative">{k === "first" ? "RRF" : "Reranked"}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Stat label="dense" value={`${fs.dense_hits ?? 0}`} sub={`${Math.round(fs.timings.dense_ms ?? 0)} ms`} color="text-violet" />
              <Stat label="bm25" value={`${fs.bm25_hits ?? 0}`} sub={`${(fs.timings.bm25_ms ?? 0).toFixed(1)} ms`} color="text-cyan" />
              <Stat label="rerank" value={msg.trace.rerank ? `${fs.fused ?? 0}` : "…"} sub={msg.trace.rerank ? `${Math.round(msg.trace.rerank.timings.rerank_ms ?? 0)} ms` : "pending"} color="text-[#c08bff]" />
            </div>
            {fs.query && <div className="mt-3 break-words rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 font-mono text-[10.5px] text-fg-muted">query: {fs.query}</div>}
            <LayoutGroup>
              <div className="mt-3 space-y-1.5">
                {rows.slice(0, 8).map((c, i) => {
                  const isEvidence = evidence.has(c.chunk_id);
                  return (
                    <motion.div layout="position" key={c.chunk_id} transition={{ type: "spring", stiffness: 260, damping: 28 }}
                      className={cn("rounded-lg border px-2.5 py-2", isEvidence ? "border-mint/30 bg-mint/[0.06]" : "border-white/[0.06] bg-white/[0.02]")}>
                      <div className="flex items-center gap-2">
                        <span className="w-4 font-mono text-[10.5px] text-fg-subtle">{i + 1}</span>
                        <span className="truncate text-[12px] text-white">§{c.section}</span>
                        {isEvidence && <span className="ml-auto shrink-0 rounded bg-mint/15 px-1 font-mono text-[9.5px] text-mint">cited</span>}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 pl-6 font-mono text-[10px] text-fg-subtle">
                        <span className="text-violet/90">D{c.dense_rank ?? "–"}</span>
                        <span className="text-cyan/90">B{c.bm25_rank ?? "–"}</span>
                        <span>rrf {c.rrf_score?.toFixed(4) ?? "–"}</span>
                        {tab === "rerank" && c.rerank_score !== null && (
                          <span className="ml-auto flex items-center gap-1.5">
                            <span className="h-1 w-14 overflow-hidden rounded-full bg-white/[0.07]">
                              <motion.span className="block h-full rounded-full bg-gradient-to-r from-[#c08bff] to-cyan" initial={{ width: 0 }} animate={{ width: `${Math.max(3, c.rerank_score * 100)}%` }} transition={{ duration: 0.8, ease: EASE }} />
                            </span>
                            <span className="tabular-nums text-fg-muted">{c.rerank_score.toFixed(3)}</span>
                          </span>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </LayoutGroup>
          </div>
        )}

        {/* security */}
        {f && (f.security.flags.length > 0 || f.security.output_flags.length > 0) && (
          <div>
            <SectionTitle>Security signals</SectionTitle>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {f.security.flags.map((fl, i) => (
                <span key={i} className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10.5px]", fl.blocking ? "border-rose/30 bg-rose/10 text-rose" : "border-amber/25 bg-amber/[0.08] text-amber")}>
                  <ShieldAlert className="h-3 w-3" /> {fl.category} · {fl.rule}
                </span>
              ))}
              {f.security.output_flags.map((o) => (
                <span key={o} className="inline-flex items-center gap-1 rounded-md border border-sky/25 bg-sky/[0.08] px-2 py-0.5 font-mono text-[10.5px] text-sky">
                  <Sparkles className="h-3 w-3" /> output · {o}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const Pill = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10.5px] text-fg-muted">{children}</span>
);
const SectionTitle = ({ children }: { children: React.ReactNode }) => <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">{children}</div>;
const Stat = ({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) => (
  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] py-2">
    <div className={cn("text-base font-semibold tabular-nums", color)}>{value}</div>
    <div className="font-mono text-[9.5px] uppercase tracking-wider text-fg-subtle">{label}</div>
    <div className="font-mono text-[9.5px] text-fg-subtle">{sub}</div>
  </div>
);

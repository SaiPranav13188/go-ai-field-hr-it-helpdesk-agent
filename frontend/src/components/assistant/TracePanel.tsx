"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useState } from "react";
import { EASE, cn } from "@/components/fx/primitives";
import type { CandidateRow, ChatMessage, StageEvent } from "@/lib/types";

type Merged = { node: string; label: string; running: boolean; ms?: number; detail?: string | null };

const STOP_NODES = new Set(["safe_refusal", "scope_refusal"]);

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
  const [tab, setTab] = useState<"first" | "rerank">("rerank");
  if (!msg) {
    return (
      <div className={cn("flex h-full flex-col", className)}>
        <Header right="idle" />
        <div className="px-5 py-6">
          <p className="text-[14px] leading-relaxed text-mute">
            Ask something. Each step of the agent appears here as it runs: validation, routing, the dense and BM25 candidates, the reranker reordering them, and the checks applied to the answer.
          </p>
          <div className="mt-6 space-y-2">
            {["input_validation", "scope_classifier", "security_guard", "intent_router", "hybrid_retrieval", "rerank_passages", "evidence_check", "response_generation", "output_guard"].map((n, i) => (
              <div key={n} className="flex items-center gap-3 font-mono text-[11px] text-faint">
                <span className="w-5">{String(i + 1).padStart(2, "0")}</span>
                <span className="h-px flex-1 bg-rule" />
                <span>{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  const stages = merge(msg.trace.stages);
  const f = msg.final;
  const evidence = new Set(f?.citations.map((c) => c.chunk_id) ?? []);
  const fs = msg.trace.firstStage;
  const rows: CandidateRow[] = (tab === "rerank" ? msg.trace.rerank?.candidates ?? fs?.candidates : fs?.candidates) ?? [];

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <Header right={f ? `${f.request_id} · ${((f.timings.total_ms ?? 0) / 1000).toFixed(2)} s` : "running"} />
      <div className="flex-1 overflow-y-auto">
        {f && (
          <div className="grid grid-cols-3 border-b border-rule">
            {[["intent", f.intent ?? "—"], ["route", f.route], ["router", f.classifier ?? "—"]].map(([k, v], i) => (
              <div key={k} className={cn("px-4 py-3", i < 2 && "border-r border-rule")}>
                <div className="label text-[10px]">{k}</div>
                <div className="mt-1 truncate font-mono text-[11.5px] text-paper">{v}</div>
              </div>
            ))}
          </div>
        )}

        <Section title="LangGraph nodes">
          <ol>
            <AnimatePresence initial={false}>
              {stages.map((s, i) => {
                const stop = STOP_NODES.has(s.node);
                return (
                  <motion.li key={s.node} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, ease: EASE }}
                    className="grid grid-cols-[1.6rem_1fr_auto] gap-x-2 border-b border-rule py-2.5 last:border-b-0">
                    <span className={cn("font-mono text-[10.5px]", s.running ? "text-accent" : stop ? "text-stop" : "text-faint")}>{String(i + 1).padStart(2, "0")}</span>
                    <span className="min-w-0">
                      <span className={cn("flex items-center gap-2 text-[13px]", s.running ? "text-paper" : "text-paper-2")}>
                        {s.label}
                        {s.running && <span className="h-3 w-[5px] animate-blink bg-accent" />}
                      </span>
                      {s.detail && <span className="mt-0.5 block break-words font-mono text-[10.5px] leading-relaxed text-mute">{s.detail}</span>}
                    </span>
                    <span className="font-mono text-[10.5px] tabular-nums text-faint">{s.ms === undefined ? "" : s.ms < 1 ? "<1 ms" : `${Math.round(s.ms)} ms`}</span>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
        </Section>

        {msg.trace.tools.length > 0 && (
          <Section title="MCP tool call">
            {msg.trace.tools.map((t, i) => (
              <div key={i} className="font-mono text-[11.5px]">
                <div className="flex justify-between">
                  <span className="text-paper">{t.tool}</span>
                  <span className={t.status === "ok" ? "text-ok" : "text-stop"}>{t.status}</span>
                </div>
                <div className="mt-1.5 flex justify-between text-mute">
                  <span>fields: {t.fields_returned.join(", ") || "none"}</span>
                  <span>{Math.round(t.duration_ms)} ms</span>
                </div>
                <div className="mt-1.5 text-faint">signed 60 s assertion → read-only role → RLS</div>
              </div>
            ))}
          </Section>
        )}

        {fs && (
          <Section
            title="Hybrid retrieval"
            action={
              <div className="flex border border-rule font-mono text-[10.5px] uppercase">
                {(["first", "rerank"] as const).map((k) => (
                  <button key={k} onClick={() => setTab(k)} className={cn("px-2 py-0.5 transition", tab === k ? "bg-paper text-ink" : "text-mute hover:text-paper")}>
                    {k === "first" ? "RRF" : "Reranked"}
                  </button>
                ))}
              </div>
            }
          >
            <div className="grid grid-cols-3 border border-rule font-mono">
              {[["dense", `${fs.dense_hits ?? 0}`, `${Math.round(fs.timings.dense_ms ?? 0)} ms`], ["bm25", `${fs.bm25_hits ?? 0}`, `${(fs.timings.bm25_ms ?? 0).toFixed(1)} ms`], ["rerank", msg.trace.rerank ? `${fs.fused ?? 0}` : "…", msg.trace.rerank ? `${Math.round(msg.trace.rerank.timings.rerank_ms ?? 0)} ms` : "pending"]].map(([k, v, s], i) => (
                <div key={k} className={cn("px-3 py-2", i < 2 && "border-r border-rule")}>
                  <div className="text-[9.5px] uppercase tracking-wider text-faint">{k}</div>
                  <div className="text-[16px] text-paper">{v}</div>
                  <div className="text-[9.5px] text-mute">{s}</div>
                </div>
              ))}
            </div>
            {fs.query && <div className="mt-3 break-words font-mono text-[10.5px] text-mute">query → {fs.query}</div>}
            <LayoutGroup>
              <div className="mt-3">
                {rows.slice(0, 8).map((c, i) => {
                  const cited = evidence.has(c.chunk_id);
                  return (
                    <motion.div layout="position" key={c.chunk_id} transition={{ type: "spring", stiffness: 260, damping: 30 }} className="border-b border-rule py-2">
                      <div className="flex items-baseline gap-2">
                        <span className="w-4 font-mono text-[10.5px] text-faint">{i + 1}</span>
                        <span className={cn("truncate text-[12.5px]", cited ? "text-paper" : "text-paper-2")}>§{c.section}</span>
                        {cited && <span className="ml-auto shrink-0 font-mono text-[9.5px] uppercase tracking-wider text-accent">cited</span>}
                      </div>
                      <div className="mt-1 flex items-center gap-3 pl-6 font-mono text-[10px] text-faint">
                        <span>D{c.dense_rank ?? "–"}</span>
                        <span>B{c.bm25_rank ?? "–"}</span>
                        <span>rrf {c.rrf_score?.toFixed(4) ?? "–"}</span>
                        {tab === "rerank" && c.rerank_score !== null && (
                          <span className="ml-auto flex items-center gap-2">
                            <span className="h-[3px] w-14 bg-rule">
                              <motion.span className="block h-full bg-accent" initial={{ width: 0 }} animate={{ width: `${Math.max(2, c.rerank_score * 100)}%` }} transition={{ duration: 0.8, ease: EASE }} />
                            </span>
                            <span className="tabular-nums text-mute">{c.rerank_score.toFixed(3)}</span>
                          </span>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </LayoutGroup>
          </Section>
        )}

        {f && (f.security.flags.length > 0 || f.security.output_flags.length > 0) && (
          <Section title="Security signals">
            <div className="space-y-1.5 font-mono text-[11px]">
              {f.security.flags.map((fl, i) => (
                <div key={i} className="flex justify-between gap-3">
                  <span className={fl.blocking ? "text-stop" : "text-accent"}>{fl.category}</span>
                  <span className="truncate text-mute">{fl.rule}</span>
                </div>
              ))}
              {f.security.output_flags.map((o) => (
                <div key={o} className="flex justify-between gap-3"><span className="text-info">output</span><span className="text-mute">{o}</span></div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Header({ right }: { right: string }) {
  return (
    <div className="flex items-center justify-between border-b border-rule px-5 py-3.5">
      <span className="label text-paper">Agent trace</span>
      <span className="font-mono text-[10.5px] text-faint">{right}</span>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-b border-rule px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

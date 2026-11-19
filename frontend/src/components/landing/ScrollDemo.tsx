"use client";

import { AnimatePresence, LayoutGroup, motion, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { EASE, cn } from "@/components/fx/primitives";
import { Scramble } from "@/components/fx/effects";

const QUESTION = "How much home internet expense can I claim each month?";

const STAGES = [
  ["Validate input", "length · secrets · PII"],
  ["Classify intent", "policy_question"],
  ["Security guard", "passed · no injection"],
  ["BGE-M3 dense", "20 candidates"],
  ["BM25 sparse", "11 candidates"],
  ["RRF fusion", "22 fused"],
  ["Rerank", "bge-reranker-v2-m3"],
  ["Evidence gate", "top 0.934 ≥ threshold"],
  ["Generate", "evidence-only answer"],
  ["Output guard", "citations ✓ numbers ✓ PII ✓"],
] as const;

type Cand = { id: string; title: string; rrf: number; rerank: number };
const CANDS: Cand[] = [
  { id: "3.15", title: "Sample limits", rrf: 1, rerank: 0.934 },
  { id: "3.16", title: "Submission process", rrf: 2, rerank: 0.004 },
  { id: "3.14", title: "Eligible expenses", rrf: 3, rerank: 0.012 },
  { id: "3.17", title: "Review and payment", rrf: 4, rerank: 0.001 },
];

const clamp = (v: number) => Math.min(1, Math.max(0, v));

export default function ScrollDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [p, setP] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setP(v));
  const bar = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  const typed = Math.round(clamp((p - 0.02) / 0.12) * QUESTION.length);
  const stagesDone = Math.floor(clamp((p - 0.16) / 0.5) * STAGES.length);
  const reranked = stagesDone >= 7;
  const showCands = stagesDone >= 6;
  const answer1 = p > 0.7;
  const answer2 = p > 0.76;
  const cites = p > 0.82;
  const stamp = p > 0.9;
  const ordered = reranked ? [...CANDS].sort((a, b) => b.rerank - a.rerank) : CANDS;

  return (
    <section ref={ref} className="relative h-[340vh] border-t border-rule">
      <div className="sticky top-0 flex h-[100svh] flex-col overflow-hidden">
        {/* faint grid backdrop */}
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage: "linear-gradient(rgba(236,233,226,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(236,233,226,0.04) 1px, transparent 1px)",
            backgroundSize: "88px 88px",
            maskImage: "radial-gradient(ellipse 80% 70% at 50% 50%, black, transparent)",
            WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 50% 50%, black, transparent)",
          }}
        />
        <div className="relative z-10 mx-auto flex w-full max-w-[1440px] items-center justify-between px-5 pt-8 sm:px-8 sm:pt-10">
          <span className="label"><Scramble text="LIVE WALKTHROUGH — ONE QUESTION, START TO FINISH" /></span>
          <span className="label hidden text-faint sm:inline">Illustrative replay · keep scrolling</span>
        </div>
        <div className="relative z-10 mx-4 mt-4 h-px bg-rule sm:mx-8">
          <motion.div className="h-px bg-accent" style={{ width: bar }} />
        </div>

        <div className="relative z-10 mx-auto grid w-full max-w-[1440px] flex-1 items-center gap-8 px-5 py-6 sm:px-8 lg:grid-cols-12 lg:gap-12">
          {/* left: question + pipeline */}
          <div className="lg:col-span-5">
            <span className="label">You ask</span>
            <p className="mt-3 min-h-[2.2em] text-[clamp(1.6rem,3vw,2.7rem)] font-semibold leading-[1.08] tracking-[-0.035em] text-paper">
              {QUESTION.slice(0, typed)}
              {typed < QUESTION.length && <span className="ml-1 inline-block h-[0.85em] w-[0.08em] translate-y-[0.1em] animate-blink bg-accent" />}
            </p>

            <ol className="mt-8 grid grid-cols-2 gap-x-6 border-t border-rule">
              {STAGES.map(([name, detail], i) => {
                const done = i < stagesDone;
                const active = i === stagesDone && p > 0.16 && stagesDone < STAGES.length;
                return (
                  <li key={name} className="flex items-start gap-2.5 border-b border-rule py-2.5">
                    <span className={cn("mt-[3px] grid h-3.5 w-3.5 shrink-0 place-items-center border transition-colors duration-300", done ? "border-accent bg-accent" : active ? "border-accent" : "border-rule-strong")}>
                      {done && <Check className="h-2.5 w-2.5 text-ink" strokeWidth={3.5} />}
                    </span>
                    <span className="min-w-0">
                      <span className={cn("block text-[13.5px] transition-colors duration-300", done ? "text-paper" : active ? "text-paper-2" : "text-faint")}>{name}</span>
                      <motion.span className="block truncate font-mono text-[10.5px] text-mute" animate={{ opacity: done ? 1 : 0 }} transition={{ duration: 0.3 }}>
                        {detail}
                      </motion.span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* right: candidates + answer */}
          <div className="hidden lg:col-span-7 lg:block">
            <div className="border border-rule bg-ink-2/70">
              <div className="flex items-center justify-between border-b border-rule px-5 py-3">
                <span className="label">{reranked ? "Reranked by the cross-encoder" : "Hybrid candidates (RRF order)"}</span>
                <span className="font-mono text-[10.5px] text-faint">HR-POL-003 · Reimbursement</span>
              </div>
              <LayoutGroup>
                <div className="px-5 py-2">
                  {ordered.map((c, i) => (
                    <motion.div
                      layout
                      key={c.id}
                      transition={{ type: "spring", stiffness: 220, damping: 28 }}
                      initial={false}
                      animate={{ opacity: showCands ? 1 : 0.18 }}
                      className="grid grid-cols-[1.5rem_3.2rem_1fr_9rem] items-center gap-3 border-b border-rule py-2.5 last:border-b-0"
                    >
                      <span className="font-mono text-[11px] text-faint">{i + 1}</span>
                      <span className="font-mono text-[12px] text-paper-2">§{c.id}</span>
                      <span className={cn("text-[14px]", reranked && i === 0 ? "text-paper" : "text-paper-2")}>{c.title}</span>
                      <span className="flex items-center gap-2">
                        <span className="h-[3px] flex-1 bg-rule">
                          <motion.span className="block h-full bg-accent" animate={{ width: reranked ? `${Math.max(2, c.rerank * 100)}%` : "0%" }} transition={{ duration: 0.8, ease: EASE }} />
                        </span>
                        <span className="w-10 text-right font-mono text-[10.5px] tabular-nums text-mute">{reranked ? c.rerank.toFixed(3) : `rrf ${c.rrf}`}</span>
                      </span>
                    </motion.div>
                  ))}
                </div>
              </LayoutGroup>
            </div>

            <div className="relative mt-5 min-h-[190px] border border-rule bg-ink-2/70 p-6">
              <div className="flex items-center gap-3">
                <span className="label">Helpdesk</span>
                <AnimatePresence>
                  {stamp && (
                    <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="label flex items-center gap-1.5 text-ok">
                      <span className="h-1.5 w-1.5 bg-ok" /> Verified answer
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
              <div className="mt-4 space-y-2 text-[17px] leading-relaxed">
                <motion.p animate={{ opacity: answer1 ? 1 : 0, y: answer1 ? 0 : 8 }} transition={{ duration: 0.5, ease: EASE }} className="text-paper-2">
                  You can claim up to <span className="font-semibold text-paper">INR 1,000 per month</span> for home internet
                  <Cite n={1} on={cites} />.
                </motion.p>
                <motion.p animate={{ opacity: answer2 ? 1 : 0, y: answer2 ? 0 : 8 }} transition={{ duration: 0.5, ease: EASE }} className="text-paper-2">
                  It needs manager pre-approval and a valid receipt
                  <Cite n={2} on={cites} />.
                </motion.p>
              </div>
              <motion.div animate={{ opacity: cites ? 1 : 0 }} transition={{ duration: 0.4 }} className="mt-5 space-y-1 border-t border-rule pt-3 font-mono text-[11px] text-mute">
                <div><span className="text-accent">[1]</span> HR-POL-003 · §3.15 Sample limits · v1.0</div>
                <div><span className="text-accent">[2]</span> HR-POL-003 · §3.14 Eligible expenses · v1.0</div>
              </motion.div>
              <AnimatePresence>
                {stamp && (
                  <motion.div
                    initial={{ opacity: 0, scale: 1.6, rotate: -14 }}
                    animate={{ opacity: 1, scale: 1, rotate: -8 }}
                    transition={{ type: "spring", stiffness: 260, damping: 16 }}
                    className="absolute right-6 top-5 border-2 border-ok px-3 py-1 font-mono text-[12px] font-medium uppercase tracking-[0.18em] text-ok"
                  >
                    Grounded
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* mobile: compact answer */}
          <motion.div className="border border-rule bg-ink-2/70 p-4 lg:hidden" animate={{ opacity: answer1 ? 1 : 0 }}>
            <p className="text-[15px] text-paper-2">
              Up to <span className="font-semibold text-paper">INR 1,000 per month</span> <span className="font-mono text-[11px] text-accent">[HR-POL-003 §3.15]</span>
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function Cite({ n, on }: { n: number; on: boolean }) {
  return (
    <motion.sup
      className="ml-1 inline-grid h-[18px] min-w-[18px] place-items-center border border-rule-strong px-1 font-mono text-[10px] text-accent"
      animate={{ opacity: on ? 1 : 0, scale: on ? 1 : 0.5 }}
      transition={{ type: "spring", stiffness: 500, damping: 20 }}
    >
      {n}
    </motion.sup>
  );
}

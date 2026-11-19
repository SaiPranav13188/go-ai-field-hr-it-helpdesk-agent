"use client";

import { motion, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight } from "lucide-react";
import Logo from "@/components/Logo";
import { AnimatedNumber, BackgroundVideo, Clock, EASE, LineReveal, Reveal, Rule, cn } from "@/components/fx/primitives";
import { api } from "@/lib/api";

type Eval = {
  available: boolean;
  n_queries?: number;
  n_negatives?: number;
  summary?: Record<string, { label: string; recall_at_5: number; mrr_at_10: number; ndcg_at_10: number; hit_at_1: number; latency_p50_ms: number }>;
  calibration?: { configured_gate?: { negative_reject_rate: number; answerable_pass_rate: number } };
};

export default function Landing({ onLaunch }: { onLaunch: () => void }) {
  const [evalData, setEval] = useState<Eval | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const hero = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: hero, offset: ["start start", "end start"] });
  const videoY = useTransform(scrollYProgress, [0, 1], ["0%", "18%"]);
  const contentY = useTransform(scrollYProgress, [0, 1], ["0%", "-12%"]);
  const fade = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  useEffect(() => {
    api.evaluation().then((d) => setEval(d as Eval)).catch(() => setEval({ available: false }));
    api.health().then((h) => setOnline(h.status === "ok")).catch(() => setOnline(false));
  }, []);

  return (
    <div className="relative bg-ink">
      {/* ====================== HERO ====================== */}
      <section ref={hero} className="relative h-[100svh] min-h-[660px] overflow-hidden">
        <motion.div className="absolute inset-0" style={{ y: videoY }}>
          <BackgroundVideo
            scale={1.08}
            overlayClassName="bg-[linear-gradient(180deg,rgba(10,10,11,0.70)_0%,rgba(10,10,11,0.10)_28%,rgba(10,10,11,0.20)_55%,rgba(10,10,11,0.92)_88%,#0a0a0b_100%),linear-gradient(90deg,rgba(10,10,11,0.75)_0%,rgba(10,10,11,0.0)_60%)]"
          />
        </motion.div>

        {/* nav */}
        <motion.nav initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.2 }} className="absolute inset-x-0 top-0 z-20">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-5 sm:px-8">
            <Logo />
            <div className="hidden items-center gap-8 md:flex">
              {[["01", "Method", "#method"], ["02", "Evidence", "#evidence"], ["03", "Guardrails", "#guardrails"]].map(([n, l, h]) => (
                <a key={h} href={h} className="group flex items-baseline gap-1.5 text-[13.5px] text-paper-2 transition hover:text-paper">
                  <span className="font-mono text-[10.5px] text-faint group-hover:text-accent">{n}</span>
                  {l}
                </a>
              ))}
              <Link href="/architecture" className="flex items-center gap-1 text-[13.5px] text-paper-2 transition hover:text-paper">
                Architecture <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <button onClick={onLaunch} className="group inline-flex items-center gap-2 bg-paper px-4 py-2.5 text-[13.5px] font-medium text-ink transition hover:bg-accent">
              Open helpdesk <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </button>
          </div>
        </motion.nav>

        {/* headline block */}
        <motion.div style={{ y: contentY, opacity: fade }} className="absolute inset-x-0 bottom-[86px] z-10">
          <div className="mx-auto grid max-w-[1440px] gap-10 px-5 sm:px-8 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-8">
              <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.9, delay: 0.3, ease: EASE }} className="mb-6 flex items-center gap-3">
                <span className="h-px w-8 bg-accent" />
                <span className="label text-paper-2">Prototype · fictional sample policies</span>
              </motion.div>
              <h1 className="text-[clamp(3rem,8.4vw,8.6rem)] font-semibold leading-[0.9] tracking-[-0.05em] text-paper">
                <LineReveal delay={0.35} lines={["HR & IT answers,", <>with the <span className="text-accent">receipts.</span></>]} />
              </h1>
            </div>
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 0.9, ease: EASE }} className="lg:col-span-4 lg:pb-3">
              <p className="max-w-md text-[16px] leading-relaxed text-paper-2">
                Ask about leave, expenses, VPN or MFA. Every policy answer cites the section it came from. Your own leave balance comes from a permission-checked lookup. When the documents don’t say, it tells you so instead of guessing.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <button onClick={onLaunch} className="group inline-flex items-center gap-2.5 bg-paper px-6 py-3.5 text-[15px] font-medium text-ink transition hover:bg-accent">
                  Open the helpdesk <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </button>
                <a href="#method" className="inline-flex items-center gap-2 border border-rule-strong px-5 py-3.5 text-[15px] text-paper transition hover:border-paper">
                  How it works
                </a>
              </div>
            </motion.div>
          </div>
        </motion.div>

        {/* status bar */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 1.2 }} className="absolute inset-x-0 bottom-0 z-10 border-t border-rule">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-5 py-4 sm:px-8">
            <div className="flex items-center gap-6">
              <span className="label flex items-center gap-2">
                <span className={cn("h-1.5 w-1.5", online === null ? "bg-faint" : online ? "bg-ok" : "bg-stop")} />
                {online === null ? "Checking service" : online ? "Service online" : "Service waking up"}
              </span>
              <span className="label hidden sm:inline">Local <Clock className="text-paper-2" /></span>
            </div>
            <span className="label hidden md:inline">6 documents · 35 sections · 2 MCP tools</span>
            <a href="#method" className="label flex items-center gap-1.5 transition hover:text-paper">
              Scroll <ArrowDown className="h-3 w-3" />
            </a>
          </div>
        </motion.div>
      </section>

      {/* ====================== 01 METHOD ====================== */}
      <section id="method" className="mx-auto max-w-[1440px] px-5 pb-28 pt-28 sm:px-8 sm:pt-40">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="lg:sticky lg:top-28">
              <Reveal><span className="label"><span className="text-accent">01</span> — Method</span></Reveal>
              <h2 className="mt-5 text-[clamp(2.2rem,4.2vw,3.8rem)] font-semibold leading-[0.98] tracking-[-0.04em]">
                <LineReveal inView lines={["One question,", "four possible", "routes."]} />
              </h2>
              <Reveal delay={0.2}>
                <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-mute">
                  A LangGraph state machine decides the route before anything is retrieved or looked up. The language model never decides who you are or what you may see.
                </p>
              </Reveal>
            </div>
          </div>

          <div className="lg:col-span-8">
            {ROUTES.map((r, i) => (
              <Reveal key={r.title} delay={i * 0.06}>
                <div className="group grid grid-cols-[3rem_1fr] gap-x-4 border-t border-rule py-8 sm:grid-cols-[4rem_1fr_12rem]">
                  <span className="font-mono text-[12px] text-faint transition group-hover:text-accent">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 className="text-[22px] font-medium tracking-[-0.02em] text-paper sm:text-[26px]">{r.title}</h3>
                    <p className="mt-2.5 max-w-xl text-[15px] leading-relaxed text-mute">{r.body}</p>
                  </div>
                  <span className="label col-start-2 mt-4 sm:col-start-auto sm:mt-1.5 sm:text-right">{r.tag}</span>
                </div>
              </Reveal>
            ))}
            <Rule />

            {/* pipeline strip */}
            <Reveal delay={0.1}>
              <div className="mt-16">
                <span className="label">The policy route, stage by stage</span>
                <div className="relative mt-5 grid grid-cols-2 border-l border-t border-rule sm:grid-cols-3 lg:grid-cols-6">
                  {STAGES.map((s) => (
                    <div key={s.k} className="border-b border-r border-rule p-4">
                      <div className="font-mono text-[10.5px] text-faint">{s.k}</div>
                      <div className="mt-2 text-[14.5px] font-medium text-paper">{s.t}</div>
                      <div className="mt-1 font-mono text-[11px] text-mute">{s.s}</div>
                    </div>
                  ))}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden">
                    <div className="h-px w-1/3 animate-scan bg-accent" />
                  </div>
                </div>
              </div>
            </Reveal>

            {/* specimen */}
            <Reveal delay={0.1}>
              <div className="mt-16 grid border border-rule sm:grid-cols-[1fr_1.3fr]">
                <div className="border-b border-rule p-6 sm:border-b-0 sm:border-r">
                  <span className="label">Specimen · question</span>
                  <p className="mt-4 text-[20px] leading-snug tracking-[-0.01em] text-paper">“How much home internet expense can I claim each month?”</p>
                </div>
                <div className="p-6">
                  <span className="label">Answer, as returned</span>
                  <p className="mt-4 text-[15.5px] leading-relaxed text-paper-2">
                    You can claim up to <span className="font-semibold text-paper">INR 1,000 per month</span> for home internet
                    <sup className="ml-0.5 border border-rule-strong px-1 font-mono text-[10px] text-accent">1</sup>, subject to manager pre-approval and a valid receipt
                    <sup className="ml-0.5 border border-rule-strong px-1 font-mono text-[10px] text-accent">2</sup>.
                  </p>
                  <div className="mt-5 space-y-1.5 border-t border-rule pt-4 font-mono text-[11.5px] text-mute">
                    <div><span className="text-accent">1</span>&nbsp; HR-POL-003 · §3.15 Sample limits · v1.0</div>
                    <div><span className="text-accent">2</span>&nbsp; HR-POL-003 · §3.14 Eligible expenses · v1.0</div>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ====================== 02 EVIDENCE ====================== */}
      <section id="evidence" className="border-t border-rule">
        <div className="mx-auto max-w-[1440px] px-5 py-28 sm:px-8 sm:py-36">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <Reveal><span className="label"><span className="text-accent">02</span> — Evidence</span></Reveal>
              <h2 className="mt-5 text-[clamp(2.2rem,4.2vw,3.8rem)] font-semibold leading-[0.98] tracking-[-0.04em]">
                <LineReveal inView lines={["Measured on", "labelled questions,", "not adjectives."]} />
              </h2>
            </div>
            <Reveal delay={0.15} className="lg:col-span-5 lg:col-start-8 lg:self-end">
              <p className="text-[15px] leading-relaxed text-mute">
                {evalData?.n_queries ?? 48} labelled questions and {evalData?.n_negatives ?? 12} out-of-corpus negatives, run against four retrieval configurations. Numbers are read live from the evaluation file in the repository.
              </p>
            </Reveal>
          </div>

          <MetricRow data={evalData} />
          <ComparisonTable data={evalData} />
        </div>
      </section>

      {/* ====================== 03 GUARDRAILS ====================== */}
      <section id="guardrails" className="border-t border-rule">
        <div className="mx-auto max-w-[1440px] px-5 py-28 sm:px-8 sm:py-36">
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <Reveal><span className="label"><span className="text-accent">03</span> — Guardrails</span></Reveal>
              <h2 className="mt-5 text-[clamp(2.2rem,4.2vw,3.8rem)] font-semibold leading-[0.98] tracking-[-0.04em]">
                <LineReveal inView lines={["Enforced in code,", "not in a prompt."]} />
              </h2>
            </div>
            <div className="grid gap-x-10 sm:grid-cols-2 lg:col-span-8">
              {GUARDS.map((g, i) => (
                <Reveal key={g.t} delay={(i % 2) * 0.08}>
                  <div className="border-t border-rule py-7">
                    <div className="flex items-baseline justify-between gap-4">
                      <h3 className="text-[19px] font-medium tracking-[-0.015em] text-paper">{g.t}</h3>
                      <span className="font-mono text-[10.5px] text-faint">{g.k}</span>
                    </div>
                    <p className="mt-3 text-[14.5px] leading-relaxed text-mute">{g.b}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ====================== CTA BAND ====================== */}
      <section className="relative h-[78svh] min-h-[520px] overflow-hidden border-t border-rule">
        <BackgroundVideo scale={1.35} overlayClassName="bg-[linear-gradient(180deg,#0a0a0b_0%,rgba(10,10,11,0.55)_30%,rgba(10,10,11,0.55)_70%,#0a0a0b_100%)]" />
        <div className="relative z-10 mx-auto flex h-full max-w-[1440px] flex-col justify-center px-5 sm:px-8">
          <span className="label text-paper-2">Open to recruiters · no sign-up</span>
          <h2 className="mt-6 text-[clamp(3rem,9vw,9rem)] font-semibold leading-[0.88] tracking-[-0.055em]">
            <LineReveal inView lines={["Try to", <span key="b" className="text-accent">break it.</span>]} />
          </h2>
          <Reveal delay={0.2}>
            <div className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-center">
              <button onClick={onLaunch} className="group inline-flex w-fit items-center gap-2.5 bg-paper px-6 py-3.5 text-[15px] font-medium text-ink transition hover:bg-accent">
                Choose a test employee <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </button>
              <p className="max-w-md text-[14.5px] text-paper-2">Ask for someone else’s balance, paste a prompt injection, or ask for the system prompt. The trace shows exactly where it stops.</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ====================== FOOTER ====================== */}
      <footer className="border-t border-rule">
        <div className="mx-auto grid max-w-[1440px] gap-6 px-5 py-10 sm:grid-cols-3 sm:px-8">
          <Logo />
          <p className="text-[13px] leading-relaxed text-mute">All policies, people and balances are fictional test data. This is not official Go AI Field policy or employee information.</p>
          <div className="flex flex-col gap-1.5 sm:items-end">
            <Link href="/architecture" className="label transition hover:text-paper">Architecture &amp; evaluation ↗</Link>
            <a href="https://github.com/SaiPranav13188/go-ai-field-hr-it-helpdesk-agent" target="_blank" rel="noreferrer" className="label transition hover:text-paper">Source on GitHub ↗</a>
            <span className="label text-faint">Footage: Mixkit (free license)</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

const ROUTES = [
  { title: "Policy questions", body: "Hybrid search over the policy library, a cross-encoder reranker, then an answer that may only use the passages it was given, with every claim cited.", tag: "Hybrid RAG → cited answer" },
  { title: "Your own records", body: "Your leave balance comes from a narrow MCP tool. Identity is taken from your signed session, never from what you type, and the database enforces row-level access.", tag: "MCP → Postgres (RLS)" },
  { title: "Unsafe requests", body: "Prompt injection, bulk data requests and attempts to extract secrets are refused before any tool or search runs.", tag: "Refused · 0 tools" },
  { title: "Off-topic questions", body: "Cricket scores and weather are politely declined. It is a helpdesk, not a general chatbot.", tag: "Declined · no search" },
];

const STAGES = [
  { k: "A", t: "BGE-M3 dense", s: "meaning, multilingual" },
  { k: "B", t: "BM25 sparse", s: "exact IDs, acronyms" },
  { k: "C", t: "RRF fusion", s: "ranks, not scores" },
  { k: "D", t: "Reranker", s: "bge-reranker-v2-m3" },
  { k: "E", t: "Evidence gate", s: "calibrated threshold" },
  { k: "F", t: "Output check", s: "citations · numbers · PII" },
];

const GUARDS = [
  { k: "IDENTITY", t: "Session, not chat", b: "Typing “I am E103” changes nothing. The lookup tool has no employee-ID parameter; identity comes from a signed, single-use, 60-second assertion." },
  { k: "DATABASE", t: "Least privilege, twice", b: "A read-only role with column-level grants, plus row-level security. Names and e-mails are not even readable by the service." },
  { k: "INJECTION", t: "Four independent layers", b: "Deterministic rules, an intent classifier, fenced untrusted content, and server-side authorization that holds even if the first three fail." },
  { k: "OUTPUT", t: "Checked before you see it", b: "Citations must map to retrieved passages and every number must exist in the evidence. Anything else becomes a safe abstention." },
  { k: "PRIVACY", t: "PII stays out", b: "Passwords and codes are stripped from your message before the model sees it. Logs keep a hash of your text, never the text." },
  { k: "HONESTY", t: "Knows when it doesn’t know", b: "If the documents don’t specify something, such as the exact health cover for parents, it says so and points you to HR." },
];

function MetricRow({ data }: { data: Eval | null }) {
  const best = data?.summary?.hybrid_rerank;
  const gate = data?.calibration?.configured_gate;
  const items = [
    { l: "Recall@5", v: best?.recall_at_5, d: 3, n: "primary passage in top five" },
    { l: "MRR@10", v: best?.mrr_at_10, d: 3, n: "how high the first hit ranks" },
    { l: "nDCG@10", v: best?.ndcg_at_10, d: 3, n: "graded ranking quality" },
    { l: "Negatives rejected", v: gate ? gate.negative_reject_rate * 100 : undefined, d: 0, s: "%", n: "out-of-corpus → abstain" },
  ];
  return (
    <div className="mt-20 grid grid-cols-2 border-l border-t border-rule lg:grid-cols-4">
      {items.map((it, i) => (
        <Reveal key={it.l} delay={i * 0.07} className="border-b border-r border-rule p-6">
          <span className="label">{it.l}</span>
          <div className="mt-5 text-[clamp(2.8rem,6vw,5.6rem)] font-semibold leading-none tracking-[-0.05em] text-paper">
            {it.v === undefined ? <span className="text-faint">—</span> : <AnimatedNumber value={it.v} decimals={it.d} suffix={it.s} />}
          </div>
          <div className="mt-3 text-[13px] text-mute">{it.n}</div>
        </Reveal>
      ))}
    </div>
  );
}

function ComparisonTable({ data }: { data: Eval | null }) {
  if (!data?.summary) return null;
  const modes = ["bm25", "dense", "hybrid", "hybrid_rerank"] as const;
  return (
    <Reveal delay={0.1}>
      <div className="mt-14">
        <div className="grid grid-cols-[1fr_4.5rem] gap-4 border-b border-rule pb-3 sm:grid-cols-[16rem_1fr_5rem_5rem]">
          <span className="label">Configuration</span>
          <span className="label hidden sm:block">nDCG@10</span>
          <span className="label hidden text-right sm:block">MRR@10</span>
          <span className="label text-right">nDCG</span>
        </div>
        {modes.map((m, i) => {
          const r = data.summary![m];
          const best = m === "hybrid_rerank";
          return (
            <div key={m} className="grid grid-cols-[1fr_4.5rem] items-center gap-4 border-b border-rule py-4 sm:grid-cols-[16rem_1fr_5rem_5rem]">
              <span className={cn("text-[15px]", best ? "font-medium text-paper" : "text-mute")}>{r.label}</span>
              <div className="hidden h-[3px] bg-rule sm:block">
                <motion.div
                  className={cn("h-full", best ? "bg-accent" : "bg-paper-2/50")}
                  initial={{ width: 0 }}
                  whileInView={{ width: `${r.ndcg_at_10 * 100}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 1.4, delay: 0.15 + i * 0.1, ease: EASE }}
                />
              </div>
              <span className={cn("hidden text-right font-mono text-[13px] tabular-nums sm:block", best ? "text-paper" : "text-mute")}>{r.mrr_at_10.toFixed(3)}</span>
              <span className={cn("text-right font-mono text-[13px] tabular-nums", best ? "text-accent" : "text-mute")}>{r.ndcg_at_10.toFixed(3)}</span>
            </div>
          );
        })}
        <p className="mt-4 text-[12.5px] text-faint">Hybrid fusion alone scores slightly below dense-only on this small corpus; the reranker turns it into the best configuration. Reported as measured.</p>
      </div>
    </Reveal>
  );
}

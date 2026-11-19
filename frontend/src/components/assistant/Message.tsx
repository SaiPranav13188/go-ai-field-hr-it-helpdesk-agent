"use client";

import { AnimatePresence, motion } from "motion/react";
import { Children, isValidElement, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  BookMarked,
  CheckCircle2,
  CircleSlash,
  Clock3,
  Compass,
  Database,
  FileQuestion,
  Info,
  KeyRound,
  LifeBuoy,
  ShieldX,
  Sparkles,
  Workflow,
} from "lucide-react";
import { AnimatedNumber, EASE, cn } from "@/components/fx/primitives";
import type { ChatMessage, Citation, FinalPayload } from "@/lib/types";

export const STATUS: Record<string, { label: string; icon: typeof CheckCircle2; cls: string; ring: string }> = {
  answered: { label: "Verified answer", icon: CheckCircle2, cls: "text-mint border-mint/25 bg-mint/10", ring: "from-mint/40" },
  partial: { label: "Partially covered", icon: FileQuestion, cls: "text-sky border-sky/25 bg-sky/10", ring: "from-sky/40" },
  not_in_documents: { label: "Not in documents", icon: FileQuestion, cls: "text-sky border-sky/25 bg-sky/10", ring: "from-sky/40" },
  personal_data: { label: "Your record · via MCP", icon: KeyRound, cls: "text-mint border-mint/25 bg-mint/10", ring: "from-mint/40" },
  abstained: { label: "Safe abstention", icon: LifeBuoy, cls: "text-sky border-sky/25 bg-sky/10", ring: "from-sky/40" },
  refused: { label: "Blocked", icon: ShieldX, cls: "text-rose border-rose/30 bg-rose/10", ring: "from-rose/50" },
  denied: { label: "Access denied", icon: Ban, cls: "text-rose border-rose/30 bg-rose/10", ring: "from-rose/50" },
  out_of_scope: { label: "Outside HR & IT", icon: Compass, cls: "text-amber border-amber/30 bg-amber/10", ring: "from-amber/40" },
  info: { label: "Helpdesk", icon: Sparkles, cls: "text-violet border-violet/25 bg-violet/10", ring: "from-violet/40" },
  invalid: { label: "Invalid input", icon: CircleSlash, cls: "text-amber border-amber/30 bg-amber/10", ring: "from-amber/40" },
};

const CATEGORY_LABEL: Record<string, string> = {
  bulk_personal_data: "Bulk personal-data request",
  secret_extraction: "Secret / prompt extraction",
  instruction_override: "Prompt injection",
  sql_injection: "SQL injection",
  role_escalation: "Role escalation",
};

export function UserBubble({ content }: { content: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.5, ease: EASE }} className="flex justify-end">
      <div className="max-w-[min(85%,38rem)] whitespace-pre-wrap break-words rounded-[1.35rem] rounded-br-md border border-white/[0.09] bg-gradient-to-b from-white/[0.10] to-white/[0.05] px-4 py-3 text-[15px] leading-relaxed text-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)]">
        {content}
      </div>
    </motion.div>
  );
}

export function AssistantMessage({
  msg,
  selected,
  onSelect,
  onOpenCitation,
}: {
  msg: Extract<ChatMessage, { role: "assistant" }>;
  selected: boolean;
  onSelect: () => void;
  onOpenCitation: (c: Citation) => void;
}) {
  const f = msg.final;
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="group flex gap-3 sm:gap-4">
      <AgentAvatar active={msg.pending} />
      <div className="min-w-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          {msg.pending ? (
            <Thinking key="thinking" msg={msg} />
          ) : msg.error ? (
            <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-2.5 rounded-2xl border border-rose/25 bg-rose/[0.07] px-4 py-3 text-sm text-rose">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {msg.error}
            </motion.div>
          ) : f ? (
            <motion.div key="final" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
              <FinalView f={f} onOpenCitation={onOpenCitation} />
              <MetaRow f={f} selected={selected} onSelect={onSelect} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function AgentAvatar({ active }: { active: boolean }) {
  return (
    <div className="relative mt-0.5 h-8 w-8 shrink-0">
      {active && <span className="absolute inset-0 rounded-full bg-violet/50 animate-pulse-ring" />}
      <div className={cn("absolute inset-0 rounded-full p-[1.5px]", active ? "animate-spin-slow" : "")} style={{ background: "conic-gradient(from 180deg,#6d5dfc,#38d6f5,#3ee6a8,#ff7ab6,#6d5dfc)" }}>
        <div className="grid h-full w-full place-items-center rounded-full bg-ink-900">
          <div className="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-violet to-cyan shadow-[0_0_12px_rgba(139,123,255,0.9)]" />
        </div>
      </div>
    </div>
  );
}

function Thinking({ msg }: { msg: Extract<ChatMessage, { role: "assistant" }> }) {
  const stages = msg.trace.stages;
  const running = [...stages].reverse().find((s) => s.status === "start" && !stages.some((d) => d.node === s.node && d.status === "done"));
  const done = stages.filter((s) => s.status === "done");
  const label = running?.label ?? (done.length ? done[done.length - 1].label : "Connecting");
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, filter: "blur(4px)" }} className="pt-1">
      <AnimatePresence mode="wait">
        <motion.div key={label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }} className="shimmer-text text-[15px] font-medium">
          {label}…
        </motion.div>
      </AnimatePresence>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {done.map((s) => (
          <motion.span key={s.node} layout initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10.5px] text-fg-muted">
            {s.node.replace(/_/g, " ")} <span className="text-fg-subtle">{Math.round(s.ms ?? 0)}ms</span>
          </motion.span>
        ))}
      </div>
    </motion.div>
  );
}

function FinalView({ f, onOpenCitation }: { f: FinalPayload; onOpenCitation: (c: Citation) => void }) {
  const st = STATUS[f.status] ?? STATUS.info;
  const blocked = f.status === "refused" || f.status === "denied";
  return (
    <div>
      <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, ease: EASE }} className={cn("mb-2.5 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium", st.cls)}>
        <st.icon className="h-3.5 w-3.5" /> {st.label}
        {blocked && f.security.category && <span className="opacity-70">· {CATEGORY_LABEL[f.security.category] ?? f.security.category}</span>}
      </motion.div>

      {f.notices.map((n) => (
        <div key={n} className="mb-3 flex items-start gap-2 rounded-xl border border-amber/25 bg-amber/[0.07] px-3.5 py-2.5 text-[13px] text-amber">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {n}
        </div>
      ))}

      {f.personal_data && <BalanceCard data={f.personal_data} />}

      {blocked ? (
        <BlockedCard f={f} />
      ) : (
        <div className={cn(f.personal_data && "mt-3")}>
          <AnswerMarkdown text={f.answer} citations={f.citations} onOpen={onOpenCitation} />
        </div>
      )}

      {f.escalation && <EscalationCard e={f.escalation} />}

      {f.citations.length > 0 && <Sources citations={f.citations} onOpen={onOpenCitation} />}
    </div>
  );
}

function BlockedCard({ f }: { f: FinalPayload }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.6, ease: EASE }}
      className="relative overflow-hidden rounded-2xl border border-rose/25 bg-gradient-to-br from-rose/[0.12] via-rose/[0.04] to-transparent p-4 sm:p-5">
      <motion.div className="absolute -left-10 -top-10 h-32 w-32 rounded-full bg-rose/25 blur-3xl" animate={{ opacity: [0.4, 0.8, 0.4] }} transition={{ duration: 3, repeat: Infinity }} />
      <div className="relative flex gap-3.5">
        <motion.div initial={{ rotate: -20, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 14 }} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-rose/30 bg-rose/15">
          <ShieldX className="h-5 w-5 text-rose" />
        </motion.div>
        <div className="answer-md text-[15px]">
          <ReactMarkdown>{f.answer}</ReactMarkdown>
          <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-fg-muted">tools called: {f.tool_calls.length}</span>
            <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-fg-muted">records disclosed: 0</span>
            {f.security.flags.slice(0, 3).map((fl, i) => (
              <span key={i} className="rounded-md border border-rose/20 bg-rose/[0.08] px-2 py-0.5 font-mono text-rose/90">{fl.rule.replace(/_/g, " ")}</span>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

const ENTITLEMENT: Record<string, number> = { earned: 18, casual: 6, sick: 6 };
const LEAVE_META: Record<string, { label: string; color: string }> = {
  earned: { label: "Earned leave", color: "#8b7bff" },
  casual: { label: "Casual leave", color: "#38d6f5" },
  sick: { label: "Sick leave", color: "#3ee6a8" },
};

function BalanceCard({ data }: { data: NonNullable<FinalPayload["personal_data"]> }) {
  const entries = Object.entries(data.balances);
  return (
    <motion.div initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.7, ease: EASE }}
      className="relative overflow-hidden rounded-2xl border border-mint/20 bg-gradient-to-br from-mint/[0.09] via-white/[0.02] to-transparent p-4 sm:p-5">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-mint/15 blur-3xl" />
      <div className={cn("relative grid gap-4", entries.length > 1 ? "sm:grid-cols-3" : "")}>
        {entries.map(([k, v], i) => {
          const meta = LEAVE_META[k] ?? { label: k, color: "#fff" };
          const pct = Math.min(1, v / (ENTITLEMENT[k] ?? Math.max(v, 1)));
          return (
            <div key={k} className="flex items-center gap-4">
              <div className="relative h-[74px] w-[74px] shrink-0">
                <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
                  <circle cx="40" cy="40" r="34" stroke="rgba(255,255,255,0.08)" strokeWidth="7" fill="none" />
                  <motion.circle cx="40" cy="40" r="34" stroke={meta.color} strokeWidth="7" fill="none" strokeLinecap="round"
                    initial={{ pathLength: 0 }} animate={{ pathLength: pct }} transition={{ duration: 1.6, delay: 0.2 + i * 0.15, ease: EASE }}
                    style={{ filter: `drop-shadow(0 0 6px ${meta.color}88)` }} />
                </svg>
                <div className="absolute inset-0 grid place-items-center">
                  <AnimatedNumber value={v} decimals={Number.isInteger(v) ? 0 : 1} className="text-2xl font-semibold tabular-nums text-white" />
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-white">{meta.label}</div>
                <div className="text-xs text-fg-muted">days remaining{ENTITLEMENT[k] ? ` · of ${ENTITLEMENT[k]} annual (sample policy)` : ""}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="relative mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/[0.07] pt-3 font-mono text-[11px] text-fg-subtle">
        <span className="inline-flex items-center gap-1.5 text-mint/90"><Database className="h-3.5 w-3.5" /> PostgreSQL · RLS · read-only</span>
        <span>via MCP get_my_leave_balance</span>
        {data.as_of && <span>updated {data.as_of.slice(0, 10)}</span>}
      </div>
    </motion.div>
  );
}

function EscalationCard({ e }: { e: NonNullable<FinalPayload["escalation"]> }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.25, ease: EASE }}
      className="mt-3.5 flex items-start gap-3 rounded-2xl border border-sky/20 bg-sky/[0.06] px-4 py-3">
      <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-sky" />
      <div className="text-[13px] leading-relaxed text-fg-muted">
        <span className="font-medium text-white">Recommended next step:</span> contact {e.team}.
        <span className="block text-fg-subtle">No ticket was created. This prototype has no ticketing integration.</span>
      </div>
    </motion.div>
  );
}

/** Markdown with block-level staggered reveal and interactive [n] citation chips. */
function AnswerMarkdown({ text, citations, onOpen }: { text: string; citations: Citation[]; onOpen: (c: Citation) => void }) {
  const md = useMemo(() => text.replace(/\[(\d{1,2})\]/g, (_, n) => `[${n}](#cite-${n})`), [text]);
  // Stable component identities: recreating them would remount blocks and replay the reveal.
  const components = useMemo(() => {
    let block = 0;
    const reveal = (Tag: "p" | "li") =>
      function Block({ children }: { children?: ReactNode }) {
        const [i] = useState(() => block++);
        const M = Tag === "p" ? motion.p : motion.li;
        return (
          <M initial={{ opacity: 0, y: 8, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.55, delay: 0.05 + i * 0.09, ease: EASE }}>
            {children}
          </M>
        );
      };
    return { p: reveal("p"), li: reveal("li") };
  }, []);
  return (
    <div className="answer-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          ...components,
          a: ({ href, children }) => {
            const m = href?.match(/^#cite-(\d+)$/);
            if (m) {
              const c = citations.find((x) => x.n === Number(m[1]));
              if (c) return <CitationChip c={c} onOpen={onOpen} />;
              return null;
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" className="text-violet underline-offset-2 hover:underline">
                {Children.toArray(children).filter((x) => isValidElement(x) || typeof x === "string")}
              </a>
            );
          },
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}

function CitationChip({ c, onOpen }: { c: Citation; onOpen: (c: Citation) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <span className="relative inline-block align-baseline" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 18, delay: 0.3 }}
        onClick={() => onOpen(c)}
        className="mx-0.5 inline-grid h-[1.3rem] min-w-[1.3rem] -translate-y-px place-items-center rounded-md border border-violet/35 bg-violet/15 px-1 font-mono text-[10.5px] font-semibold text-[#cfc8ff] transition hover:border-violet hover:bg-violet/30 hover:text-white"
        aria-label={`Source ${c.n}: ${c.document_title} section ${c.section}`}
      >
        {c.n}
      </motion.button>
      <AnimatePresence>
        {hover && (
          <motion.span
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="absolute bottom-full left-1/2 z-30 mb-2 block w-72 -translate-x-1/2 rounded-xl p-3 text-left glass-strong"
          >
            <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-violet">{c.document_id} · §{c.section_number}</span>
            <span className="mt-1 block text-[13px] font-medium text-white">{c.document_title}: {c.section.replace(/^[\d.]+\s/, "")}</span>
            <span className="mt-1.5 line-clamp-4 block text-[12px] leading-relaxed text-fg-muted">{c.excerpt.replace(/[|*#`]/g, " ").replace(/\s+/g, " ")}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function Sources({ citations, onOpen }: { citations: Citation[]; onOpen: (c: Citation) => void }) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
        <BookMarked className="h-3.5 w-3.5" /> {citations.some((c) => c.related_only) ? "Related sections" : "Sources"}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {citations.map((c, i) => (
          <motion.button
            key={c.chunk_id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35 + i * 0.08, ease: EASE }}
            whileHover={{ y: -2 }}
            onClick={() => onOpen(c)}
            className="group/src relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 text-left transition-colors hover:border-violet/40 hover:bg-violet/[0.06]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <span className="grid h-5 min-w-5 place-items-center rounded-md bg-violet/20 px-1 font-mono text-[10.5px] font-semibold text-[#cfc8ff]">{c.n}</span>
                <span className="font-mono text-[11px] text-fg-muted">{c.document_id}</span>
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 text-fg-subtle transition group-hover/src:-translate-y-0.5 group-hover/src:translate-x-0.5 group-hover/src:text-white" />
            </div>
            <div className="mt-1.5 truncate text-[13px] font-medium text-white">
              {c.document_title} · §{c.section_number} {c.section.replace(/^[\d.]+\s/, "")}
            </div>
            <div className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-fg-muted">{c.excerpt.replace(/[|*#`]/g, " ").replace(/-{3,}/g, " ").replace(/\s+/g, " ")}</div>
            <div className="mt-2.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                <motion.div className="h-full rounded-full bg-gradient-to-r from-violet to-cyan" initial={{ width: 0 }} animate={{ width: `${Math.max(4, c.rerank_score * 100)}%` }} transition={{ duration: 1, delay: 0.5 + i * 0.1, ease: EASE }} />
              </div>
              <span className="font-mono text-[10px] tabular-nums text-fg-subtle">rel {c.rerank_score.toFixed(3)}</span>
            </div>
            <div className="mt-1 font-mono text-[10px] text-fg-subtle">v{c.version} · effective {c.effective_date}</div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function MetaRow({ f, selected, onSelect }: { f: FinalPayload; selected: boolean; onSelect: () => void }) {
  const total = f.timings.total_ms;
  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[11px] text-fg-subtle">
      <span className="inline-flex items-center gap-1"><Workflow className="h-3 w-3" /> route: {f.route}</span>
      {total !== undefined && <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" /> {(total / 1000).toFixed(2)}s</span>}
      {f.tool_calls.map((t) => (
        <span key={t.tool} className="inline-flex items-center gap-1 text-mint/80"><KeyRound className="h-3 w-3" /> {t.tool} · {t.status}</span>
      ))}
      {f.security.output_flags.includes("pii_redacted") && <span className="inline-flex items-center gap-1 text-amber/80"><Info className="h-3 w-3" /> PII redacted</span>}
      <button onClick={onSelect} className={cn("ml-auto rounded-md border px-2 py-0.5 transition", selected ? "border-violet/40 bg-violet/15 text-violet" : "border-white/10 text-fg-subtle hover:border-white/25 hover:text-fg")}>
        {selected ? "Showing trace" : "View trace"}
      </button>
    </div>
  );
}

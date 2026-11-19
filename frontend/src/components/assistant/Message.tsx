"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUpRight } from "lucide-react";
import { AnimatedNumber, EASE, cn } from "@/components/fx/primitives";
import type { ChatMessage, Citation, FinalPayload } from "@/lib/types";

/** Status → mono label + one semantic colour. No pills, no icons-as-decoration. */
export const STATUS: Record<string, { label: string; dot: string; text: string }> = {
  answered: { label: "Verified answer", dot: "bg-ok", text: "text-ok" },
  partial: { label: "Partly covered by the documents", dot: "bg-info", text: "text-info" },
  not_in_documents: { label: "Not in the documents", dot: "bg-info", text: "text-info" },
  personal_data: { label: "Your record · via MCP", dot: "bg-ok", text: "text-ok" },
  abstained: { label: "Abstained, won’t guess", dot: "bg-info", text: "text-info" },
  refused: { label: "Blocked", dot: "bg-stop", text: "text-stop" },
  denied: { label: "Access denied", dot: "bg-stop", text: "text-stop" },
  out_of_scope: { label: "Outside HR & IT", dot: "bg-accent", text: "text-accent" },
  info: { label: "Helpdesk", dot: "bg-paper-2", text: "text-paper-2" },
  invalid: { label: "Invalid input", dot: "bg-accent", text: "text-accent" },
};

const CATEGORY_LABEL: Record<string, string> = {
  bulk_personal_data: "bulk personal-data request",
  secret_extraction: "secret / prompt extraction",
  instruction_override: "prompt injection",
  sql_injection: "SQL injection",
  role_escalation: "role escalation",
};

export function UserBubble({ content }: { content: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }} className="flex flex-col items-end">
      <span className="label mb-2">You</span>
      <div className="max-w-[min(88%,36rem)] whitespace-pre-wrap break-words border border-rule bg-ink-3 px-4 py-3 text-[15.5px] leading-relaxed text-paper">{content}</div>
    </motion.div>
  );
}

export function AssistantMessage({ msg, selected, onSelect, onOpenCitation }: {
  msg: Extract<ChatMessage, { role: "assistant" }>;
  selected: boolean;
  onSelect: () => void;
  onOpenCitation: (c: Citation) => void;
}) {
  const f = msg.final;
  const st = f ? STATUS[f.status] ?? STATUS.info : null;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }}>
      <div className="mb-3 flex items-center gap-3">
        <span className="label">Helpdesk</span>
        {st && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={cn("label flex items-center gap-1.5", st.text)}>
            <span className={cn("h-1.5 w-1.5", st.dot)} />
            {st.label}
            {(f!.status === "refused" || f!.status === "denied") && f!.security.category && <span className="text-mute">· {CATEGORY_LABEL[f!.security.category] ?? f!.security.category}</span>}
          </motion.span>
        )}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {msg.pending ? (
          <Thinking key="t" msg={msg} />
        ) : msg.error ? (
          <motion.div key="e" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border-l-2 border-stop pl-4 text-[15px] text-stop">
            {msg.error}
          </motion.div>
        ) : f ? (
          <motion.div key="f" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
            <FinalView f={f} onOpenCitation={onOpenCitation} />
            <MetaRow f={f} selected={selected} onSelect={onSelect} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

function Thinking({ msg }: { msg: Extract<ChatMessage, { role: "assistant" }> }) {
  const stages = msg.trace.stages;
  const done = stages.filter((s) => s.status === "done");
  const running = [...stages].reverse().find((s) => s.status === "start" && !done.some((d) => d.node === s.node));
  const label = running?.label ?? (done.length ? done[done.length - 1].label : "Connecting to the service");
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="flex items-center gap-2 text-[15px] text-paper">
        <AnimatePresence mode="wait">
          <motion.span key={label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
            {label}
          </motion.span>
        </AnimatePresence>
        <span className="h-4 w-[7px] animate-blink bg-accent" />
      </div>
      <div className="relative mt-4 h-px w-full max-w-sm overflow-hidden bg-rule">
        <div className="absolute inset-y-0 w-1/3 animate-scan bg-accent" />
      </div>
      <div className="mt-3 font-mono text-[11px] text-faint">
        {done.length} step{done.length === 1 ? "" : "s"} complete
        {done.length > 0 && ` · last: ${done[done.length - 1].node.replace(/_/g, " ")} ${Math.round(done[done.length - 1].ms ?? 0)} ms`}
      </div>
    </motion.div>
  );
}

function FinalView({ f, onOpenCitation }: { f: FinalPayload; onOpenCitation: (c: Citation) => void }) {
  const blocked = f.status === "refused" || f.status === "denied";
  return (
    <div>
      {f.notices.map((n) => (
        <div key={n} className="mb-4 border-l-2 border-accent bg-accent-dim px-4 py-3 text-[14px] text-paper">{n}</div>
      ))}
      {f.personal_data && <BalanceCard data={f.personal_data} />}
      {blocked ? (
        <div className="border-l-2 border-stop pl-4">
          <div className="answer-md"><ReactMarkdown>{f.answer}</ReactMarkdown></div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11.5px] text-mute">
            <span>tools called: <span className="text-paper">{f.tool_calls.length}</span></span>
            <span>records disclosed: <span className="text-paper">0</span></span>
            {f.security.flags.length > 0 && <span>rules: <span className="text-stop">{[...new Set(f.security.flags.map((x) => x.rule.replace(/_/g, " ")))].slice(0, 3).join(", ")}</span></span>}
          </div>
        </div>
      ) : (
        <div className={cn(f.personal_data && "mt-5")}>
          <AnswerMarkdown text={f.answer} citations={f.citations} onOpen={onOpenCitation} />
        </div>
      )}
      {f.escalation && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-5 grid grid-cols-[6.5rem_1fr] border-y border-rule py-3 text-[14px]">
          <span className="label pt-0.5">Next step</span>
          <span className="text-paper-2">Contact <span className="text-paper">{f.escalation.team}</span>. <span className="text-mute">No ticket was created; this prototype has no ticketing integration.</span></span>
        </motion.div>
      )}
      {f.citations.length > 0 && <Sources citations={f.citations} onOpen={onOpenCitation} />}
    </div>
  );
}

const ENTITLEMENT: Record<string, number> = { earned: 18, casual: 6, sick: 6 };
const LEAVE_LABEL: Record<string, string> = { earned: "Earned leave", casual: "Casual leave", sick: "Sick leave" };

function BalanceCard({ data }: { data: NonNullable<FinalPayload["personal_data"]> }) {
  const entries = Object.entries(data.balances);
  return (
    <div className="border border-rule">
      <div className={cn("grid", entries.length > 1 ? "sm:grid-cols-3" : "")}>
        {entries.map(([k, v], i) => {
          const total = ENTITLEMENT[k];
          return (
            <div key={k} className={cn("p-5", i > 0 && "border-t border-rule sm:border-l sm:border-t-0")}>
              <span className="label">{LEAVE_LABEL[k] ?? k} · remaining</span>
              <div className="mt-3 flex items-baseline gap-2">
                <AnimatedNumber value={v} decimals={Number.isInteger(v) ? 0 : 1} className="text-[56px] font-semibold leading-none tracking-[-0.05em] text-paper" />
                <span className="text-[15px] text-mute">{v === 1 ? "day" : "days"}{total ? ` of ${total}` : ""}</span>
              </div>
              {total && (
                <div className="mt-4 h-[3px] bg-rule">
                  <motion.div className="h-full bg-accent" initial={{ width: 0 }} animate={{ width: `${Math.min(100, (v / total) * 100)}%` }} transition={{ duration: 1.3, delay: 0.2 + i * 0.1, ease: EASE }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-rule px-5 py-2.5 font-mono text-[11px] text-mute">
        <span className="text-ok">PostgreSQL · read-only · row-level security</span>
        <span>via MCP get_my_leave_balance</span>
        {data.as_of && <span>updated {data.as_of.slice(0, 10)}</span>}
      </div>
    </div>
  );
}

function AnswerMarkdown({ text, citations, onOpen }: { text: string; citations: Citation[]; onOpen: (c: Citation) => void }) {
  const md = useMemo(() => text.replace(/\[(\d{1,2})\]/g, (_, n) => `[${n}](#cite-${n})`), [text]);
  const components = useMemo(() => {
    let block = 0;
    const reveal = (Tag: "p" | "li") =>
      function Block({ children }: { children?: ReactNode }) {
        const [i] = useState(() => block++);
        const M = Tag === "p" ? motion.p : motion.li;
        return (
          <M initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.04 + i * 0.07, ease: EASE }}>
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
              return c ? <CitationMark c={c} onOpen={onOpen} /> : null;
            }
            return <a href={href} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">{children}</a>;
          },
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}

function CitationMark({ c, onOpen }: { c: Citation; onOpen: (c: Citation) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <span className="relative inline-block" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        onClick={() => onOpen(c)}
        className="mx-0.5 inline-grid h-[18px] min-w-[18px] -translate-y-[3px] place-items-center border border-rule-strong px-1 font-mono text-[10px] text-accent transition hover:border-accent hover:bg-accent hover:text-ink"
        aria-label={`Source ${c.n}: ${c.document_title} section ${c.section}`}
      >
        {c.n}
      </button>
      <AnimatePresence>
        {hover && (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-1/2 z-30 mb-2 block w-72 -translate-x-1/2 border border-rule-strong bg-ink-2 p-3 text-left shadow-[0_20px_40px_-10px_rgba(0,0,0,0.8)]"
          >
            <span className="block font-mono text-[10.5px] text-accent">{c.document_id} · §{c.section_number}</span>
            <span className="mt-1 block text-[13px] font-medium text-paper">{c.document_title}: {c.section.replace(/^[\d.]+\s/, "")}</span>
            <span className="mt-1.5 line-clamp-4 block text-[12px] leading-relaxed text-mute">{c.excerpt.replace(/[|*#`]/g, " ").replace(/-{3,}/g, " ").replace(/\s+/g, " ")}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function Sources({ citations, onOpen }: { citations: Citation[]; onOpen: (c: Citation) => void }) {
  return (
    <div className="mt-6">
      <span className="label">{citations.some((c) => c.related_only) ? "Related sections" : "Sources"}</span>
      <div className="mt-2 border-t border-rule">
        {citations.map((c, i) => (
          <motion.button
            key={c.chunk_id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.25 + i * 0.06 }}
            onClick={() => onOpen(c)}
            className="group grid w-full grid-cols-[1.75rem_1fr_auto] items-start gap-3 border-b border-rule py-3 text-left transition-colors hover:bg-ink-2"
          >
            <span className="pt-0.5 font-mono text-[11px] text-accent">[{c.n}]</span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] text-paper">
                {c.document_title} — §{c.section_number} {c.section.replace(/^[\d.]+\s/, "")}
              </span>
              <span className="mt-1 block font-mono text-[11px] text-mute">
                {c.document_id} · v{c.version} · effective {c.effective_date} · relevance {c.rerank_score.toFixed(3)}
              </span>
            </span>
            <ArrowUpRight className="mt-0.5 h-4 w-4 text-faint transition group-hover:text-paper" />
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function MetaRow({ f, selected, onSelect }: { f: FinalPayload; selected: boolean; onSelect: () => void }) {
  const total = f.timings.total_ms;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-faint">
      <span>route {f.route}</span>
      {total !== undefined && <span>{(total / 1000).toFixed(2)} s</span>}
      {f.tool_calls.map((t) => <span key={t.tool} className="text-ok/80">{t.tool} · {t.status}</span>)}
      {f.security.output_flags.includes("pii_redacted") && <span className="text-accent">pii redacted</span>}
      <button onClick={onSelect} className={cn("ml-auto border px-2 py-0.5 uppercase tracking-wider transition", selected ? "border-accent text-accent" : "border-rule text-mute hover:border-paper hover:text-paper")}>
        {selected ? "Trace shown" : "Show trace"}
      </button>
    </div>
  );
}

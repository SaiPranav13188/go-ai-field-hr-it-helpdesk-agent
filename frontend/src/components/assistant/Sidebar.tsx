"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { EASE, cn } from "@/components/fx/primitives";
import { PROMPT_GROUPS } from "@/lib/prompts";
import type { DocSummary } from "@/lib/types";

type Props = {
  docs: DocSummary[];
  busy: boolean;
  asked: Set<string>;
  lastAsked: string | null;
  onAsk: (t: string) => void;
  onOpenDoc: (id: string) => void;
};

export default function Sidebar({ docs, busy, asked, lastAsked, onAsk, onOpenDoc }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({ policy: true, mine: false, edge: false, red: false, kb: false });
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  const groups = useMemo(
    () =>
      PROMPT_GROUPS.map((g) => ({
        ...g,
        items: query ? g.items.filter((it) => (it.label + " " + it.text + " " + (it.tag ?? "")).toLowerCase().includes(query)) : g.items,
      })).filter((g) => g.items.length > 0),
    [query],
  );
  const total = PROMPT_GROUPS.reduce((n, g) => n + g.items.length, 0);
  const askedCount = PROMPT_GROUPS.flatMap((g) => g.items).filter((it) => asked.has(it.text)).length;

  return (
    <aside className="hidden w-[284px] shrink-0 flex-col border-r border-rule lg:flex">
      {/* header + filter */}
      <div className="border-b border-rule px-4 pb-3 pt-4">
        <div className="flex items-baseline justify-between">
          <span className="label text-paper">Test prompts</span>
          <span className="font-mono text-[10.5px] text-faint">
            {askedCount}/{total} tried
          </span>
        </div>
        <div className="mt-2 h-[2px] bg-rule">
          <motion.div className="h-full bg-accent" animate={{ width: `${(askedCount / total) * 100}%` }} transition={{ duration: 0.6, ease: EASE }} />
        </div>
        <label className="group mt-3 flex items-center gap-2 border border-rule bg-ink-2 px-2.5 py-2 transition-colors focus-within:border-paper/50">
          <Search className="h-3.5 w-3.5 text-faint group-focus-within:text-paper" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter prompts" className="w-full bg-transparent text-[13px] text-paper outline-none placeholder:text-faint" />
          {q && (
            <button onClick={() => setQ("")} aria-label="Clear filter" className="text-faint hover:text-paper">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
      </div>

      <div className="flex-1 overflow-y-auto">
        {groups.map((g, gi) => {
          const isOpen = query ? true : open[g.id];
          const red = g.id === "red";
          return (
            <div key={g.id} className="border-b border-rule">
              <button
                onClick={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))}
                className="group flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-ink-2"
                aria-expanded={isOpen}
              >
                <span className={cn("font-mono text-[10.5px]", red ? "text-stop" : "text-faint")}>{String(gi + 1).padStart(2, "0")}</span>
                <span className={cn("flex-1 text-[13.5px] font-medium", red ? "text-stop" : "text-paper")}>{g.title}</span>
                <span className="font-mono text-[10.5px] text-faint">{g.items.length}</span>
                <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.3, ease: EASE }}>
                  <ChevronDown className="h-3.5 w-3.5 text-faint group-hover:text-paper" />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.35, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <motion.ul className={cn("pb-2", red && "ml-4 border-l border-stop/40")} initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.03 } } }}>
                      {g.items.map((it) => {
                        const done = asked.has(it.text);
                        const current = lastAsked === it.text;
                        return (
                          <motion.li key={it.text} variants={{ hidden: { opacity: 0, x: -6 }, show: { opacity: 1, x: 0, transition: { duration: 0.3, ease: EASE } } }}>
                            <button
                              onClick={() => onAsk(it.text)}
                              disabled={busy}
                              title={it.text}
                              className={cn(
                                "group relative flex w-full items-center gap-2.5 py-[7px] pr-4 text-left transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40",
                                red ? "pl-4" : "pl-8",
                              )}
                            >
                              {current && <motion.span layoutId="sidebar-current" className="absolute inset-y-0 left-0 w-[2px] bg-accent" transition={{ type: "spring", stiffness: 450, damping: 38 }} />}
                              <span className={cn("min-w-0 flex-1 truncate text-[13.5px] transition-colors", current ? "text-paper" : done ? "text-mute" : "text-paper-2 group-hover:text-paper")}>
                                {it.label}
                              </span>
                              {done ? (
                                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 22 }}>
                                  <Check className="h-3.5 w-3.5 text-ok" />
                                </motion.span>
                              ) : (
                                it.tag && <span className="font-mono text-[10px] text-faint transition-colors group-hover:text-accent">{it.tag}</span>
                              )}
                            </button>
                          </motion.li>
                        );
                      })}
                    </motion.ul>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
        {groups.length === 0 && <p className="px-4 py-6 text-[13px] text-mute">No prompt matches “{q}”. Press Enter in the chat box to ask it directly.</p>}

        {/* knowledge base */}
        {!query && (
          <div className="border-b border-rule">
            <button onClick={() => setOpen((o) => ({ ...o, kb: !o.kb }))} className="group flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-ink-2" aria-expanded={open.kb}>
              <span className="font-mono text-[10.5px] text-faint">KB</span>
              <span className="flex-1 text-[13.5px] font-medium text-paper">Knowledge base</span>
              <span className="font-mono text-[10.5px] text-faint">{docs.length}</span>
              <motion.span animate={{ rotate: open.kb ? 180 : 0 }} transition={{ duration: 0.3, ease: EASE }}>
                <ChevronDown className="h-3.5 w-3.5 text-faint group-hover:text-paper" />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {open.kb && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="overflow-hidden">
                  <ul className="pb-2">
                    {docs.map((d) => (
                      <li key={d.document_id}>
                        <button onClick={() => onOpenDoc(d.document_id)} className="group flex w-full flex-col py-2 pl-8 pr-4 text-left transition-colors hover:bg-ink-2">
                          <span className="truncate text-[13.5px] text-paper-2 group-hover:text-paper">{d.title}</span>
                          <span className="font-mono text-[10.5px] text-faint">
                            {d.document_id} · {d.sections.length} sections
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="border-t border-rule px-4 py-3 font-mono text-[10.5px] leading-relaxed text-faint">
        T1–T10 are the assignment’s required test cases.
      </div>
    </aside>
  );
}

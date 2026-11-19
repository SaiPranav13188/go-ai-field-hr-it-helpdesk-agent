"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Loader2, X } from "lucide-react";
import { EASE, cn } from "@/components/fx/primitives";
import { api } from "@/lib/api";
import type { DocFull } from "@/lib/types";

export type DrawerTarget = { documentId: string; section?: string } | null;

export default function DocumentDrawer({ target, onClose }: { target: DrawerTarget; onClose: () => void }) {
  const [loaded, setLoaded] = useState<{ id: string; doc?: DocFull; error?: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const current = target && loaded?.id === target.documentId ? loaded : null;
  const doc = current?.doc ?? null;
  const error = current?.error ?? null;
  const documentId = target?.documentId;

  useEffect(() => {
    if (!documentId) return;
    let alive = true;
    api.document(documentId)
      .then((d) => alive && setLoaded({ id: documentId, doc: d }))
      .catch(() => alive && setLoaded({ id: documentId, error: "Couldn’t load the document." }));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [documentId, onClose]);

  useEffect(() => {
    if (!doc || !target?.section) return;
    const t = setTimeout(() => {
      const el = scroller.current?.querySelector(`[data-section="${target.section}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 380);
    return () => clearTimeout(t);
  }, [doc, target?.section]);

  return (
    <AnimatePresence>
      {target && (
        <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-ink/80" onClick={onClose} />
          <motion.aside
            initial={{ x: "100%", opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0.6 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-rule bg-ink-2 "
            role="dialog"
            aria-label="Policy document"
          >
            <div className="flex items-start justify-between gap-4 border-b border-rule px-6 py-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-mono text-[11px] text-accent">
                  <FileText className="h-3.5 w-3.5" /> {target.documentId}
                </div>
                <div className="mt-1 truncate text-lg font-semibold tracking-tight text-paper">{doc?.title ?? "Loading…"}</div>
                {doc && (
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-mute">
                    <span>Owner: {doc.owner}</span>
                    <span>v{doc.version}</span>
                    <span>Effective {doc.effective_date}</span>
                    <span className=" border px-0 font-mono text-[10.5px] uppercase tracking-wider text-accent">{doc.status}</span>
                  </div>
                )}
              </div>
              <button onClick={onClose} className=" p-2 text-faint transition hover:bg-ink-3 hover:text-paper" aria-label="Close document">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div ref={scroller} className="flex-1 overflow-y-auto px-6 py-6">
              {error && <p className="text-sm text-stop">{error}</p>}
              {!doc && !error && <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-faint" />}
              {doc?.sections.map((s, i) => {
                const active = target.section === s.number;
                return (
                  <motion.section
                    key={s.number}
                    data-section={s.number}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1 + i * 0.04, ease: EASE }}
                    className={cn("relative mb-3 border px-5 py-4 transition-colors", active ? "border-accent/40 bg-accent-dim" : "border-transparent")}
                  >
                    {active && (
                      <motion.span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-accent/20 via-accent/5 to-transparent" initial={{ opacity: 0, clipPath: "inset(0 100% 0 0)" }} animate={{ opacity: [0, 1, 0.25], clipPath: "inset(0 0% 0 0)" }} transition={{ duration: 1.4, delay: 0.5, ease: EASE }} />
                    )}
                    <h3 className="relative flex items-baseline gap-2 text-[15px] font-semibold text-paper">
                      <span className="font-mono text-xs text-faint">§{s.number}</span> {s.title}
                      {active && <span className="ml-auto bg-accent-dim px-1.5 py-0.5 font-mono text-[10px] font-normal text-accent">cited</span>}
                    </h3>
                    <div className="doc-md relative mt-2">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.body}</ReactMarkdown>
                    </div>
                  </motion.section>
                );
              })}
            </div>
            <div className="border-t border-rule px-6 py-3 text-[11px] text-faint">Fictional sample document for the prototype. Not official policy.</div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

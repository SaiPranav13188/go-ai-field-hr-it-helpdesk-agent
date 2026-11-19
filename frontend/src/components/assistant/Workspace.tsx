"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Command, LogOut, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { Avatar, BackgroundVideo, EASE, LineReveal, cn } from "@/components/fx/primitives";
import Logo from "@/components/Logo";
import { api } from "@/lib/api";
import { PROMPT_GROUPS } from "@/lib/prompts";
import type { Citation, DocSummary, Session } from "@/lib/types";
import { useChat } from "@/lib/useChat";
import CommandPalette from "./CommandPalette";
import Composer, { type ComposerHandle } from "./Composer";
import DocumentDrawer, { type DrawerTarget } from "./DocumentDrawer";
import { AssistantMessage, UserBubble } from "./Message";
import TracePanel from "./TracePanel";

export default function Workspace({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const router = useRouter();
  const { messages, busy, send, stop, reset, selectedId, setSelectedId } = useChat(session.token, onSignOut);
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState<DrawerTarget>(null);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [showTrace, setShowTrace] = useState(true);
  const [mobileTrace, setMobileTrace] = useState(false);
  const [health, setHealth] = useState<{ ok: boolean; mcp: boolean } | null>(null);
  const composer = useRef<ComposerHandle>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const firstName = session.identity.display_name.split(" ")[0];

  useEffect(() => {
    api.documents().then((d) => setDocs(d.documents)).catch(() => {});
    api.health()
      .then((h) => setHealth({ ok: h.status === "ok", mcp: Boolean(h.components.mcp?.connected) }))
      .catch(() => setHealth({ ok: false, mcp: false }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    const t = setTimeout(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 1000);
    return () => clearTimeout(t);
  }, [messages]);

  const ask = useCallback((t: string) => send(t), [send]);
  const openCitation = useCallback((c: Citation) => setDrawer({ documentId: c.document_id, section: c.section_number }), []);
  const selected = useMemo(() => {
    const a = messages.filter((m) => m.role === "assistant");
    return (a.find((m) => m.id === selectedId) ?? a[a.length - 1]) as Extract<(typeof messages)[number], { role: "assistant" }> | undefined;
  }, [messages, selectedId]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex h-[100svh] flex-col bg-ink">
      {/* header */}
      <header className="relative z-30 flex items-center gap-4 border-b border-rule bg-ink px-4 py-3 sm:px-5">
        <Logo />
        <span className="label hidden border-l border-rule pl-4 md:inline">Prototype · fictional sample policies</span>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {health && (
            <span className="label mr-2 hidden items-center gap-2 lg:flex">
              <span className={cn("h-1.5 w-1.5", health.ok ? "bg-ok" : "bg-stop")} />
              {health.ok ? "Online" : "Waking up"} · MCP {health.mcp ? "connected" : "down"}
            </span>
          )}
          <button onClick={() => setPalette(true)} className="hidden items-center gap-2 border border-rule px-3 py-1.5 text-[13px] text-paper-2 transition hover:border-paper hover:text-paper sm:flex">
            <Command className="h-3.5 w-3.5" /> Test prompts <span className="font-mono text-[10.5px] text-faint">⌘K</span>
          </button>
          <button onClick={() => router.push("/architecture")} className="hidden p-2 text-mute transition hover:text-paper md:block" title="Architecture & evaluation">
            <ArrowUpRight className="h-4 w-4" />
          </button>
          <button onClick={() => setShowTrace((s) => !s)} className="hidden p-2 text-mute transition hover:text-paper xl:block" title="Toggle trace">
            {showTrace ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
          <button onClick={() => setMobileTrace(true)} className="label border border-rule px-2.5 py-1.5 text-paper-2 xl:hidden">Trace</button>
          <div className="ml-1 flex items-center gap-2.5 border-l border-rule pl-3">
            <Avatar name={session.identity.display_name} size={30} />
            <div className="hidden leading-tight sm:block">
              <div className="text-[13px] font-medium text-paper">{session.identity.display_name}</div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-accent">simulated · {session.identity.subject_id}</div>
            </div>
            <button onClick={onSignOut} className="p-1.5 text-mute transition hover:text-paper" title="Switch simulated session">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* sidebar */}
        <aside className="hidden w-[272px] shrink-0 flex-col overflow-y-auto border-r border-rule lg:flex">
          {PROMPT_GROUPS.map((g, gi) => (
            <div key={g.id} className="border-b border-rule py-3">
              <div className="label flex items-center gap-2 px-5 pb-1.5">
                <span className="text-faint">{String(gi + 1).padStart(2, "0")}</span>
                <span className={g.id === "red" ? "text-stop" : ""}>{g.title}</span>
              </div>
              {g.items.map((it) => (
                <button
                  key={it.text}
                  onClick={() => ask(it.text)}
                  disabled={busy}
                  className="group flex w-full items-center gap-2 px-5 py-[7px] text-left text-[13.5px] text-paper-2 transition hover:bg-ink-2 hover:text-paper disabled:opacity-40"
                >
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.tag && <span className="font-mono text-[10px] text-faint group-hover:text-accent">{it.tag}</span>}
                </button>
              ))}
            </div>
          ))}
          <div className="py-3">
            <div className="label px-5 pb-1.5">Knowledge base</div>
            {docs.map((d) => (
              <button key={d.document_id} onClick={() => setDrawer({ documentId: d.document_id })} className="flex w-full items-baseline gap-3 px-5 py-[7px] text-left transition hover:bg-ink-2">
                <span className="w-[86px] shrink-0 font-mono text-[10.5px] text-mute">{d.document_id}</span>
                <span className="truncate text-[13px] text-paper-2">{d.title}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* chat */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            <AnimatePresence mode="popLayout">
              {messages.length === 0 && (
                <motion.div key="empty" exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                  <div className="relative h-[42vh] min-h-[280px] overflow-hidden border-b border-rule">
                    <BackgroundVideo scale={1.15} overlayClassName="bg-[linear-gradient(180deg,rgba(10,10,11,0.35)_0%,rgba(10,10,11,0.25)_45%,#0a0a0b_100%)]" />
                    <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-3xl px-5 pb-8 sm:px-8">
                      <span className="label text-paper-2">Signed in as a test employee · {session.identity.department}</span>
                      <h1 className="mt-3 text-[clamp(2.2rem,5vw,3.8rem)] font-semibold leading-[0.95] tracking-[-0.045em]">
                        <LineReveal lines={[`${greeting}, ${firstName}.`, <span key="q" className="text-paper-2">What do you need?</span>]} />
                      </h1>
                    </div>
                  </div>
                  <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
                    <span className="label">Start with one of these</span>
                    <div className="mt-3 border-t border-rule">
                      {[PROMPT_GROUPS[0].items[0], PROMPT_GROUPS[1].items[0], PROMPT_GROUPS[0].items[2], PROMPT_GROUPS[3].items[0]].map((it, i) => (
                        <motion.button
                          key={it.text}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.4 + i * 0.06, duration: 0.5, ease: EASE }}
                          onClick={() => ask(it.text)}
                          className="group grid w-full grid-cols-[2.5rem_1fr_auto] items-center border-b border-rule py-4 text-left transition-colors hover:bg-ink-2"
                        >
                          <span className="pl-1 font-mono text-[11px] text-faint group-hover:text-accent">{String(i + 1).padStart(2, "0")}</span>
                          <span className="text-[15.5px] text-paper-2 group-hover:text-paper">{it.text}</span>
                          <ArrowRight className="mr-2 h-4 w-4 text-faint transition group-hover:translate-x-1 group-hover:text-paper" />
                        </motion.button>
                      ))}
                    </div>
                    <p className="mt-5 text-[13px] text-mute">
                      More test cases, including the red-team ones, are in the sidebar or under <span className="font-mono text-paper-2">⌘K</span>.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {messages.length > 0 && (
              <div className="mx-auto w-full max-w-3xl space-y-10 px-5 pb-10 pt-10 sm:px-8">
                {messages.map((m) =>
                  m.role === "user" ? (
                    <UserBubble key={m.id} content={m.content} />
                  ) : (
                    <AssistantMessage key={m.id} msg={m} selected={selected?.id === m.id} onSelect={() => { setSelectedId(m.id); setMobileTrace(true); }} onOpenCitation={openCitation} />
                  ),
                )}
              </div>
            )}
            <div ref={bottom} className="h-2" />
          </div>

          <div className="border-t border-rule bg-ink px-4 pb-4 pt-3 sm:px-8">
            <div className="mx-auto max-w-3xl">
              <Composer ref={composer} busy={busy} onSend={ask} onStop={stop} />
              <div className="mt-2 flex items-center justify-between font-mono text-[10.5px] text-faint">
                <span>Answers come only from the sample policies or your own record.</span>
                {messages.length > 0 && <button onClick={reset} className="uppercase tracking-wider transition hover:text-paper">Clear</button>}
              </div>
            </div>
          </div>
        </main>

        {/* trace */}
        <AnimatePresence initial={false}>
          {showTrace && (
            <motion.aside key="trace" initial={{ width: 0 }} animate={{ width: 360 }} exit={{ width: 0 }} transition={{ duration: 0.45, ease: EASE }}
              className="hidden shrink-0 overflow-hidden border-l border-rule bg-ink xl:block">
              <TracePanel msg={selected} className="w-[360px]" />
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* mobile trace */}
      <AnimatePresence>
        {mobileTrace && (
          <motion.div className="fixed inset-0 z-50 xl:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/80" onClick={() => setMobileTrace(false)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ duration: 0.45, ease: EASE }}
              className="absolute inset-x-0 bottom-0 h-[84svh] border-t border-rule-strong bg-ink">
              <button onClick={() => setMobileTrace(false)} className="absolute right-3 top-2.5 z-10 p-1.5 text-mute" aria-label="Close trace"><X className="h-4 w-4" /></button>
              <TracePanel msg={selected} className="h-full" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CommandPalette open={palette} onClose={() => setPalette(false)} onAsk={ask} onClear={reset} onSwitch={onSignOut} onArchitecture={() => router.push("/architecture")} />
      <DocumentDrawer target={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}

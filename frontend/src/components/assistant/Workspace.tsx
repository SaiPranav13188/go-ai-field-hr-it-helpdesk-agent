"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, BookOpen, ChevronRight, Command, FlaskConical, LayoutDashboard, LogOut, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import Orb from "@/components/fx/Orb";
import { Avatar, EASE, cn } from "@/components/fx/primitives";
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
  const [health, setHealth] = useState<{ ok: boolean; mcp: boolean; llm: boolean } | null>(null);
  const composer = useRef<ComposerHandle>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const firstName = session.identity.display_name.split(" ")[0];

  useEffect(() => {
    api.documents().then((d) => setDocs(d.documents)).catch(() => {});
    api.health()
      .then((h) => setHealth({ ok: h.status === "ok", mcp: Boolean(h.components.mcp?.connected), llm: Boolean(h.components.generation?.configured) }))
      .catch(() => setHealth({ ok: false, mcp: false, llm: false }));
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
    // answers reveal (and grow) over ~1s — follow them down once the animation settles
    const t = setTimeout(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 1100);
    return () => clearTimeout(t);
  }, [messages]);

  const ask = useCallback((t: string) => send(t), [send]);
  const openCitation = useCallback((c: Citation) => setDrawer({ documentId: c.document_id, section: c.section_number }), []);
  const selected = useMemo(() => {
    const assistants = messages.filter((m) => m.role === "assistant");
    return (assistants.find((m) => m.id === selectedId) ?? assistants[assistants.length - 1]) as Extract<(typeof messages)[number], { role: "assistant" }> | undefined;
  }, [messages, selectedId]);

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  })();

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} className="flex h-[100svh] flex-col">
      {/* ---------- header ---------- */}
      <motion.header initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.7, ease: EASE }} className="relative z-30 flex items-center gap-3 border-b border-white/[0.06] bg-ink-950/40 px-3 py-2.5 backdrop-blur-xl sm:px-5">
        <Logo />
        <span className="ml-1 hidden items-center gap-1.5 rounded-full border border-amber/25 bg-amber/[0.08] px-2.5 py-1 text-[11px] font-medium text-amber md:inline-flex">
          <FlaskConical className="h-3 w-3" /> Prototype using fictional sample policies
        </span>
        <div className="ml-auto flex items-center gap-2">
          {health && (
            <span className="hidden items-center gap-1.5 rounded-full border border-white/[0.08] px-2.5 py-1 font-mono text-[10.5px] text-fg-muted lg:inline-flex" title="Backend status">
              <span className={cn("h-1.5 w-1.5 rounded-full", health.ok ? "bg-mint shadow-[0_0_8px_#3ee6a8]" : "bg-rose")} />
              API {health.ok ? "online" : "offline"} · MCP {health.mcp ? "connected" : "down"}{!health.llm && " · LLM not configured"}
            </span>
          )}
          <button onClick={() => setPalette(true)} className="hidden items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12.5px] text-fg-muted transition hover:border-white/20 hover:text-fg sm:inline-flex">
            <Command className="h-3.5 w-3.5" /> Prompts <kbd className="rounded border border-white/10 px-1 font-mono text-[10px]">⌘K</kbd>
          </button>
          <button onClick={() => router.push("/architecture")} className="hidden rounded-xl p-2 text-fg-subtle transition hover:bg-white/5 hover:text-fg md:block" title="Architecture & evaluation">
            <LayoutDashboard className="h-4 w-4" />
          </button>
          <button onClick={() => setShowTrace((s) => !s)} className="hidden rounded-xl p-2 text-fg-subtle transition hover:bg-white/5 hover:text-fg xl:block" title="Toggle trace">
            {showTrace ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
          <button onClick={() => setMobileTrace(true)} className="rounded-xl p-2 text-fg-subtle transition hover:bg-white/5 hover:text-fg xl:hidden" title="Agent trace">
            <Activity className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] py-1 pl-1 pr-2">
            <motion.div layoutId="session-avatar">
              <Avatar name={session.identity.display_name} id={session.identity.subject_id} size={28} />
            </motion.div>
            <div className="hidden leading-tight sm:block">
              <div className="text-[12.5px] font-medium text-white">{session.identity.display_name}</div>
              <div className="font-mono text-[10px] text-amber/90">simulated · {session.identity.subject_id}</div>
            </div>
            <button onClick={onSignOut} className="ml-1 rounded-lg p-1 text-fg-subtle transition hover:bg-white/5 hover:text-fg" title="Switch simulated session">
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </motion.header>

      <div className="flex min-h-0 flex-1">
        {/* ---------- sidebar ---------- */}
        <motion.aside initial={{ x: -24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.8, ease: EASE, delay: 0.1 }} className="hidden w-[284px] shrink-0 flex-col overflow-y-auto border-r border-white/[0.06] bg-ink-950/20 px-3 py-4 lg:flex">
          {PROMPT_GROUPS.map((g, gi) => (
            <div key={g.id} className="mb-5">
              <div className="mb-1.5 flex items-center gap-1.5 px-2 text-[10.5px] font-medium uppercase tracking-[0.16em] text-fg-subtle">
                <g.icon className={cn("h-3.5 w-3.5", g.tone)} /> {g.title}
              </div>
              {g.items.map((it, i) => (
                <motion.button
                  key={it.text}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + gi * 0.06 + i * 0.025, duration: 0.5, ease: EASE }}
                  onClick={() => ask(it.text)}
                  disabled={busy}
                  className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-fg-muted transition hover:bg-white/[0.05] hover:text-white disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.tag && <span className="rounded border border-white/10 px-1 font-mono text-[9.5px] text-fg-subtle group-hover:border-white/20">{it.tag}</span>}
                  <ChevronRight className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" />
                </motion.button>
              ))}
            </div>
          ))}
          <div className="mb-2 mt-1 flex items-center gap-1.5 px-2 text-[10.5px] font-medium uppercase tracking-[0.16em] text-fg-subtle">
            <BookOpen className="h-3.5 w-3.5 text-cyan" /> Knowledge base
          </div>
          {docs.map((d) => (
            <button key={d.document_id} onClick={() => setDrawer({ documentId: d.document_id })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.05]">
              <span className="w-[92px] shrink-0 font-mono text-[10.5px] text-cyan/80">{d.document_id}</span>
              <span className="truncate text-[12.5px] text-fg-muted">{d.title}</span>
            </button>
          ))}
        </motion.aside>

        {/* ---------- chat ---------- */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-8 sm:px-6">
              <AnimatePresence mode="popLayout">
                {messages.length === 0 && (
                  <motion.div key="empty" exit={{ opacity: 0, y: -20, filter: "blur(8px)" }} transition={{ duration: 0.4 }} className="flex flex-col items-center pt-[4vh] text-center">
                    <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 1.4, ease: EASE }} className="h-44 w-44 sm:h-52 sm:w-52">
                      <Orb className="h-full w-full" energy={0.15} />
                    </motion.div>
                    <motion.h1 initial={{ opacity: 0, y: 12, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.9, delay: 0.2, ease: EASE }} className="mt-2 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                      {greeting}, <span className="font-display font-normal italic text-gradient">{firstName}</span>.
                    </motion.h1>
                    <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.35, ease: EASE }} className="mt-3 max-w-md text-[15px] text-fg-muted">
                      Ask about HR or IT policy and I’ll cite the exact section. Ask about your own leave and I’ll check your record securely.
                    </motion.p>
                    <div className="mt-9 grid w-full gap-2.5 sm:grid-cols-2">
                      {[PROMPT_GROUPS[0].items[0], PROMPT_GROUPS[1].items[0], PROMPT_GROUPS[0].items[2], PROMPT_GROUPS[3].items[0]].map((it, i) => (
                        <motion.button
                          key={it.text}
                          initial={{ opacity: 0, y: 14 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.5 + i * 0.07, duration: 0.6, ease: EASE }}
                          whileHover={{ y: -3 }}
                          onClick={() => ask(it.text)}
                          className="group rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 text-left transition-colors hover:border-violet/35 hover:bg-violet/[0.06]"
                        >
                          <div className="text-[13.5px] leading-snug text-white">{it.text}</div>
                          <div className="mt-2 flex items-center gap-1 text-[11px] text-fg-subtle">
                            {it.tag && <span className="font-mono">{it.tag}</span>}
                            <ChevronRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                          </div>
                        </motion.button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="space-y-7">
                {messages.map((m) =>
                  m.role === "user" ? (
                    <UserBubble key={m.id} content={m.content} />
                  ) : (
                    <AssistantMessage key={m.id} msg={m} selected={selected?.id === m.id} onSelect={() => { setSelectedId(m.id); setMobileTrace(true); }} onOpenCitation={openCitation} />
                  ),
                )}
              </div>
              <div ref={bottom} className="h-2" />
            </div>
          </div>

          <div className="relative px-3 pb-3 pt-2 sm:px-6 sm:pb-5">
            <div className="pointer-events-none absolute inset-x-0 -top-10 h-10 bg-gradient-to-t from-ink-950/80 to-transparent" />
            <div className="mx-auto max-w-3xl">
              <Composer ref={composer} busy={busy} onSend={ask} onStop={stop} />
              <div className="mt-2 flex items-center justify-between px-2 text-[11px] text-fg-subtle">
                <span>Answers come only from the sample knowledge base or your authorised record.</span>
                {messages.length > 0 && (
                  <button onClick={reset} className="transition hover:text-fg">Clear</button>
                )}
              </div>
            </div>
          </div>
        </main>

        {/* ---------- trace ---------- */}
        <AnimatePresence initial={false}>
          {showTrace && (
            <motion.aside
              key="trace"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 360, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.5, ease: EASE }}
              className="hidden shrink-0 overflow-hidden border-l border-white/[0.06] bg-ink-950/30 backdrop-blur-xl xl:block"
            >
              <TracePanel msg={selected} className="w-[360px]" />
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* mobile trace sheet */}
      <AnimatePresence>
        {mobileTrace && (
          <motion.div className="fixed inset-0 z-50 xl:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm" onClick={() => setMobileTrace(false)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ duration: 0.5, ease: EASE }} drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, info) => info.offset.y > 120 && setMobileTrace(false)}
              className="absolute inset-x-0 bottom-0 h-[82svh] overflow-hidden rounded-t-3xl border-t border-white/10 bg-ink-900/95 backdrop-blur-2xl">
              <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/20" />
              <button onClick={() => setMobileTrace(false)} className="absolute right-3 top-3 rounded-lg p-2 text-fg-subtle" aria-label="Close trace"><X className="h-4 w-4" /></button>
              <TracePanel msg={selected} className="h-[calc(82svh-14px)]" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CommandPalette open={palette} onClose={() => setPalette(false)} onAsk={ask} onClear={reset} onSwitch={onSignOut} onArchitecture={() => router.push("/architecture")} />
      <DocumentDrawer target={drawer} onClose={() => setDrawer(null)} />
    </motion.div>
  );
}

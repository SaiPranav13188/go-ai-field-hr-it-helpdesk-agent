"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Eraser, LayoutDashboard, LogOut, Search } from "lucide-react";
import { EASE, cn } from "@/components/fx/primitives";
import { ALL_PROMPTS } from "@/lib/prompts";

type Item = { id: string; label: string; sub: string; tag?: string; tone?: string; run: () => void; icon?: typeof Search };

type Props = { onClose: () => void; onAsk: (t: string) => void; onClear: () => void; onSwitch: () => void; onArchitecture: () => void };

export default function CommandPalette({ open, ...props }: Props & { open: boolean }) {
  return <AnimatePresence>{open && <Palette {...props} />}</AnimatePresence>;
}

function Palette({ onClose, onAsk, onClear, onSwitch, onArchitecture }: Props) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items: Item[] = useMemo(() => {
    const prompts: Item[] = ALL_PROMPTS.map((p, i) => ({ id: `p${i}`, label: p.text, sub: p.group, tag: p.tag, tone: p.tone, run: () => onAsk(p.text) }));
    const actions: Item[] = [
      { id: "clear", label: "Clear conversation", sub: "Action", icon: Eraser, run: onClear },
      { id: "switch", label: "Switch simulated session", sub: "Action", icon: LogOut, run: onSwitch },
      { id: "arch", label: "Open architecture & evaluation", sub: "Navigate", icon: LayoutDashboard, run: onArchitecture },
    ];
    const all = [...prompts, ...actions];
    const t = q.trim().toLowerCase();
    if (!t) return all;
    const custom: Item = { id: "custom", label: q.trim(), sub: "Ask the helpdesk", icon: CornerDownLeft, run: () => onAsk(q.trim()) };
    return [custom, ...all.filter((i) => (i.label + i.sub + (i.tag ?? "")).toLowerCase().includes(t))];
  }, [q, onAsk, onClear, onSwitch, onArchitecture]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const run = (i: Item) => {
    onClose();
    i.run();
  };

  return (
    <>
      {(
        <motion.div className="fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.97, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="relative w-full max-w-xl overflow-hidden rounded-2xl glass-strong"
            role="dialog"
            aria-label="Command palette"
          >
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-4">
              <Search className="h-4 w-4 text-fg-subtle" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
                  else if (e.key === "Enter" && items[active]) { e.preventDefault(); run(items[active]); }
                  else if (e.key === "Escape") onClose();
                }}
                placeholder="Ask anything, or search test prompts…"
                className="h-14 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-fg-subtle"
              />
              <kbd className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle">esc</kbd>
            </div>
            <div className="max-h-[52vh] overflow-y-auto p-2">
              {items.map((it, i) => (
                <button
                  key={it.id}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(it)}
                  className={cn("relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left", i === active ? "text-white" : "text-fg-muted")}
                >
                  {i === active && <motion.span layoutId="cmd-active" className="absolute inset-0 rounded-xl bg-white/[0.07]" transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
                  <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.03]">
                    {it.icon ? <it.icon className="h-3.5 w-3.5" /> : <span className={cn("h-1.5 w-1.5 rounded-full bg-current", it.tone)} />}
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <span className="block truncate text-[13.5px]">{it.label}</span>
                    <span className="block text-[11px] text-fg-subtle">{it.sub}</span>
                  </span>
                  {it.tag && <span className="relative rounded-md border border-white/10 px-1.5 font-mono text-[10px] text-fg-subtle">{it.tag}</span>}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </>
  );
}

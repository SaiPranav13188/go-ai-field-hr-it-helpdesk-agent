"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { Avatar, BackgroundVideo, EASE, cn } from "@/components/fx/primitives";
import { api } from "@/lib/api";
import type { Identity, Session } from "@/lib/types";

const FALLBACK: Identity[] = [
  { subject_id: "E101", display_name: "Aarav Mehta", department: "Engineering", role: "employee" },
  { subject_id: "E102", display_name: "Priya Sharma", department: "Human Resources", role: "employee" },
  { subject_id: "E103", display_name: "Kabir Rao", department: "IT Support", role: "employee" },
  { subject_id: "E104", display_name: "Ananya Iyer", department: "Finance", role: "employee" },
  { subject_id: "E105", display_name: "Ishaan Patel", department: "Product", role: "employee" },
  { subject_id: "HR900", display_name: "HR Administrator", department: "HR Operations", role: "hr_admin" },
];

const STEPS = [
  ["You pick a person", "No password. This is a clearly-labelled demo identity."],
  ["The server signs a session", "An HMAC-signed token, verified on every request."],
  ["Only that record is readable", "The MCP tool and Postgres row-level security both enforce it."],
];

type Phase = "idle" | "signing" | "done";

type Props = { onClose: () => void; onSession: (s: Session) => void };

/** Mounted only while open, so every opening starts from a fresh state. */
export default function IdentityPicker({ open, ...props }: Props & { open: boolean }) {
  return <AnimatePresence>{open && <Picker {...props} />}</AnimatePresence>;
}

function Picker({ onClose, onSession }: Props) {
  const [ids, setIds] = useState<Identity[]>(FALLBACK);
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Recommended test case first, the HR role last (shown under its own divider).
  const { employees, admins, flat } = useMemo(() => {
    const ordered = [...ids].sort((a, b) => rank(a) - rank(b));
    const employees = ordered.filter((p) => p.role !== "hr_admin");
    const admins = ordered.filter((p) => p.role === "hr_admin");
    return { employees, admins, flat: [...employees, ...admins] };
  }, [ids]);

  const choose = useCallback(
    async (p: Identity) => {
      if (phase !== "idle") return;
      setChosen(p.subject_id);
      setPhase("signing");
      setError(null);
      try {
        const [s] = await Promise.all([api.login(p.subject_id), new Promise((r) => setTimeout(r, 650))]);
        setPhase("done");
        setTimeout(() => onSession(s), 520);
      } catch (e) {
        setPhase("idle");
        setChosen(null);
        setError(e instanceof Error ? `Couldn’t start the session (${e.message}). The service may be waking up. Try again in a few seconds.` : "Couldn’t start the session.");
      }
    },
    [phase, onSession],
  );

  useEffect(() => {
    api.identities().then((r) => setIds(r.identities)).catch(() => {});
    const t = setTimeout(() => listRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % flat.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + flat.length) % flat.length); }
      else if (e.key === "Enter" && flat[active]) { e.preventDefault(); choose(flat[active]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, flat, active, choose]);

  const row = (p: Identity) => {
    const i = flat.indexOf(p);
    const isActive = i === active;
    const isChosen = chosen === p.subject_id;
    const recommended = p.subject_id === "E102";
    return (
      <motion.button
        key={p.subject_id}
        variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } } }}
        onMouseEnter={() => phase === "idle" && setActive(i)}
        onClick={() => choose(p)}
        disabled={phase !== "idle" && !isChosen}
        className={cn("relative flex w-full items-center gap-4 px-6 py-3.5 text-left transition-opacity", phase !== "idle" && !isChosen && "opacity-30")}
      >
        {isActive && phase === "idle" && (
          <motion.span layoutId="picker-hl" className="absolute inset-0 bg-ink-3" transition={{ type: "spring", stiffness: 500, damping: 40 }}>
            <span className="absolute inset-y-0 left-0 w-[2px] bg-accent" />
          </motion.span>
        )}
        <Avatar name={p.display_name} size={40} className={cn("relative", p.role === "hr_admin" && "border-accent/60 text-accent")} />
        <span className="relative min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[16px] font-medium text-paper">{p.display_name}</span>
            {recommended && <span className="shrink-0 bg-accent px-1.5 py-[1px] font-mono text-[9.5px] uppercase tracking-wider text-ink">Recommended</span>}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-mute">
            {p.role === "hr_admin" ? "HR role · may look up one employee" : p.department}
            {recommended && <span className="text-faint"> · assignment test case</span>}
          </span>
        </span>
        <span className="relative font-mono text-[11px] text-faint">{p.subject_id}</span>
        <span className="relative grid h-6 w-6 place-items-center">
          <AnimatePresence mode="wait" initial={false}>
            {isChosen && phase === "done" ? (
              <motion.span key="ok" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }}>
                <Check className="h-4 w-4 text-ok" />
              </motion.span>
            ) : (
              <motion.span key="arrow" animate={{ x: isActive ? 2 : 0, opacity: isActive ? 1 : 0.35 }}>
                <ArrowRight className="h-4 w-4 text-paper" />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        {isChosen && phase !== "idle" && (
          <span className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
            <motion.span className="block h-px bg-accent" initial={{ width: "0%" }} animate={{ width: phase === "done" ? "100%" : "75%" }} transition={{ duration: phase === "done" ? 0.3 : 0.7, ease: EASE }} />
          </span>
        )}
      </motion.button>
    );
  };

  return (
    <>
      {(
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
          <motion.div className="absolute inset-0 bg-ink/85" onClick={() => phase === "idle" && onClose()} />
          <motion.div
            role="dialog"
            aria-modal
            aria-label="Choose a simulated employee session"
            initial={{ opacity: 0, y: 24, clipPath: "inset(6% 0% 6% 0%)" }}
            animate={{ opacity: 1, y: 0, clipPath: "inset(0% 0% 0% 0%)" }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="relative grid max-h-[94svh] w-full max-w-[920px] overflow-hidden border border-rule-strong bg-ink-2 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
          >
            {/* left: footage + how it works */}
            <div className="relative hidden min-h-[520px] flex-col justify-between overflow-hidden border-r border-rule p-7 md:flex">
              <BackgroundVideo scale={1.4} overlayClassName="bg-[linear-gradient(180deg,rgba(17,17,19,0.55)_0%,rgba(17,17,19,0.75)_55%,#111113_100%)]" />
              <div className="relative">
                <span className="label text-accent">Simulated session</span>
                <h2 className="mt-4 text-[34px] font-semibold leading-[1] tracking-[-0.04em] text-paper">
                  Choose who
                  <br />
                  you are today.
                </h2>
              </div>
              <ol className="relative space-y-5">
                {STEPS.map(([t, d], i) => (
                  <motion.li key={t} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.1, duration: 0.6, ease: EASE }} className="grid grid-cols-[1.75rem_1fr]">
                    <span className="font-mono text-[11px] text-accent">{String(i + 1).padStart(2, "0")}</span>
                    <span>
                      <span className="block text-[14.5px] font-medium text-paper">{t}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-paper-2">{d}</span>
                    </span>
                  </motion.li>
                ))}
              </ol>
            </div>

            {/* right: people */}
            <div className="flex min-h-0 flex-col">
              <div className="flex items-center justify-between border-b border-rule px-6 py-4">
                <div>
                  <span className="label md:hidden">Simulated session</span>
                  <div className="text-[15px] font-medium text-paper">Test employees</div>
                </div>
                <button onClick={onClose} className="-mr-2 p-2 text-mute transition hover:rotate-90 hover:text-paper" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <motion.div ref={listRef} tabIndex={-1} className="flex-1 overflow-y-auto py-2 outline-none" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.045, delayChildren: 0.15 } } }}>
                {employees.map(row)}
                <motion.div variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }} className="mx-6 mb-1 mt-3 flex items-center gap-3">
                  <span className="label text-faint">Role demo</span>
                  <span className="h-px flex-1 bg-rule" />
                </motion.div>
                {admins.map(row)}
              </motion.div>

              <AnimatePresence>
                {error && (
                  <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="border-t border-rule px-6 py-3 text-[13.5px] text-stop">
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              <div className="flex items-center justify-between gap-4 border-t border-rule px-6 py-3.5">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span key={phase} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}
                    className={cn("label", phase === "signing" && "text-accent", phase === "done" && "text-ok")}>
                    {phase === "idle" ? "Synthetic test data only" : phase === "signing" ? "Issuing signed session…" : "Session verified"}
                  </motion.span>
                </AnimatePresence>
                <span className="label hidden text-faint sm:inline">↑ ↓ to move · Enter to sign in</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </>
  );
}

function rank(p: Identity) {
  if (p.subject_id === "E102") return 0;
  if (p.role === "hr_admin") return 99;
  return 1 + parseInt(p.subject_id.replace(/\D/g, "") || "0", 10) / 1000;
}

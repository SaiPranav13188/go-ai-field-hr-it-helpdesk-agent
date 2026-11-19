"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { ArrowRight, Loader2, X } from "lucide-react";
import { Avatar, EASE, cn } from "@/components/fx/primitives";
import { api } from "@/lib/api";
import type { Identity, Session } from "@/lib/types";

const FALLBACK: Identity[] = [
  { subject_id: "E101", display_name: "Aarav Mehta", department: "Engineering", role: "employee" },
  { subject_id: "E102", display_name: "Priya Sharma", department: "Human Resources", role: "employee" },
  { subject_id: "E103", display_name: "Kabir Rao", department: "IT Support", role: "employee" },
  { subject_id: "E104", display_name: "Ananya Iyer", department: "Finance", role: "employee" },
  { subject_id: "E105", display_name: "Ishaan Patel", department: "Product", role: "employee" },
  { subject_id: "HR900", display_name: "HR Administrator", department: "HR Operations (role demo)", role: "hr_admin" },
];

export default function IdentityPicker({ open, onClose, onSession }: { open: boolean; onClose: () => void; onSession: (s: Session) => void }) {
  const [ids, setIds] = useState<Identity[]>(FALLBACK);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api.identities().then((r) => setIds(r.identities)).catch(() => {});
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const choose = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      onSession(await api.login(id));
    } catch (e) {
      setError(e instanceof Error ? `Couldn’t start the session: ${e.message}. The service may be waking up; try again in a few seconds.` : "Couldn’t start the session.");
      setBusy(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-ink/85 backdrop-blur-[2px]" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal
            aria-label="Choose a simulated employee session"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.55, ease: EASE }}
            className="relative max-h-[92svh] w-full max-w-3xl overflow-y-auto border border-rule-strong bg-ink-2"
          >
            <div className="flex items-start justify-between border-b border-rule px-6 py-5 sm:px-8">
              <div>
                <span className="label text-accent">Simulated employee session</span>
                <h2 className="mt-3 text-[28px] font-semibold tracking-[-0.03em] sm:text-[34px]">Sign in as a test employee.</h2>
                <p className="mt-2 max-w-xl text-[14.5px] leading-relaxed text-mute">
                  There is no real login in this demo. The server issues a signed session for whoever you pick, and that session decides whose leave balance can be read. What you type in the chat never does.
                </p>
              </div>
              <button onClick={onClose} className="-mr-2 p-2 text-mute transition hover:text-paper" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div>
              {ids.map((p, i) => (
                <motion.button
                  key={p.subject_id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.04, duration: 0.5, ease: EASE }}
                  onClick={() => !busy && choose(p.subject_id)}
                  className={cn(
                    "group grid w-full grid-cols-[2.5rem_1fr_auto] items-center gap-4 border-b border-rule px-6 py-4 text-left transition-colors hover:bg-ink-3 sm:grid-cols-[3rem_2.5rem_1fr_12rem_auto] sm:px-8",
                    busy && busy !== p.subject_id && "opacity-40",
                  )}
                >
                  <span className="hidden font-mono text-[11px] text-faint sm:block">{p.subject_id}</span>
                  <Avatar name={p.display_name} size={36} className={p.role === "hr_admin" ? "border-accent/50 text-accent" : ""} />
                  <span>
                    <span className="block text-[16px] font-medium text-paper">
                      {p.display_name}
                      {p.subject_id === "E102" && <span className="ml-2 align-middle font-mono text-[10px] uppercase tracking-wider text-accent">assignment test case</span>}
                    </span>
                    <span className="block text-[13px] text-mute sm:hidden">{p.subject_id} · {p.department}</span>
                  </span>
                  <span className="hidden text-[13.5px] text-mute sm:block">
                    {p.department}
                    {p.role === "hr_admin" && <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-accent">HR role</span>}
                  </span>
                  {busy === p.subject_id ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : <ArrowRight className="h-4 w-4 text-faint transition group-hover:translate-x-1 group-hover:text-paper" />}
                </motion.button>
              ))}
            </div>
            <AnimatePresence>
              {error && (
                <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="border-b border-rule px-6 py-4 text-[14px] text-stop sm:px-8">
                  {error}
                </motion.p>
              )}
            </AnimatePresence>
            <p className="label px-6 py-4 text-faint sm:px-8">All names, IDs and balances are synthetic test data.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

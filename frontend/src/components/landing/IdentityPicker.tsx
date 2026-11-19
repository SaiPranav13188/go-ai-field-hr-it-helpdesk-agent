"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { FlaskConical, Loader2, ShieldHalf, X } from "lucide-react";
import { Avatar, EASE, SpotlightCard, cn } from "@/components/fx/primitives";
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
      setError(e instanceof Error ? `Couldn’t start the session: ${e.message}. Is the API running?` : "Couldn’t start the session.");
      setBusy(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-ink-950/70 backdrop-blur-md" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal
            aria-label="Choose a simulated employee session"
            initial={{ opacity: 0, y: 40, scale: 0.96, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 30, scale: 0.97, filter: "blur(6px)" }}
            transition={{ duration: 0.6, ease: EASE }}
            className="relative max-h-[92svh] w-full max-w-3xl overflow-y-auto rounded-3xl p-5 glass-strong sm:p-8"
          >
            <button onClick={onClose} className="absolute right-4 top-4 rounded-lg p-2 text-fg-subtle transition hover:bg-white/5 hover:text-fg" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber/30 bg-amber/10 px-3 py-1 text-xs font-medium text-amber">
              <FlaskConical className="h-3.5 w-3.5" /> Simulated employee session
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">Who are you today?</h2>
            <p className="mt-2 max-w-xl text-sm text-fg-muted">
              This demo has no real login. Pick a synthetic employee: the server issues a signed session for them, and that session (never the chat text) decides whose leave balance the agent can read.
            </p>

            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {ids.map((p, i) => (
                <motion.div key={p.subject_id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 + i * 0.05, duration: 0.6, ease: EASE }}>
                  <SpotlightCard
                    as="button"
                    tilt
                    onClick={() => !busy && choose(p.subject_id)}
                    glow={p.role === "hr_admin" ? "rgba(255,190,92,0.18)" : "rgba(139,123,255,0.18)"}
                    className={cn("w-full p-4 text-left transition-colors", busy && busy !== p.subject_id && "opacity-50", p.subject_id === "E102" && "border-violet/30")}
                  >
                    <div className="relative flex items-center gap-3.5">
                      <Avatar name={p.display_name} id={p.subject_id} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-white">{p.display_name}</span>
                          {p.role === "hr_admin" && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber">
                              <ShieldHalf className="h-3 w-3" /> HR role
                            </span>
                          )}
                          {p.subject_id === "E102" && <span className="rounded-md bg-violet/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet">Test case</span>}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-fg-muted">
                          <span className="font-mono">{p.subject_id}</span> · {p.department}
                        </div>
                      </div>
                      {busy === p.subject_id && <Loader2 className="h-4 w-4 animate-spin text-violet" />}
                    </div>
                  </SpotlightCard>
                </motion.div>
              ))}
            </div>
            <AnimatePresence>
              {error && (
                <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-4 rounded-xl border border-rose/30 bg-rose/10 px-4 py-3 text-sm text-rose">
                  {error}
                </motion.p>
              )}
            </AnimatePresence>
            <p className="mt-6 text-xs text-fg-subtle">All names, IDs and balances are synthetic test data.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

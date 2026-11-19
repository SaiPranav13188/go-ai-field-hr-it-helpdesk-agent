"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import Backdrop from "@/components/fx/Backdrop";
import { EASE } from "@/components/fx/primitives";
import Workspace from "@/components/assistant/Workspace";
import IdentityPicker from "@/components/landing/IdentityPicker";
import Landing from "@/components/landing/Landing";
import { sessionStore } from "@/lib/api";
import type { Session } from "@/lib/types";

export default function Home() {
  const SSR = "__ssr__";
  const raw = useSyncExternalStore(sessionStore.subscribe, sessionStore.raw, () => SSR);
  const ready = raw !== SSR;
  const session = useMemo(() => (raw === SSR ? null : sessionStore.parse(raw)), [raw]);
  const [picker, setPicker] = useState(false);

  const onSession = (s: Session) => {
    setPicker(false);
    window.scrollTo({ top: 0 });
    sessionStore.set(s);
  };
  const signOut = useCallback(() => {
    sessionStore.clear();
    setPicker(true);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <Backdrop intensity={session ? 0.55 : 1} />
      {ready && (
        <AnimatePresence mode="wait">
          {session ? (
            <motion.div key="ws" initial={{ opacity: 0, scale: 1.02, filter: "blur(12px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} exit={{ opacity: 0, filter: "blur(10px)" }} transition={{ duration: 0.8, ease: EASE }}>
              <Workspace session={session} onSignOut={signOut} />
            </motion.div>
          ) : (
            <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.97, filter: "blur(14px)" }} transition={{ duration: 0.7, ease: EASE }}>
              <Landing onLaunch={() => setPicker(true)} />
            </motion.div>
          )}
        </AnimatePresence>
      )}
      <IdentityPicker open={picker && !session} onClose={() => setPicker(false)} onSession={onSession} />
    </MotionConfig>
  );
}

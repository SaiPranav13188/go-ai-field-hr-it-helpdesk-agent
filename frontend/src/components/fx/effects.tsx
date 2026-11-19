"use client";

import Lenis from "lenis";
import {
  AnimatePresence,
  animate,
  motion,
  useAnimationFrame,
  useInView,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { EASE, cn } from "./primitives";

/* ---------------------------------------------------------------- smooth scroll */
/** Inertial scrolling (Lenis). Anchor links (#method) glide instead of jumping. */
export function SmoothScroll() {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({ autoRaf: true, lerp: 0.085, smoothWheel: true, anchors: { offset: 0, duration: 1.4 } });
    return () => lenis.destroy();
  }, [reduce]);
  return null;
}

/* ---------------------------------------------------------------- intro */
const INTRO_KEY = "gaf.intro.seen";

/** Once per browser session: a mono counter, then the page opens from a thin slit. */
export function Intro({ onDone }: { onDone: () => void }) {
  const [n, setN] = useState(0);
  const [phase, setPhase] = useState<"count" | "open" | "gone">(() => {
    try {
      return sessionStorage.getItem(INTRO_KEY) ? "gone" : "count";
    } catch {
      return "gone";
    }
  });

  useEffect(() => {
    if (phase === "gone") {
      onDone();
      return;
    }
    if (phase !== "count") return;
    const c = animate(0, 100, { duration: 1.5, ease: [0.65, 0, 0.35, 1], onUpdate: (v) => setN(Math.round(v)) });
    const t = setTimeout(() => setPhase("open"), 1650);
    return () => {
      c.stop();
      clearTimeout(t);
    };
  }, [phase, onDone]);

  useEffect(() => {
    if (phase !== "open") return;
    try {
      sessionStorage.setItem(INTRO_KEY, "1");
    } catch {}
    onDone();
    const t = setTimeout(() => setPhase("gone"), 1300);
    return () => clearTimeout(t);
  }, [phase, onDone]);

  return (
    <AnimatePresence>
      {phase !== "gone" && (
        <motion.div className="pointer-events-none fixed inset-0 z-[100]" exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
          {/* two shutters that part from the middle */}
          <motion.div className="absolute inset-x-0 top-0 h-1/2 bg-ink" animate={{ y: phase === "open" ? "-100%" : "0%" }} transition={{ duration: 1.15, ease: [0.76, 0, 0.24, 1] }} />
          <motion.div className="absolute inset-x-0 bottom-0 h-1/2 bg-ink" animate={{ y: phase === "open" ? "100%" : "0%" }} transition={{ duration: 1.15, ease: [0.76, 0, 0.24, 1] }} />
          <motion.div className="absolute inset-0 flex flex-col items-center justify-center" animate={{ opacity: phase === "open" ? 0 : 1 }} transition={{ duration: 0.25 }}>
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-mute">Go AI Field · HR &amp; IT Helpdesk</div>
            <div className="mt-6 text-[clamp(4rem,12vw,9rem)] font-semibold leading-none tracking-[-0.06em] text-paper tabular-nums">{String(n).padStart(3, "0")}</div>
            <div className="mt-8 h-px w-[min(60vw,420px)] bg-rule">
              <div className="h-px bg-accent" style={{ width: `${n}%` }} />
            </div>
            <div className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.18em] text-faint">loading the night shift</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------------------------------------------------------- scramble */
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/#·—";

/** Mono label that decodes from random glyphs when it scrolls into view. */
export function Scramble({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const [out, setOut] = useState(text);
  useEffect(() => {
    if (!inView || reduce) return;
    let frame = 0;
    const total = 22;
    const id = setInterval(() => {
      frame++;
      const done = Math.floor((frame / total) * text.length);
      setOut(text.split("").map((ch, i) => (i < done || ch === " " ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join(""));
      if (frame >= total) clearInterval(id);
    }, 32);
    return () => clearInterval(id);
  }, [inView, reduce, text]);
  return (
    <span ref={ref} className={className} aria-label={text}>
      {out}
    </span>
  );
}

/* ---------------------------------------------------------------- lens */
/** Darkens footage everywhere except a soft lens that follows the cursor. */
export function Lens({ radius = 380, dim = 0.5, className }: { radius?: number; dim?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(useMotionValue(-999), { stiffness: 140, damping: 22, mass: 0.5 });
  const y = useSpring(useMotionValue(-999), { stiffness: 140, damping: 22, mass: 0.5 });
  const bg = useMotionTemplate`radial-gradient(${radius}px circle at ${x}px ${y}px, rgba(10,10,11,0) 0%, rgba(10,10,11,${dim * 0.55}) 45%, rgba(10,10,11,${dim}) 100%)`;
  const ring = useMotionTemplate`radial-gradient(${radius * 0.9}px circle at ${x}px ${y}px, rgba(242,181,68,0.10) 0%, rgba(242,181,68,0) 60%)`;
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const r0 = el.getBoundingClientRect();
    x.jump(r0.width * 0.68);
    y.jump(r0.height * 0.42);
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      x.set(e.clientX - r.left);
      y.set(e.clientY - r.top);
    };
    el.addEventListener("pointermove", move);
    return () => el.removeEventListener("pointermove", move);
  }, [x, y]);
  return (
    <div ref={ref} className={cn("pointer-events-none absolute inset-0", className)}>
      <motion.div className="absolute inset-0" style={{ background: bg }} />
      <motion.div className="absolute inset-0 mix-blend-screen" style={{ background: ring }} />
    </div>
  );
}

/* ---------------------------------------------------------------- velocity marquee */
function wrap(min: number, max: number, v: number) {
  const r = max - min;
  return ((((v - min) % r) + r) % r) + min;
}

/** Huge type that drifts sideways; scrolling speeds it up and flips its direction. */
export function VelocityMarquee({ items, baseVelocity = -2.2, className }: { items: string[]; baseVelocity?: number; className?: string }) {
  const base = useMotionValue(0);
  const { scrollY } = useScroll();
  const vel = useSpring(useVelocity(scrollY), { damping: 50, stiffness: 400 });
  const factor = useTransform(vel, [0, 1000], [0, 5], { clamp: false });
  const x = useTransform(base, (v) => `${wrap(-50, 0, v)}%`);
  const dir = useRef(1);
  const reduce = useReducedMotion();
  useAnimationFrame((_, delta) => {
    if (reduce) return;
    let move = dir.current * baseVelocity * (delta / 1000);
    const f = factor.get();
    if (f < 0) dir.current = -1;
    else if (f > 0) dir.current = 1;
    move += dir.current * move * f;
    base.set(base.get() + move);
  });
  const row = items.flatMap((t, i) => [
    <span key={`t${i}`} className={cn("whitespace-nowrap", i % 2 ? "text-transparent [-webkit-text-stroke:1px_rgba(236,233,226,0.45)]" : "text-paper")}>{t}</span>,
    <span key={`d${i}`} className="mx-[0.35em] inline-block h-[0.18em] w-[0.18em] -translate-y-[0.3em] bg-accent" />,
  ]);
  return (
    <div className={cn("overflow-hidden", className)}>
      <motion.div className="flex w-max items-center" style={{ x }}>
        <div className="flex items-center pr-[0.35em]">{row}</div>
        <div className="flex items-center pr-[0.35em]" aria-hidden>{row}</div>
      </motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------- cursor tag */
/** Small label that trails the cursor over an element — "Open", "Play", etc. */
export function CursorTag({ children, label }: { children: ReactNode; label: string }) {
  const [on, setOn] = useState(false);
  const x = useSpring(0, { stiffness: 500, damping: 40 });
  const y = useSpring(0, { stiffness: 500, damping: 40 });
  return (
    <div
      className="relative"
      onPointerEnter={() => setOn(true)}
      onPointerLeave={() => setOn(false)}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set(e.clientX - r.left + 14);
        y.set(e.clientY - r.top + 14);
      }}
    >
      {children}
      <AnimatePresence>
        {on && (
          <motion.span
            className="pointer-events-none absolute left-0 top-0 z-20 bg-accent px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider text-ink"
            style={{ x, y }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

"use client";

import { clsx, type ClassValue } from "clsx";
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));
export const EASE = [0.25, 1, 0.5, 1] as const;

/** Lines that rise out of a mask — the classic editorial headline reveal. */
export function LineReveal({ lines, className, lineClassName, delay = 0, stagger = 0.09, inView = false }: {
  lines: ReactNode[];
  className?: string;
  lineClassName?: string;
  delay?: number;
  stagger?: number;
  inView?: boolean;
}) {
  const trigger = inView ? { whileInView: "show", viewport: { once: true, margin: "-60px" } } : { animate: "show" };
  return (
    <motion.span className={cn("block", className)} initial="hidden" {...trigger} variants={{ show: { transition: { staggerChildren: stagger, delayChildren: delay } } }}>
      {lines.map((l, i) => (
        <span key={i} className="block overflow-hidden pb-[0.06em]">
          <motion.span className={cn("block", lineClassName)} variants={{ hidden: { y: "105%" }, show: { y: "0%", transition: { duration: 1.1, ease: EASE } } }}>
            {l}
          </motion.span>
        </span>
      ))}
    </motion.span>
  );
}

/** Fade + short rise when scrolled into view. */
export function Reveal({ children, delay = 0, className, y = 18 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-70px" }} transition={{ duration: 0.9, delay, ease: EASE }}>
      {children}
    </motion.div>
  );
}

/** A hairline that draws itself from left to right. */
export function Rule({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <motion.div
      className={cn("h-px origin-left bg-rule", className)}
      initial={{ scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 1.4, delay, ease: EASE }}
    />
  );
}

export function AnimatedNumber({ value, decimals = 0, className, duration = 1.6, suffix = "" }: { value: number; decimals?: number; className?: string; duration?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const c = animate(0, value, { duration, ease: EASE, onUpdate: setDisplay });
    return () => c.stop();
  }, [inView, value, duration]);
  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/** Full-bleed background footage: poster paints instantly, video fades in when it can play,
 *  pauses off-screen / in hidden tabs, and stays a still image for reduced-motion users. */
export function BackgroundVideo({ className, overlayClassName, scale = 1.06 }: { className?: string; overlayClassName?: string; scale?: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const v = ref.current;
    if (!v || reduce) return;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? v.play().catch(() => {}) : v.pause()), { threshold: 0.01 });
    io.observe(v);
    const onVis = () => (document.hidden ? v.pause() : v.play().catch(() => {}));
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reduce]);

  return (
    <div className={cn("absolute inset-0 overflow-hidden bg-ink", className)} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/media/hero-poster.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" style={{ transform: `scale(${scale})` }} />
      {!reduce && (
        <motion.video
          ref={ref}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ scale }}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster="/media/hero-poster.jpg"
          onCanPlay={() => setReady(true)}
          initial={{ opacity: 0 }}
          animate={{ opacity: ready ? 1 : 0 }}
          transition={{ duration: 1.2 }}
        >
          <source src="/media/hero.webm" type="video/webm" />
          <source src="/media/hero.mp4" type="video/mp4" />
        </motion.video>
      )}
      <div className={cn("absolute inset-0", overlayClassName)} />
      <div className="film-grain" />
    </div>
  );
}

export function Avatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  return (
    <div
      className={cn("grid shrink-0 place-items-center border border-rule-strong bg-ink-3 font-mono text-paper", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.34) }}
    >
      {initials}
    </div>
  );
}

/** Live local time for the hero status bar — small detail, makes the page feel alive. */
export function Clock({ className }: { className?: string }) {
  const [t, setT] = useState("");
  useEffect(() => {
    const f = () => setT(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    f();
    const id = setInterval(f, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className={cn("tabular-nums", className)}>{t || "--:--:--"}</span>;
}

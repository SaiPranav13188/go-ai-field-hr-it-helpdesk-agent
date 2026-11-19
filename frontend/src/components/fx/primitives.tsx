"use client";

import { clsx, type ClassValue } from "clsx";
import { animate, motion, useInView, useMotionTemplate, useMotionValue, useSpring, useTransform } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));
export const EASE = [0.16, 1, 0.3, 1] as const;

/** Word-by-word blur/rise reveal. */
export function TextReveal({ text, className, wordClassName, delay = 0, stagger = 0.045, as = "span" }: { text: string; className?: string; wordClassName?: string; delay?: number; stagger?: number; as?: "span" | "h1" | "h2" | "p" }) {
  const Tag = motion[as];
  const words = text.split(" ");
  return (
    <Tag className={className} initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: stagger, delayChildren: delay } } }} aria-label={text}>
      {words.map((w, i) => (
        <motion.span
          key={i}
          aria-hidden
          className={cn("inline-block whitespace-pre", wordClassName)}
          variants={{
            hidden: { opacity: 0, y: "0.45em", filter: "blur(10px)" },
            show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.9, ease: EASE } },
          }}
        >
          {w + (i < words.length - 1 ? " " : "")}
        </motion.span>
      ))}
    </Tag>
  );
}

/** Spring-animated number that counts up when it enters the viewport. */
export function AnimatedNumber({ value, decimals = 0, className, duration = 1.4, suffix = "" }: { value: number; decimals?: number; className?: string; duration?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, value, { duration, ease: EASE, onUpdate: (v) => setDisplay(v) });
    return () => controls.stop();
  }, [inView, value, duration]);
  return (
    <span ref={ref} className={className}>
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/** Card with a cursor-following radial highlight and an optional subtle 3D tilt. */
export function SpotlightCard({ children, className, tilt = false, glow = "rgba(139,123,255,0.16)", onClick, as = "div" }: { children: ReactNode; className?: string; tilt?: boolean; glow?: string; onClick?: () => void; as?: "div" | "button" }) {
  const x = useMotionValue(-300);
  const y = useMotionValue(-300);
  const rx = useSpring(useMotionValue(0), { stiffness: 200, damping: 20 });
  const ry = useSpring(useMotionValue(0), { stiffness: 200, damping: 20 });
  const bg = useMotionTemplate`radial-gradient(340px circle at ${x}px ${y}px, ${glow}, transparent 70%)`;
  const Comp = as === "button" ? motion.button : motion.div;
  return (
    <Comp
      onClick={onClick}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set(e.clientX - r.left);
        y.set(e.clientY - r.top);
        if (tilt) {
          ry.set(((e.clientX - r.left) / r.width - 0.5) * 9);
          rx.set(-((e.clientY - r.top) / r.height - 0.5) * 9);
        }
      }}
      onPointerLeave={() => {
        x.set(-300);
        y.set(-300);
        rx.set(0);
        ry.set(0);
      }}
      style={tilt ? { rotateX: rx, rotateY: ry, transformPerspective: 900 } : undefined}
      className={cn("group relative overflow-hidden rounded-2xl glass", className)}
    >
      <motion.div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: bg }} />
      {children}
    </Comp>
  );
}

/** Element that is gently pulled toward the cursor. */
export function Magnetic({ children, strength = 0.28, className }: { children: ReactNode; strength?: number; className?: string }) {
  const x = useSpring(0, { stiffness: 220, damping: 15, mass: 0.4 });
  const y = useSpring(0, { stiffness: 220, damping: 15, mass: 0.4 });
  return (
    <motion.div
      className={cn("inline-block", className)}
      style={{ x, y }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left - r.width / 2) * strength);
        y.set((e.clientY - r.top - r.height / 2) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

/** Fade/rise into view on scroll. */
export function Reveal({ children, delay = 0, className, y = 28 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.9, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Gradient avatar with initials. */
export function Avatar({ name, id, size = 40, className }: { name: string; id: string; size?: number; className?: string }) {
  const palettes = [
    ["#8b7bff", "#38d6f5"],
    ["#ff7ab6", "#8b7bff"],
    ["#3ee6a8", "#38d6f5"],
    ["#ffbe5c", "#ff5c7a"],
    ["#6cb6ff", "#3ee6a8"],
    ["#c08bff", "#ff7ab6"],
  ];
  const idx = [...id].reduce((a, c) => a + c.charCodeAt(0), 0) % palettes.length;
  const [a, b] = palettes[idx];
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  return (
    <div
      className={cn("relative grid shrink-0 place-items-center rounded-full font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]", className)}
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, ${a}, ${b})` }}
    >
      {initials}
    </div>
  );
}

export function useParallax(range = 60) {
  const ref = useRef<HTMLDivElement>(null);
  const progress = useMotionValue(0);
  useEffect(() => {
    const onScroll = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      progress.set(Math.max(-1, Math.min(1, (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight)));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [progress]);
  const y = useTransform(progress, [-1, 1], [-range, range]);
  return { ref, y };
}

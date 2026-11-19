"use client";

import { motion, useMotionTemplate, useMotionValue, useSpring } from "motion/react";
import { useEffect } from "react";

/** Fixed, layered background: aurora blobs, masked grid, film grain and a cursor spotlight. */
export default function Backdrop({ intensity = 1 }: { intensity?: number }) {
  const mx = useMotionValue(-1000);
  const my = useMotionValue(-1000);
  const sx = useSpring(mx, { stiffness: 120, damping: 24, mass: 0.6 });
  const sy = useSpring(my, { stiffness: 120, damping: 24, mass: 0.6 });
  const spotlight = useMotionTemplate`radial-gradient(520px circle at ${sx}px ${sy}px, rgba(139,123,255,0.10), transparent 70%)`;

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      mx.set(e.clientX);
      my.set(e.clientY);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [mx, my]);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,#12163a_0%,#070915_45%,#04050a_100%)]" />
      <div className="absolute inset-0" style={{ opacity: intensity }}>
        <div className="absolute -left-[20%] -top-[30%] h-[80vh] w-[80vh] rounded-full bg-[radial-gradient(circle,rgba(109,93,252,0.38),transparent_62%)] blur-3xl animate-aurora" />
        <div className="absolute -right-[18%] top-[5%] h-[70vh] w-[70vh] rounded-full bg-[radial-gradient(circle,rgba(56,214,245,0.22),transparent_62%)] blur-3xl animate-aurora [animation-delay:-6s] [animation-duration:22s]" />
        <div className="absolute bottom-[-35%] left-[25%] h-[80vh] w-[90vh] rounded-full bg-[radial-gradient(circle,rgba(255,92,180,0.12),transparent_60%)] blur-3xl animate-aurora [animation-delay:-11s] [animation-duration:26s]" />
      </div>
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 70% 55% at 50% 30%, black 20%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 55% at 50% 30%, black 20%, transparent 75%)",
        }}
      />
      <motion.div className="absolute inset-0" style={{ background: spotlight }} />
      <div className="grain" />
    </div>
  );
}

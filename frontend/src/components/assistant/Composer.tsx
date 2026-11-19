"use client";

import { AnimatePresence, motion } from "motion/react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { cn } from "@/components/fx/primitives";

export type ComposerHandle = { focus: () => void; set: (t: string) => void };

const Composer = forwardRef<ComposerHandle, { busy: boolean; onSend: (t: string) => void; onStop: () => void; maxChars?: number }>(function Composer(
  { busy, onSend, onStop, maxChars = 2000 },
  ref,
) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  const autosize = () => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(200, el.scrollHeight) + "px";
  };
  useImperativeHandle(ref, () => ({
    focus: () => ta.current?.focus(),
    set: (t: string) => {
      setValue(t);
      requestAnimationFrame(() => {
        autosize();
        ta.current?.focus();
      });
    },
  }));

  const submit = () => {
    if (!value.trim() || busy) return;
    onSend(value);
    setValue("");
    requestAnimationFrame(autosize);
  };
  const over = value.length > maxChars;

  return (
    <div className={cn("relative rounded-[1.4rem] transition-shadow duration-500", focused ? "border-beam shadow-[0_0_0_1px_rgba(139,123,255,0.25),0_20px_60px_-15px_rgba(109,93,252,0.45)]" : "shadow-[0_20px_50px_-20px_rgba(0,0,0,0.7)]")}>
      <div className="relative flex items-end gap-2 rounded-[1.4rem] p-2 pl-4 glass-strong">
        <textarea
          ref={ta}
          rows={1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            autosize();
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask about leave, reimbursements, benefits, VPN, MFA…"
          aria-label="Message the helpdesk"
          className="max-h-[200px] min-h-[44px] flex-1 resize-none bg-transparent py-3 text-[15px] leading-relaxed text-white outline-none placeholder:text-fg-subtle"
        />
        <AnimatePresence>
          {value.length > maxChars * 0.8 && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={cn("mb-3.5 font-mono text-[10.5px]", over ? "text-rose" : "text-fg-subtle")}>
              {value.length}/{maxChars}
            </motion.span>
          )}
        </AnimatePresence>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={busy ? onStop : submit}
          disabled={!busy && (!value.trim() || over)}
          aria-label={busy ? "Stop" : "Send"}
          className={cn(
            "grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition-all duration-300",
            busy ? "bg-white/10 text-white hover:bg-white/15" : value.trim() && !over ? "bg-gradient-to-b from-[#9d8fff] to-[#6d5dfc] text-white shadow-[0_8px_24px_-6px_rgba(109,93,252,0.9)]" : "bg-white/[0.06] text-fg-subtle",
          )}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={busy ? "stop" : "send"} initial={{ scale: 0.4, opacity: 0, rotate: -45 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.4, opacity: 0, rotate: 45 }} transition={{ duration: 0.2 }}>
              {busy ? <Square className="h-3.5 w-3.5 fill-current" /> : <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.4} />}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </div>
    </div>
  );
});

export default Composer;

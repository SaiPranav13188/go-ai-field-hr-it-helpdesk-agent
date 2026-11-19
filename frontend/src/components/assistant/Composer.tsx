"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { cn } from "@/components/fx/primitives";

export type ComposerHandle = { focus: () => void; set: (t: string) => void };

const Composer = forwardRef<ComposerHandle, { busy: boolean; onSend: (t: string) => void; onStop: () => void; maxChars?: number }>(function Composer(
  { busy, onSend, onStop, maxChars = 2000 },
  ref,
) {
  const [value, setValue] = useState("");
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
  const canSend = !!value.trim() && !over;

  return (
    <div className="group flex items-end gap-0 border border-rule-strong bg-ink-2 transition-colors focus-within:border-paper/60">
      <span className="hidden self-stretch border-r border-rule px-3 pt-[15px] font-mono text-[11px] text-faint sm:block">ASK</span>
      <textarea
        ref={ta}
        rows={1}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          autosize();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Leave, reimbursements, benefits, VPN, MFA…"
        aria-label="Message the helpdesk"
        className="max-h-[200px] min-h-[50px] flex-1 resize-none bg-transparent px-4 py-[13px] text-[15.5px] leading-relaxed text-paper outline-none placeholder:text-faint"
      />
      {value.length > maxChars * 0.8 && <span className={cn("mb-4 mr-3 font-mono text-[10.5px]", over ? "text-stop" : "text-faint")}>{value.length}/{maxChars}</span>}
      <button
        onClick={busy ? onStop : submit}
        disabled={!busy && !canSend}
        aria-label={busy ? "Stop" : "Send"}
        className={cn(
          "grid h-[50px] w-[50px] shrink-0 place-items-center border-l border-rule transition-colors",
          busy ? "bg-ink-3 text-paper hover:bg-ink" : canSend ? "bg-paper text-ink hover:bg-accent" : "text-faint",
        )}
      >
        {busy ? <Square className="h-3.5 w-3.5 fill-current" /> : <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.2} />}
      </button>
    </div>
  );
});

export default Composer;

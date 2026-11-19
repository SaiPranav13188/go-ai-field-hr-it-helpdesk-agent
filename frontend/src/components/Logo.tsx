import { cn } from "@/components/fx/primitives";

/** Wordmark: a plain square mark + set type. Deliberately quiet. */
export default function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="relative grid h-7 w-7 shrink-0 place-items-center bg-paper">
        <span className="h-2.5 w-2.5 bg-ink" />
        <span className="absolute right-[5px] top-[5px] h-1.5 w-1.5 bg-accent" />
      </div>
      {!compact && (
        <div className="leading-[1.1]">
          <div className="text-[14px] font-semibold tracking-[-0.01em] text-paper">Go AI Field</div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-mute">HR &amp; IT Helpdesk</div>
        </div>
      )}
    </div>
  );
}

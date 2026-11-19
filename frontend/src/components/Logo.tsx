import { cn } from "@/components/fx/primitives";

export default function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="relative h-8 w-8 shrink-0">
        <div className="absolute inset-0 rounded-[10px] bg-[conic-gradient(from_200deg,#6d5dfc,#38d6f5,#3ee6a8,#ff7ab6,#6d5dfc)] animate-spin-slow opacity-90 blur-[6px]" />
        <div className="absolute inset-0 grid place-items-center rounded-[10px] border border-white/15 bg-ink-900/90">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
            <path d="M4 12.5c0-4.4 3.6-8 8-8 2.3 0 4.3.9 5.8 2.4" stroke="url(#lg)" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M20 11.5c0 4.4-3.6 8-8 8-2.3 0-4.3-.9-5.8-2.4" stroke="url(#lg)" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="12" cy="12" r="2.4" fill="#fff" />
            <defs>
              <linearGradient id="lg" x1="4" y1="4" x2="20" y2="20">
                <stop stopColor="#a99dff" />
                <stop offset="1" stopColor="#38d6f5" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>
      {!compact && (
        <div className="leading-tight">
          <div className="text-[14px] font-semibold tracking-tight text-white">Go AI Field</div>
          <div className="text-[11px] text-fg-subtle">HR & IT Helpdesk</div>
        </div>
      )}
    </div>
  );
}

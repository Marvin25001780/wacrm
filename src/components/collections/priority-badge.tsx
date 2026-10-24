import { cn } from "@/lib/utils";

export function PriorityBadge({
  score,
  reason,
  showReason = false,
}: {
  score: number;
  reason?: string | null;
  showReason?: boolean;
}) {
  const value = Math.round(Number(score) || 0);
  const tone =
    value >= 75
      ? "border-red-500/40 bg-red-500/10 text-red-300"
      : value >= 50
        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
        : value >= 25
          ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
          : "border-border bg-muted text-muted-foreground";

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={cn(
          "inline-flex h-7 min-w-9 items-center justify-center rounded-md border px-1.5 text-xs font-semibold tabular-nums",
          tone,
        )}
        title={reason ?? undefined}
      >
        {value}
      </span>
      {showReason && reason ? (
        <span className="max-w-[280px] truncate text-xs text-muted-foreground">{reason}</span>
      ) : null}
    </div>
  );
}

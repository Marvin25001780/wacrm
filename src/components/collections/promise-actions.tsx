"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  availablePromiseResolutions,
  type PromiseResolution,
  type PromiseResolutionTone,
} from "@/lib/collections/promise-actions";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<PromiseResolutionTone, string> = {
  positive: "text-emerald-300 hover:bg-emerald-500/10",
  negative: "text-red-300 hover:bg-red-500/10",
  neutral: "text-muted-foreground hover:bg-muted",
};

/**
 * 131 — botones para cerrar (o reabrir) una PTP. Las opciones y su
 * orden salen de `availablePromiseResolutions`; el servidor valida de
 * nuevo quién puede hacerlo.
 */
export function PromiseActions({
  status,
  canReopen = false,
  pending = false,
  onResolve,
  className,
}: {
  status: string;
  canReopen?: boolean;
  pending?: boolean;
  onResolve: (value: PromiseResolution) => void;
  className?: string;
}) {
  const options = availablePromiseResolutions(status, canReopen);
  if (options.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          title={option.hint}
          onClick={() => onResolve(option.value)}
          className={cn("h-7 px-2 text-xs", TONE_CLASS[option.tone])}
        >
          {pending ? <Loader2 className="size-3 animate-spin" /> : null}
          {option.label}
        </Button>
      ))}
    </div>
  );
}

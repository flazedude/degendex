"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Timeframe = "1m" | "5m" | "15m" | "1H" | "4H" | "1D";

interface TimeframeSelectorProps {
  selected: Timeframe;
  onChange: (tf: Timeframe) => void;
}

const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "1H", value: "1H" },
  { label: "4H", value: "4H" },
  { label: "1D", value: "1D" },
];

export function TimeframeSelector({ selected, onChange }: TimeframeSelectorProps) {
  return (
    <div className="flex items-center gap-1">
      {TIMEFRAMES.map((tf) => (
        <Button
          key={tf.value}
          variant="ghost"
          size="sm"
          onClick={() => onChange(tf.value)}
          className={cn(
            "h-7 px-2.5 text-xs",
            selected === tf.value
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tf.label}
        </Button>
      ))}
    </div>
  );
}

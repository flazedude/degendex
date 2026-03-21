"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PoolType = "all" | "standard" | "concentrated";
type SortField = "liquidity" | "volume24h" | "fee24h" | "apr24h";

interface PoolFiltersProps {
  poolType: PoolType;
  sortBy: SortField;
  onTypeChange: (type: PoolType) => void;
  onSortChange: (sort: SortField) => void;
}

const TYPE_OPTIONS: { label: string; value: PoolType }[] = [
  { label: "All", value: "all" },
  { label: "Standard", value: "standard" },
  { label: "Concentrated", value: "concentrated" },
];

const SORT_OPTIONS: { label: string; value: SortField }[] = [
  { label: "TVL", value: "liquidity" },
  { label: "Volume", value: "volume24h" },
  { label: "Fees", value: "fee24h" },
  { label: "APR", value: "apr24h" },
];

export function PoolFilters({ poolType, sortBy, onTypeChange, onSortChange }: PoolFiltersProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-1.5">
        {TYPE_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant="outline"
            size="sm"
            onClick={() => onTypeChange(opt.value)}
            className={cn(
              "text-xs",
              poolType === opt.value && "border-primary bg-primary/10 text-primary"
            )}
          >
            {opt.label}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground mr-1">Sort:</span>
        {SORT_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant="ghost"
            size="sm"
            onClick={() => onSortChange(opt.value)}
            className={cn(
              "h-7 px-2.5 text-xs",
              sortBy === opt.value
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

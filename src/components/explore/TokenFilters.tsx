"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SortOption = "v24hUSD" | "mc" | "v24hChangePercent";

interface TokenFiltersProps {
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
}

const SORT_OPTIONS: { label: string; value: SortOption }[] = [
  { label: "Volume", value: "v24hUSD" },
  { label: "Market Cap", value: "mc" },
  { label: "Trending", value: "v24hChangePercent" },
];

export function TokenFilters({ sortBy, onSortChange }: TokenFiltersProps) {
  return (
    <div className="flex items-center gap-2">
      {SORT_OPTIONS.map((opt) => (
        <Button
          key={opt.value}
          variant="outline"
          size="sm"
          onClick={() => onSortChange(opt.value)}
          className={cn(
            "text-xs",
            sortBy === opt.value &&
              "border-primary bg-primary/10 text-primary"
          )}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}

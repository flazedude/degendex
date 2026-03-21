"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SortOption = "volume" | "liquidity" | "priceChange";

interface TokenFiltersProps {
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
}

const SORT_OPTIONS: { label: string; value: SortOption }[] = [
  { label: "Volume", value: "volume" },
  { label: "Liquidity", value: "liquidity" },
  { label: "Trending", value: "priceChange" },
];

export function TokenFilters({ sortBy, onSortChange }: TokenFiltersProps) {
  return (
    <div className="flex items-center gap-1">
      {SORT_OPTIONS.map((opt) => (
        <Button
          key={opt.value}
          variant="outline"
          size="sm"
          onClick={() => onSortChange(opt.value)}
          className={cn(
            "text-xs h-7 px-2",
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

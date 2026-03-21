"use client";

import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useTokenPrice } from "@/hooks/useTokenPrice";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatUSD } from "@/lib/utils";

interface PriceHeaderProps {
  address: string;
  symbol?: string;
  name?: string;
}

export function PriceHeader({ address, symbol, name }: PriceHeaderProps) {
  const { data, isLoading } = useTokenPrice(address);

  if (isLoading) {
    return (
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-7 w-24" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-lg font-bold">
        {symbol?.[0] || "?"}
      </div>
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{symbol || "Token"}</h2>
          {name && (
            <span className="text-sm text-muted-foreground">{name}</span>
          )}
        </div>
        {data && (
          <p className="text-2xl font-bold">
            {data.value < 0.01
              ? `$${data.value.toFixed(8)}`
              : formatUSD(data.value)}
          </p>
        )}
      </div>
    </div>
  );
}

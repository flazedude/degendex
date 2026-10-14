"use client";

import { AlertTriangle, ExternalLink } from "lucide-react";
import type { TokenInfo } from "@/lib/tokens/types";
import type { TokenWarning } from "@/lib/tokens/risk";
import { cn, shortenAddress } from "@/lib/utils";

/** Risk warnings for a token, with a Solscan link to check the mint. */
export function TokenWarningBanner({
  token,
  warnings,
  compact = false,
}: {
  token: TokenInfo;
  warnings: TokenWarning[];
  /** Denser variant for the trade terminal. */
  compact?: boolean;
}) {
  if (warnings.length === 0) return null;
  const danger = warnings.some((w) => w.level === "danger");
  return (
    <div
      role="alert"
      className={cn(
        "border",
        compact ? "px-2 py-1.5 text-[10px]" : "px-3 py-2 text-xs",
        danger
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : "border-yellow-500/40 bg-yellow-500/10 text-yellow-500"
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={cn("flex items-center gap-1.5 font-semibold", compact && "min-w-0")}>
          <AlertTriangle className={compact ? "h-3 w-3 shrink-0" : "h-3.5 w-3.5"} />
          {compact ? <span className="truncate">{token.symbol}</span> : token.symbol}
          <span className="font-mono font-normal opacity-80">{shortenAddress(token.mint)}</span>
        </span>
        <a
          href={`https://solscan.io/token/${token.mint}`}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "flex items-center gap-1 underline-offset-2 hover:underline",
            compact && "shrink-0"
          )}
        >
          Solscan <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <ul className="space-y-0.5">
        {warnings.map((w) => (
          <li key={w.message}>• {w.message}</li>
        ))}
      </ul>
    </div>
  );
}

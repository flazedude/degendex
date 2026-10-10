"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface TokenLogoProps {
  symbol: string;
  logoURI?: string;
  className?: string;
}

/** Token icon with a letter-avatar fallback when missing or broken. */
export function TokenLogo({ symbol, logoURI, className }: TokenLogoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImg = !!logoURI && failedSrc !== logoURI;

  return showImg ? (
    <img
      src={logoURI}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(logoURI)}
      className={cn("h-6 w-6 shrink-0 rounded-full bg-muted object-cover", className)}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted-foreground/20 text-xs font-bold uppercase",
        className
      )}
    >
      {symbol.replace(/[^A-Za-z0-9]/g, "").charAt(0) || "?"}
    </span>
  );
}

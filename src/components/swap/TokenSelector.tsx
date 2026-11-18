"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, BadgeCheck, Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DEGN_MINT, POPULAR_TOKENS } from "@/lib/constants";
import { getTokenWarnings, hasDanger } from "@/lib/tokens/risk";
import { useTokenSearch, useTokensByMint } from "@/hooks/useTokenSearch";
import type { TokenInfo } from "@/store/useSwapStore";
import { cn, shortenAddress } from "@/lib/utils";
import { TokenLogo } from "./TokenLogo";

interface TokenSelectorProps {
  selectedToken: TokenInfo;
  onSelect: (token: TokenInfo) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

const DEGN_MINTS = DEGN_MINT ? [DEGN_MINT] : [];

export function TokenSelector({
  selectedToken,
  onSelect,
  disabled,
  children,
}: TokenSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const { tokens, isSearching, isError } = useTokenSearch(query);
  // DEGN decimals/metadata come from Jupiter, never from a guess.
  const degn = useTokensByMint(DEGN_MINTS);

  const popular = useMemo<TokenInfo[]>(() => {
    const degnToken = degn.data?.find((t) => t.mint === DEGN_MINT);
    return degnToken ? [degnToken, ...POPULAR_TOKENS] : POPULAR_TOKENS;
  }, [degn.data]);

  const hasQuery = query.trim().length > 0;
  const list = hasQuery ? tokens : popular;
  const active = Math.min(activeIndex, Math.max(0, list.length - 1));

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setActiveIndex(0);
    }
  };

  const select = (token: TokenInfo) => {
    onSelect(token);
    handleOpenChange(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(Math.min(active + 1, list.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(Math.max(active - 1, 0));
    } else if (e.key === "Enter" && list[active]) {
      e.preventDefault();
      select(list[active]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild disabled={disabled}>
        {children}
      </DialogTrigger>
      <DialogContent className="gap-3 border-border bg-card p-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold uppercase tracking-wide">
            Select token
          </DialogTitle>
          <DialogDescription className="text-xs">
            Search by symbol, name, or paste a mint address.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="SOL, Bonk, or mint address"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            aria-label="Search tokens"
            className="border-border bg-background pl-9 font-mono text-sm"
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {popular.map((token) => (
            <button
              key={token.mint}
              type="button"
              onClick={() => select(token)}
              className={cn(
                "flex items-center gap-1.5 border border-border bg-muted/40 px-2 py-1 text-xs font-medium transition-colors hover:border-primary/50 hover:bg-primary/10",
                selectedToken.mint === token.mint && "border-primary/60 text-primary"
              )}
            >
              <TokenLogo symbol={token.symbol} logoURI={token.logoURI} className="h-4 w-4 text-[9px]" />
              {token.symbol}
            </button>
          ))}
        </div>

        <div
          role="listbox"
          aria-label="Tokens"
          className="max-h-72 space-y-px overflow-y-auto border-t border-border pt-2"
        >
          {list.map((token, i) => {
            const danger = hasDanger(getTokenWarnings(token));
            return (
              <button
                key={token.mint}
                type="button"
                role="option"
                aria-selected={i === active}
                onClick={() => select(token)}
                onMouseEnter={() => setActiveIndex(i)}
                className={cn(
                  "flex w-full items-center gap-3 px-2 py-2 text-left transition-colors",
                  i === active ? "bg-muted/60" : "hover:bg-muted/40",
                  selectedToken.mint === token.mint && "bg-primary/10"
                )}
              >
                <TokenLogo symbol={token.symbol} logoURI={token.logoURI} className="h-8 w-8 text-sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="truncate font-semibold">{token.symbol}</span>
                    {token.isVerified && (
                      <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Verified" />
                    )}
                    {danger && (
                      <AlertTriangle
                        className="h-3.5 w-3.5 shrink-0 text-destructive"
                        aria-label="Risk warning"
                      />
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {token.name || token.symbol}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {shortenAddress(token.mint)}
                </span>
              </button>
            );
          })}

          {hasQuery && !isSearching && isError && (
            <p className="py-8 text-center text-sm text-destructive">
              Search failed. Try again.
            </p>
          )}
          {hasQuery && !isSearching && !isError && list.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No tokens found. Try pasting the mint address.
            </p>
          )}
          {hasQuery && isSearching && list.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Searching...
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { POPULAR_TOKENS, DEGN_MINT } from "@/lib/constants";
import type { TokenInfo } from "@/store/useSwapStore";

interface TokenSelectorProps {
  selectedToken: TokenInfo;
  onSelect: (token: TokenInfo) => void;
  children: React.ReactNode;
}

const ALL_TOKENS: TokenInfo[] = [
  ...(DEGN_MINT
    ? [{ symbol: "DEGN", mint: DEGN_MINT, decimals: 9, name: "DEGN Token" }]
    : []),
  ...POPULAR_TOKENS.map((t) => ({ ...t, name: t.symbol })),
];

export function TokenSelector({
  selectedToken,
  onSelect,
  children,
}: TokenSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = ALL_TOKENS.filter(
    (t) =>
      t.symbol.toLowerCase().includes(search.toLowerCase()) ||
      t.mint.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Token</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or paste address"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-background border-border"
          />
        </div>

        {/* Popular tokens quick select */}
        <div className="flex flex-wrap gap-2">
          {ALL_TOKENS.slice(0, 4).map((token) => (
            <button
              key={token.mint}
              onClick={() => {
                onSelect(token);
                setOpen(false);
              }}
              className="flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1.5 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-primary/10"
            >
              <span className="h-5 w-5 rounded-full bg-muted-foreground/20 text-xs flex items-center justify-center font-bold">
                {token.symbol[0]}
              </span>
              {token.symbol}
            </button>
          ))}
        </div>

        {/* Token list */}
        <div className="max-h-64 overflow-y-auto space-y-1">
          {filtered.map((token) => (
            <button
              key={token.mint}
              onClick={() => {
                onSelect(token);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/50 ${
                selectedToken.mint === token.mint ? "bg-primary/10" : ""
              }`}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-bold">
                {token.symbol[0]}
              </span>
              <div>
                <p className="font-medium">{token.symbol}</p>
                <p className="text-xs text-muted-foreground">
                  {token.name || token.symbol}
                </p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No tokens found. Try pasting a mint address.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

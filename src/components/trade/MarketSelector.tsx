"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Search, Star } from "lucide-react";
import { useMarkets } from "@/hooks/useMarkets";
import { useTokenSearch } from "@/hooks/useTokenSearch";
import { isValidPubkey } from "@/lib/jupiter/params";
import type { MarketSummary } from "@/lib/markets/types";
import type { TokenInfo } from "@/lib/tokens/types";
import { cn } from "@/lib/utils";
import { TokenLogo } from "@/components/swap/TokenLogo";
import { changeClass, formatPct, formatPrice, shortMint } from "@/app/trade/terminalFormat";

// ---------------------------------------------------------------------------
// Favourites: a tiny localStorage-backed store read with useSyncExternalStore
// (the server snapshot is empty, so SSR and hydration always match).

interface Favourite {
  mint: string;
  symbol: string;
  icon?: string;
  verified: boolean;
}

const FAV_KEY = "degn:trade:favourites";
const MAX_FAVS = 50;
const EMPTY: Favourite[] = [];
const favListeners = new Set<() => void>();
let favRaw: string | null | undefined;
let favCache: Favourite[] = EMPTY;

function parseFavs(raw: string | null): Favourite[] {
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    const out: Favourite[] = [];
    for (const f of parsed) {
      if (!f || typeof f !== "object") continue;
      const { mint, symbol, icon, verified } = f as Record<string, unknown>;
      if (!isValidPubkey(mint) || typeof symbol !== "string") continue;
      out.push({
        mint: mint as string,
        symbol: symbol.slice(0, 24),
        icon: typeof icon === "string" && icon.startsWith("https://") ? icon : undefined,
        verified: verified === true,
      });
    }
    return out.slice(0, MAX_FAVS);
  } catch {
    return EMPTY;
  }
}

function readFavs(): Favourite[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(FAV_KEY);
  } catch {
    // storage blocked: favourites live only in memory
    return favCache;
  }
  if (raw !== favRaw) {
    favRaw = raw;
    favCache = parseFavs(raw);
  }
  return favCache;
}

function writeFavs(next: Favourite[]) {
  favCache = next;
  try {
    const raw = JSON.stringify(next);
    window.localStorage.setItem(FAV_KEY, raw);
    favRaw = raw;
  } catch {
    // keep the in-memory copy
  }
  favListeners.forEach((l) => l());
}

function subscribeFavs(listener: () => void) {
  favListeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === FAV_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    favListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function useFavourites() {
  const favs = useSyncExternalStore(subscribeFavs, readFavs, () => EMPTY);
  const toggle = (f: Favourite) => {
    const current = readFavs();
    writeFavs(
      current.some((x) => x.mint === f.mint)
        ? current.filter((x) => x.mint !== f.mint)
        : [...current, f].slice(-MAX_FAVS)
    );
  };
  return { favs, toggle };
}

// ---------------------------------------------------------------------------

interface RowItem {
  mint: string;
  symbol: string;
  name?: string;
  icon?: string;
  verified: boolean;
  priceUsd: number | null;
  change24hPct: number | null;
  /** Show the short mint (search results, unverified or unknown tokens). */
  showMint: boolean;
}

function fromSummary(m: MarketSummary): RowItem {
  return {
    mint: m.mint,
    symbol: m.symbol,
    name: m.name,
    icon: m.icon,
    verified: m.isVerified,
    priceUsd: m.priceUsd,
    change24hPct: m.change24hPct,
    showMint: !m.isVerified,
  };
}

function fromToken(t: TokenInfo): RowItem {
  return {
    mint: t.mint,
    symbol: t.symbol,
    name: t.name,
    icon: t.logoURI,
    verified: t.isVerified === true,
    priceUsd: typeof t.usdPrice === "number" ? t.usdPrice : null,
    change24hPct: null,
    showMint: true,
  };
}

function matches(m: MarketSummary, q: string): boolean {
  return (
    m.symbol.toLowerCase().includes(q) ||
    m.name.toLowerCase().includes(q) ||
    m.mint.toLowerCase() === q
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-[1] bg-background/95 px-2 py-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function MarketRow({
  item,
  selected,
  favourite,
  onSelect,
  onToggleFav,
}: {
  item: RowItem;
  selected: boolean;
  favourite: boolean;
  onSelect: (mint: string) => void;
  onToggleFav: (item: RowItem) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center border-l-2 transition-colors hover:bg-muted/50",
        selected ? "border-primary bg-primary/10" : "border-transparent"
      )}
    >
      <button
        type="button"
        onClick={() => onToggleFav(item)}
        aria-pressed={favourite}
        aria-label={favourite ? `Remove ${item.symbol} from favourites` : `Add ${item.symbol} to favourites`}
        className="shrink-0 py-1 pl-1.5 pr-1 text-muted-foreground hover:text-yellow-400"
      >
        <Star className={cn("h-3 w-3", favourite && "fill-yellow-400 text-yellow-400")} />
      </button>
      <button
        type="button"
        onClick={() => onSelect(item.mint)}
        aria-current={selected ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2 text-left"
      >
        <TokenLogo symbol={item.symbol} logoURI={item.icon} className="h-4 w-4 text-[8px]" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span className={cn("truncate font-mono text-[11px]", selected ? "text-primary" : "text-foreground")}>
              {item.symbol}
            </span>
            {!item.verified && (
              <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-yellow-400" aria-label="Not verified by Jupiter" />
            )}
          </span>
          {item.showMint && (
            <span className="block truncate font-mono text-[9px] text-muted-foreground">{shortMint(item.mint)}</span>
          )}
        </span>
        <span className="shrink-0 text-right font-mono leading-tight">
          <span className="block text-[10px] text-foreground/90">
            {item.priceUsd !== null ? formatPrice(item.priceUsd) : ""}
          </span>
          {item.change24hPct !== null && (
            <span className={cn("block text-[9px]", changeClass(item.change24hPct))}>{formatPct(item.change24hPct)}</span>
          )}
        </span>
      </button>
    </div>
  );
}

/**
 * Solana market list for the terminal: curated markets with live prices,
 * favourites, and a search over every Jupiter-listed token.
 */
export function MarketSelector({
  selectedMint,
  onSelect,
}: {
  selectedMint: string;
  /** Called after navigation (e.g. to close a mobile sheet). */
  onSelect?: (mint: string) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const markets = useMarkets();
  const search = useTokenSearch(query);
  const { favs, toggle } = useFavourites();

  const list = useMemo(() => markets.data?.markets ?? [], [markets.data]);
  const byMint = useMemo(() => new Map(list.map((m) => [m.mint, m])), [list]);
  const favSet = useMemo(() => new Set(favs.map((f) => f.mint)), [favs]);
  const q = query.trim().toLowerCase();

  const select = (mint: string) => {
    router.replace(`/trade?${new URLSearchParams({ mint })}`, { scroll: false });
    onSelect?.(mint);
  };
  const toggleFav = (item: RowItem) =>
    toggle({ mint: item.mint, symbol: item.symbol, icon: item.icon, verified: item.verified });

  const favRows: RowItem[] = favs.map((f) => {
    const m = byMint.get(f.mint);
    return m
      ? fromSummary(m)
      : { mint: f.mint, symbol: f.symbol, icon: f.icon, verified: f.verified, priceUsd: null, change24hPct: null, showMint: true };
  });
  const core = list.filter((m) => m.tier === "core").map(fromSummary);
  const ecosystem = list.filter((m) => m.tier !== "core").map(fromSummary);

  const curatedHits = q ? list.filter((m) => matches(m, q)).map(fromSummary) : [];
  const searchHits = q
    ? search.tokens
        .filter((t) => !byMint.has(t.mint))
        .map(fromToken)
        // Stable sort keeps Jupiter's relevance order inside each group.
        .sort((a, b) => Number(b.verified) - Number(a.verified))
    : [];
  const rawMint = query.trim();
  const showOpenMint =
    isValidPubkey(rawMint) && !byMint.has(rawMint) && !searchHits.some((s) => s.mint === rawMint);

  const firstHit = curatedHits[0]?.mint ?? searchHits[0]?.mint ?? (showOpenMint ? rawMint : undefined);

  const renderRows = (rows: RowItem[]) =>
    rows.map((item) => (
      <MarketRow
        key={item.mint}
        item={item}
        selected={item.mint === selectedMint}
        favourite={favSet.has(item.mint)}
        onSelect={select}
        onToggleFav={toggleFav}
      />
    ));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-border/50 p-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            inputMode="search"
            placeholder="Symbol, name or mint"
            aria-label="Search Solana tokens"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && firstHit) select(firstHit);
              if (e.key === "Escape") setQuery("");
            }}
            className="w-full border border-border/50 bg-background py-1 pl-6 pr-2 text-[11px] outline-none focus:border-primary/50"
          />
        </div>
        {markets.data?.stale && (
          <span
            className="shrink-0 border border-yellow-500/40 bg-yellow-500/10 px-1 py-px text-[9px] font-medium uppercase text-yellow-400"
            title="Prices are from the last successful update"
          >
            Delayed
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {q ? (
          <>
            {curatedHits.length > 0 && (
              <>
                <SectionHeader>Markets</SectionHeader>
                {renderRows(curatedHits)}
              </>
            )}
            <SectionHeader>
              <span className="flex items-center gap-1">
                All Solana tokens
                {search.isSearching && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
              </span>
            </SectionHeader>
            {renderRows(searchHits)}
            {showOpenMint && (
              <button
                type="button"
                onClick={() => select(rawMint)}
                className="w-full px-2 py-1 text-left font-mono text-[10px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              >
                Open mint {shortMint(rawMint)}
              </button>
            )}
            {search.isError && <p className="px-2 py-1 text-[10px] text-destructive">Token search failed</p>}
            {!search.isSearching && !search.isError && searchHits.length === 0 && curatedHits.length === 0 && !showOpenMint && (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">No tokens found</p>
            )}
            {searchHits.some((s) => !s.verified) && (
              <p className="px-2 py-1 text-[9px] text-muted-foreground">
                <AlertTriangle className="mr-0.5 inline h-2.5 w-2.5 text-yellow-400" />
                Not verified by Jupiter: check the mint before trading.
              </p>
            )}
          </>
        ) : (
          <>
            {favRows.length > 0 && (
              <>
                <SectionHeader>Favourites</SectionHeader>
                {renderRows(favRows)}
              </>
            )}
            {markets.isPending && (
              <p className="flex items-center gap-1.5 px-2 py-3 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading markets…
              </p>
            )}
            {!markets.data && markets.isError && (
              <div className="px-2 py-3 text-[11px] text-muted-foreground">
                Markets unavailable.{" "}
                <button type="button" onClick={() => void markets.refetch()} className="text-foreground underline">
                  Retry
                </button>
              </div>
            )}
            {core.length > 0 && (
              <>
                <SectionHeader>Core</SectionHeader>
                {renderRows(core)}
              </>
            )}
            {ecosystem.length > 0 && (
              <>
                <SectionHeader>Ecosystem</SectionHeader>
                {renderRows(ecosystem)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

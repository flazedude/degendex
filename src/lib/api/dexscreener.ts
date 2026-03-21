const DEXSCREENER_API = "https://api.dexscreener.com";

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  labels?: string[];
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string | null;
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
  info?: {
    imageUrl?: string;
    websites?: { url: string }[];
    socials?: { type: string; url: string }[];
  };
}

export interface DexScreenerTokenProfile {
  url: string;
  chainId: string;
  tokenAddress: string;
  icon?: string;
  description?: string;
  links?: { type: string; label: string; url: string }[];
}

export async function searchTokenPairs(query: string): Promise<DexScreenerPair[]> {
  const res = await fetch(`${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`DexScreener search error: ${res.statusText}`);
  const data = await res.json();
  return (data.pairs || []).filter((p: DexScreenerPair) => p.chainId === "solana");
}

export async function getTokenPairs(tokenAddress: string): Promise<DexScreenerPair[]> {
  const res = await fetch(`${DEXSCREENER_API}/latest/dex/tokens/${tokenAddress}`);
  if (!res.ok) throw new Error(`DexScreener token error: ${res.statusText}`);
  const data = await res.json();
  return (data.pairs || []).filter((p: DexScreenerPair) => p.chainId === "solana");
}

export async function getLatestTokenProfiles(): Promise<DexScreenerTokenProfile[]> {
  const res = await fetch(`${DEXSCREENER_API}/token-profiles/latest/v1`);
  if (!res.ok) throw new Error(`DexScreener profiles error: ${res.statusText}`);
  const data = await res.json();
  return (data || []).filter((p: DexScreenerTokenProfile) => p.chainId === "solana");
}

export async function getLatestBoostedTokens(): Promise<DexScreenerTokenProfile[]> {
  const res = await fetch(`${DEXSCREENER_API}/token-boosts/latest/v1`);
  if (!res.ok) throw new Error(`DexScreener boosts error: ${res.statusText}`);
  const data = await res.json();
  return (data || []).filter((p: DexScreenerTokenProfile) => p.chainId === "solana");
}

/**
 * Fetch pump.fun memecoins via DexScreener search.
 * Searches for recent pump.fun tokens on Solana.
 */
export async function getPumpFunPairs(): Promise<DexScreenerPair[]> {
  // Use DexScreener search to find pump.fun tokens on Solana
  const res = await fetch(`${DEXSCREENER_API}/latest/dex/search?q=pump.fun`);
  if (!res.ok) throw new Error(`DexScreener search error: ${res.statusText}`);
  const data = await res.json();
  const pairs: DexScreenerPair[] = data.pairs || [];

  // Filter to Solana pairs from pump.fun or raydium (graduated pump.fun tokens)
  return pairs
    .filter(
      (p) =>
        p.chainId === "solana" &&
        (p.dexId === "pumpfun" || p.dexId === "raydium")
    )
    .slice(0, 30);
}

/**
 * Build a DexScreener embed chart URL for a given pair
 */
export function getDexScreenerChartEmbed(pairAddress: string): string {
  return `https://dexscreener.com/solana/${pairAddress}?embed=1&theme=dark&info=0&trades=0`;
}

export function getDexScreenerChartUrl(pairAddress: string): string {
  return `https://dexscreener.com/solana/${pairAddress}`;
}

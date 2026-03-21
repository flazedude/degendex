const BIRDEYE_API = "https://public-api.birdeye.so";

function getHeaders(): HeadersInit {
  const apiKey = process.env.BIRDEYE_API_KEY;
  return {
    accept: "application/json",
    "x-chain": "solana",
    ...(apiKey ? { "X-API-KEY": apiKey } : {}),
  };
}

export interface BirdeyeTokenOverview {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string;
  price: number;
  priceChange24hPercent: number;
  volume24hUSD: number;
  marketCap: number;
  liquidity: number;
}

export interface BirdeyeOHLCV {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  unixTime: number;
}

export async function getTokenPrice(address: string): Promise<{ value: number; updateUnixTime: number }> {
  const res = await fetch(`${BIRDEYE_API}/defi/price?address=${address}`, {
    headers: getHeaders(),
    next: { revalidate: 30 },
  });
  if (!res.ok) throw new Error(`Birdeye price error: ${res.statusText}`);
  const data = await res.json();
  return data.data;
}

export async function getTokenOverview(address: string): Promise<BirdeyeTokenOverview> {
  const res = await fetch(`${BIRDEYE_API}/defi/token_overview?address=${address}`, {
    headers: getHeaders(),
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`Birdeye overview error: ${res.statusText}`);
  const data = await res.json();
  return data.data;
}

export async function getOHLCV(
  address: string,
  type: "1m" | "5m" | "15m" | "1H" | "4H" | "1D" = "1H",
  timeFrom?: number,
  timeTo?: number
): Promise<BirdeyeOHLCV[]> {
  const now = Math.floor(Date.now() / 1000);
  const from = timeFrom || now - 7 * 24 * 60 * 60; // 7 days default
  const to = timeTo || now;

  const params = new URLSearchParams({
    address,
    type,
    time_from: from.toString(),
    time_to: to.toString(),
  });

  const res = await fetch(`${BIRDEYE_API}/defi/ohlcv?${params}`, {
    headers: getHeaders(),
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`Birdeye OHLCV error: ${res.statusText}`);
  const data = await res.json();
  return data.data?.items || [];
}

export async function getTokenList(
  sortBy: "v24hUSD" | "mc" | "v24hChangePercent" = "v24hUSD",
  sortType: "asc" | "desc" = "desc",
  offset = 0,
  limit = 20
): Promise<{ tokens: BirdeyeTokenOverview[]; total: number }> {
  const params = new URLSearchParams({
    sort_by: sortBy,
    sort_type: sortType,
    offset: offset.toString(),
    limit: limit.toString(),
  });

  const res = await fetch(`${BIRDEYE_API}/defi/tokenlist?${params}`, {
    headers: getHeaders(),
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`Birdeye token list error: ${res.statusText}`);
  const data = await res.json();
  return { tokens: data.data?.tokens || [], total: data.data?.total || 0 };
}

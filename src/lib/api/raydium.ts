const RAYDIUM_API = "https://api-v3.raydium.io";

export interface RaydiumPool {
  id: string;
  type: "Standard" | "Concentrated";
  programId: string;
  mintA: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI: string;
  };
  mintB: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI: string;
  };
  price: number;
  mintAmountA: number;
  mintAmountB: number;
  feeRate: number;
  tvl: number;
  day: {
    volume: number;
    volumeFee: number;
    apr: number;
    feeApr: number;
    rewardApr: number[];
  };
  week: {
    volume: number;
    volumeFee: number;
    apr: number;
    feeApr: number;
    rewardApr: number[];
  };
  month: {
    volume: number;
    volumeFee: number;
    apr: number;
    feeApr: number;
    rewardApr: number[];
  };
  lpMint?: {
    address: string;
    decimals: number;
  };
  lpPrice?: number;
  lpAmount?: number;
}

export interface RaydiumPoolListResponse {
  count: number;
  data: RaydiumPool[];
  hasNextPage: boolean;
}

export async function getPoolList(
  type: "all" | "standard" | "concentrated" = "all",
  sort: "liquidity" | "volume24h" | "fee24h" | "apr24h" = "liquidity",
  order: "asc" | "desc" = "desc",
  page = 1,
  pageSize = 20
): Promise<RaydiumPoolListResponse> {
  // Raydium API V3 uses poolType, poolSortField, sortType as param names
  const sortFieldMap: Record<string, string> = {
    liquidity: "liquidity",
    volume24h: "volume24h",
    fee24h: "fee24h",
    apr24h: "apr24h",
  };

  const params = new URLSearchParams({
    poolType: type,
    poolSortField: sortFieldMap[sort] || "default",
    sortType: order,
    page: page.toString(),
    pageSize: pageSize.toString(),
  });

  const res = await fetch(`${RAYDIUM_API}/pools/info/list?${params}`);
  if (!res.ok) throw new Error(`Raydium pool list error: ${res.statusText}`);
  const json = await res.json();
  return {
    count: json.data?.count ?? 0,
    data: json.data?.data ?? [],
    hasNextPage: json.data?.hasNextPage ?? false,
  };
}

export async function getPoolById(poolId: string): Promise<RaydiumPool | null> {
  const res = await fetch(`${RAYDIUM_API}/pools/info/ids?ids=${poolId}`);
  if (!res.ok) throw new Error(`Raydium pool info error: ${res.statusText}`);
  const json = await res.json();
  const pools = json.data ?? [];
  return pools[0] ?? null;
}

export async function searchPools(keyword: string): Promise<RaydiumPool[]> {
  const params = new URLSearchParams({
    keyword,
    poolType: "all",
    poolSortField: "liquidity",
    sortType: "desc",
    page: "1",
    pageSize: "10",
  });

  const res = await fetch(`${RAYDIUM_API}/pools/info/list?${params}`);
  if (!res.ok) throw new Error(`Raydium search error: ${res.statusText}`);
  const json = await res.json();
  return json.data?.data ?? [];
}

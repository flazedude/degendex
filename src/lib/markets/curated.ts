// Curated default market list for the /trade terminal.
//
// Source: one batched Jupiter Tokens v2 search (verified 2026-10-14, all
// isVerified). Symbols are display symbols (Jupiter returns e.g. "Bonk",
// "$WIF"); always match markets by mint, never by symbol. Stablecoins are not
// markets (USDC is the quote asset).
//
// `pool` is the GeckoTerminal pool used for candles and trades, resolved once
// (GT /tokens/multi?include=top_pools, 2026-10-14) with the same rule as
// selectTopPool(): paired with USDC, USDT or SOL and >= $10k reserve. Mints
// without one (JTO's top pool is JTO/JitoSOL) are resolved at runtime.

export interface CuratedPool {
  address: string;
  dex: string;
  quoteSymbol: string;
}

export interface CuratedMarket {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  tier: "core" | "ecosystem";
  tokenProgram: string;
  pool?: CuratedPool;
}

export const CURATED_MARKETS: readonly CuratedMarket[] = [
  {
    mint: "So11111111111111111111111111111111111111112",
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE", dex: "orca", quoteSymbol: "USDC" },
  },
  {
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    symbol: "JUP",
    name: "Jupiter",
    decimals: 6,
    icon: "https://static.jup.ag/jup/icon.png",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "C8Gr6AUuq9hEdSYJzoEpNcdjpojPZwqG5MtQbeouNNwg", dex: "meteora", quoteSymbol: "SOL" },
  },
  {
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    symbol: "BONK",
    name: "Bonk",
    decimals: 5,
    icon: "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9", dex: "orca", quoteSymbol: "SOL" },
  },
  {
    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    symbol: "WIF",
    name: "dogwifhat",
    decimals: 6,
    icon: "https://bafkreibk3covs5ltyqxa272uodhculbr6kea6betidfwy3ajsav2vjzyum.ipfs.nftstorage.link",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx", dex: "raydium", quoteSymbol: "SOL" },
  },
  {
    mint: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN",
    symbol: "TRUMP",
    name: "OFFICIAL TRUMP",
    decimals: 6,
    icon: "https://arweave.net/VQrPjACwnQRmxdKBTqNwPiyo65x7LAT773t8Kd7YBzw",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "3C5YE97HADPDxZehYq9Cis8AXr9aNyrUsczKzE1nDbW9", dex: "meteora", quoteSymbol: "USDC" },
  },
  {
    mint: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv",
    symbol: "PENGU",
    name: "Pudgy Penguins",
    decimals: 6,
    icon: "https://arweave.net/BW67hICaKGd2_wamSB0IQq-x7Xwtmr2oJj1WnWGJRHU",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "FAqh648xeeaTqL7du49sztp9nfj5PjRQrfvaMccyd9cz", dex: "orca", quoteSymbol: "SOL" },
  },
  {
    mint: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
    symbol: "PUMP",
    name: "Pump",
    decimals: 6,
    icon: "https://ipfs.io/ipfs/bafkreibyb3hcn7gglvdqpmklfev3fut3eqv3kje54l3to3xzxxbgpt5wjm",
    tier: "core",
    tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    pool: { address: "2uF4Xh61rDwxnG9woyxsVQP7zuA6kLFpb3NvnRQeoiSd", dex: "pumpswap", quoteSymbol: "USDC" },
  },
  {
    mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    symbol: "RAY",
    name: "Raydium",
    decimals: 6,
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "2AXXcN6oN9bBT5owwmTH53C7QHUXvhLeu718Kqt8rvY2", dex: "raydium-clmm", quoteSymbol: "SOL" },
  },
  {
    mint: "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4",
    symbol: "JLP",
    name: "Jupiter Perps",
    decimals: 6,
    icon: "https://static.jup.ag/jlp/icon.png",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "6a3m2EgFFKfsFuQtP4LJJXPcAe3TQYXNyHUjjZpUxYgd", dex: "orca", quoteSymbol: "SOL" },
  },
  {
    mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    symbol: "JitoSOL",
    name: "Jito Staked SOL",
    decimals: 9,
    icon: "https://storage.googleapis.com/token-metadata/JitoSOL-256.png",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "Hp53XEtt4S8SvPCXarsLSdGfZBuUr5mMmZmX2DRNXQKp", dex: "orca", quoteSymbol: "SOL" },
  },
  {
    mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    symbol: "mSOL",
    name: "Marinade staked SOL (mSOL)",
    decimals: 9,
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "HcjZvfeSNJbNkfLD4eEcRBr96AD3w1GpmMppaeRZf7ur", dex: "meteora", quoteSymbol: "SOL" },
  },
  {
    mint: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij",
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    decimals: 8,
    icon: "https://ipfs.io/ipfs/QmZ7L8yd5j36oXXydUiYFiFsRHbi3EdgC4RuFwvM7dcqge",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "CeaZcxBNLpJWtxzt58qQmfMBtJY8pQLvursXTJYGQpbN", dex: "orca", quoteSymbol: "SOL" },
  },
  {
    mint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
    symbol: "ETH",
    name: "Ether (Portal)",
    decimals: 8,
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "HktfL7iwGKT5QHjywQkcDnZXScoh811k7akrMZJkCcEF", dex: "orca", quoteSymbol: "SOL" },
  },
  {
    mint: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump",
    symbol: "FARTCOIN",
    name: "Fartcoin",
    decimals: 6,
    icon: "https://ipfs.io/ipfs/QmQr3Fz4h1etNsF7oLGMRHiCzhB5y9a7GjyodnF7zLHK1g",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "Bzc9NZfMqkXR6fz1DBph7BDf9BroyEf6pnzESP7v5iiw", dex: "raydium", quoteSymbol: "SOL" },
  },
  {
    mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
    symbol: "POPCAT",
    name: "Popcat",
    decimals: 9,
    icon: "https://arweave.net/A1etRNMKxhlNGTf-gNBtJ75QJJ4NJtbKh_UXQTlLXzI",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "FRhB8L7Y9Qq41qZXYLtC2nw8An1RJfLLxRF2x9RwLLMo", dex: "raydium", quoteSymbol: "SOL" },
  },
  {
    mint: "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS",
    symbol: "KMNO",
    name: "Kamino",
    decimals: 6,
    icon: "https://cdn.kamino.finance/kamino.svg",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "3ndjN1nJVUKGrJBc1hhVpER6kWTZKHdyDrPyCJyX3CXK", dex: "orca", quoteSymbol: "USDC" },
  },
  {
    mint: "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL",
    symbol: "MET",
    name: "Meteora",
    decimals: 6,
    icon: "https://assets.meteora.ag/met-token.svg",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "AsSyvUnbfaZJPRrNh3kUuvZTeHKoMVWEoHz86f4Q5D9x", dex: "meteora", quoteSymbol: "SOL" },
  },
  {
    mint: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82",
    symbol: "BOME",
    name: "BOOK OF MEME",
    decimals: 6,
    icon: "https://bafkreihztk5poge7f2lz6logfjmhc7h7u6shvgacoktnuezks5oblmieue.ipfs.nftstorage.link",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "DSUvc5qf5LJHHV5e2tD184ixotSnCnwj7i4jJa4Xsrmt", dex: "raydium", quoteSymbol: "SOL" },
  },
  {
    mint: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5",
    symbol: "MEW",
    name: "cat in a dogs world",
    decimals: 5,
    icon: "https://bafkreidlwyr565dxtao2ipsze6bmzpszqzybz7sqi2zaet5fs7k53henju.ipfs.nftstorage.link/",
    tier: "core",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "879F697iuDJGMevRkRcnW21fcXiAeLJK1ffsw2ATebce", dex: "raydium", quoteSymbol: "SOL" },
  },
  {
    mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
    symbol: "JTO",
    name: "JITO",
    decimals: 9,
    icon: "https://metadata.jito.network/token/jto/image",
    tier: "ecosystem",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  },
  {
    mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
    symbol: "PYTH",
    name: "Pyth Network",
    decimals: 6,
    icon: "https://pyth.network/token.svg",
    tier: "ecosystem",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "9n3dSLrERZQp95dHXywft7xV8D8xnGFLaUHtEhQVaXaC", dex: "raydium-clmm", quoteSymbol: "SOL" },
  },
  {
    mint: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof",
    symbol: "RENDER",
    name: "Render Token",
    decimals: 8,
    icon: "https://assets.coingecko.com/coins/images/11636/standard/rndr.png?1696511529",
    tier: "ecosystem",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "FZ8MJvdTPbp8juhtFCCzb7LsKunhexgzShGQ59SUJkNL", dex: "raydium-clmm", quoteSymbol: "SOL" },
  },
  {
    mint: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux",
    symbol: "HNT",
    name: "Helium Network Token",
    decimals: 8,
    icon: "https://entities.nft.helium.io/v2/assets/hnt.png",
    tier: "ecosystem",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "91axdGmMoqQQg2MPUXKxT3bdqX4p2RMLXqZSQgXn2JpM", dex: "raydium", quoteSymbol: "SOL" },
  },
  {
    mint: "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ",
    symbol: "W",
    name: "Wormhole Token",
    decimals: 6,
    icon: "https://wormhole.com/token.png",
    tier: "ecosystem",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "CwHuXNNkj5inuj2ZXaU1DtjA5Nxfoiy4nNoc1PQQJxTR", dex: "orca", quoteSymbol: "SOL" },
  },
  {
    mint: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
    symbol: "ORCA",
    name: "Orca",
    decimals: 6,
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE/logo.png",
    tier: "ecosystem",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    pool: { address: "Hxw77h9fEx598afiiZunwHaX3vYu9UskDk9EpPNZp1mG", dex: "orca", quoteSymbol: "SOL" },
  },
];

const BY_MINT = new Map(CURATED_MARKETS.map((m) => [m.mint, m]));

export function getCuratedMarket(mint: string): CuratedMarket | undefined {
  return BY_MINT.get(mint);
}

export const CURATED_MINTS: readonly string[] = CURATED_MARKETS.map((m) => m.mint);

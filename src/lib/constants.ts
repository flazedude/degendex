export const DEGN_MINT = process.env.NEXT_PUBLIC_DEGN_MINT || "";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export const JUPITER_API_URL =
  process.env.JUPITER_API_URL || "https://quote-api.jup.ag/v6";

export const HELIUS_RPC_URL =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

export const SOLANA_NETWORK =
  (process.env.NEXT_PUBLIC_SOLANA_NETWORK as "mainnet-beta" | "devnet") ||
  "mainnet-beta";

export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%

export const POPULAR_TOKENS = [
  { symbol: "SOL", mint: SOL_MINT, decimals: 9, logoURI: "/tokens/sol.png" },
  { symbol: "USDC", mint: USDC_MINT, decimals: 6, logoURI: "/tokens/usdc.png" },
  { symbol: "USDT", mint: USDT_MINT, decimals: 6, logoURI: "/tokens/usdt.png" },
];

export const NAV_LINKS = [
  { label: "Swap", href: "/swap" },
  { label: "Memes", href: "/memes" },
  { label: "Charts", href: "/charts" },
  { label: "Explore", href: "/explore" },
  { label: "Liquidity", href: "/liquidity" },
  { label: "Order Book", href: "/orderbook" },
  { label: "Portfolio", href: "/portfolio" },
];

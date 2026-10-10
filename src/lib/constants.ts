import type { TokenInfo } from "@/lib/tokens/types";

export const DEGN_MINT = process.env.NEXT_PUBLIC_DEGN_MINT || "";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export const HELIUS_RPC_URL =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

export const SOLANA_NETWORK =
  (process.env.NEXT_PUBLIC_SOLANA_NETWORK as "mainnet-beta" | "devnet") ||
  "mainnet-beta";

export const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
export const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
export const WIF_MINT = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";

// Mints, decimals and icons verified against https://api.jup.ag/tokens/v2/search.
// Audit flags are baked in only where both authorities are revoked: revoking a
// mint/freeze authority is permanent, so these cannot go stale.
const REVOKED = { mintAuthorityDisabled: true, freezeAuthorityDisabled: true };
const VERIFIED_TAGS = ["verified", "strict"];

export const POPULAR_TOKENS: TokenInfo[] = [
  {
    symbol: "SOL",
    name: "Solana",
    mint: SOL_MINT,
    decimals: 9,
    logoURI:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
    isVerified: true,
    tags: VERIFIED_TAGS,
    audit: REVOKED,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    mint: USDC_MINT,
    decimals: 6,
    logoURI:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
    isVerified: true,
    tags: VERIFIED_TAGS,
  },
  {
    symbol: "USDT",
    name: "USDT",
    mint: USDT_MINT,
    decimals: 6,
    logoURI:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg",
    isVerified: true,
    tags: VERIFIED_TAGS,
  },
  {
    symbol: "JUP",
    name: "Jupiter",
    mint: JUP_MINT,
    decimals: 6,
    logoURI: "https://static.jup.ag/jup/icon.png",
    isVerified: true,
    tags: VERIFIED_TAGS,
    audit: REVOKED,
  },
  {
    symbol: "BONK",
    name: "Bonk",
    mint: BONK_MINT,
    decimals: 5,
    logoURI: "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I",
    isVerified: true,
    tags: VERIFIED_TAGS,
    audit: REVOKED,
  },
  {
    symbol: "WIF",
    name: "dogwifhat",
    mint: WIF_MINT,
    decimals: 6,
    logoURI:
      "https://bafkreibk3covs5ltyqxa272uodhculbr6kea6betidfwy3ajsav2vjzyum.ipfs.nftstorage.link",
    isVerified: true,
    tags: VERIFIED_TAGS,
    audit: REVOKED,
  },
];

export const NAV_LINKS = [
  { label: "Trade", href: "/trade" },
  { label: "Swap", href: "/swap" },
  { label: "Memes", href: "/memes" },
  { label: "Explore", href: "/explore" },
  { label: "Liquidity", href: "/liquidity" },
  { label: "Portfolio", href: "/portfolio" },
];

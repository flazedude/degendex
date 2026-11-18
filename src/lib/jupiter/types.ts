export type JupiterRouter = "metis" | "jupiterz" | "dflow" | "okx";

export interface JupiterSwapInfo {
  ammKey: string;
  label?: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
}

export interface JupiterRoutePlanStep {
  percent?: number;
  bps?: number;
  usdValue?: number;
  swapInfo: JupiterSwapInfo;
}

export interface JupiterPlatformFee {
  amount?: string;
  feeBps: number;
  feeMint?: string;
}

/** Response of GET /swap/v2/order. */
export interface JupiterOrder {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  /** Fraction as a string: "-0.994" means -99.4%. Negative = loss. */
  priceImpactPct?: string;
  /** Already in percent: -99.43 means -99.43%. Negative = loss. */
  priceImpact?: number;
  routePlan?: JupiterRoutePlanStep[];
  /** Total fee rate charged for the swap. */
  feeBps?: number;
  feeMint?: string;
  platformFee?: JupiterPlatformFee;
  /** base64 v0 tx; null without a taker; "" when the quote could not be built. */
  transaction: string | null;
  gasless?: boolean;
  signatureFeeLamports?: number;
  prioritizationFeeLamports?: number;
  rentFeeLamports?: number;
  requestId: string;
  router?: JupiterRouter | (string & {});
  mode?: "ultra" | "manual" | (string & {});
  taker?: string | null;
  /** RFQ quote expiry, unix seconds as a string. */
  expireAt?: string | null;
  lastValidBlockHeight?: number | string;
  inUsdValue?: number;
  outUsdValue?: number;
  transactionVersion?: number | string;
  errorCode?: number;
  errorMessage?: string;
  error?: string;
}

/** Response of POST /swap/v2/execute. */
export interface JupiterExecuteResult {
  status: "Success" | "Failed";
  signature?: string;
  slot?: string | number;
  code: number;
  error?: string;
  totalInputAmount?: string;
  totalOutputAmount?: string;
  inputAmountResult?: string;
  outputAmountResult?: string;
}

/** Item of GET /tokens/v2/search. Only id/symbol/decimals are guaranteed. */
export interface JupiterToken {
  id: string;
  symbol: string;
  decimals: number;
  name?: string;
  icon?: string;
  tokenProgram?: string;
  holderCount?: number;
  audit?: {
    mintAuthorityDisabled?: boolean;
    freezeAuthorityDisabled?: boolean;
    topHoldersPercentage?: number;
  };
  organicScore?: number;
  organicScoreLabel?: "high" | "medium" | "low";
  isVerified?: boolean;
  tags?: string[];
  usdPrice?: number;
  liquidity?: number;
  mcap?: number;
  fdv?: number;
  stats24h?: { priceChange?: number };
}

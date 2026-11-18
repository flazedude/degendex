export interface TokenAudit {
  mintAuthorityDisabled?: boolean;
  freezeAuthorityDisabled?: boolean;
  /** Share of supply held by the top holders, 0-100 scale. */
  topHoldersPercentage?: number;
}

export interface TokenInfo {
  mint: string;
  symbol: string;
  name?: string;
  decimals: number;
  logoURI?: string;
  isVerified?: boolean;
  tags?: string[];
  audit?: TokenAudit;
  organicScoreLabel?: "high" | "medium" | "low";
  /** USD liquidity reported by Jupiter. */
  liquidity?: number;
  usdPrice?: number;
}

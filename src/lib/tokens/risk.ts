import { SOL_MINT, USDC_MINT, USDT_MINT } from "@/lib/constants";
import type { TokenInfo } from "./types";

export type WarningLevel = "info" | "warning" | "danger";

export interface TokenWarning {
  level: WarningLevel;
  message: string;
}

export type RiskInput = Pick<
  TokenInfo,
  "mint" | "isVerified" | "audit" | "organicScoreLabel" | "liquidity"
>;

/**
 * Mints exempt from all risk flags.
 *
 * USDC and USDT legitimately keep mint and freeze authority (regulated issuers),
 * and Jupiter omits those audit fields for them. We special-case these exact
 * mints instead of trusting `isVerified` / "strict" tags, because a verified
 * tag says the token is the "real" one, not that its authorities are safe:
 * a verified token with an active authority still gets a (non-danger) warning.
 */
const TRUSTED_MINTS = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);

const LOW_LIQUIDITY_USD = 10_000;
const TOP_HOLDERS_LIMIT = 50;

const ORDER: Record<WarningLevel, number> = { danger: 0, warning: 1, info: 2 };

export function getTokenWarnings(token: RiskInput | null | undefined): TokenWarning[] {
  if (!token || TRUSTED_MINTS.has(token.mint)) return [];
  const out: TokenWarning[] = [];

  if (token.isVerified !== true) {
    out.push({ level: "warning", message: "Not verified by Jupiter" });
  }

  const audit = token.audit;
  if (!audit) {
    out.push({ level: "info", message: "No audit data available" });
  } else {
    // Jupiter omits these flags when the authority is still active, so
    // anything other than an explicit `true` is treated as not disabled.
    // Verified tokens (LSTs, regulated stablecoins, program-minted tokens)
    // often keep these authorities by design: still shown, but not as danger.
    const verified = token.isVerified === true;
    if (audit.mintAuthorityDisabled !== true) {
      out.push(
        verified
          ? { level: "warning", message: "Issuer/program can mint more supply" }
          : { level: "danger", message: "Mint authority active: supply can be inflated" }
      );
    }
    if (audit.freezeAuthorityDisabled !== true) {
      out.push(
        verified
          ? { level: "warning", message: "Issuer can freeze token accounts" }
          : { level: "danger", message: "Freeze authority active: your tokens can be frozen" }
      );
    }
    if (
      typeof audit.topHoldersPercentage === "number" &&
      audit.topHoldersPercentage > TOP_HOLDERS_LIMIT
    ) {
      out.push({
        level: "warning",
        message: `Top holders own ${audit.topHoldersPercentage.toFixed(0)}% of supply`,
      });
    }
  }

  if (token.organicScoreLabel === "low") {
    out.push({
      level: "warning",
      message: "Low organic trading activity",
    });
  }

  if (
    typeof token.liquidity === "number" &&
    Number.isFinite(token.liquidity) &&
    token.liquidity < LOW_LIQUIDITY_USD
  ) {
    out.push({
      level: "warning",
      message: `Very low liquidity ($${Math.max(0, Math.floor(token.liquidity)).toLocaleString("en-US")})`,
    });
  }

  return out.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}

export function hasDanger(warnings: TokenWarning[]): boolean {
  return warnings.some((w) => w.level === "danger");
}

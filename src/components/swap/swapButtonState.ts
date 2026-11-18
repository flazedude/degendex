import { formatPriceImpact, type ImpactSeverity } from "@/lib/jupiter/priceImpact";

export type SwapButtonAction = "connect" | "swap" | "confirm-extreme" | null;
export type SwapButtonTone = "primary" | "connect" | "danger" | "muted";
export type SwapButtonKind =
  | "connect"
  | "swapping"
  | "pending"
  | "enter-amount"
  | "insufficient"
  | "fetching"
  | "quote-error"
  | "order-error"
  | "no-route"
  | "unavailable"
  | "confirm-extreme"
  | "high-impact"
  | "swap";

export interface SwapButtonState {
  kind: SwapButtonKind;
  label: string;
  tone: SwapButtonTone;
  /** What a click does; null = disabled. */
  action: SwapButtonAction;
  spin?: boolean;
}

export interface SwapButtonInput {
  connected: boolean;
  swapping: boolean;
  /** An earlier swap's outcome is unknown (useSwap's pendingSwap). */
  pendingSwap: { canDismiss: boolean } | null;
  /** Base-unit amount, null when the field is empty or invalid. */
  rawAmount: string | null;
  insufficient: boolean;
  inputSymbol: string;
  isQuoting: boolean;
  quoteError: string | null;
  orderError: string | null;
  order: { transaction: string | null } | null;
  severity: ImpactSeverity;
  priceImpactPct: number;
  /** The extreme-impact confirm has been armed for the order on screen. */
  armed: boolean;
  /** Verb on the action button (default "Swap"), e.g. "Buy SOL". */
  actionLabel?: string;
  /** Label while executing (default "Swapping..."). */
  swappingLabel?: string;
  /** Shorter impact suffix for narrow layouts: "(impact X)". */
  compact?: boolean;
}

/**
 * The swap button's label, tone and action. The order of the checks is the
 * priority: e.g. a pending earlier swap blocks before any amount is checked,
 * and quote errors win over the impact labels.
 */
export function swapButtonState(input: SwapButtonInput): SwapButtonState {
  const {
    connected,
    swapping,
    pendingSwap,
    rawAmount,
    insufficient,
    inputSymbol,
    isQuoting,
    quoteError,
    orderError,
    order,
    severity,
    priceImpactPct,
    armed,
    actionLabel = "Swap",
    swappingLabel = "Swapping...",
    compact = false,
  } = input;
  const impactLabel = formatPriceImpact(priceImpactPct);
  const impactWord = compact ? "impact" : "price impact";

  if (!connected) {
    return { kind: "connect", label: "Connect Wallet", tone: "connect", action: "connect" };
  }
  if (swapping) {
    return { kind: "swapping", label: swappingLabel, tone: "primary", action: null, spin: true };
  }
  if (pendingSwap) {
    return {
      kind: "pending",
      label: "Previous swap may still land - check wallet",
      tone: "muted",
      action: null,
      spin: !pendingSwap.canDismiss,
    };
  }
  if (!rawAmount) {
    return { kind: "enter-amount", label: "Enter an amount", tone: "muted", action: null };
  }
  if (insufficient) {
    return {
      kind: "insufficient",
      label: `Insufficient ${inputSymbol} balance`,
      tone: "muted",
      action: null,
    };
  }
  if (isQuoting) {
    return { kind: "fetching", label: "Fetching quote...", tone: "muted", action: null, spin: true };
  }
  if (quoteError) {
    return { kind: "quote-error", label: quoteError, tone: "muted", action: null };
  }
  if (orderError) {
    return { kind: "order-error", label: orderError, tone: "muted", action: null };
  }
  if (!order) {
    return { kind: "no-route", label: "No route found", tone: "muted", action: null };
  }
  if (!order.transaction) {
    // Taker was sent but Jupiter returned no transaction and no error code.
    return { kind: "unavailable", label: "Quote unavailable, retrying", tone: "muted", action: null };
  }
  if (severity === "extreme") {
    return {
      kind: "confirm-extreme",
      label: armed
        ? `Click again to confirm (impact ${impactLabel})`
        : `${actionLabel} anyway (${impactWord} ${impactLabel})`,
      tone: "danger",
      action: "confirm-extreme",
    };
  }
  if (severity === "high") {
    return {
      kind: "high-impact",
      label: `${actionLabel} (${impactWord} ${impactLabel})`,
      tone: "primary",
      action: "swap",
    };
  }
  return { kind: "swap", label: actionLabel, tone: "primary", action: "swap" };
}

/** The running swap's pair (useSwap's swapInFlight). */
export interface InFlightPair {
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
}

/**
 * Button label while a swap runs. `ownLabel` ("Buying...") when the running
 * swap is the pair on screen; otherwise it names the running pair, because the
 * form may show another market (or have remounted) since Swap was pressed.
 */
export function swappingLabelFor(
  inFlight: InFlightPair | null,
  pair: { inputMint: string; outputMint: string },
  ownLabel: string
): string {
  if (!inFlight || (inFlight.inputMint === pair.inputMint && inFlight.outputMint === pair.outputMint)) {
    return ownLabel;
  }
  return `Swapping ${inFlight.inputSymbol} → ${inFlight.outputSymbol}...`;
}

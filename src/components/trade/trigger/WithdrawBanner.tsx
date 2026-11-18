"use client";

import { AlertTriangle } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useTriggerOrders } from "@/hooks/useTriggerOrders";
import { ACCOUNT_PANEL_ID, useTerminalUiStore } from "@/store/useTerminalUiStore";

/**
 * Compact notice when funds wait in the Jupiter vault (expired or
 * half-cancelled orders). Renders nothing otherwise, or when signed out.
 */
export function WithdrawBanner() {
  const { connected } = useWallet();
  const { enabled, needsWithdraw } = useTriggerOrders();
  const setBottomTab = useTerminalUiStore((s) => s.setBottomTab);
  const n = needsWithdraw.length;
  if (!connected || !enabled || n === 0) return null;

  const open = () => {
    setBottomTab("open");
    document.getElementById(ACCOUNT_PANEL_ID)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-yellow-500/40 bg-yellow-500/10 px-3 py-1 text-[11px] text-yellow-500"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        You have funds waiting in the Jupiter vault from {n} expired or cancelled order{n === 1 ? "" : "s"}.
      </span>
      <button
        type="button"
        onClick={open}
        className="shrink-0 border border-yellow-500/60 px-2 py-0 font-semibold leading-5 hover:bg-yellow-500/20"
      >
        Withdraw
      </button>
    </div>
  );
}

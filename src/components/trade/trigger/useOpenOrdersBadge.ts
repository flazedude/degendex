"use client";

import { useMemo } from "react";
import { useTriggerOrders } from "@/hooks/useTriggerOrders";
import { mergeOpenRows } from "./triggerFormat";

/** Count for the "Open orders" tab and whether any row needs a withdraw. */
export function useOpenOrdersBadge(): { count: number; needsWithdraw: boolean } {
  const { enabled, activeRows, needsWithdraw } = useTriggerOrders();
  return useMemo(
    () => ({
      count: enabled ? mergeOpenRows(activeRows, needsWithdraw).length : 0,
      needsWithdraw: enabled && needsWithdraw.length > 0,
    }),
    [enabled, activeRows, needsWithdraw]
  );
}

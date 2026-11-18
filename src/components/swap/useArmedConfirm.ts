"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How long an armed confirm stays armed. */
export const CONFIRM_WINDOW_MS = 5_000;
/** Clicks this soon after arming (e.g. a double-click) do not confirm. */
export const CONFIRM_MIN_DELAY_MS = 600;

/**
 * Two-click confirmation for an extreme-impact quote, armed per order id: a
 * new quote is never pre-armed. `press(id)` arms on the first click and
 * returns true only for a second click inside the window.
 */
export function useArmedConfirm() {
  const [armedId, setArmedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedAt = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const press = useCallback(
    (id: string): boolean => {
      if (armedId !== id) {
        if (timer.current) clearTimeout(timer.current);
        setArmedId(id);
        armedAt.current = Date.now();
        timer.current = setTimeout(() => setArmedId(null), CONFIRM_WINDOW_MS);
        return false;
      }
      // A double-click or a too-quick second click must not confirm. Timing
      // only: MouseEvent.detail keeps counting for users with a slow OS
      // double-click setting, which would make confirming impossible.
      if (Date.now() - armedAt.current < CONFIRM_MIN_DELAY_MS) return false;
      if (timer.current) clearTimeout(timer.current);
      setArmedId(null);
      return true;
    },
    [armedId]
  );

  return { armedId, press };
}

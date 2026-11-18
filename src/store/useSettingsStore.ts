import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  normalizeSlippageSetting,
  type SlippageSetting,
} from "@/lib/jupiter/params";

export type { SlippageSetting };

interface SettingsState {
  /** "auto" = Jupiter real-time slippage (RTSE), or a fixed value in bps. */
  slippage: SlippageSetting;
  setSlippage: (slippage: SlippageSetting) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      slippage: "auto",
      setSlippage: (slippage) =>
        set({ slippage: normalizeSlippageSetting(slippage) }),
    }),
    {
      name: "degn-settings",
      version: 1,
      // Rehydrated on mount by the swap UI, so SSR and the first client render
      // agree (avoids a hydration mismatch on the slippage label).
      skipHydration: true,
      partialize: (state) => ({ slippage: state.slippage }),
      // v0 stored { slippageBps: 50, priorityFee }. The 50 bps default was never
      // a deliberate user choice, so everyone moves to Auto (RTSE).
      migrate: () => ({ slippage: "auto" as SlippageSetting }),
      // Never trust localStorage contents.
      merge: (persisted, current) => ({
        ...current,
        slippage: normalizeSlippageSetting(
          (persisted as { slippage?: unknown } | null)?.slippage
        ),
      }),
    }
  )
);

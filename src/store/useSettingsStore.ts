import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_SLIPPAGE_BPS } from "@/lib/constants";

interface SettingsState {
  slippageBps: number;
  priorityFee: "none" | "low" | "medium" | "high";
  setSlippageBps: (bps: number) => void;
  setPriorityFee: (fee: "none" | "low" | "medium" | "high") => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      slippageBps: DEFAULT_SLIPPAGE_BPS,
      priorityFee: "medium",
      setSlippageBps: (bps) => set({ slippageBps: bps }),
      setPriorityFee: (fee) => set({ priorityFee: fee }),
    }),
    { name: "degn-settings" }
  )
);

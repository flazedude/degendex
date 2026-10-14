import { create } from "zustand";

// Tiny UI store for the trade terminal: lets the withdraw banner switch the
// bottom panel to Open orders. Not persisted.

export type BottomTabId = "balances" | "open" | "history";

interface TerminalUiState {
  bottomTab: BottomTabId;
  setBottomTab: (tab: BottomTabId) => void;
}

export const useTerminalUiStore = create<TerminalUiState>()((set) => ({
  bottomTab: "balances",
  setBottomTab: (bottomTab) => set({ bottomTab }),
}));

/** DOM id of the bottom panel section, for scrolling it into view. */
export const ACCOUNT_PANEL_ID = "account-panel";

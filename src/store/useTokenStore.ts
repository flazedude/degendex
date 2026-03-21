import { create } from "zustand";
import type { BirdeyeTokenOverview } from "@/lib/api/birdeye";

interface TokenStore {
  tokens: BirdeyeTokenOverview[];
  selectedToken: string | null;
  setTokens: (tokens: BirdeyeTokenOverview[]) => void;
  setSelectedToken: (address: string | null) => void;
}

export const useTokenStore = create<TokenStore>((set) => ({
  tokens: [],
  selectedToken: null,
  setTokens: (tokens) => set({ tokens }),
  setSelectedToken: (address) => set({ selectedToken: address }),
}));

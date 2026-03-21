import { create } from "zustand";
import { SOL_MINT, USDC_MINT, DEFAULT_SLIPPAGE_BPS } from "@/lib/constants";

export interface TokenInfo {
  symbol: string;
  mint: string;
  decimals: number;
  logoURI?: string;
  name?: string;
}

interface SwapState {
  inputToken: TokenInfo;
  outputToken: TokenInfo;
  inputAmount: string;
  outputAmount: string;
  slippageBps: number;
  loading: boolean;
  setInputToken: (token: TokenInfo) => void;
  setOutputToken: (token: TokenInfo) => void;
  setInputAmount: (amount: string) => void;
  setOutputAmount: (amount: string) => void;
  setSlippageBps: (bps: number) => void;
  setLoading: (loading: boolean) => void;
  switchTokens: () => void;
}

export const useSwapStore = create<SwapState>((set) => ({
  inputToken: { symbol: "SOL", mint: SOL_MINT, decimals: 9 },
  outputToken: { symbol: "USDC", mint: USDC_MINT, decimals: 6 },
  inputAmount: "",
  outputAmount: "",
  slippageBps: DEFAULT_SLIPPAGE_BPS,
  loading: false,
  setInputToken: (token) => set({ inputToken: token }),
  setOutputToken: (token) => set({ outputToken: token }),
  setInputAmount: (amount) => set({ inputAmount: amount }),
  setOutputAmount: (amount) => set({ outputAmount: amount }),
  setSlippageBps: (bps) => set({ slippageBps: bps }),
  setLoading: (loading) => set({ loading }),
  switchTokens: () =>
    set((state) => ({
      inputToken: state.outputToken,
      outputToken: state.inputToken,
      inputAmount: state.outputAmount,
      outputAmount: state.inputAmount,
    })),
}));

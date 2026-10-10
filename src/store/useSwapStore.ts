import { create } from "zustand";
import { POPULAR_TOKENS } from "@/lib/constants";
import type { TokenInfo } from "@/lib/tokens/types";

export type { TokenInfo };

interface SwapState {
  inputToken: TokenInfo;
  outputToken: TokenInfo;
  /** Exact decimal string typed by the user (never a float). */
  inputAmount: string;
  /** Selecting the current output token here swaps the two sides. */
  setInputToken: (token: TokenInfo) => void;
  /** Selecting the current input token here swaps the two sides. */
  setOutputToken: (token: TokenInfo) => void;
  /** Sets both sides at once (deep links). Ignored if they are the same mint. */
  setTokens: (input: TokenInfo, output: TokenInfo) => void;
  setInputAmount: (amount: string) => void;
  /** Flips sides; optionally seeds the new input with the previous quote. */
  switchTokens: (nextInputAmount?: string) => void;
}

export const useSwapStore = create<SwapState>((set) => ({
  inputToken: POPULAR_TOKENS[0],
  outputToken: POPULAR_TOKENS[1],
  inputAmount: "",
  setInputToken: (token) =>
    set((s) =>
      token.mint === s.outputToken.mint
        ? { inputToken: token, outputToken: s.inputToken }
        : { inputToken: token }
    ),
  setOutputToken: (token) =>
    set((s) =>
      token.mint === s.inputToken.mint
        ? { outputToken: token, inputToken: s.outputToken }
        : { outputToken: token }
    ),
  setTokens: (input, output) =>
    set(() =>
      input.mint === output.mint ? {} : { inputToken: input, outputToken: output }
    ),
  setInputAmount: (amount) => set({ inputAmount: amount }),
  switchTokens: (nextInputAmount) =>
    set((s) => ({
      inputToken: s.outputToken,
      outputToken: s.inputToken,
      inputAmount: nextInputAmount ?? s.inputAmount,
    })),
}));

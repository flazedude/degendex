import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/craft-live.json";
import { validateDepositTransaction } from "./validateTx";

// Real deposit transactions crafted by Jupiter for a throwaway wallet (never
// signed or submitted). Guards against the validator rejecting genuine
// deposits: USDC and native-SOL price orders, and a USDC DCA order.
describe("validateDepositTransaction on real craft responses", () => {
  for (const [name, { request, response }] of Object.entries(fixture.crafts)) {
    it(`accepts ${name}`, () => {
      const check = validateDepositTransaction(response.transaction, {
        user: fixture.wallet,
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        amount: request.amount,
        receiverAddress: response.receiverAddress,
        inputTokenAccount: response.inputTokenAccount,
        vaultPubkey: fixture.vaultPubkey,
        tokenDecimals: response.tokenDecimals,
      });
      expect(check).toMatchObject({ ok: true, depositedAmount: request.amount });
    });

    it(`rejects ${name} when the amount asked for is smaller`, () => {
      const check = validateDepositTransaction(response.transaction, {
        user: fixture.wallet,
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        amount: String(BigInt(request.amount) - 1n),
        receiverAddress: response.receiverAddress,
        inputTokenAccount: response.inputTokenAccount,
        vaultPubkey: fixture.vaultPubkey,
        tokenDecimals: response.tokenDecimals,
      });
      expect(check.ok).toBe(false);
    });

    it(`rejects ${name} for a different wallet`, () => {
      const check = validateDepositTransaction(response.transaction, {
        user: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        amount: request.amount,
        receiverAddress: response.receiverAddress,
        inputTokenAccount: response.inputTokenAccount,
        vaultPubkey: fixture.vaultPubkey,
        tokenDecimals: response.tokenDecimals,
      });
      expect(check.ok).toBe(false);
    });
  }
});

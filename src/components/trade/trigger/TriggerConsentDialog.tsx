"use client";

import { useState } from "react";
import { ArrowUpRight, Loader2, Lock } from "lucide-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTriggerAuth } from "@/hooks/useTriggerAuth";
import {
  JUPITER_APP_URL,
  JUPITER_FEES_URL,
  NEW_ORDERS_PAUSED_MESSAGE,
  TRIGGER_FEES_TEXT,
  TRIGGER_MIN_USD,
  TRIGGER_OFF_MESSAGE,
} from "@/lib/jupiter/trigger/config";
import { cn } from "@/lib/utils";
import { recordConsent, useTriggerConsent } from "./consent";

export const JUPITER_TRIGGER_DOCS_URL = "https://developers.jup.ag/docs/trigger";

const POINTS = [
  "Expired orders do not refund automatically. Withdraw them from Open orders.",
  `Minimum $${TRIGGER_MIN_USD} per order (per round for DCA).`,
  "Execution and output are not guaranteed. Orders can fill partially, or be skipped when the price moves fast.",
  "Triggers use the token's USD price from Jupiter, not the pair rate.",
  "Never send tokens to the vault address yourself. Jupiter does not credit them to an order.",
];

function LedgerToggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3 w-3 accent-primary"
      />
      Sign with a transaction (Ledger)
    </label>
  );
}

/**
 * The one-time custody explanation. "Continue" records consent for the
 * wallet and starts the sign-in signature.
 */
export function TriggerConsentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const auth = useTriggerAuth();
  const [understood, setUnderstood] = useState(false);
  const [useTx, setUseTx] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const signingIn = auth.status === "signing-in";

  const handleContinue = async () => {
    if (!auth.wallet || !understood) return;
    recordConsent(auth.wallet, Date.now());
    setSubmitted(true);
    const ok = await auth.signIn(useTx ? { mode: "transaction" } : undefined);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSubmitted(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto rounded-none border-border/50 bg-card p-4 sm:max-w-md">
        <DialogHeader className="gap-1 text-left">
          <DialogTitle className="flex items-center gap-1.5 text-sm">
            <Lock className="h-3.5 w-3.5 text-primary" /> Limit orders and DCA
            <span className="border border-yellow-500/50 px-1 text-[9px] font-semibold uppercase tracking-wide text-yellow-500">
              Beta
            </span>
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-relaxed text-foreground/90">
            Limit orders and DCA are run by Jupiter. When you place one, the tokens for it move from your
            wallet into a Jupiter vault (custody by Privy) until the order fills or you cancel.
            Withdrawing needs Jupiter&apos;s service; if it&apos;s unavailable you can&apos;t withdraw until
            it&apos;s back.
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1 pl-4 text-[11px] leading-snug text-muted-foreground marker:text-muted-foreground/60">
          {POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
          <li>
            <FeesNote />
          </li>
        </ul>

        <a
          href={JUPITER_TRIGGER_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-0.5 text-[11px] text-primary hover:underline"
        >
          Jupiter&apos;s docs on limit orders and DCA <ArrowUpRight className="h-3 w-3" />
        </a>

        <div className="space-y-1.5 border-t border-border/50 pt-2">
          <label className="flex cursor-pointer items-start gap-1.5 text-[11px]">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="mt-0.5 h-3 w-3 accent-primary"
            />
            <span>I understand that my tokens are held by Jupiter while an order is open.</span>
          </label>
          <p className="text-[10px] leading-snug text-muted-foreground">
            Continue asks your wallet for a sign-in signature. It proves you own this wallet to Jupiter.
            It is not a token approval and moves no funds.
          </p>
          <LedgerToggle checked={useTx} onChange={setUseTx} disabled={signingIn} />
          {submitted && auth.error && !signingIn && (
            <p role="alert" className="text-[10px] text-destructive">
              {auth.error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-1.5 sm:gap-1.5">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="h-7 rounded-none px-3 text-[11px]"
          >
            Not now
          </Button>
          <Button
            onClick={() => void handleContinue()}
            disabled={!understood || signingIn || !auth.wallet}
            className="h-7 rounded-none px-4 text-[11px] font-semibold"
          >
            {signingIn && <Loader2 className="h-3 w-3 animate-spin" />}
            {signingIn ? "Check your wallet..." : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The fee sentence with a link to Jupiter's fee table. */
export function FeesNote({ className }: { className?: string }) {
  return (
    <span className={className}>
      {TRIGGER_FEES_TEXT}.{" "}
      <a
        href={JUPITER_FEES_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 text-primary hover:underline"
      >
        Jupiter&apos;s fees <ArrowUpRight className="h-2.5 w-2.5" />
      </a>
    </span>
  );
}

function JupiterLink() {
  return (
    <a
      href={JUPITER_APP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 text-primary hover:underline"
    >
      Open jup.ag <ArrowUpRight className="h-3 w-3" />
    </a>
  );
}

/**
 * Kill-switch note. "off": the whole feature is off here, with the pointer to
 * jup.ag (same vault). "new-orders": only new orders are paused; existing
 * orders stay manageable in Open orders.
 */
export function TriggerUnavailable({
  className,
  kind = "off",
}: {
  className?: string;
  kind?: "off" | "new-orders";
}) {
  if (kind === "new-orders") {
    return (
      <div className={cn("space-y-1 text-[11px] text-muted-foreground", className)} role="status">
        <p className="font-medium text-foreground/90">{NEW_ORDERS_PAUSED_MESSAGE}.</p>
        <p>Orders you already placed are still listed under Open orders, where you can cancel or withdraw them.</p>
      </div>
    );
  }
  return (
    <div className={cn("space-y-1 text-[11px] text-muted-foreground", className)} role="status">
      <p className="font-medium text-foreground/90">Limit orders and DCA are turned off here for now.</p>
      <p>{TRIGGER_OFF_MESSAGE}</p>
      <JupiterLink />
    </div>
  );
}

/**
 * Renders `children` once the wallet has accepted the custody consent and is
 * signed in to Jupiter Trigger; otherwise the matching call to action.
 */
export function TriggerGate({
  children,
  layout = "panel",
  intro,
}: {
  children: React.ReactNode;
  /** "panel" for order forms, "centered" for table areas. */
  layout?: "panel" | "centered";
  /** One line above the button explaining what this unlocks. */
  intro?: string;
}) {
  const auth = useTriggerAuth();
  const consented = useTriggerConsent(auth.wallet);
  const { setVisible } = useWalletModal();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [useTx, setUseTx] = useState(false);

  if (!auth.enabled) {
    return (
      <div className={cn(layout === "centered" ? "flex flex-1 items-center justify-center p-4" : "py-2")}>
        <TriggerUnavailable className={cn(layout === "centered" && "flex flex-col items-center text-center")} />
      </div>
    );
  }

  if (auth.wallet && consented && auth.status === "ready") return <>{children}</>;

  const wrap = cn(
    "flex flex-col gap-2 text-[11px]",
    layout === "centered" ? "flex-1 items-center justify-center px-3 py-4 text-center" : "border border-border/50 bg-background/30 p-3"
  );
  const btn = "h-7 rounded-none px-3 text-[11px] font-semibold";

  let content: React.ReactNode;
  if (!auth.wallet) {
    content = (
      <>
        <p className="text-muted-foreground">Connect a wallet to use limit orders and DCA.</p>
        <Button size="sm" onClick={() => setVisible(true)} className={cn(btn, layout === "panel" && "w-full")}>
          Connect Wallet
        </Button>
      </>
    );
  } else if (auth.status === "signing-in") {
    content = (
      <p className="flex items-center justify-center gap-1.5 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Signing in to Jupiter...
      </p>
    );
  } else if (!consented) {
    content = (
      <>
        {intro && <p className="text-muted-foreground">{intro}</p>}
        <Button
          size="sm"
          onClick={() => setDialogOpen(true)}
          className={cn(btn, layout === "panel" && "w-full")}
        >
          Enable limit orders &amp; DCA
        </Button>
      </>
    );
  } else {
    // Consented before, but not signed in (new tab, expired session, error).
    content = (
      <>
        <p className="text-muted-foreground">
          {layout === "centered"
            ? "Sign in to see your orders - funds from expired or cancelled orders may be waiting in your Jupiter vault."
            : "Sign in to Jupiter to use limit orders and DCA."}{" "}
          It&apos;s a signature, not a token approval.
        </p>
        {auth.error && (
          <p role="alert" className="text-[10px] text-destructive">
            {auth.error}
          </p>
        )}
        <Button
          size="sm"
          onClick={() => void auth.signIn(useTx ? { mode: "transaction" } : undefined)}
          className={cn(btn, layout === "panel" && "w-full")}
        >
          Sign in
        </Button>
        <div className={cn(layout === "centered" && "flex justify-center")}>
          <LedgerToggle checked={useTx} onChange={setUseTx} />
        </div>
      </>
    );
  }

  return (
    <div className={wrap}>
      {content}
      {/* Mounted across branches: recording consent and signing in both
          change the branch while the dialog is still open. */}
      {auth.wallet && <TriggerConsentDialog open={dialogOpen} onOpenChange={setDialogOpen} />}
    </div>
  );
}

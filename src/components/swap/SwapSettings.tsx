"use client";

import { useState } from "react";
import { AlertTriangle, Settings2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettingsStore, type SlippageSetting } from "@/store/useSettingsStore";
import {
  MAX_CUSTOM_SLIPPAGE_BPS,
  MIN_CUSTOM_SLIPPAGE_BPS,
} from "@/lib/jupiter/params";
import { cn } from "@/lib/utils";

const PRESETS: { label: string; value: SlippageSetting }[] = [
  { label: "Auto", value: "auto" },
  { label: "0.5%", value: 50 },
  { label: "1%", value: 100 },
  { label: "3%", value: 300 },
];

/** Parses a percent string ("0.75") to bps, or null if outside 0.01..50%. */
function percentToBps(text: string): number | null {
  if (!/^\d{0,2}(\.\d{0,2})?$/.test(text.trim()) || !text.trim()) return null;
  const bps = Math.round(Number(text) * 100);
  return Number.isFinite(bps) &&
    bps >= MIN_CUSTOM_SLIPPAGE_BPS &&
    bps <= MAX_CUSTOM_SLIPPAGE_BPS
    ? bps
    : null;
}

export function slippageLabel(slippage: SlippageSetting): string {
  return slippage === "auto" ? "Auto" : `${slippage / 100}%`;
}

export function SwapSettings() {
  const slippage = useSettingsStore((s) => s.slippage);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 font-mono text-xs text-muted-foreground hover:text-foreground"
          aria-label="Swap settings"
        >
          <Settings2 className="h-4 w-4" />
          {slippageLabel(slippage)}
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border bg-card p-4 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold uppercase tracking-wide">
            Swap settings
          </DialogTitle>
          <DialogDescription className="text-xs">
            Priority fees and transaction landing are managed by Jupiter.
          </DialogDescription>
        </DialogHeader>
        <SlippageEditor />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so its local state starts fresh. */
function SlippageEditor() {
  const slippage = useSettingsStore((s) => s.slippage);
  const setSlippage = useSettingsStore((s) => s.setSlippage);
  const isPreset = PRESETS.some((p) => p.value === slippage);
  const [custom, setCustom] = useState(
    !isPreset && typeof slippage === "number" ? String(slippage / 100) : ""
  );

  const customBps = custom ? percentToBps(custom) : null;
  const invalidCustom = custom.trim() !== "" && customBps === null;
  const effective = typeof slippage === "number" ? slippage : null;

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Max slippage
      </label>
      <div className="grid grid-cols-5 gap-1">
        {PRESETS.map((opt) => (
          <Button
            key={opt.label}
            variant="outline"
            size="sm"
            onClick={() => {
              setSlippage(opt.value);
              setCustom("");
            }}
            className={cn(
              "h-8 px-0 font-mono text-xs",
              slippage === opt.value && "border-primary bg-primary/10 text-primary"
            )}
          >
            {opt.label}
          </Button>
        ))}
        <div className="relative">
          <Input
            inputMode="decimal"
            placeholder="Custom"
            value={custom}
            aria-label="Custom slippage percent"
            aria-invalid={invalidCustom || undefined}
            onChange={(e) => {
              const text = e.target.value.replace(",", ".");
              if (!/^\d{0,2}(\.\d{0,2})?$/.test(text)) return;
              setCustom(text);
              const bps = percentToBps(text);
              if (bps !== null) setSlippage(bps);
            }}
            className={cn(
              "h-8 bg-background pr-5 font-mono text-xs",
              !isPreset && "border-primary text-primary"
            )}
          />
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            %
          </span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        <span className="text-foreground">Auto</span> (recommended) uses
        Jupiter&apos;s real-time slippage estimate for each quote, balancing
        success rate and price protection.
      </p>

      {invalidCustom && (
        <p className="text-xs text-destructive">Enter a value between 0.01% and 50%.</p>
      )}
      {effective !== null && effective > 500 && (
        <p className="flex items-start gap-1.5 text-xs text-yellow-500">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          High slippage can get you sandwiched: you may receive much less than quoted.
        </p>
      )}
      {effective !== null && effective < 10 && (
        <p className="flex items-start gap-1.5 text-xs text-yellow-500">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          Very low slippage: your swap may fail.
        </p>
      )}
    </div>
  );
}

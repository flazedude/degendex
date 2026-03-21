"use client";

import { Settings2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/store/useSettingsStore";
import { cn } from "@/lib/utils";

const SLIPPAGE_OPTIONS = [
  { label: "0.1%", value: 10 },
  { label: "0.5%", value: 50 },
  { label: "1%", value: 100 },
];

const PRIORITY_OPTIONS = [
  { label: "None", value: "none" as const },
  { label: "Low", value: "low" as const },
  { label: "Medium", value: "medium" as const },
  { label: "High", value: "high" as const },
];

export function SwapSettings() {
  const { slippageBps, priorityFee, setSlippageBps, setPriorityFee } =
    useSettingsStore();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
          <Settings2 className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Swap Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Slippage */}
          <div>
            <label className="mb-2 block text-sm font-medium text-muted-foreground">
              Slippage Tolerance
            </label>
            <div className="flex gap-2">
              {SLIPPAGE_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  variant="outline"
                  size="sm"
                  onClick={() => setSlippageBps(opt.value)}
                  className={cn(
                    "flex-1",
                    slippageBps === opt.value &&
                      "border-primary bg-primary/10 text-primary"
                  )}
                >
                  {opt.label}
                </Button>
              ))}
              <div className="relative flex-1">
                <Input
                  type="number"
                  placeholder="Custom"
                  value={
                    SLIPPAGE_OPTIONS.some((o) => o.value === slippageBps)
                      ? ""
                      : (slippageBps / 100).toString()
                  }
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val > 0 && val <= 50) {
                      setSlippageBps(Math.floor(val * 100));
                    }
                  }}
                  className="h-9 bg-background pr-6 text-sm"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  %
                </span>
              </div>
            </div>
          </div>

          {/* Priority Fee */}
          <div>
            <label className="mb-2 block text-sm font-medium text-muted-foreground">
              Priority Fee
            </label>
            <div className="flex gap-2">
              {PRIORITY_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  variant="outline"
                  size="sm"
                  onClick={() => setPriorityFee(opt.value)}
                  className={cn(
                    "flex-1",
                    priorityFee === opt.value &&
                      "border-primary bg-primary/10 text-primary"
                  )}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

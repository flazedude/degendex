"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const STYLES = [
  { id: "graphite", label: "Graphite", swatches: ["#101820", "#293744", "#80b9ef"] },
  { id: "paper", label: "Paper", swatches: ["#f5f0e5", "#b6ac98", "#253c70"] },
  { id: "signal", label: "Night Signal", swatches: ["#140f23", "#b7a1ff", "#66e9de"] },
  { id: "copper", label: "Copper", swatches: ["#211a16", "#7d5544", "#e0a570"] },
  { id: "harbor", label: "Harbor", swatches: ["#eaf4f5", "#87bfc3", "#146e71"] },
] as const;

type InterfaceStyle = (typeof STYLES)[number]["id"];
const DEFAULT_STYLE: InterfaceStyle = "graphite";
const STORAGE_KEY = "degn:interface-style";

function isInterfaceStyle(value: unknown): value is InterfaceStyle {
  return STYLES.some((style) => style.id === value);
}

function getActiveStyle(): InterfaceStyle {
  const value = document.documentElement.dataset.degnStyle;
  return isInterfaceStyle(value) ? value : DEFAULT_STYLE;
}

function subscribe(onStyleChange: () => void): () => void {
  const observer = new MutationObserver(onStyleChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-degn-style"] });
  return () => observer.disconnect();
}

function saveStyle(style: InterfaceStyle) {
  try {
    window.localStorage.setItem(STORAGE_KEY, style);
  } catch {
    // The selector still works when browser storage is blocked.
  }
}

function restoreStyle() {
  const fromUrl = new URL(window.location.href).searchParams.get("style");
  if (isInterfaceStyle(fromUrl)) {
    document.documentElement.dataset.degnStyle = fromUrl;
    saveStyle(fromUrl);
    return;
  }
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isInterfaceStyle(saved)) document.documentElement.dataset.degnStyle = saved;
  } catch {
    // Keep the server-rendered default.
  }
}

export function StyleSwitcher() {
  const active = useSyncExternalStore(subscribe, getActiveStyle, () => DEFAULT_STYLE);

  useEffect(() => {
    restoreStyle();
    window.addEventListener("popstate", restoreStyle);
    return () => window.removeEventListener("popstate", restoreStyle);
  }, []);

  function chooseStyle(value: string) {
    if (!isInterfaceStyle(value)) return;
    document.documentElement.dataset.degnStyle = value;
    saveStyle(value);

    // Keep a direct preview link pointing at the style that is on screen.
    const url = new URL(window.location.href);
    if (url.searchParams.has("style")) {
      url.searchParams.set("style", value);
      window.history.replaceState(window.history.state, "", url);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="xs"
          aria-label="Interface styles"
          title={STYLES.find((style) => style.id === active)?.label}
          className="degn-style-trigger h-8 min-w-8 px-2"
        >
          <Palette className="size-3.5" aria-hidden />
          <span className="hidden min-[360px]:inline">Styles</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="degn-style-menu z-[70] min-w-39 bg-card p-1.5 text-card-foreground shadow-xl">
        <DropdownMenuRadioGroup value={active} onValueChange={chooseStyle}>
          {STYLES.map((style) => (
            <DropdownMenuRadioItem key={style.id} value={style.id} className="min-h-8 gap-2.5 pr-3">
              <span className="flex h-3.5 w-7 shrink-0 overflow-hidden rounded-sm border border-border" aria-hidden>
                {style.swatches.map((color) => <span key={color} className="flex-1" style={{ backgroundColor: color }} />)}
              </span>
              <span>{style.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

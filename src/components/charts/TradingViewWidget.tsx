"use client";

import { useEffect, useRef, memo } from "react";

interface TradingViewWidgetProps {
  symbol: string;
  hideTopToolbar?: boolean;
}

function TradingViewWidgetInner({ symbol, hideTopToolbar = false }: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    containerRef.current.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: "60",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      backgroundColor: "rgba(10, 10, 15, 1)",
      gridColor: "rgba(39, 39, 58, 0.3)",
      hide_top_toolbar: hideTopToolbar,
      hide_legend: false,
      allow_symbol_change: true,
      save_image: false,
      calendar: false,
      hide_volume: false,
      support_host: "https://www.tradingview.com",
      withdateranges: false,
      details: false,
      hotlist: false,
    });

    containerRef.current.appendChild(script);
  }, [symbol, hideTopToolbar]);

  return (
    <div className="tradingview-widget-container h-full w-full overflow-hidden">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

export const TradingViewWidget = memo(TradingViewWidgetInner);

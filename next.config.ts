import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  // /charts was an unlinked TradingView (CEX price) page; the on-chain chart lives in /trade.
  async redirects() {
    return [{ source: "/charts", destination: "/trade", permanent: true }];
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
    };
    return config;
  },
};

export default nextConfig;

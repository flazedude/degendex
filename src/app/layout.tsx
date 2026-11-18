import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { DEFAULT_INTERFACE_STYLE } from "@/lib/constants";
import { SolanaProvider } from "@/providers/SolanaProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import { Navbar } from "@/components/layout/Navbar";
import { PendingSwapMonitor } from "@/components/shared/PendingSwapMonitor";
import { ConditionalFooter } from "@/components/layout/ConditionalFooter";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DEGN DEX | Solana Decentralized Exchange",
  description:
    "Best-price Solana swaps through Jupiter, meme pair discovery, a Raydium pool explorer and charts.",
  openGraph: {
    title: "DEGN DEX",
    description:
      "Best-price Solana swaps through Jupiter, meme pair discovery, a Raydium pool explorer and charts.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-degn-style={DEFAULT_INTERFACE_STYLE}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <QueryProvider>
          <SolanaProvider>
            <PendingSwapMonitor />
            <Navbar />
            <main className="flex flex-1 flex-col">{children}</main>
            <ConditionalFooter />
            <Toaster
              theme="dark"
              position="bottom-right"
              toastOptions={{
                style: {
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  color: "var(--foreground)",
                },
              }}
            />
          </SolanaProvider>
        </QueryProvider>
      </body>
    </html>
  );
}

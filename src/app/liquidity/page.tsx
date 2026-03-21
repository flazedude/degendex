"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PoolList } from "@/components/liquidity/PoolList";
import { AddLiquidity } from "@/components/liquidity/AddLiquidity";
import { MyPositions } from "@/components/liquidity/MyPositions";
import type { RaydiumPool } from "@/lib/api/raydium";

export default function LiquidityPage() {
  const [selectedPool, setSelectedPool] = useState<RaydiumPool | null>(null);

  if (selectedPool) {
    return (
      <div className="flex flex-1 items-start justify-center px-4 pt-8 pb-20">
        <AddLiquidity pool={selectedPool} onBack={() => setSelectedPool(null)} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 pb-16">
      <div className="mb-3">
        <h1 className="text-xl font-bold">
          <span className="text-gradient">Liquidity</span> Pools
        </h1>
        <p className="text-xs text-muted-foreground">
          Provide liquidity to Raydium pools and earn trading fees.
        </p>
      </div>

      <Tabs defaultValue="pools" className="space-y-4">
        <TabsList className="bg-muted/50 border border-border/50">
          <TabsTrigger value="pools" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
            All Pools
          </TabsTrigger>
          <TabsTrigger value="positions" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
            My Positions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pools">
          <PoolList onSelectPool={setSelectedPool} />
        </TabsContent>

        <TabsContent value="positions">
          <MyPositions />
        </TabsContent>
      </Tabs>
    </div>
  );
}

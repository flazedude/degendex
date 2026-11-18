import { Suspense } from "react";
import { SwapCard } from "@/components/swap/SwapCard";
import { SwapDeepLink } from "@/components/swap/SwapDeepLink";

export default function SwapPage() {
  return (
    <div className="flex flex-1 items-start justify-center px-4 pt-6 pb-16">
      <Suspense fallback={null}>
        <SwapDeepLink />
      </Suspense>
      <SwapCard />
    </div>
  );
}

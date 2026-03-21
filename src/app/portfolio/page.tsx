import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PortfolioPage() {
  return (
    <div className="flex flex-1 items-start justify-center px-4 pt-12 pb-20">
      <Card className="w-full max-w-4xl border-border/50 bg-card/80">
        <CardHeader>
          <CardTitle className="text-gradient">Portfolio</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Track your positions, balances, and transaction history. Coming in
            Phase 5 with Helius DAS integration.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-dashed border-border py-16 text-center">
              <p className="text-sm text-muted-foreground">Balance Overview</p>
            </div>
            <div className="rounded-lg border border-dashed border-border py-16 text-center">
              <p className="text-sm text-muted-foreground">Positions</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

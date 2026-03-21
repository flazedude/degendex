import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function OrderBookPage() {
  return (
    <div className="flex flex-1 items-start justify-center px-4 pt-12 pb-20">
      <Card className="w-full max-w-4xl border-border/50 bg-card/80">
        <CardHeader>
          <CardTitle className="text-gradient">Order Book</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Place limit orders with full order book depth. Coming soon with
            OpenBook V2 integration.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-dashed border-border py-16 text-center">
              <p className="text-sm text-muted-foreground">Order Book</p>
            </div>
            <div className="rounded-lg border border-dashed border-border py-16 text-center">
              <p className="text-sm text-muted-foreground">Order Form</p>
            </div>
            <div className="rounded-lg border border-dashed border-border py-16 text-center">
              <p className="text-sm text-muted-foreground">Trade History</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

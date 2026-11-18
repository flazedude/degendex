"use client";

import { ExternalLink } from "lucide-react";
import { solscanTxUrl } from "@/components/trade/tradesFormat";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTokenAmount, fromBaseUnits } from "@/lib/amounts";
import type { SwapReceipt } from "@/lib/swapReceipts";
import { shortenAddress } from "@/lib/utils";
import { useSwapReceipts } from "@/store/useSwapReceipts";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

function ReceiptAmount({ token, raw }: { token: SwapReceipt["input"]; raw: string | null }) {
  const exact = raw === null ? null : fromBaseUnits(raw, token.decimals);

  return (
    <>
      {exact === null ? (
        <span className="block text-muted-foreground">
          <span aria-hidden="true">—</span>
          <span className="sr-only">Amount unavailable</span>
        </span>
      ) : (
        <span className="block break-all font-mono tabular-nums" title={exact}>
          {formatTokenAmount(exact)}
        </span>
      )}
      <span className="block truncate text-muted-foreground" title={token.mint}>
        {token.symbol}
      </span>
    </>
  );
}

function ReceiptRow({ receipt }: { receipt: SwapReceipt }) {
  const href = solscanTxUrl(receipt.signature);
  const confirmedAt = new Date(receipt.confirmedAt);
  const hasTime = Number.isFinite(confirmedAt.getTime());

  return (
    <TableRow>
      <TableCell className="py-3 pl-3 whitespace-normal sm:pl-5">
        {hasTime ? (
          <time dateTime={confirmedAt.toISOString()}>
            <span className="block">{dateFormat.format(confirmedAt)}</span>
            <span className="block text-muted-foreground">{timeFormat.format(confirmedAt)}</span>
          </time>
        ) : "—"}
      </TableCell>
      <TableCell className="text-right whitespace-normal">
        <ReceiptAmount token={receipt.input} raw={receipt.inputAmountRaw} />
      </TableCell>
      <TableCell className="text-right whitespace-normal">
        <ReceiptAmount token={receipt.output} raw={receipt.outputAmountRaw} />
      </TableCell>
      <TableCell className="pr-3 text-right sm:pr-5">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View swap ${shortenAddress(receipt.signature)} on Solscan`}
            className="inline-flex min-h-8 items-center gap-1 text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Solscan <ExternalLink aria-hidden="true" className="hidden size-3 sm:block" />
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

export function SwapHistory({ wallet }: { wallet: string }) {
  const receipts = useSwapReceipts(wallet);

  return (
    <section aria-labelledby="swap-history-title">
      <Card className="gap-0 border-border/50 py-0">
        <div className="border-b border-border/50 p-4 sm:p-5">
          <h2 id="swap-history-title" className="text-sm font-semibold">Swap history</h2>
          <p className="mt-1 text-xs text-muted-foreground">Confirmed DEGN DEX swaps recorded in this browser.</p>
        </div>
        {receipts.length > 0 ? (
          <Table aria-label="Confirmed swaps" className="table-fixed text-xs sm:text-sm">
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead scope="col" className="w-[26%] pl-3 sm:w-[32%] sm:pl-5">Time</TableHead>
                <TableHead scope="col" className="w-1/4 text-right">Sent</TableHead>
                <TableHead scope="col" className="w-1/4 text-right">Received</TableHead>
                <TableHead scope="col" className="w-[24%] pr-3 text-right sm:w-[18%] sm:pr-5">Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receipts.map((receipt) => <ReceiptRow key={receipt.signature} receipt={receipt} />)}
            </TableBody>
          </Table>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No confirmed swaps recorded for this wallet.</p>
        )}
      </Card>
    </section>
  );
}

import { NextRequest, NextResponse } from "next/server";
import { getOHLCV } from "@/lib/api/birdeye";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const address = searchParams.get("address");
  const type = (searchParams.get("type") as "1m" | "5m" | "15m" | "1H" | "4H" | "1D") || "1H";
  const timeFrom = searchParams.get("timeFrom")
    ? parseInt(searchParams.get("timeFrom")!)
    : undefined;
  const timeTo = searchParams.get("timeTo")
    ? parseInt(searchParams.get("timeTo")!)
    : undefined;

  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  try {
    const data = await getOHLCV(address, type, timeFrom, timeTo);
    return NextResponse.json({ items: data }, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Chart API error:", error);
    return NextResponse.json({ items: [] }, { status: 500 });
  }
}

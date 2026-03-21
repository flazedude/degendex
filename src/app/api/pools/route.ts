import { NextRequest, NextResponse } from "next/server";
import { getPoolList } from "@/lib/api/raydium";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const type = (searchParams.get("type") as "all" | "standard" | "concentrated") || "all";
  const sort = (searchParams.get("sort") as "liquidity" | "volume24h" | "fee24h" | "apr24h") || "liquidity";
  const order = (searchParams.get("order") as "asc" | "desc") || "desc";
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "20");

  try {
    const data = await getPoolList(type, sort, order, page, pageSize);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error("Pools API error:", error);
    return NextResponse.json({ count: 0, data: [], hasNextPage: false }, { status: 500 });
  }
}

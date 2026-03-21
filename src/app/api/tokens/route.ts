import { NextRequest, NextResponse } from "next/server";
import { getTokenList } from "@/lib/api/birdeye";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const sortBy = (searchParams.get("sortBy") as "v24hUSD" | "mc" | "v24hChangePercent") || "v24hUSD";
  const sortType = (searchParams.get("sortType") as "asc" | "desc") || "desc";
  const offset = parseInt(searchParams.get("offset") || "0");
  const limit = parseInt(searchParams.get("limit") || "20");

  try {
    const data = await getTokenList(sortBy, sortType, offset, limit);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Token list API error:", error);
    return NextResponse.json({ tokens: [], total: 0 }, { status: 500 });
  }
}

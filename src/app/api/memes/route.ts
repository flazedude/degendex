import { NextResponse } from "next/server";
import { getPumpFunPairs } from "@/lib/api/dexscreener";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pairs = await getPumpFunPairs();
    return NextResponse.json({ pairs }, {
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" },
    });
  } catch (error) {
    console.error("Memes API error:", error);
    return NextResponse.json({ pairs: [] }, { status: 500 });
  }
}

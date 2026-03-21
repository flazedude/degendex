import { NextResponse } from "next/server";
import { getTopSolanaPairs } from "@/lib/api/dexscreener";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pairs = await getTopSolanaPairs();
    return NextResponse.json({ pairs });
  } catch (error) {
    console.error("Explore API error:", error);
    return NextResponse.json({ pairs: [] }, { status: 500 });
  }
}

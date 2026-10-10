import { validateExecuteBody } from "@/lib/jupiter/params";
import { EXECUTE_UNKNOWN_STATUS_CODE } from "@/lib/jupiter/errors";
import {
  JUPITER_BASE_URL,
  isTimeoutError,
  jsonResponse,
  jupiterHeaders,
  readJson,
  upstreamError,
} from "@/lib/jupiter/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse(
      { status: "Failed", error: "Invalid JSON body", code: -2 },
      400
    );
  }
  const parsed = validateExecuteBody(raw);
  if (!parsed.ok) {
    return jsonResponse({ status: "Failed", error: parsed.error, code: -2 }, 400);
  }

  try {
    const res = await fetch(`${JUPITER_BASE_URL}/swap/v2/execute`, {
      method: "POST",
      headers: jupiterHeaders(true),
      // Forward only the two validated fields.
      body: JSON.stringify({
        signedTransaction: parsed.value.signedTransaction,
        requestId: parsed.value.requestId,
      }),
      cache: "no-store",
      // /execute waits for the transaction to land.
      signal: AbortSignal.timeout(60_000),
    });
    const body = await readJson(res);
    if (res.ok && body && typeof body === "object") {
      return jsonResponse(body, 200);
    }
    const upstream = (body ?? {}) as Record<string, unknown>;
    const code =
      typeof upstream.code === "number"
        ? upstream.code
        : EXECUTE_UNKNOWN_STATUS_CODE;
    const status = res.ok ? 502 : res.status >= 500 ? 502 : res.status;
    return jsonResponse(
      {
        status: "Failed",
        error: upstreamError(body, `Jupiter execute failed (${res.status})`),
        code,
        ...(typeof upstream.signature === "string"
          ? { signature: upstream.signature }
          : {}),
      },
      status
    );
  } catch (err) {
    // The signed transaction may still land: report an unknown outcome rather
    // than a failure so the client never encourages a blind retry.
    return jsonResponse(
      {
        status: "Failed",
        error: isTimeoutError(err)
          ? "Timed out waiting for the swap to land"
          : "Could not reach Jupiter",
        code: EXECUTE_UNKNOWN_STATUS_CODE,
      },
      504
    );
  }
}

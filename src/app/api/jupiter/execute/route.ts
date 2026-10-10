import { validateExecuteBody } from "@/lib/jupiter/params";
import { EXECUTE_REJECTED_CODE, EXECUTE_UNKNOWN_STATUS_CODE } from "@/lib/jupiter/errors";
import {
  BodyTooLargeError,
  JUPITER_BASE_URL,
  isTimeoutError,
  jsonResponse,
  jupiterHeaders,
  readJson,
  readTextCapped,
  upstreamError,
} from "@/lib/jupiter/server";

export const dynamic = "force-dynamic";
// Upstream wait is capped at 60s below; leave headroom so the platform never
// cuts the response off first (that would look like an unknown outcome).
export const maxDuration = 90;

/** A real body is < 2 KB (signed tx is capped at 4096 base64 chars). */
const MAX_BODY_BYTES = 8 * 1024;

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = JSON.parse(await readTextCapped(req, MAX_BODY_BYTES));
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return jsonResponse(
        { status: "Failed", error: "Request body too large", code: -2 },
        413
      );
    }
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
    // A 4xx without a code (e.g. a 429 from the execute bucket) was rejected
    // before broadcast: a definite failure. Only 5xx may hide a landed swap.
    const code =
      typeof upstream.code === "number"
        ? upstream.code
        : res.status >= 400 && res.status < 500
          ? EXECUTE_REJECTED_CODE
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

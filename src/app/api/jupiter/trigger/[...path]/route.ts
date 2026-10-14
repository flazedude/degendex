// Strict allow-list proxy for Jupiter Trigger Order API v2 (limit orders + DCA).
//
// - Only the method + path pairs in matchTriggerRoute are forwarded; ids must
//   be UUIDs. Everything else is a 404.
// - Bodies are capped, validated and rebuilt from known fields only; query
//   strings are allow-listed.
// - The caller's `Authorization: Bearer <jwt>` is forwarded verbatim on
//   authenticated routes and never logged, cached or echoed. Cookies and every
//   other incoming header are dropped (fresh upstream headers + x-api-key).
// - Every response is Cache-Control: no-store.
// - Kill switch (NEXT_PUBLIC_DISABLE_TRIGGER, re-read on every request):
//   "new-orders-off" 404s only the routes that start or change an order
//   (craft, create, PATCH) so cancel / withdraw keep working; "off" 404s all.
// - A Trigger JWT rejection (401 {"error":"Unauthorized"}) comes back as
//   401 { error, authError: true } so the client knows to refresh; a gateway
//   401/403 (bad or under-privileged API key) becomes a 502 config error.
import type { NextRequest } from "next/server";
import {
  NEW_ORDERS_PAUSED_MESSAGE,
  TRIGGER_OFF_MESSAGE,
  isTriggerRouteAllowed,
  triggerModeFromEnv,
} from "@/lib/jupiter/trigger/config";
import {
  isTriggerAuthRejection,
  matchTriggerRoute,
  parseBearer,
  sanitizeDetails,
  type TriggerMethod,
} from "@/lib/jupiter/trigger/params";
import {
  BodyTooLargeError,
  JUPITER_BASE_URL,
  isTimeoutError,
  jsonResponse,
  jupiterHeaders,
  rateLimitedResponse,
  readJson,
  readTextCapped,
  upstreamError,
} from "@/lib/jupiter/server";

export const dynamic = "force-dynamic";
// Create / confirm-cancel wait up to 45s upstream; leave headroom.
export const maxDuration = 60;

const MAX_BODY_BYTES = 16 * 1024;
const TRIGGER_BASE = `${JUPITER_BASE_URL}/trigger/v2`;

interface RouteContext {
  params: Promise<{ path?: string[] }>;
}

const UNKNOWN_OUTCOME_ERROR =
  "Jupiter did not confirm the result. The transaction may or may not have landed: check your open orders before trying again";

function isGatewayShape(body: unknown): boolean {
  return (
    !!body &&
    typeof body === "object" &&
    ("code" in body || ("message" in body && !("error" in body)))
  );
}

async function handle(method: TriggerMethod, req: NextRequest, ctx: RouteContext) {
  // Read per request (not a module constant) so a server-side change of the
  // flag applies without a rebuild.
  const mode = triggerModeFromEnv();
  if (mode === "off") {
    return jsonResponse(
      { error: `Limit orders and DCA are turned off here. ${TRIGGER_OFF_MESSAGE}`, disabled: true },
      404
    );
  }

  const { path = [] } = await ctx.params;
  const route = matchTriggerRoute(method, path);
  if (!route) return jsonResponse({ error: "Not found" }, 404);
  if (!isTriggerRouteAllowed(mode, route.name)) {
    return jsonResponse({ error: NEW_ORDERS_PAUSED_MESSAGE, disabled: true }, 404);
  }

  let qs = "";
  if (route.query) {
    const parsed = route.query(req.nextUrl.searchParams);
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);
    qs = parsed.value.toString();
  }

  let bearer: string | null = null;
  if (route.auth) {
    bearer = parseBearer(req.headers.get("authorization"));
    if (!bearer) {
      return jsonResponse({ error: "Sign in to continue", authError: true }, 401);
    }
  }

  let upstreamBody: string | undefined;
  if (route.body) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readTextCapped(req, MAX_BODY_BYTES));
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        return jsonResponse({ error: "Request body too large" }, 413);
      }
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    const parsed = route.body(raw, Date.now());
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);
    upstreamBody = JSON.stringify(parsed.value);
  }

  const headers = jupiterHeaders(upstreamBody !== undefined);
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  let res: Response;
  try {
    res = await fetch(`${TRIGGER_BASE}/${route.upstreamPath}${qs ? `?${qs}` : ""}`, {
      method,
      headers,
      body: upstreamBody,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(route.timeoutMs),
    });
  } catch (err) {
    const timedOut = isTimeoutError(err);
    if (route.landsTransaction) {
      return jsonResponse({ error: UNKNOWN_OUTCOME_ERROR, unknownOutcome: true }, 504);
    }
    return jsonResponse(
      { error: timedOut ? "Jupiter took too long to respond" : "Could not reach Jupiter" },
      timedOut ? 504 : 502
    );
  }

  if (res.status === 429) return rateLimitedResponse(res);

  const body = await readJson(res);

  if (res.ok) {
    return jsonResponse(body !== null && typeof body === "object" ? body : {}, res.status);
  }

  if (res.status === 401) {
    if (isTriggerAuthRejection(res.status, body)) {
      // Bearer routes: the access token is missing/expired/revoked. Refresh:
      // the refresh token itself was rejected. Verify: bad signature/challenge.
      const authError = route.auth || route.name === "auth/refresh";
      return jsonResponse(
        {
          error: authError
            ? route.auth
              ? "Session expired"
              : "Sign-in expired, please sign in again"
            : upstreamError(body, "Signature rejected"),
          authError,
        },
        401
      );
    }
    return jsonResponse({ error: "Jupiter rejected this server's API key" }, 502);
  }

  if (res.status === 403 && isGatewayShape(body)) {
    return jsonResponse({ error: "This server's Jupiter API key has no Trigger access" }, 502);
  }

  if (res.status >= 400 && res.status < 500) {
    const details =
      body && typeof body === "object"
        ? sanitizeDetails((body as Record<string, unknown>).details)
        : undefined;
    return jsonResponse(
      {
        error: upstreamError(body, `Jupiter Trigger request failed (${res.status})`),
        ...(details ? { details } : {}),
      },
      res.status
    );
  }

  if (route.landsTransaction) {
    return jsonResponse({ error: UNKNOWN_OUTCOME_ERROR, unknownOutcome: true }, 502);
  }
  return jsonResponse({ error: `Jupiter Trigger error (${res.status})` }, 502);
}

export function GET(req: NextRequest, ctx: RouteContext) {
  return handle("GET", req, ctx);
}

export function POST(req: NextRequest, ctx: RouteContext) {
  return handle("POST", req, ctx);
}

export function PATCH(req: NextRequest, ctx: RouteContext) {
  return handle("PATCH", req, ctx);
}

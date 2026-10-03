// Sanitised evidence of real partner calls (Gnani, Pine Labs) for the Ken
// Round 3 submission. Redaction is structural, not best-effort: secrets are
// removed by KEY NAME (anything auth-shaped) and by VALUE (the configured
// secrets are scrubbed wherever they appear), and contact details are masked.
// Delhivery is not integrated, so nothing here ever records a Delhivery call.
import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "@/lib/prisma";

export type RailContext = { tripId?: string | null; userId?: string | null; relatedKind?: string; relatedId?: string; decision?: string };
const als = new AsyncLocalStorage<RailContext>();
export const withRailContext = <T>(ctx: RailContext, fn: () => Promise<T>): Promise<T> => als.run(ctx, fn);
export const currentRailContext = () => als.getStore();

const SECRET_KEYS = /^(authorization|x-api-key|x-api-key-id|api[-_]?key|apikey|client[-_]?secret|client[-_]?id|access[-_]?token|refresh[-_]?token|token|password|secret|cookie|set-cookie|webhook[-_]?secret)$/i;
const SECRET_ENV = ["GNANI_SPEECH_API_KEY", "GNANI_API_KEY", "GNANI_PLATFORM_API_KEY", "PINELABS_CLIENT_ID", "PINELABS_CLIENT_SECRET", "PINELABS_WEBHOOK_SECRET", "GEMINI_API_KEY", "RESEND_API_KEY", "DATABASE_URL"];

export function maskEmail(v: string) {
  const [u, d] = v.split("@");
  return d ? `${u.slice(0, 1)}***@${d}` : v;
}
export function maskPhone(v: string) {
  const digits = v.replace(/\D/g, "");
  return digits.length > 4 ? `${"*".repeat(Math.max(0, digits.length - 2))}${digits.slice(-2)}` : "***";
}

function scrubString(s: string): string {
  let out = s;
  for (const name of SECRET_ENV) {
    const v = process.env[name];
    if (v && v.length > 5) out = out.split(v).join("[REDACTED]");
  }
  return out;
}

export function sanitize(value: unknown, key = ""): unknown {
  if (SECRET_KEYS.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (/^(email|email_id|customer_email)$/i.test(key)) return maskEmail(value);
    if (/^(mobile|mobile_number|phone)$/i.test(key)) return maskPhone(value);
    return scrubString(value);
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitize(v, k)]));
  return value;
}

export type RailRecord = {
  partner: "GNANI" | "PINELABS";
  operation: string;
  endpoint: string;
  method: string;
  request: unknown;
  response?: unknown;
  httpStatus?: number | null;
  providerRequestId?: string | null;
  durationMs?: number | null;
  context?: RailContext;
};

// Returns the new row id (so callers can link a call to a message), or null on failure.
// A failure to record evidence must never break the real call.
export async function logRailCall(r: RailRecord): Promise<string | null> {
  try {
    const ctx = { ...(currentRailContext() ?? {}), ...(r.context ?? {}) };
    const row = await prisma.railCall.create({
      data: {
        tripId: ctx.tripId ?? null,
        userId: ctx.userId ?? null,
        partner: r.partner,
        operation: r.operation,
        endpoint: scrubString(r.endpoint),
        method: r.method,
        requestJson: JSON.stringify(sanitize(r.request)),
        responseJson: r.response === undefined ? null : JSON.stringify(sanitize(r.response)),
        httpStatus: r.httpStatus ?? null,
        providerRequestId: r.providerRequestId ?? null,
        durationMs: r.durationMs ?? null,
        relatedKind: ctx.relatedKind ?? null,
        relatedId: ctx.relatedId ?? null,
        decision: ctx.decision ?? null,
      },
    });
    return row.id;
  } catch (err) {
    console.error("[rail-evidence] could not record:", err instanceof Error ? err.message : "unknown");
    return null;
  }
}

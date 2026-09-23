// Real, request-based verification for every external integration — never
// infers LIVE merely from an env var being present. Each check either
// makes an actual read-only request to the provider (safe, no side
// effects — never sends a real email, never places a real call/ride) or
// is transparent about why it can't be independently verified.
import { GoogleGenAI } from "@google/genai";
import { list as listBlobs } from "@vercel/blob";
import { getWeather } from "@/lib/travel/open-meteo-weather";
import { resolveLocationText, isGeoapifyConfigured } from "@/lib/travel/geoapify-provider";
import { getMissingUberEnvVars } from "@/lib/uber/oauth";
import { getMissingGnaniEnvVars } from "@/lib/voice-escalation/gnani-provider";
import { isBlobConfigured } from "@/lib/attachments";

export type IntegrationStatusValue = "LIVE" | "NOT_CONFIGURED" | "DEMO_MODE" | "ERROR";

export type IntegrationStatus = {
  name: string;
  status: IntegrationStatusValue;
  detail: string;
  checkedAt: string;
};

function result(name: string, status: IntegrationStatusValue, detail: string): IntegrationStatus {
  return { name, status, detail, checkedAt: new Date().toISOString() };
}

async function checkGemini(): Promise<IntegrationStatus> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return result("Gemini", "NOT_CONFIGURED", "GEMINI_API_KEY is missing.");

  const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: "Reply with exactly one word: OK" }] }],
      config: { maxOutputTokens: 5, httpOptions: { timeout: 15_000 } },
    });
    if (res.text?.trim()) {
      return result("Gemini", "LIVE", `Model "${model}" responded to a real request.`);
    }
    return result("Gemini", "ERROR", "Request succeeded but returned no text.");
  } catch (err) {
    return result("Gemini", "ERROR", err instanceof Error ? err.message : "Unknown error.");
  }
}

// Always either LIVE or ERROR — genuinely keyless, so "not configured"
// isn't a real state for this one.
async function checkOpenMeteoWeather(): Promise<IntegrationStatus> {
  try {
    const weather = await getWeather({ lat: 51.5072, lng: -0.1276 }); // London — fixed, always-valid point
    return result("Open-Meteo Weather", "LIVE", `Real forecast returned: ${Math.round(weather.temperatureC)}°C in London just now.`);
  } catch (err) {
    return result("Open-Meteo Weather", "ERROR", err instanceof Error ? err.message : "Unknown error.");
  }
}

async function checkGeoapify(): Promise<IntegrationStatus> {
  if (!isGeoapifyConfigured()) return result("Geoapify", "NOT_CONFIGURED", "GEOAPIFY_API_KEY is missing.");
  try {
    const resolved = await resolveLocationText("Vienna, Austria");
    if (resolved) {
      return result("Geoapify", "LIVE", `Resolved "Vienna, Austria" → ${resolved.displayName}.`);
    }
    return result("Geoapify", "ERROR", "Request succeeded but returned no results for a known query.");
  } catch (err) {
    return result("Geoapify", "ERROR", err instanceof Error ? err.message : "Unknown error.");
  }
}

function testRecipientSuffix(): string {
  // WAITLIST_EMAIL_TEST_RECIPIENT is a plain redirect-target email
  // address, not a credential — safe to show the actual value (unlike
  // RESEND_API_KEY, which this function never prints).
  const testRecipient = process.env.WAITLIST_EMAIL_TEST_RECIPIENT?.trim();
  return testRecipient
    ? ` WAITLIST_EMAIL_TEST_RECIPIENT is configured (${testRecipient}) — both waitlist emails currently redirect there instead of the visitor/admin address.`
    : " WAITLIST_EMAIL_TEST_RECIPIENT is not configured — waitlist emails go to their normal recipients.";
}

async function checkResend(): Promise<IntegrationStatus> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return result("Resend", "NOT_CONFIGURED", `RESEND_API_KEY is missing.${testRecipientSuffix()}`);
  try {
    // Read-only — lists domains, never sends an email just to check status.
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return result("Resend", "LIVE", `API key authenticated via GET /domains (no email sent).${testRecipientSuffix()}`);
    return result("Resend", "ERROR", `Resend returned ${res.status}.${testRecipientSuffix()}`);
  } catch (err) {
    return result("Resend", "ERROR", `${err instanceof Error ? err.message : "Unknown error."}${testRecipientSuffix()}`);
  }
}

async function checkUber(): Promise<IntegrationStatus> {
  const missing = getMissingUberEnvVars();
  if (missing.length > 0) return result("Uber", "NOT_CONFIGURED", `Missing: ${missing.join(", ")}.`);
  try {
    // Client-credentials token exchange — verifies the app's own
    // client_id/secret are valid without acting on behalf of any rider.
    const res = await fetch("https://auth.uber.com/oauth/v2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.UBER_CLIENT_ID!,
        client_secret: process.env.UBER_CLIENT_SECRET!,
      }),
    });
    if (res.ok) return result("Uber", "LIVE", "Client credentials verified via a real OAuth token exchange.");
    return result("Uber", "ERROR", `Uber returned ${res.status}: ${await res.text()}`);
  } catch (err) {
    return result("Uber", "ERROR", err instanceof Error ? err.message : "Unknown error.");
  }
}

async function checkGnani(): Promise<IntegrationStatus> {
  const missing = getMissingGnaniEnvVars();
  if (missing.length > 0) {
    return result(
      "Gnani",
      "DEMO_MODE",
      `Missing: ${missing.join(", ")} — voice escalations run in clearly-labelled DEMO MODE until these are set.`
    );
  }
  try {
    // Best-effort only: a GET-single-agent endpoint at this path follows
    // REST convention alongside Gnani's documented PUT /v1/agents/{botId},
    // but wasn't independently confirmed in public docs during research.
    // A failure here could mean invalid credentials OR that this specific
    // read endpoint differs from what's guessed — the detail says so.
    const res = await fetch(`https://api.inya.ai/platform/v1/agents/${process.env.GNANI_BOT_ID}`, {
      headers: { "x-api-key": process.env.GNANI_API_KEY! },
    });
    if (res.ok) return result("Gnani", "LIVE", "GNANI_BOT_ID resolved to a real agent.");
    return result(
      "Gnani",
      "ERROR",
      `Gnani returned ${res.status}. This read endpoint isn't independently confirmed in their public docs — this could mean invalid credentials or a differing API shape, not necessarily that the key is wrong.`
    );
  } catch (err) {
    return result("Gnani", "ERROR", err instanceof Error ? err.message : "Unknown error.");
  }
}

async function checkBlob(): Promise<IntegrationStatus> {
  if (!isBlobConfigured()) return result("Blob Storage", "NOT_CONFIGURED", "BLOB_READ_WRITE_TOKEN is missing.");
  try {
    // Read-only — lists at most 1 blob, never uploads/deletes anything.
    await listBlobs({ limit: 1 });
    return result("Blob Storage", "LIVE", "Token authenticated via a real read-only list request.");
  } catch (err) {
    return result("Blob Storage", "ERROR", err instanceof Error ? err.message : "Unknown error.");
  }
}

export async function checkAllIntegrations(): Promise<IntegrationStatus[]> {
  return Promise.all([
    checkGemini(),
    checkOpenMeteoWeather(),
    checkGeoapify(),
    checkResend(),
    checkUber(),
    checkGnani(),
    checkBlob(),
  ]);
}

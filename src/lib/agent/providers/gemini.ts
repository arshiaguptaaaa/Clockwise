import { GoogleGenAI, ApiError, type Content, type Part } from "@google/genai";
import type {
  AgentModelProvider,
  AgentMessage,
  AgentToolSchema,
  AgentGenerateResult,
  AgentErrorCategory,
} from "../provider";

// "gemini-2.5-flash" (what training data would suggest) returns 404 as of
// this build — deprecated for new API keys. "-latest" aliases stay current
// as Google rotates the underlying model. "gemini-flash-latest" currently
// resolves to "gemini-3.8-flash", whose free tier is a hard 20
// requests/DAY cap (confirmed by hitting RESOURCE_EXHAUSTED during
// development) — far too tight for interactive use. The lite variant is a
// distinct model with its own separate free-tier quota bucket. Overridable
// so a paid-tier key or a different model doesn't need a code change.
const DEFAULT_MODEL = "gemini-flash-lite-latest";

type GeminiToolCallMeta = { thoughtSignature?: string };

function toGeminiContents(messages: AgentMessage[]): Content[] {
  return messages.map((m): Content => {
    if (m.role === "user") {
      return { role: "user", parts: [{ text: m.content }] };
    }
    if (m.role === "assistant") {
      const parts: Part[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const call of m.toolCalls ?? []) {
        const meta = call.providerMeta as GeminiToolCallMeta | undefined;
        // Newer Gemini models require the model's own thought_signature to
        // be echoed back alongside a function call on the next turn, or
        // the API rejects the request with INVALID_ARGUMENT. It's a
        // sibling of functionCall on the Part, not nested inside it.
        parts.push({
          functionCall: { id: call.id, name: call.name, args: call.input },
          ...(meta?.thoughtSignature ? { thoughtSignature: meta.thoughtSignature } : {}),
        });
      }
      return { role: "model", parts };
    }
    // Gemini has no distinct "function" role — tool results go back as a
    // "user" content carrying a functionResponse part (per this SDK's own
    // Content.role doc: "Must be either 'user' or 'model'").
    return {
      role: "user",
      parts: [
        {
          functionResponse: {
            id: m.toolCallId,
            name: m.name,
            response: { output: m.output },
          },
        },
      ],
    };
  });
}

function toGeminiTools(tools: AgentToolSchema[]) {
  if (tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        // Gemini accepts a plain JSON Schema object here directly — no
        // need to translate into its uppercase Type-enum Schema format.
        parametersJsonSchema: t.parameters,
      })),
    },
  ];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Gemini's error body is `{"error":{"code","message","status","details":[...]}}`
// where `.error.message` is what the SDK surfaces as `ApiError.message`
// (confirmed against real 503/429 responses during development). Parsing
// it out gives us the semantic status string and, for 429s, the server's
// own suggested RetryInfo.retryDelay — never anything from the request
// itself, so there is nothing here that could ever contain the API key.
function parseGeminiErrorBody(message: string): { status?: string; retryDelayMs?: number } {
  try {
    const parsed = JSON.parse(message) as {
      error?: {
        status?: string;
        details?: Array<{ "@type"?: string; retryDelay?: string }>;
      };
    };
    const retryInfo = parsed.error?.details?.find((d) => d["@type"]?.includes("RetryInfo"));
    const retryDelayMs = retryInfo?.retryDelay
      ? Math.ceil(parseFloat(retryInfo.retryDelay.replace(/s$/, "")) * 1000)
      : undefined;
    return { status: parsed.error?.status, retryDelayMs };
  } catch {
    return {};
  }
}

type Classification = {
  category: AgentErrorCategory;
  retryable: boolean;
  retryDelayMs: number | null;
  httpStatus: number | null;
};

function classifyError(err: unknown): Classification {
  if (!(err instanceof ApiError)) {
    return { category: "UNKNOWN", retryable: false, retryDelayMs: null, httpStatus: null };
  }

  const { status: googleStatus, retryDelayMs } = parseGeminiErrorBody(err.message);
  const httpStatus = err.status;

  let category: AgentErrorCategory;
  let retryable: boolean;
  switch (httpStatus) {
    case 429:
      category = googleStatus === "RESOURCE_EXHAUSTED" ? "QUOTA_EXHAUSTED" : "RATE_LIMIT";
      retryable = true; // per spec: retry 429 and 503 only
      break;
    case 503:
      category = "OVERLOADED";
      retryable = true;
      break;
    case 404:
      category = "INVALID_MODEL";
      retryable = false;
      break;
    case 401:
    case 403:
      category = "AUTH_ERROR";
      retryable = false;
      break;
    case 400:
      category = "MALFORMED_REQUEST";
      retryable = false;
      break;
    default:
      category = "UNKNOWN";
      retryable = false;
  }

  return { category, retryable, retryDelayMs: retryDelayMs ?? null, httpStatus };
}

const MAX_ATTEMPTS = 3; // total tries, i.e. up to 2 retries after the first failure
const BASE_DELAY_MS = 500;

function backoffDelayMs(attempt: number, serverSuggestedMs: number | null): number {
  if (serverSuggestedMs !== null) return serverSuggestedMs;
  const exp = BASE_DELAY_MS * 2 ** attempt; // 500, 1000, 2000
  const jitter = Math.random() * exp * 0.3;
  return Math.round(exp + jitter);
}

function fallbackTextFor(category: AgentErrorCategory): string {
  switch (category) {
    case "QUOTA_EXHAUSTED":
      return "I've hit today's free-tier usage limit with the model provider, so I can't reason about that right now.";
    case "RATE_LIMIT":
      return "The model provider is rate-limiting requests right now. Give it a moment and try again.";
    case "OVERLOADED":
      return "I couldn't reach my reasoning right now — the model provider is temporarily overloaded. Try again in a moment.";
    case "AUTH_ERROR":
      return "I can't authenticate with the model provider right now — the API key may be invalid or missing permissions.";
    case "INVALID_MODEL":
      return "The configured model isn't available right now — it may need to be updated.";
    case "MALFORMED_REQUEST":
      return "Something about that request wasn't valid — this looks like a bug rather than a provider outage.";
    case "MISSING_KEY":
      return "I'd help with that, but I don't have a Gemini API key configured yet — set GEMINI_API_KEY to enable live answers.";
    default:
      return "I couldn't reach my reasoning right now — the model provider is temporarily unavailable. Try again in a moment.";
  }
}

export class GeminiAgentProvider implements AgentModelProvider {
  async generate({
    system,
    tools,
    messages,
  }: {
    system: string;
    tools: AgentToolSchema[];
    messages: AgentMessage[];
  }): Promise<AgentGenerateResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        text: fallbackTextFor("MISSING_KEY"),
        toolCalls: [],
        error: { category: "MISSING_KEY", status: null },
      };
    }

    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const ai = new GoogleGenAI({ apiKey });

    let response;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        response = await ai.models.generateContent({
          model,
          contents: toGeminiContents(messages),
          config: {
            systemInstruction: system,
            tools: toGeminiTools(tools),
            maxOutputTokens: 600,
          },
        });
        break;
      } catch (err) {
        const classification = classifyError(err);

        // Safe, structured diagnostics: HTTP status + semantic category
        // only. Never logs the API key, the request body, or `ai`/`err`
        // objects wholesale (those could carry the key in some SDK
        // versions' error metadata) — just the two primitives needed to
        // actually diagnose what happened.
        console.error(
          `[GeminiAgentProvider] attempt ${attempt + 1}/${MAX_ATTEMPTS} failed — status=${classification.httpStatus} category=${classification.category} retryable=${classification.retryable}`
        );

        const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
        if (classification.retryable && !isLastAttempt) {
          await sleep(backoffDelayMs(attempt, classification.retryDelayMs));
          continue;
        }

        // Either a permanent error (auth/malformed/invalid model — retrying
        // won't help) or a retryable one that's exhausted its attempts.
        // Either way this must degrade like a missing key, never crash the
        // message send — but it's tagged with `error` so the UI can offer
        // a genuine Retry action instead of a dead-end fallback message.
        return {
          text: fallbackTextFor(classification.category),
          toolCalls: [],
          error: { category: classification.category, status: classification.httpStatus },
        };
      }
    }

    // Walk the raw parts (not the response.functionCalls convenience
    // getter) so we can capture each call's thoughtSignature alongside it.
    const rawParts = response?.candidates?.[0]?.content?.parts ?? [];
    const toolCalls = rawParts
      .filter((p): p is Part & { functionCall: NonNullable<Part["functionCall"]> } => !!p.functionCall)
      .map((p, i) => ({
        id: p.functionCall.id ?? `call_${i}`,
        name: p.functionCall.name ?? "",
        input: p.functionCall.args ?? {},
        providerMeta: { thoughtSignature: p.thoughtSignature } satisfies GeminiToolCallMeta,
      }));

    return {
      text: response?.text ?? null,
      toolCalls,
    };
  }
}

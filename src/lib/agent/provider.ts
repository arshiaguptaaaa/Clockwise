// Provider-agnostic types for the Clockwise agent. clockwise-agent.ts and
// tools.ts only ever speak this shape — no Gemini (or Anthropic, or
// whatever comes next) types leak outside of src/lib/agent/providers/*.
// Swapping models means writing a new file in providers/ and changing one
// import in clockwise-agent.ts; nothing else moves.

export type AgentToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  // Opaque per-provider round-trip data (e.g. Gemini's thought signatures,
  // required when echoing a function call back on the next turn). The
  // orchestration loop in clockwise-agent.ts never reads this — it just
  // carries it along; only the provider that produced it interprets it.
  providerMeta?: unknown;
};

export type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: AgentToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; output: string };

export type AgentToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema (type/properties/required/...)
};

// Provider-agnostic failure categories, derived from whatever HTTP status
// the underlying API actually returned — never guessed. RATE_LIMIT/
// OVERLOADED are the only ones the orchestration loop treats as retryable
// upstream of the provider (the provider itself already retried internally
// before giving up and reaching this state).
export type AgentErrorCategory =
  | "RATE_LIMIT"
  | "QUOTA_EXHAUSTED"
  | "OVERLOADED"
  | "INVALID_MODEL"
  | "AUTH_ERROR"
  | "MALFORMED_REQUEST"
  | "MISSING_KEY"
  | "TIMEOUT"
  | "UNKNOWN";

export type AgentGenerateResult = {
  text: string | null;
  toolCalls: AgentToolCall[];
  // Present only when the provider call failed after exhausting its own
  // retries (or wasn't retryable at all). `text` is still populated with a
  // human-friendly fallback so a normal reply can always be persisted —
  // this field is what lets the UI distinguish "genuine answer" from
  // "exhausted-retry failure" and offer a Retry action.
  error?: { category: AgentErrorCategory; status: number | null };
};

export interface AgentModelProvider {
  generate(params: {
    system: string;
    tools: AgentToolSchema[];
    messages: AgentMessage[];
  }): Promise<AgentGenerateResult>;
}

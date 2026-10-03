import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { GeminiAgentProvider } from "@/lib/agent/providers/gemini";
import { AGENT_TOOLS } from "@/lib/agent/tools";
import type { AgentMessage } from "@/lib/agent/provider";

// Signed-in only. Sends tiny SYNTHETIC conversations to Gemini to find out which
// request structures it rejects (400). No user data is involved. Reports status,
// category and Google's own error text per case — never keys or contents.
const U = (content: string): AgentMessage => ({ role: "user", content });
const A = (content: string | null): AgentMessage => ({ role: "assistant", content });

const CASES: Record<string, { messages: AgentMessage[]; withTools: boolean }> = {
  control_alternating: { messages: [U("Arshia: hi"), A("Hello"), U("Arshia: what is 2+2?")], withTools: false },
  ends_on_model: { messages: [U("Arshia: hi"), A("Hello")], withTools: false },
  starts_on_model: { messages: [A("Hello"), U("Arshia: hi")], withTools: false },
  empty_assistant_text: { messages: [U("Arshia: hi"), A(""), U("Arshia: what is 2+2?")], withTools: false },
  empty_user_text: { messages: [U("Arshia: hi"), A("Hello"), U("")], withTools: false },
  consecutive_user: { messages: [U("Arshia: hi"), U("Arshia: what is 2+2?")], withTools: false },
  consecutive_model: { messages: [U("Arshia: hi"), A("Hello"), A("Again"), U("Arshia: what is 2+2?")], withTools: false },
  control_with_real_tools: { messages: [U("Arshia: hi"), A("Hello"), U("Arshia: what is 2+2?")], withTools: true },
};

export async function GET(request: NextRequest) {
  if (!(await getCurrentUserId())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const only = request.nextUrl.searchParams.get("case");
  const provider = new GeminiAgentProvider();
  const out: Record<string, unknown> = {};
  for (const [name, c] of Object.entries(CASES)) {
    if (only && only !== name) continue;
    const r = await provider.generate({ system: "You are a test assistant. Answer in one short sentence.", tools: c.withTools ? AGENT_TOOLS : [], messages: c.messages });
    const d = r.error?.diagnostics as Record<string, unknown> | undefined;
    out[name] = r.error ? { ok: false, status: r.error.status, category: r.error.category, google: d?.googleMessage ?? null, shape: { roles: d?.roles, parts: d?.parts } } : { ok: true };
  }
  return NextResponse.json(out);
}

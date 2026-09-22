import { prisma } from "@/lib/prisma";
import { buildGroupContext, buildPrivateContext, type AgentContext } from "./context";
import { AGENT_TOOLS, executeTool } from "./tools";
import { GeminiAgentProvider } from "./providers/gemini";
import type { AgentModelProvider, AgentMessage, AgentToolSchema } from "./provider";

const MAX_TOOL_ROUNDS = 4;

// The one place that knows which model backs Clockwise today. Swapping
// providers later means writing a new class in providers/ and changing
// this single line — clockwise-agent.ts and tools.ts never touch a
// provider SDK directly.
function getAgentProvider(): AgentModelProvider {
  return new GeminiAgentProvider();
}

export type AgentTurnResult = {
  spoke: boolean;
  replyText?: string;
  failed?: boolean;
  toolCalls: { name: string; input: unknown }[];
};

function toolsForMode(mode: AgentContext["mode"]): AgentToolSchema[] {
  return AGENT_TOOLS.filter((t) => {
    if (t.name === "stay_silent") return mode === "GROUP"; // private room: every message deserves a reply
    if (t.name === "update_participation_window") return mode === "PRIVATE";
    return true;
  });
}

function buildSystemPrompt(ctx: AgentContext): string {
  const shared = [
    `You are Clockwise, the coordination, execution and recovery agent for a group trip called "${ctx.trip.name}".`,
    "Core rules:",
    "- Ask the smallest necessary question. Do as much reasoning as possible before asking a human anything.",
    "- A preference is not a hard constraint. Silence does not mean consent.",
    "- Never fabricate travellers, dates, bookings, or facts that aren't in the structured state or conversation below.",
    "- Consequential actions (transport, payment) are only ever PREPARED via tools, producing a pending card a human must confirm — never claim something is booked or charged unless a tool result says so.",
    "- For anything time/status related (readiness, ETA), always call the relevant tool rather than judging it yourself — you narrate the deterministic result, you don't invent it.",
    "- You have two kinds of knowledge. TRIP KNOWLEDGE (travellers, dates, bookings, commitments, decisions — already in the structured state below) you can answer directly. LIVE WORLD KNOWLEDGE (hotels, places, addresses, distances, travel time, weather) you do NOT know yourself — you MUST call search_places/search_hotels/search_nearby/get_route/get_weather and answer only from what the tool actually returned. Never guess a hotel name, address, distance, or fare — if a live tool isn't configured or fails, say so honestly and still answer whatever part of the question trip state alone can cover.",
    "- Reply in 1-3 short, conversational sentences. No headings, no bullet lists, no markdown formatting — the tool result is already shown to the user as a card, so don't repeat it verbatim, just add the reasoning/recommendation on top of it.",
  ].join("\n");

  const modeBlock =
    ctx.mode === "GROUP"
      ? [
          "You are in Trip Room, the SHARED group conversation — all travellers see everything here.",
          "Never reveal any individual traveller's private data (budget figures, passport/visa specifics, personal reasons) even if you have it — speak only in consequences, e.g. \"this conflicts with one traveller's hard constraint\", never naming who or the value.",
          "Stay quiet on ordinary chatter between travellers — call stay_silent instead of replying unless: you're asked directly, clarification is needed, a decision was just reached worth a brief acknowledgement, an action is now relevant, or a risk/deadline materially affects the trip.",
          "'Asked directly' is broad: any message starting with @Clockwise or addressed to you by name is ALWAYS a direct ask and must get a real answer — this includes plain trip-data questions ('who's on this trip', 'how many travellers', 'what are our dates') just as much as travel/logistics questions ('where is our hotel', 'how far is dinner'). Only fall back to stay_silent for messages that are clearly travellers talking to EACH OTHER, not to you — e.g. 'lol', 'yes', an emoji, or banter with no @Clockwise/name address.",
        ].join("\n")
      : [
          `You are in ${ctx.actingUserName}'s private "My Clockwise" room. Only ${ctx.actingUserName} and you see this conversation.`,
          `You may discuss ${ctx.actingUserName}'s own data freely. You must still never reveal another traveller's private data here.`,
          `${ctx.actingUserName}'s private profile:\n${ctx.privateProfileSummary ?? "(nothing on file yet)"}`,
        ].join("\n");

  return [shared, modeBlock, `Structured trip state:\n${ctx.stateSummary}`].join("\n\n");
}

function toAgentMessages(history: AgentContext["history"]): AgentMessage[] {
  const merged: { role: "user" | "assistant"; lines: string[] }[] = [];
  for (const turn of history) {
    const role: "user" | "assistant" = turn.isClockwise ? "assistant" : "user";
    const text = turn.isClockwise ? turn.content : `${turn.senderName}: ${turn.content}`;
    const last = merged[merged.length - 1];
    if (last && last.role === role) {
      last.lines.push(text);
    } else {
      merged.push({ role, lines: [text] });
    }
  }
  if (merged.length > 0 && merged[0].role !== "user") {
    merged.unshift({ role: "user", lines: ["(conversation continues)"] });
  }
  return merged.map((m) => ({ role: m.role, content: m.lines.join("\n") }));
}

async function runAgentTurn(ctx: AgentContext): Promise<AgentTurnResult> {
  const provider = getAgentProvider();
  const system = buildSystemPrompt(ctx);
  const tools = toolsForMode(ctx.mode);
  let messages = toAgentMessages(ctx.history);
  const executedTools: { name: string; input: unknown }[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await provider.generate({ system, tools, messages });

    if (result.error) {
      // Provider call failed after exhausting its own retries (or wasn't
      // retryable at all). This can only happen before any tool in this
      // turn has executed — tool calls are only dispatched below, after a
      // *successful* generate() — so surfacing this immediately and
      // tagging it `failed` is always safe to retry from scratch later.
      return {
        spoke: true,
        replyText: result.text ?? "Something went wrong.",
        failed: true,
        toolCalls: executedTools,
      };
    }

    if (result.toolCalls.length === 0) {
      const text = result.text?.trim();
      if (text) {
        return { spoke: true, replyText: text, toolCalls: executedTools };
      }
      // A genuinely empty response (no text, no tool call) means the model
      // didn't comply with the stay_silent contract in form, but the
      // intent is the same. In GROUP mode this defaults to silence — the
      // whole point is Clockwise stays quiet unless it has something real
      // to say. In PRIVATE mode a non-reply would feel broken (the user is
      // talking directly to it), so it still gets a minimal acknowledgement.
      return ctx.mode === "GROUP"
        ? { spoke: false, toolCalls: executedTools }
        : { spoke: true, replyText: "Got it — let me know if there's more.", toolCalls: executedTools };
    }

    if (result.toolCalls.some((c) => c.name === "stay_silent")) {
      return { spoke: false, toolCalls: executedTools };
    }

    messages = [
      ...messages,
      { role: "assistant", content: result.text, toolCalls: result.toolCalls },
    ];

    for (const call of result.toolCalls) {
      executedTools.push({ name: call.name, input: call.input });
      const toolResult = await executeTool(call.name, call.input, ctx);
      messages = [
        ...messages,
        { role: "tool", toolCallId: call.id, name: call.name, output: toolResult.output },
      ];
    }
    // loop again so the model can narrate the tool result(s) in natural language
  }

  return { spoke: true, replyText: "I've noted that.", toolCalls: executedTools };
}

export async function respondToGroupMessage(
  tripId: string,
  actingUserId: string
): Promise<AgentTurnResult> {
  const ctx = await buildGroupContext(tripId, actingUserId);
  const result = await runAgentTurn(ctx);

  if (result.spoke && result.replyText) {
    await prisma.message.create({
      data: {
        tripId,
        senderId: ctx.clockwiseUserId,
        channel: "GROUP",
        content: result.replyText,
        toolCalls: result.toolCalls.length > 0 ? JSON.stringify(result.toolCalls) : null,
        failed: result.failed ?? false,
      },
    });
  }

  return result;
}

export async function respondToPrivateMessage(
  tripId: string,
  actingUserId: string
): Promise<AgentTurnResult> {
  const ctx = await buildPrivateContext(tripId, actingUserId);
  const result = await runAgentTurn(ctx);

  if (result.spoke && result.replyText) {
    await prisma.message.create({
      data: {
        tripId,
        senderId: ctx.clockwiseUserId,
        channel: "PRIVATE",
        recipientId: actingUserId,
        content: result.replyText,
        toolCalls: result.toolCalls.length > 0 ? JSON.stringify(result.toolCalls) : null,
        failed: result.failed ?? false,
      },
    });
  }

  return result;
}

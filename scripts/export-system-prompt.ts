// Writes the exact system prompt Clockwise sends to the model (group + private
// variants, with placeholder trip state) to docs/system-prompt-export.txt — for the
// Ken Round 3 submission. Run: npx tsx scripts/export-system-prompt.ts
import { writeFileSync } from "node:fs";
import { buildSystemPrompt } from "../src/lib/agent/clockwise-agent";
import { toolsForMode } from "../src/lib/agent/clockwise-agent";

const base = {
  trip: { id: "TRIP_ID", name: "Udaipur" },
  clockwiseUserId: "CLOCKWISE_USER",
  actingUserId: "USER_ID",
  actingUserName: "Eva",
  stateSummary: "[Live trip state is injected here at run time: route, dates, travellers, confirmed decisions, confirmed stay.]",
  history: [],
  privateProfileSummary: "[Private per-traveller state is injected here in the private room only.]",
};
const out: string[] = [];
for (const mode of ["GROUP", "PRIVATE"] as const) {
  out.push(`===== SYSTEM PROMPT (${mode} room) =====\n`);
  out.push(buildSystemPrompt({ ...base, mode } as never));
  out.push(`\n----- TOOLS AVAILABLE IN ${mode} ROOM -----`);
  for (const t of toolsForMode(mode)) out.push(`- ${t.name}: ${t.description}`);
  out.push("\n");
}
out.push(`MODEL: ${process.env.GEMINI_MODEL || "gemini-flash-lite-latest"} (alias; see docs for how to capture the resolved version)`);
writeFileSync("docs/system-prompt-export.txt", out.join("\n"));
console.log("wrote docs/system-prompt-export.txt", out.join("\n").length, "chars");

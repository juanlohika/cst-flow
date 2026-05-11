/**
 * Generate the actual check-in message for a client using the existing Gemini
 * adapter (reuses getModelForApp("arima") so it picks up admin's provider choice).
 *
 * We deliberately DON'T go through runArima() because:
 *  - This isn't part of a back-and-forth conversation
 *  - We don't want the [REQUEST] capture path triggering
 *  - We need full control over the prompt for tone/length
 */
import { getModelForApp, generateWithRetry } from "@/lib/ai";
import { db } from "@/db";
import {
  clientProfiles as clientProfilesTable,
  arimaRequests,
  arimaCheckIns,
  arimaConversations,
  arimaMessages,
} from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

export interface CheckInGenInput {
  clientProfileId: string;
  contactName: string;          // e.g. "Lester"
  isFirstCheckIn: boolean;      // for cold opener vs continuation tone
  consecutiveNoResponse: number; // for tone calibration
}

export interface CheckInGenResult {
  text: string;
  contextSummary: string;       // what facts ARIMA used (for debugging)
}

const SYSTEM_PROMPT = `You are ARIMA — an AI Relationship Manager. You're writing a SHORT proactive check-in message to a client contact on behalf of the CST team at MobileOptima/Tarkie.

CRITICAL RULES:
1. Keep it under 3 short sentences. Friendly but professional. NOT salesy.
2. Address the contact by their first name.
3. Reference SPECIFIC context (last interaction, pending request, time elapsed) if available — don't write generic "just checking in!" fluff.
4. End with ONE concrete, easy-to-answer question. Never ask "is there anything else?" or vague open-ended things.
5. NO markdown formatting (this will be sent as a plain message). No bold, no headers, no bullet lists.
6. Do not introduce yourself as AI in subsequent check-ins — only on the first ever message to that contact.
7. If we've been silent for a while, acknowledge it briefly without being apologetic.
8. Do NOT include a sign-off like "Best, ARIMA" — channel UI handles attribution.

Output ONLY the message body. No quotes around it, no preamble.`;

function buildContextPrompt(args: {
  contactName: string;
  companyName: string;
  industry: string;
  modulesAvailed: string[];
  daysSinceLastSent: number | null;
  isFirstCheckIn: boolean;
  consecutiveNoResponse: number;
  pendingRequestTitles: string[];
  lastUserMessageSnippet: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`Client contact: ${args.contactName}`);
  lines.push(`Company: ${args.companyName} (${args.industry})`);
  if (args.modulesAvailed.length > 0) {
    lines.push(`Modules contracted: ${args.modulesAvailed.join(", ")}`);
  }
  if (args.isFirstCheckIn) {
    lines.push(`This is the FIRST proactive check-in. Open warmly and identify yourself once.`);
  } else if (args.daysSinceLastSent !== null) {
    lines.push(`Days since the last check-in we sent: ${args.daysSinceLastSent}`);
  }
  if (args.consecutiveNoResponse > 0) {
    lines.push(`They've missed ${args.consecutiveNoResponse} of our previous check-in(s). Be lighter and easier to respond to.`);
  }
  if (args.pendingRequestTitles.length > 0) {
    lines.push(`Pending requests on file:\n- ${args.pendingRequestTitles.slice(0, 3).join("\n- ")}`);
    lines.push(`You MAY reference one of these naturally if relevant.`);
  }
  if (args.lastUserMessageSnippet) {
    lines.push(`Last thing this contact said in any conversation: "${args.lastUserMessageSnippet.slice(0, 200)}"`);
  }
  return lines.join("\n");
}

export async function generateCheckInMessage(input: CheckInGenInput): Promise<CheckInGenResult> {
  // 1) Gather context for personalization
  const clientRows = await db
    .select({
      companyName: clientProfilesTable.companyName,
      industry: clientProfilesTable.industry,
      modulesAvailed: clientProfilesTable.modulesAvailed,
    })
    .from(clientProfilesTable)
    .where(eq(clientProfilesTable.id, input.clientProfileId))
    .limit(1);
  const client = clientRows[0];
  if (!client) {
    throw new Error("Client not found");
  }

  let modules: string[] = [];
  try { modules = JSON.parse(client.modulesAvailed || "[]"); } catch {}

  // Last check-in send timestamp
  const lastSentRows = await db
    .select({ sentAt: arimaCheckIns.sentAt })
    .from(arimaCheckIns)
    .where(and(
      eq(arimaCheckIns.clientProfileId, input.clientProfileId),
      eq(arimaCheckIns.status, "sent")
    ))
    .orderBy(desc(arimaCheckIns.sentAt))
    .limit(1);
  const lastSent = lastSentRows[0]?.sentAt;
  const daysSinceLastSent = lastSent
    ? Math.floor((Date.now() - new Date(lastSent).getTime()) / 86400_000)
    : null;

  // Pending requests
  const pendingRows = await db
    .select({ title: arimaRequests.title })
    .from(arimaRequests)
    .where(and(
      eq(arimaRequests.clientProfileId, input.clientProfileId),
      eq(arimaRequests.status, "new")
    ))
    .orderBy(desc(arimaRequests.createdAt))
    .limit(3);
  const pendingRequestTitles = pendingRows.map(r => r.title);

  // Most recent user message on any conversation for this client
  const convRows = await db
    .select({ id: arimaConversations.id })
    .from(arimaConversations)
    .where(eq(arimaConversations.clientProfileId, input.clientProfileId))
    .orderBy(desc(arimaConversations.lastMessageAt))
    .limit(1);
  let lastUserMessageSnippet: string | null = null;
  if (convRows[0]) {
    const msgRows = await db
      .select({ content: arimaMessages.content })
      .from(arimaMessages)
      .where(and(
        eq(arimaMessages.conversationId, convRows[0].id),
        eq(arimaMessages.role, "user")
      ))
      .orderBy(desc(arimaMessages.createdAt))
      .limit(1);
    if (msgRows[0]) {
      lastUserMessageSnippet = msgRows[0].content;
    }
  }

  const contextPrompt = buildContextPrompt({
    contactName: input.contactName,
    companyName: client.companyName,
    industry: client.industry,
    modulesAvailed: modules,
    daysSinceLastSent,
    isFirstCheckIn: input.isFirstCheckIn,
    consecutiveNoResponse: input.consecutiveNoResponse,
    pendingRequestTitles,
    lastUserMessageSnippet,
  });

  // 2) Call the model — NOT via runArima (we don't want capture/persistence here)
  const model = await getModelForApp("arima");
  const userPrompt = `Write the check-in message now. Context:\n\n${contextPrompt}`;

  const result = await generateWithRetry(model, {
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    systemInstruction: { role: "system", parts: [{ text: SYSTEM_PROMPT }] },
  });

  // Extract text safely (no function-calling in this path)
  let text = "";
  try {
    text = (result?.response?.text?.() || "").trim();
  } catch {
    try {
      const parts = result?.response?.candidates?.[0]?.content?.parts || [];
      text = parts.map((p: any) => p?.text || "").join("").trim();
    } catch {}
  }

  if (!text) {
    // Fallback message so a failure doesn't block the runner
    text = `Hi ${input.contactName}, quick check-in from ARIMA for ${client.companyName}. How are things going? Anything I can help with this week?`;
  }

  return {
    text,
    contextSummary: contextPrompt,
  };
}

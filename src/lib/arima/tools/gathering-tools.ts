/**
 * Tools that let Arima manage a gathering session deliberately.
 *
 * The webhook already files screenshots automatically while a session is live —
 * that is the common case and needs no decision. These tools cover the cases
 * where Arima should act on purpose rather than reflexively:
 *
 *   - naming the requirement once it understands it (the folder was created
 *     from the first message, which is usually a rough title)
 *   - checking what it has already collected before asking for more
 *   - capturing the requirement as a tracked ArimaRequest
 *
 * All three are read-or-light-write and safe to run automatically. Nothing here
 * deletes or overwrites evidence.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { registerTool, type ToolContext } from "./registry";
import { getActiveSession, updateSession } from "../session";
import { listSessionEvidence } from "../evidence-filing";
import { arimaRequests } from "@/db/schema";

// ─── rename_gathering ──────────────────────────────────────────────────
registerTool({
  name: "rename_gathering",
  category: "write",
  description:
    "Renames the requirement you are currently gathering. The evidence folder was named from the first message, which is usually rough ('document the issue with the form'). Once you understand what the requirement actually is, give it a short descriptive name (5-8 words) so the folder is findable later — e.g. 'Share of Display photo cap' or 'MTD rate auto-computation'. Call this ONCE, when the subject is clear. Does not move or rename the Drive folder that already exists; it updates the title used in the handoff.",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short descriptive name for the requirement. No verbs like 'document' or 'fix' — name the SUBJECT.",
      },
    },
    required: ["title"],
  },
  defaultEnabled: true,
  defaultAutonomy: "auto",
  handler: async (input: any, ctx: ToolContext) => {
    const session = await getActiveSession(ctx.conversationId);
    if (!session) {
      return { ok: false as const, error: "There's no gathering session running in this conversation." };
    }
    const title = String(input?.title || "").trim();
    if (title.length < 3) {
      return { ok: false as const, error: "That title is too short to be useful." };
    }
    await updateSession(session.id, { requestTitle: title.slice(0, 90) });
    return { ok: true as const, data: { title: title.slice(0, 90) } };
  },
});

// ─── list_gathered_evidence ────────────────────────────────────────────
registerTool({
  name: "list_gathered_evidence",
  category: "read",
  description:
    "Lists the files collected so far in the current gathering session, with your own note about what each one showed. Use this before asking for more screenshots, so you don't ask for something already shared, and before summarising, so your summary reflects what was actually captured.",
  inputSchema: { type: "object", properties: {}, required: [] },
  defaultEnabled: true,
  defaultAutonomy: "auto",
  handler: async (_input: any, ctx: ToolContext) => {
    const session = await getActiveSession(ctx.conversationId);
    if (!session) {
      return { ok: false as const, error: "There's no gathering session running in this conversation." };
    }
    const evidence = await listSessionEvidence(session.id);
    return {
      ok: true as const,
      data: {
        title: session.requestTitle,
        folder: session.driveDisplayPath,
        count: evidence.length,
        files: evidence.map((e) => ({
          name: e.fileName,
          kind: e.kind,
          sharedBy: e.uploadedByName,
          whatItShowed: e.visionSummary,
        })),
      },
    };
  },
});

// ─── capture_gathered_requirement ──────────────────────────────────────
registerTool({
  name: "capture_gathered_requirement",
  category: "write",
  description:
    "Records the requirement you have gathered as a tracked request, linked to the evidence folder. Call this when the requester has CONFIRMED your summary is complete — not before. Give the current behaviour and the requested behaviour separately; developers need both, and 'what happens today' is the part people forget to state.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short descriptive title for the requirement." },
      current_behaviour: {
        type: "string",
        description: "What happens today. Describe it as the requester described it — do not quote exact values read off a screenshot.",
      },
      requested_behaviour: { type: "string", description: "What they want instead." },
      category: {
        type: "string",
        enum: ["feature", "bug", "question", "config", "other"],
        description: "bug = something is broken; feature = something new; config = a setting change.",
      },
      priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
      open_questions: {
        type: "array",
        items: { type: "string" },
        description: "Anything you could not resolve in the conversation.",
      },
    },
    required: ["title", "requested_behaviour"],
  },
  defaultEnabled: true,
  defaultAutonomy: "auto",
  handler: async (input: any, ctx: ToolContext) => {
    const session = await getActiveSession(ctx.conversationId);
    if (!session) {
      return { ok: false as const, error: "There's no gathering session running in this conversation." };
    }

    const title = String(input?.title || session.requestTitle || "Untitled requirement").slice(0, 200);
    const parts: string[] = [];
    if (input?.current_behaviour) parts.push(`**Current behaviour**\n${input.current_behaviour}`);
    if (input?.requested_behaviour) parts.push(`**Requested behaviour**\n${input.requested_behaviour}`);
    if (Array.isArray(input?.open_questions) && input.open_questions.length) {
      parts.push(`**Open questions**\n${input.open_questions.map((q: string) => `- ${q}`).join("\n")}`);
    }
    if (session.driveFolderUrl) {
      parts.push(`**Evidence**\n${session.driveDisplayPath || "folder"}\n${session.driveFolderUrl}`);
    }

    const id = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    await db.insert(arimaRequests).values({
      id,
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      clientProfileId: ctx.clientProfileId || null,
      title,
      description: parts.join("\n\n"),
      category: String(input?.category || "feature"),
      priority: String(input?.priority || "medium"),
      status: "new",
    } as any);

    await updateSession(session.id, { arimaRequestId: id, requestTitle: title });

    // Backfill the request id onto evidence already filed, so the files and the
    // request point at each other.
    try {
      await db.run(sql`
        UPDATE ArimaEvidenceFile SET arimaRequestId = ${id} WHERE sessionId = ${session.id}
      `);
    } catch { /* cosmetic link — not worth failing the capture */ }

    return {
      ok: true as const,
      data: { requestId: id, title, evidenceFolder: session.driveFolderUrl },
    };
  },
});

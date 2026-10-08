/**
 * Files an inbound attachment to Drive and records a link row.
 *
 * This is the seam that keeps bytes out of the database. The webhook downloads
 * a Telegram photo into memory; this module writes it to Drive, stores a link,
 * and hands back a lightweight reference. The base64 never reaches
 * `ArimaMessage.attachments`.
 *
 * VISION POLICY — DESCRIBE, DON'T TRANSCRIBE
 * ------------------------------------------
 * Arima summarises what a screenshot SHOWS ("Logic tab, a formula field, a red
 * validation error") so it can ask a sensible next question. It does not read
 * exact values into the record.
 *
 * The reason is specific to this product. The evidence that matters in a Tarkie
 * requirement is dense UI: a formula like `{count_of_the_mtd}/30`, a field
 * showing `0.5` where 50% was expected. A 27B open model will usually get those
 * right and occasionally get a digit wrong — and a wrong digit, stated as fact,
 * becomes a false premise that nobody catches downstream. So exact values are
 * marked in PROMPT.md as "read from the image", and a model with the budget to
 * be careful reads them later.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ensureRequirementFolder,
  uploadEvidenceFile,
  evidenceFileName,
  type EvidenceScope,
  type RequirementFolder,
} from "./evidence-drive";
import { incrementEvidence, type GatherSession } from "./session";

export interface IncomingAttachment {
  buffer: Buffer;
  mimeType: string;
  /** screenshot | recording | document */
  kind?: "screenshot" | "recording" | "document";
  width?: number | null;
  height?: number | null;
  /** Caption the sender typed, if any — a useful filename hint. */
  caption?: string | null;
}

export interface FiledEvidence {
  id: string;
  fileName: string;
  driveFileId: string;
  driveWebViewLink: string;
  kind: string;
  sizeBytes: number;
}

/**
 * Upload one attachment into a session's folder and record it.
 *
 * Returns null rather than throwing when Drive is not configured — a missing
 * folder must not break the conversation. The caller reports it in-chat.
 */
export async function fileEvidence(args: {
  session: GatherSession;
  folder: RequirementFolder;
  attachment: IncomingAttachment;
  conversationId: string;
  messageId?: string | null;
  uploadedByName?: string | null;
  visionSummary?: string | null;
}): Promise<FiledEvidence | null> {
  const { attachment: att, folder, session } = args;
  const kind = att.kind || (att.mimeType?.startsWith("video/") ? "recording" : "screenshot");
  const targetFolderId =
    kind === "recording" ? folder.recordingsFolderId : folder.screenshotsFolderId;

  const index = session.evidenceCount + 1;
  const fileName = evidenceFileName({
    index,
    mimeType: att.mimeType,
    note: att.caption || null,
  });

  let uploaded;
  try {
    uploaded = await uploadEvidenceFile({
      folderId: targetFolderId,
      buffer: att.buffer,
      filename: fileName,
      mimeType: att.mimeType,
    });
  } catch (e) {
    console.warn("[arima/evidence] Drive upload failed:", e);
    return null;
  }

  const id = `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  await db.run(sql`
    INSERT INTO ArimaEvidenceFile
      (id, sessionId, conversationId, messageId, arimaRequestId, kind, fileName,
       mimeType, sizeBytes, driveFileId, driveWebViewLink, visionSummary,
       uploadedByName, createdAt)
    VALUES
      (${id}, ${session.id}, ${args.conversationId}, ${args.messageId ?? null},
       ${session.arimaRequestId ?? null}, ${kind}, ${fileName}, ${att.mimeType},
       ${att.buffer.length}, ${uploaded.fileId}, ${uploaded.webViewLink},
       ${args.visionSummary ?? null}, ${args.uploadedByName ?? null}, datetime('now'))
  `);
  await incrementEvidence(session.id);

  return {
    id,
    fileName,
    driveFileId: uploaded.fileId,
    driveWebViewLink: uploaded.webViewLink,
    kind,
    sizeBytes: att.buffer.length,
  };
}

/** Every evidence file filed under a session, oldest first. */
export async function listSessionEvidence(sessionId: string): Promise<
  Array<{
    fileName: string;
    kind: string;
    driveWebViewLink: string;
    visionSummary: string | null;
    uploadedByName: string | null;
  }>
> {
  const res: any = await db.run(sql`
    SELECT fileName, kind, driveWebViewLink, visionSummary, uploadedByName
    FROM ArimaEvidenceFile WHERE sessionId = ${sessionId} ORDER BY createdAt ASC
  `);
  return (res?.rows || []).map((r: any) => ({
    fileName: r.fileName,
    kind: r.kind,
    driveWebViewLink: r.driveWebViewLink,
    visionSummary: r.visionSummary ?? null,
    uploadedByName: r.uploadedByName ?? null,
  }));
}

/**
 * Ask the vision model what a screenshot shows.
 *
 * Deliberately a DESCRIPTION, not a transcription — see the policy note at the
 * top of this file. The prompt is short on purpose: every image costs roughly
 * 1,600 tokens against an 8,000/minute ceiling, so the text around it should be
 * small. The call goes through the shared throttle in src/lib/ai.ts, which
 * paces a batch rather than letting the eleventh screenshot fail.
 */
export async function describeScreenshot(args: {
  buffer: Buffer;
  mimeType: string;
  context?: string | null;
}): Promise<string | null> {
  try {
    const { getModelForApp, generateWithRetry } = await import("@/lib/ai");
    // Same adapter Arima's runtime uses. When the configured model is text-only
    // the Groq adapter swaps to the vision model for this call by itself.
    const model = await getModelForApp("arima");

    const prompt =
      `You are looking at a screenshot shared in a client support chat about the ` +
      `Tarkie field-operations app.\n\n` +
      (args.context ? `Context from the conversation: ${args.context}\n\n` : "") +
      `Describe WHAT IS ON SCREEN in 2-3 sentences: which screen or module it ` +
      `appears to be, what the user seems to be doing, and anything that looks ` +
      `wrong (an error, an empty field, an unexpected value).\n\n` +
      `Do NOT transcribe exact numbers, formulas or field values — they will be ` +
      `read precisely later. If a specific value looks important, say so by ` +
      `describing it ("a formula field showing a division expression") rather ` +
      `than quoting it.`;

    const result = await generateWithRetry(model, {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType: args.mimeType, data: args.buffer.toString("base64") } },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: 220, temperature: 0.2 },
    });
    const text = result?.response?.text?.();
    return text ? String(text).trim() : null;
  } catch (e) {
    console.warn("[arima/evidence] vision describe failed (non-fatal):", e);
    return null;
  }
}

/**
 * Resolve the Drive scope from a binding. Internal and team rooms file under
 * _Internal; client rooms file under the client's own folder.
 */
export function scopeFromBinding(args: {
  scopeType?: string | null;
  accountName?: string | null;
  accountId?: string | null;
  internalLabel?: string | null;
}): EvidenceScope {
  const st = args.scopeType === "internal" || args.scopeType === "rm-team"
    ? (args.scopeType as "internal" | "rm-team")
    : "client";
  return {
    scopeType: st,
    accountName: args.accountName ?? null,
    accountId: args.accountId ?? null,
    internalLabel: args.internalLabel ?? "MOI",
  };
}

/** Find-or-create the folder for a session, caching the ids on the row. */
export async function folderForSession(
  session: GatherSession,
  scope: EvidenceScope
): Promise<RequirementFolder> {
  if (session.driveFolderId && session.driveFolderUrl) {
    // Sub-folder ids are re-resolved cheaply by name; ensure is idempotent.
    return ensureRequirementFolder({
      scope,
      requestTitle: session.requestTitle || "Untitled request",
      date: new Date(session.startedAt + "Z"),
    });
  }
  return ensureRequirementFolder({
    scope,
    requestTitle: session.requestTitle || "Untitled request",
    date: new Date(session.startedAt + "Z"),
  });
}

/**
 * Orchestrates a gathering turn: wake decisions, evidence filing, and the
 * confirm/rest exchange.
 *
 * This module exists so the Telegram webhook stays a transport layer. The
 * webhook knows how to receive a message and send one back; everything about
 * what a gathering IS lives here, which keeps the diff on the live webhook
 * small and makes this testable on its own.
 *
 * TURN SHAPE
 * ----------
 * For every inbound group message the webhook asks two questions:
 *
 *   1. `resolveWake()`  — should Arima be awake for this turn, and why?
 *   2. `handleEvidence()` — are there files to file?
 *
 * The answers decide whether the model is called at all, which is the whole
 * point: a bound group that is just people talking costs nothing.
 */

import {
  getActiveSession, startSession, touchSession, restSession, updateSession,
  looksLikeGatherRequest, looksLikeConfirmation, looksLikeRestRequest,
  type GatherSession,
} from "./session";
import {
  fileEvidence, listSessionEvidence, describeScreenshot, scopeFromBinding,
  type IncomingAttachment,
} from "./evidence-filing";
import { ensureRequirementFolder, evidenceDriveConfigured } from "./evidence-drive";
import { composeHandoffPrompt, composeChatHandoff } from "./handoff-prompt";
import { writePromptFile } from "./evidence-drive";

export type WakeReason =
  | "not-group"          // DM or portal — normal rules apply
  | "tagged-gather"      // tagged AND reads like a requirement → start a session
  | "tagged-question"    // tagged but just a question → answer, don't gather
  | "session-active"     // already gathering — stay awake
  | "session-confirmed"  // user said yes → finish and rest
  | "session-rest"       // explicit stop
  | "asleep";            // nothing to do

export interface WakeDecision {
  reason: WakeReason;
  /** Should the model be called for this turn? */
  respond: boolean;
  /** The live session, if one is running. */
  session: GatherSession | null;
  /** True when this turn should finish the gathering and write the handoff. */
  finishing: boolean;
}

/**
 * Decide Arima's state for one inbound message.
 *
 * The bias is deliberate: when unsure, stay asleep. A missed wake costs one
 * extra tag from the user. A false wake means Arima sits in a conversation it
 * was not invited to, spending tokens and adding noise.
 */
export async function resolveWake(args: {
  conversationId: string;
  isGroup: boolean;
  text: string;
  hasArimaMention: boolean;
  hasAttachments: boolean;
}): Promise<WakeDecision> {
  if (!args.isGroup) {
    return { reason: "not-group", respond: true, session: null, finishing: false };
  }

  const session = await getActiveSession(args.conversationId);
  const text = args.text || "";

  // An explicit stop ends a session from any state.
  if (session && looksLikeRestRequest(text)) {
    return { reason: "session-rest", respond: true, session, finishing: true };
  }

  if (session) {
    // While awake, Arima reads EVERYTHING in the thread — that is the point of
    // staying awake. Whether it SPEAKS is decided later by the model and by
    // handleEvidence(); this only decides that the turn is processed.
    await touchSession(session.id);

    // It asked "is this complete?" and someone said yes.
    if (session.status === "confirming" && looksLikeConfirmation(text)) {
      return { reason: "session-confirmed", respond: true, session, finishing: true };
    }
    return { reason: "session-active", respond: true, session, finishing: false };
  }

  // No session. Only a direct tag can start one.
  if (!args.hasArimaMention) {
    return { reason: "asleep", respond: false, session: null, finishing: false };
  }

  if (looksLikeGatherRequest(text)) {
    return { reason: "tagged-gather", respond: true, session: null, finishing: false };
  }
  // Tagged, but it reads like an ordinary question — answer it without
  // committing to a gathering.
  return { reason: "tagged-question", respond: true, session: null, finishing: false };
}

/** Begin a session and prepare its Drive folder. */
export async function beginGathering(args: {
  conversationId: string;
  chatId: string;
  clientProfileId: string | null;
  scopeType: string;
  accountName: string | null;
  accountId: string | null;
  requestTitle: string;
  wokenByUserId?: string | null;
  wokenByName?: string | null;
}): Promise<{ session: GatherSession; folderError: string | null }> {
  const session = await startSession({
    conversationId: args.conversationId,
    chatId: args.chatId,
    clientProfileId: args.clientProfileId,
    scopeType: args.scopeType,
    requestTitle: args.requestTitle,
    wokenByUserId: args.wokenByUserId,
    wokenByName: args.wokenByName,
  });

  // Create the folder now so the first screenshot has somewhere to land and the
  // user gets a link they can upload a recording into straight away.
  try {
    const folder = await ensureRequirementFolder({
      scope: scopeFromBinding({
        scopeType: args.scopeType,
        accountName: args.accountName,
        accountId: args.accountId,
      }),
      requestTitle: args.requestTitle,
      date: new Date(session.startedAt + "Z"),
    });
    await updateSession(session.id, {
      driveFolderId: folder.folderId,
      driveFolderUrl: folder.folderUrl,
      driveDisplayPath: folder.displayPath,
    });
    const refreshed = await getActiveSession(args.conversationId);
    return { session: refreshed || session, folderError: null };
  } catch (e: any) {
    // Drive misconfigured — gather anyway and say so. Losing the conversation
    // because a folder id is unset would be the worse failure.
    console.warn("[arima/gathering] folder creation failed:", e?.message);
    return { session, folderError: e?.message || "could not create the evidence folder" };
  }
}

export interface EvidenceOutcome {
  filed: number;
  failed: number;
  /** A short line for the chat, or null when there is nothing to say. */
  note: string | null;
  folderUrl: string | null;
}

/**
 * File every attachment on this message, describing each screenshot.
 *
 * Images are processed SEQUENTIALLY, not in parallel. Each vision call costs
 * roughly 1,600 tokens against an 8,000/minute ceiling; firing ten at once
 * would make the throttle serialise them anyway, but sequentially the user sees
 * steady progress instead of one long stall.
 */
export async function handleEvidence(args: {
  session: GatherSession;
  attachments: IncomingAttachment[];
  conversationId: string;
  messageId?: string | null;
  uploadedByName?: string | null;
  conversationContext?: string | null;
  scopeType: string;
  accountName: string | null;
  accountId: string | null;
  /** Skip the vision call — used when the caller only wants the file stored. */
  describe?: boolean;
}): Promise<EvidenceOutcome> {
  if (!args.attachments.length) {
    return { filed: 0, failed: 0, note: null, folderUrl: null };
  }

  if (!(await evidenceDriveConfigured())) {
    return {
      filed: 0,
      failed: args.attachments.length,
      note:
        "I can see the file but I can't reach Drive — the Google service account " +
        "isn't set up. An admin can fix this in Admin → Google Integration.",
      folderUrl: null,
    };
  }

  let folder;
  try {
    folder = await ensureRequirementFolder({
      scope: scopeFromBinding({
        scopeType: args.scopeType,
        accountName: args.accountName,
        accountId: args.accountId,
      }),
      requestTitle: args.session.requestTitle || "Untitled request",
      date: new Date(args.session.startedAt + "Z"),
    });
  } catch (e: any) {
    return {
      filed: 0,
      failed: args.attachments.length,
      note: `I couldn't open the evidence folder: ${e?.message || "unknown error"}`,
      folderUrl: null,
    };
  }

  let filed = 0;
  let failed = 0;
  // Re-read the session each pass so evidenceCount (and therefore the file
  // index) stays correct across several attachments in one turn.
  let session = args.session;

  for (const att of args.attachments) {
    let summary: string | null = null;
    if (args.describe !== false && att.mimeType?.startsWith("image/")) {
      summary = await describeScreenshot({
        buffer: att.buffer,
        mimeType: att.mimeType,
        context: args.conversationContext || null,
      });
    }
    const result = await fileEvidence({
      session,
      folder,
      attachment: att,
      conversationId: args.conversationId,
      messageId: args.messageId,
      uploadedByName: args.uploadedByName,
      visionSummary: summary,
    });
    if (result) {
      filed++;
      session = { ...session, evidenceCount: session.evidenceCount + 1 };
    } else {
      failed++;
    }
  }

  let note: string | null = null;
  if (filed && !failed) {
    note = filed === 1 ? "Saved to the evidence folder." : `Saved ${filed} files to the evidence folder.`;
  } else if (filed && failed) {
    note = `Saved ${filed}, but ${failed} didn't upload.`;
  } else if (failed) {
    note = "I couldn't save that to Drive — the upload failed.";
  }

  return { filed, failed, note, folderUrl: folder.folderUrl };
}

/**
 * Write PROMPT.md, post the handoff, and rest.
 *
 * Called when the user confirms the summary or says stop.
 */
export async function finishGathering(args: {
  session: GatherSession;
  requirement: string;
  currentBehaviour?: string | null;
  requestedBehaviour?: string | null;
  openQuestions?: string[];
  participants?: string[];
  accountName?: string | null;
  deliverable?: string | null;
  reason: "confirmed" | "explicit-rest";
}): Promise<{ message: string; promptUrl: string | null }> {
  const evidence = await listSessionEvidence(args.session.id);

  const markdown = composeHandoffPrompt({
    session: args.session,
    evidence,
    requirement: args.requirement,
    currentBehaviour: args.currentBehaviour,
    requestedBehaviour: args.requestedBehaviour,
    openQuestions: args.openQuestions,
    participants: args.participants,
    accountName: args.accountName,
    deliverable: args.deliverable,
  });

  let promptUrl: string | null = null;
  if (args.session.driveFolderId) {
    try {
      const written = await writePromptFile({
        folderId: args.session.driveFolderId,
        content: markdown,
      });
      promptUrl = written.webViewLink;
    } catch (e: any) {
      console.warn("[arima/gathering] PROMPT.md write failed:", e?.message);
    }
  }

  await restSession(args.session.id, args.reason);

  const message = promptUrl
    ? composeChatHandoff(args.session, evidence.length)
    : // No folder — give the content inline so the work is not lost.
      `Here's the handoff. I couldn't write it to Drive, so it's below:\n\n${markdown.slice(0, 3000)}`;

  return { message, promptUrl };
}

/**
 * The system-prompt fragment that tells the model how to behave while gathering.
 * Appended to Arima's existing prompt only during an active session.
 */
export function gatheringInstructions(session: GatherSession, evidenceCount: number): string {
  return [
    "",
    "## You are currently GATHERING A REQUIREMENT",
    "",
    `Working title: ${session.requestTitle || "(not yet named)"}`,
    `Evidence filed so far: ${evidenceCount} file(s)`,
    session.driveDisplayPath ? `Evidence folder: ${session.driveDisplayPath}` : "",
    "",
    "Your job in this mode is to collect a complete picture of what is being",
    "asked for, so a developer can act on it without going back to the group.",
    "",
    "What you need before you are done:",
    "- What the requester wants (in their own words where possible)",
    "- What happens TODAY — the current behaviour",
    "- What they want INSTEAD",
    "- Which module or screen it concerns",
    "- Screenshots showing the current behaviour",
    "",
    "How to behave:",
    "- Ask for ONE missing thing at a time. Do not interrogate.",
    "- Stay quiet when the humans are talking among themselves and nothing is",
    "  missing. You do not need to acknowledge every message.",
    "- If a screenshot was just filed, you may note it in one short line.",
    "- Developers need to SEE the current behaviour. If nobody has shared a",
    "  screenshot, ask for one.",
    "- If a screen recording would help, ask them to upload it to the evidence",
    "  folder — you cannot read video.",
    "",
    "When you believe you have enough, summarise what you captured in a few",
    "lines and ask whether anything is missing. Do not write the final document",
    "yourself — that happens after confirmation.",
    "",
    "IMPORTANT about screenshots: you may describe what is on screen, but never",
    "state an exact formula, number or field value as fact. You are reading at",
    "low fidelity. Say what you see in general terms and let the exact values be",
    "read later from the files themselves.",
    "",
  ].filter(Boolean).join("\n");
}

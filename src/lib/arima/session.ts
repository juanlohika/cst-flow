/**
 * Arima gathering sessions — "wake, gather, confirm, rest".
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * Before this, a bound group had exactly two states: Arima answered a tagged
 * message, or it stayed silent. Silent still meant work — every human-to-human
 * message was persisted AND written to `ArimaRunLog` (one row each, with the
 * system prompt and model output truncated at 64,000 chars apiece). A busy
 * group generated that traffic all day for no benefit.
 *
 * It also made gathering a requirement awkward: you tag Arima, it answers once,
 * and the follow-up screenshots arrive to a bot that has gone back to sleep.
 *
 * THE BEHAVIOUR
 * -------------
 *   WAKE    — someone tags @arima with something that reads like a requirement.
 *   GATHER  — Arima reads everything in the thread, files screenshots to Drive,
 *             and speaks ONLY to ask a clarifying question or confirm a file
 *             landed. It does not acknowledge every message; a busy group stays
 *             readable.
 *   CONFIRM — when it believes it has enough, it summarises and asks
 *             "is this complete?".
 *   REST    — on confirmation, or after IDLE_MINUTES of silence so a forgotten
 *             session cannot stay awake burning tokens.
 *
 * WHY A TABLE AND NOT MEMORY
 * --------------------------
 * Firebase App Hosting can move us to a new container between two messages in
 * the same conversation. An in-memory session would forget it was awake
 * mid-thread, which is worse than never waking. One small row per session.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";

/** A session with no activity for this long is considered abandoned. */
export const IDLE_MINUTES = 15;

/** How many prior messages Arima reads for context when it wakes. */
export const WAKE_BACKREAD = 10;

export type SessionStatus = "gathering" | "confirming" | "rested" | "expired";

export interface GatherSession {
  id: string;
  conversationId: string;
  chatId: string | null;
  clientProfileId: string | null;
  scopeType: string;
  requestTitle: string | null;
  arimaRequestId: string | null;
  driveFolderId: string | null;
  driveFolderUrl: string | null;
  driveDisplayPath: string | null;
  status: SessionStatus;
  evidenceCount: number;
  wokenByUserId: string | null;
  wokenByName: string | null;
  lastActivityAt: string;
  startedAt: string;
  restedAt: string | null;
  restReason: string | null;
}

function rowToSession(r: any): GatherSession {
  return {
    id: r.id,
    conversationId: r.conversationId,
    chatId: r.chatId ?? null,
    clientProfileId: r.clientProfileId ?? null,
    scopeType: r.scopeType ?? "client",
    requestTitle: r.requestTitle ?? null,
    arimaRequestId: r.arimaRequestId ?? null,
    driveFolderId: r.driveFolderId ?? null,
    driveFolderUrl: r.driveFolderUrl ?? null,
    driveDisplayPath: r.driveDisplayPath ?? null,
    status: (r.status ?? "gathering") as SessionStatus,
    evidenceCount: Number(r.evidenceCount ?? 0),
    wokenByUserId: r.wokenByUserId ?? null,
    wokenByName: r.wokenByName ?? null,
    lastActivityAt: r.lastActivityAt,
    startedAt: r.startedAt,
    restedAt: r.restedAt ?? null,
    restReason: r.restReason ?? null,
  };
}

/**
 * The live session for a conversation, or null.
 *
 * Expiry is evaluated on read rather than by a scheduled job: a stale session
 * only matters when the next message arrives, and this avoids another cron.
 */
export async function getActiveSession(conversationId: string): Promise<GatherSession | null> {
  const res: any = await db.run(sql`
    SELECT * FROM ArimaGatherSession
    WHERE conversationId = ${conversationId}
      AND status IN ('gathering','confirming')
    ORDER BY startedAt DESC LIMIT 1
  `);
  const row = res?.rows?.[0];
  if (!row) return null;

  const session = rowToSession(row);
  const idleMs = Date.now() - new Date(session.lastActivityAt + "Z").getTime();
  if (idleMs > IDLE_MINUTES * 60_000) {
    await restSession(session.id, "idle-timeout");
    return null;
  }
  return session;
}

export async function startSession(args: {
  conversationId: string;
  chatId?: string | null;
  clientProfileId?: string | null;
  scopeType?: string;
  requestTitle?: string | null;
  wokenByUserId?: string | null;
  wokenByName?: string | null;
}): Promise<GatherSession> {
  const existing = await getActiveSession(args.conversationId);
  if (existing) return existing;

  const id = `gs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  await db.run(sql`
    INSERT INTO ArimaGatherSession
      (id, conversationId, chatId, clientProfileId, scopeType, requestTitle,
       status, evidenceCount, wokenByUserId, wokenByName, lastActivityAt, startedAt)
    VALUES
      (${id}, ${args.conversationId}, ${args.chatId ?? null}, ${args.clientProfileId ?? null},
       ${args.scopeType ?? "client"}, ${args.requestTitle ?? null},
       'gathering', 0, ${args.wokenByUserId ?? null}, ${args.wokenByName ?? null},
       datetime('now'), datetime('now'))
  `);
  const created = await getActiveSession(args.conversationId);
  if (!created) throw new Error("failed to start gather session");
  return created;
}

/** Any inbound message while awake refreshes the idle clock. */
export async function touchSession(id: string): Promise<void> {
  await db.run(sql`
    UPDATE ArimaGatherSession SET lastActivityAt = datetime('now') WHERE id = ${id}
  `);
}

export async function updateSession(
  id: string,
  patch: Partial<
    Pick<
      GatherSession,
      | "requestTitle"
      | "arimaRequestId"
      | "driveFolderId"
      | "driveFolderUrl"
      | "driveDisplayPath"
      | "status"
    >
  >
): Promise<void> {
  const sets: any[] = [];
  if (patch.requestTitle !== undefined) sets.push(sql`requestTitle = ${patch.requestTitle}`);
  if (patch.arimaRequestId !== undefined) sets.push(sql`arimaRequestId = ${patch.arimaRequestId}`);
  if (patch.driveFolderId !== undefined) sets.push(sql`driveFolderId = ${patch.driveFolderId}`);
  if (patch.driveFolderUrl !== undefined) sets.push(sql`driveFolderUrl = ${patch.driveFolderUrl}`);
  if (patch.driveDisplayPath !== undefined)
    sets.push(sql`driveDisplayPath = ${patch.driveDisplayPath}`);
  if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
  if (!sets.length) return;

  let setClause = sets[0];
  for (let i = 1; i < sets.length; i++) setClause = sql`${setClause}, ${sets[i]}`;
  await db.run(
    sql`UPDATE ArimaGatherSession SET ${setClause}, lastActivityAt = datetime('now') WHERE id = ${id}`
  );
}

export async function incrementEvidence(id: string, by = 1): Promise<void> {
  await db.run(sql`
    UPDATE ArimaGatherSession
    SET evidenceCount = evidenceCount + ${by}, lastActivityAt = datetime('now')
    WHERE id = ${id}
  `);
}

export async function restSession(id: string, reason: string): Promise<void> {
  const status = reason === "idle-timeout" ? "expired" : "rested";
  await db.run(sql`
    UPDATE ArimaGatherSession
    SET status = ${status}, restedAt = datetime('now'), restReason = ${reason}
    WHERE id = ${id} AND status IN ('gathering','confirming')
  `);
}

// ─── Wake / rest intent ───────────────────────────────────────────────────────

/**
 * Does this message look like it is asking Arima to gather a requirement,
 * rather than asking a question it can answer outright?
 *
 * Deliberately conservative. A false positive makes Arima sit awake through a
 * conversation it was not invited to; a false negative just means the user
 * tags it again. The second failure is cheaper.
 */
export function looksLikeGatherRequest(text: string): boolean {
  const t = (text || "").toLowerCase();
  const verbs = [
    "document", "write up", "writeup", "capture", "log this", "file this",
    "requirement", "enhancement", "raise a ticket", "create a ticket",
    "ticket for", "bug", "defect", "issue with", "brd", "artifact",
    "prepare", "gather", "collect",
  ];
  return verbs.some((v) => t.includes(v));
}

/** Explicit "we're done" from a human. */
export function looksLikeConfirmation(text: string): boolean {
  const t = (text || "").toLowerCase().trim();
  const yes = [
    "yes", "yep", "yup", "correct", "that's it", "thats it", "complete",
    "all good", "looks good", "lgtm", "tama", "okay na", "ok na", "oo",
    "go ahead", "proceed", "confirmed", "sige",
  ];
  return yes.some((y) => t === y || t.startsWith(y + " ") || t.includes(" " + y));
}

/** Explicit "stop" — ends a session regardless of state. */
export function looksLikeRestRequest(text: string): boolean {
  const t = (text || "").toLowerCase();
  return (
    t.includes("/rest") ||
    t.includes("thanks arima") ||
    t.includes("thank you arima") ||
    t.includes("salamat arima") ||
    t.includes("that's all arima") ||
    t.includes("stop arima")
  );
}

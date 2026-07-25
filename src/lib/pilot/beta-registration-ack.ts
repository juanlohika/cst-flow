/**
 * Pilot Tracker — dev acknowledgement handler for internal Telegram GCs.
 *
 * When the tagged @broadcastAssignee replies in an internal-scope GC
 * with an acknowledgement message ("done", "ok", "registered", "added",
 * etc.), we treat it as authoritative confirmation that the dev has
 * added the pending emails to the Play Store internal-tester list.
 *
 * On ack, this module flips `betaRegistered=true` for every participant
 * currently in the AWAITING_REGISTRATION state across every active
 * pilot project in the CST OS. The state machine then re-derives their
 * currentStage (usually 2) and downstream flags. All writes flow through
 * updateParticipant() so audit rows are logged and follow-up notifications
 * fire correctly.
 */

import { db } from "@/db";
import { pilotParticipants, pilotProjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { updateParticipant } from "./participant-mutations";

/**
 * Small-and-loose classifier — is this a "yes I did it" from the dev?
 *
 * We keep this deliberately conservative: exact matches on a curated
 * whitelist, with tolerant whitespace/case/punctuation. Anything else
 * (questions, off-topic chatter, longer sentences) returns false so
 * Arima stays quiet.
 *
 * We deliberately avoid regex-inside-longer-text — "I'll get it done
 * tomorrow" should NOT count as an ack. The dev's ack is almost always
 * a one-word reply.
 */
export function looksLikeBetaRegisterAck(text: string): boolean {
  if (!text) return false;
  const normalized = text
    .toLowerCase()
    .trim()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ");
  if (!normalized) return false;

  const single = new Set<string>([
    "done",
    "ok",
    "okay",
    "done ✅",
    "registered",
    "added",
    "invited",
    "sent",
    "yes",
    "y",
    "👍",
    "👌",
    "✅",
    "ok done",
    "all done",
    "done na",       // Filipino
    "tapos na",       // Filipino
    "na add",         // Filipino
    "done po",        // Filipino
    "ok po",          // Filipino
  ]);
  if (single.has(normalized)) return true;

  // Match short "done + <email or count>" replies — e.g. "done - 3 users".
  if (/^(done|added|registered|invited)\b.{0,40}$/.test(normalized)) return true;

  return false;
}

/**
 * Mark every AWAITING_REGISTRATION participant across all active pilot
 * projects as betaRegistered=true.
 *
 * `actor` is stamped on each ChangeLog row so audit history shows which
 * dev triggered the sweep. Best-effort per participant — one failed
 * update doesn't stop the rest.
 *
 * Returns a summary the caller can compose into a reply message.
 */
export async function markAwaitingRegistrationAsRegistered(args: {
  actorLabel: string;                 // e.g. "Telegram @lester_alarcon"
  actorUserId?: string | null;        // CST OS userId if we can resolve it
  note?: string;
}): Promise<{
  marked: number;
  perProject: Array<{ projectId: string; projectName: string; count: number }>;
}> {
  // Load all active projects — participants belong to a project, and we
  // want to report the marked count per project so CST knows where the
  // sweep landed.
  const projects = await db
    .select({
      id: pilotProjects.id,
      name: pilotProjects.name,
    })
    .from(pilotProjects)
    .where(eq(pilotProjects.status, "active"));

  const perProject: Array<{ projectId: string; projectName: string; count: number }> = [];
  let marked = 0;

  for (const proj of projects) {
    // Find every AWAITING_REGISTRATION participant in this project.
    const rows = await db
      .select({ id: pilotParticipants.id })
      .from(pilotParticipants)
      .where(
        and(
          eq(pilotParticipants.projectId, proj.id),
          eq(pilotParticipants.issueFlag, "AWAITING_REGISTRATION"),
        ),
      );

    let projectMarked = 0;
    for (const r of rows) {
      try {
        const result = await updateParticipant(
          r.id,
          {
            betaRegistered: true,
            // betaRegisteredByUserId is deliberately left null when we
            // can't resolve a CST user — the actorLabel stored in the
            // ChangeLog `note` is enough for audit.
            betaRegisteredByUserId: args.actorUserId ?? null,
          },
          {
            actor: "dev",
            actorUserId: args.actorUserId ?? null,
            note: args.note ?? `Acknowledged via Telegram (${args.actorLabel})`,
            // Don't fan out the "n testers imported" internal-channel
            // broadcast just because we flipped state here — the GC we're
            // replying in already knows.
            suppressInternalBroadcast: true,
          },
        );
        if (result.updated) projectMarked += 1;
      } catch (e) {
        console.warn(`[pilot/ack] mark failed for participant ${r.id}:`, e);
      }
    }

    if (projectMarked > 0) {
      perProject.push({ projectId: proj.id, projectName: proj.name, count: projectMarked });
      marked += projectMarked;
    }
  }

  return { marked, perProject };
}

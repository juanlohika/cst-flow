/**
 * Retention for Arima's append-only tables.
 *
 * WHY
 * ---
 * Nothing in this app had a retention policy. Four tables grow with use and
 * never shrink, against a Turso free tier of 9 GB storage and 1 billion monthly
 * row reads — and reads usually hit the ceiling before storage does:
 *
 *   ArimaRunLog              one row per processed turn; systemPrompt,
 *                            rawModelOutput and finalReply are each truncated
 *                            at 64,000 chars, so ~192 KB worst case per row.
 *   ArimaToolInvocation      one row per tool call, with input and output JSON.
 *   KnowledgeDocumentVersion a full copy of a document on every edit, uncapped.
 *   ArimaGatherSession       small, but finished sessions have no reason to
 *                            stay forever.
 *
 * WHAT IS NOT DELETED
 * -------------------
 * ArimaRequest, ArimaEvidenceFile, ArimaMessage and BrdGenerationLog are the
 * record of what was asked for and what was produced. They are small (links and
 * metadata, not bytes) and they are the point of the system. Deleting
 * diagnostics is housekeeping; deleting the record is data loss.
 *
 * SAFETY
 * ------
 * Every sweep is bounded by `limit` so one run cannot lock the database on a
 * large backlog — call it repeatedly to drain. `dryRun` counts without
 * deleting, which is how this should be run the first time.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface RetentionPolicy {
  /** Diagnostic turn logs. 60 days is well past any debugging window. */
  runLogDays: number;
  /** Tool-call audit. Kept longer — it answers "did Arima do that?". */
  toolInvocationDays: number;
  /** Finished/expired gathering sessions. */
  gatherSessionDays: number;
  /** Versions to keep per knowledge document, newest first. 0 disables. */
  keepDocumentVersions: number;
  /** Max rows removed per table per run. */
  limit: number;
}

export const DEFAULT_POLICY: RetentionPolicy = {
  runLogDays: 60,
  toolInvocationDays: 180,
  gatherSessionDays: 90,
  keepDocumentVersions: 10,
  limit: 5000,
};

export interface SweepResult {
  table: string;
  deleted: number;
  dryRun: boolean;
  note?: string;
}

async function countThenDelete(args: {
  table: string;
  countSql: any;
  deleteSql: any;
  dryRun: boolean;
}): Promise<SweepResult> {
  try {
    const counted: any = await db.run(args.countSql);
    const n = Number(counted?.rows?.[0]?.n ?? 0);
    if (args.dryRun || n === 0) {
      return { table: args.table, deleted: 0, dryRun: args.dryRun, note: `${n} eligible` };
    }
    await db.run(args.deleteSql);
    return { table: args.table, deleted: n, dryRun: false };
  } catch (e: any) {
    // A missing table is not an error — the sweep runs before every table
    // necessarily exists on a given deployment.
    return { table: args.table, deleted: 0, dryRun: args.dryRun, note: `skipped: ${e?.message}` };
  }
}

export async function sweepRunLogs(p: RetentionPolicy, dryRun: boolean): Promise<SweepResult> {
  const cutoff = sql`datetime('now', ${"-" + p.runLogDays + " days"})`;
  return countThenDelete({
    table: "ArimaRunLog",
    countSql: sql`SELECT COUNT(*) AS n FROM ArimaRunLog WHERE createdAt < ${cutoff}`,
    deleteSql: sql`DELETE FROM ArimaRunLog WHERE id IN (
      SELECT id FROM ArimaRunLog WHERE createdAt < ${cutoff} LIMIT ${p.limit}
    )`,
    dryRun,
  });
}

export async function sweepToolInvocations(p: RetentionPolicy, dryRun: boolean): Promise<SweepResult> {
  const cutoff = sql`datetime('now', ${"-" + p.toolInvocationDays + " days"})`;
  return countThenDelete({
    table: "ArimaToolInvocation",
    countSql: sql`SELECT COUNT(*) AS n FROM ArimaToolInvocation WHERE createdAt < ${cutoff}`,
    // Pending approvals are a live queue, never history — leave them.
    deleteSql: sql`DELETE FROM ArimaToolInvocation WHERE id IN (
      SELECT id FROM ArimaToolInvocation
      WHERE createdAt < ${cutoff} AND status != 'pending' LIMIT ${p.limit}
    )`,
    dryRun,
  });
}

export async function sweepGatherSessions(p: RetentionPolicy, dryRun: boolean): Promise<SweepResult> {
  const cutoff = sql`datetime('now', ${"-" + p.gatherSessionDays + " days"})`;
  return countThenDelete({
    table: "ArimaGatherSession",
    countSql: sql`SELECT COUNT(*) AS n FROM ArimaGatherSession
                  WHERE status IN ('rested','expired') AND startedAt < ${cutoff}`,
    deleteSql: sql`DELETE FROM ArimaGatherSession WHERE id IN (
      SELECT id FROM ArimaGatherSession
      WHERE status IN ('rested','expired') AND startedAt < ${cutoff} LIMIT ${p.limit}
    )`,
    dryRun,
  });
}

/**
 * Keep the N most recent versions of each knowledge document.
 *
 * Version history is useful for a few edits back and useless beyond that, but
 * each row holds a full copy of the document.
 */
export async function sweepDocumentVersions(p: RetentionPolicy, dryRun: boolean): Promise<SweepResult> {
  if (p.keepDocumentVersions <= 0) {
    return { table: "KnowledgeDocumentVersion", deleted: 0, dryRun, note: "disabled" };
  }
  const keep = p.keepDocumentVersions;
  const stale = sql`
    SELECT v.id FROM KnowledgeDocumentVersion v
    WHERE (
      SELECT COUNT(*) FROM KnowledgeDocumentVersion v2
      WHERE v2.documentId = v.documentId AND v2.version > v.version
    ) >= ${keep}
  `;
  return countThenDelete({
    table: "KnowledgeDocumentVersion",
    countSql: sql`SELECT COUNT(*) AS n FROM (${stale})`,
    deleteSql: sql`DELETE FROM KnowledgeDocumentVersion WHERE id IN (
      SELECT id FROM (${stale}) LIMIT ${p.limit}
    )`,
    dryRun,
  });
}

/**
 * Drop a BRD markdown blob once it has been exported to Google Docs.
 *
 * ArimaRequest.brdDocument holds a whole document — tens of KB each. Once
 * brdGoogleDocUrl is set, the Doc is the real artifact and the blob is a
 * duplicate. The URL is kept, so nothing is lost.
 */
export async function sweepExportedBrdBlobs(p: RetentionPolicy, dryRun: boolean): Promise<SweepResult> {
  return countThenDelete({
    table: "ArimaRequest.brdDocument",
    countSql: sql`SELECT COUNT(*) AS n FROM ArimaRequest
                  WHERE brdDocument IS NOT NULL AND brdDocument != ''
                    AND brdGoogleDocUrl IS NOT NULL AND brdGoogleDocUrl != ''`,
    deleteSql: sql`UPDATE ArimaRequest SET brdDocument = NULL WHERE id IN (
      SELECT id FROM ArimaRequest
      WHERE brdDocument IS NOT NULL AND brdDocument != ''
        AND brdGoogleDocUrl IS NOT NULL AND brdGoogleDocUrl != '' LIMIT ${p.limit}
    )`,
    dryRun,
  });
}

export async function runRetentionSweep(opts: {
  policy?: Partial<RetentionPolicy>;
  dryRun?: boolean;
} = {}): Promise<{ dryRun: boolean; policy: RetentionPolicy; results: SweepResult[] }> {
  const policy = { ...DEFAULT_POLICY, ...(opts.policy || {}) };
  const dryRun = opts.dryRun ?? false;
  const results = [
    await sweepRunLogs(policy, dryRun),
    await sweepToolInvocations(policy, dryRun),
    await sweepGatherSessions(policy, dryRun),
    await sweepDocumentVersions(policy, dryRun),
    await sweepExportedBrdBlobs(policy, dryRun),
  ];
  const total = results.reduce((s, r) => s + r.deleted, 0);
  console.log(
    `[retention] ${dryRun ? "DRY RUN — " : ""}${total} row(s) cleared: ` +
      results.map((r) => `${r.table}=${r.deleted}${r.note ? ` (${r.note})` : ""}`).join(", ")
  );
  return { dryRun, policy, results };
}

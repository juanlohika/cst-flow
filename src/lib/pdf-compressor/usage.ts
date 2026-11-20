/**
 * PDF Compressor usage log, for the usage counter / KPI on the AI Tools page.
 * One row per successful compression. Metadata only, never file contents.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

let ready = false;

async function ensureTable() {
  if (ready) return;
  await db.run(sql`CREATE TABLE IF NOT EXISTS PdfCompressLog (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    via TEXT NOT NULL,
    fileName TEXT,
    quality TEXT,
    pages INTEGER,
    originalBytes INTEGER NOT NULL,
    compressedBytes INTEGER NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  try { await db.run(sql`CREATE INDEX IF NOT EXISTS PdfCompressLog_createdAt_idx ON PdfCompressLog(createdAt)`); } catch {}
  ready = true;
}

export async function logCompression(row: {
  email: string; via: string; fileName: string; quality: string;
  pages?: number | null; originalBytes: number; compressedBytes: number;
}) {
  try {
    await ensureTable();
    const id = `pdfc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await db.run(sql`INSERT INTO PdfCompressLog (id, email, via, fileName, quality, pages, originalBytes, compressedBytes)
      VALUES (${id}, ${row.email}, ${row.via}, ${row.fileName}, ${row.quality}, ${row.pages ?? null}, ${row.originalBytes}, ${row.compressedBytes})`);
  } catch (e: any) {
    // Never fail a user's compression because the counter could not be written.
    console.error(`[pdf-compressor] usage log failed: ${e?.message}`);
  }
}

export interface UsageStats {
  allTime: { files: number; users: number; originalBytes: number; compressedBytes: number };
  thisMonth: { files: number; users: number; originalBytes: number; compressedBytes: number };
}

export async function usageStats(): Promise<UsageStats> {
  await ensureTable();
  const q = async (where: string) => {
    const rows: any = await db.all(sql.raw(`SELECT COUNT(*) AS files, COUNT(DISTINCT email) AS users,
      COALESCE(SUM(originalBytes),0) AS o, COALESCE(SUM(compressedBytes),0) AS c FROM PdfCompressLog ${where}`));
    const r = Array.isArray(rows) ? rows[0] : rows;
    return { files: Number(r?.files || 0), users: Number(r?.users || 0), originalBytes: Number(r?.o || 0), compressedBytes: Number(r?.c || 0) };
  };
  return {
    allTime: await q(""),
    thisMonth: await q(`WHERE createdAt >= strftime('%Y-%m-01 00:00:00', 'now')`),
  };
}

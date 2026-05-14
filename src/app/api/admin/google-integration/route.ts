import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { globalSettings } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: { status: 401, message: "Unauthorized" } } as const;
  if ((session.user as any).role !== "admin") return { error: { status: 403, message: "Admin only" } } as const;
  return { ok: true as const };
}

const KEYS = ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_DRIVE_BRD_FOLDER_ID"] as const;

/** GET /api/admin/google-integration — returns whether credentials are configured (NOT the secrets themselves). */
export async function GET() {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();

    const rows = await db.select().from(globalSettings).where(inArray(globalSettings.key, KEYS as unknown as string[]));
    const map = new Map(rows.map(r => [r.key, r.value]));
    const serviceAccountJson = map.get("GOOGLE_SERVICE_ACCOUNT_JSON") || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
    const driveFolderId = map.get("GOOGLE_DRIVE_BRD_FOLDER_ID") || process.env.GOOGLE_DRIVE_BRD_FOLDER_ID || "";

    // Surface only meta info, not the secrets
    let serviceAccountEmail = "";
    let serviceAccountValid = false;
    if (serviceAccountJson) {
      try {
        const parsed = JSON.parse(serviceAccountJson);
        serviceAccountEmail = parsed.client_email || "";
        serviceAccountValid = !!parsed.private_key && !!parsed.client_email;
      } catch {
        serviceAccountValid = false;
      }
    }

    return NextResponse.json({
      configured: !!(serviceAccountValid && driveFolderId),
      serviceAccountEmail,
      serviceAccountValid,
      driveFolderId,
      source: rows.length > 0 ? "db" : (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? "env" : "none"),
    });
  } catch (error: any) {
    console.error("[admin/google-integration GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** POST /api/admin/google-integration — write credentials to globalSettings. */
export async function POST(req: Request) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();

    const body = await req.json();
    const serviceAccountJson = String(body?.serviceAccountJson || "").trim();
    const driveFolderId = String(body?.driveFolderId || "").trim();

    if (!serviceAccountJson || !driveFolderId) {
      return NextResponse.json({ error: "Both serviceAccountJson and driveFolderId are required" }, { status: 400 });
    }

    // Validate JSON
    try {
      const parsed = JSON.parse(serviceAccountJson);
      if (!parsed.client_email || !parsed.private_key) {
        return NextResponse.json({ error: "Service account JSON missing client_email or private_key" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Service account JSON is not valid JSON" }, { status: 400 });
    }

    const upserts: Array<{ key: string; value: string }> = [
      { key: "GOOGLE_SERVICE_ACCOUNT_JSON", value: serviceAccountJson },
      { key: "GOOGLE_DRIVE_BRD_FOLDER_ID", value: driveFolderId },
    ];

    const now = new Date().toISOString();
    for (const { key, value } of upserts) {
      const existing = await db.select({ id: globalSettings.id }).from(globalSettings).where(eq(globalSettings.key, key)).limit(1);
      if (existing.length > 0) {
        await db.update(globalSettings).set({ value, updatedAt: now }).where(eq(globalSettings.id, existing[0].id));
      } else {
        await db.insert(globalSettings).values({
          id: `gs_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
          key,
          value,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[admin/google-integration POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** DELETE /api/admin/google-integration — clear credentials. */
export async function DELETE() {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();
    await db.delete(globalSettings).where(inArray(globalSettings.key, KEYS as unknown as string[]));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[admin/google-integration DELETE]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

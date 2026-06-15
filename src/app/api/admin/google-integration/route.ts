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

const KEYS = [
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_DRIVE_BRD_FOLDER_ID",
  "GOOGLE_DRIVE_DASHBOARDS_FOLDER_ID",
  "GOOGLE_MAPS_API_KEY",
  "PIN_VALIDATOR_DRIVE_FOLDER_ID",
] as const;

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
    const dashboardsFolderId = map.get("GOOGLE_DRIVE_DASHBOARDS_FOLDER_ID") || process.env.GOOGLE_DRIVE_DASHBOARDS_FOLDER_ID || "";
    const mapsApiKey = map.get("GOOGLE_MAPS_API_KEY") || process.env.GOOGLE_MAPS_API_KEY || "";
    const pinValidatorFolderId = map.get("PIN_VALIDATOR_DRIVE_FOLDER_ID") || process.env.PIN_VALIDATOR_DRIVE_FOLDER_ID || "";

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
      dashboardsConfigured: !!(serviceAccountValid && dashboardsFolderId),
      pinValidatorConfigured: !!(serviceAccountValid && mapsApiKey),
      serviceAccountEmail,
      serviceAccountValid,
      driveFolderId,
      dashboardsFolderId,
      // mapsApiKey is a secret — surface ONLY whether it's set, never the value
      mapsApiKeySet: !!mapsApiKey,
      pinValidatorFolderId,
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
    const dashboardsFolderId = String(body?.dashboardsFolderId || "").trim();
    const mapsApiKey = String(body?.mapsApiKey || "").trim();
    const pinValidatorFolderId = String(body?.pinValidatorFolderId || "").trim();

    // Load existing values so we can keep them when the admin only edits one
    // field (e.g. just adding the Dashboards folder later).
    const existingRows = await db.select().from(globalSettings).where(inArray(globalSettings.key, KEYS as unknown as string[]));
    const existingMap = new Map(existingRows.map((r: any) => [r.key, r.value]));

    const effectiveJson = serviceAccountJson || String(existingMap.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "");
    const effectiveBrdFolder = driveFolderId || String(existingMap.get("GOOGLE_DRIVE_BRD_FOLDER_ID") || "");

    if (!effectiveJson || !effectiveBrdFolder) {
      return NextResponse.json({ error: "Service account JSON and BRD folder ID are required (they can come from previously saved values — paste them again only if you want to change them)." }, { status: 400 });
    }

    // Validate the JSON we'll persist (whether new or existing)
    try {
      const parsed = JSON.parse(effectiveJson);
      if (!parsed.client_email || !parsed.private_key) {
        return NextResponse.json({ error: "Service account JSON missing client_email or private_key" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Service account JSON is not valid JSON" }, { status: 400 });
    }

    // Only upsert keys the admin actually provided in this submission.
    // Blank fields mean "leave the existing value as-is".
    const upserts: Array<{ key: string; value: string }> = [];
    if (serviceAccountJson) upserts.push({ key: "GOOGLE_SERVICE_ACCOUNT_JSON", value: serviceAccountJson });
    if (driveFolderId) upserts.push({ key: "GOOGLE_DRIVE_BRD_FOLDER_ID", value: driveFolderId });
    if (dashboardsFolderId) upserts.push({ key: "GOOGLE_DRIVE_DASHBOARDS_FOLDER_ID", value: dashboardsFolderId });
    if (mapsApiKey) upserts.push({ key: "GOOGLE_MAPS_API_KEY", value: mapsApiKey });
    if (pinValidatorFolderId) upserts.push({ key: "PIN_VALIDATOR_DRIVE_FOLDER_ID", value: pinValidatorFolderId });

    if (upserts.length === 0) {
      return NextResponse.json({ error: "Nothing to save — all fields were blank." }, { status: 400 });
    }

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

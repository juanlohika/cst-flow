import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { notificationPreferences, notificationSubscriptions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { getOrCreatePreferences } from "@/lib/notifications/dispatcher";

export const dynamic = "force-dynamic";

/** GET /api/notifications/preferences → returns current user's prefs + subscription summary */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    await ensureAccessSchema();

    const prefs = await getOrCreatePreferences(userId);

    const subs = await db
      .select({
        id: notificationSubscriptions.id,
        endpoint: notificationSubscriptions.endpoint,
        userAgent: notificationSubscriptions.userAgent,
        status: notificationSubscriptions.status,
        lastUsedAt: notificationSubscriptions.lastUsedAt,
        createdAt: notificationSubscriptions.createdAt,
      })
      .from(notificationSubscriptions)
      .where(and(
        eq(notificationSubscriptions.userId, userId),
        eq(notificationSubscriptions.status, "active")
      ));

    return NextResponse.json({ preferences: prefs, subscriptions: subs });
  } catch (error: any) {
    console.error("[preferences GET] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** PATCH /api/notifications/preferences → updates the calling user's prefs */
export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    await ensureAccessSchema();
    await getOrCreatePreferences(userId); // ensures the row exists

    const body = await req.json();
    const ALLOWED = [
      "webPushEnabled", "emailEnabled",
      "notifyOnRequest", "notifyOnTelegram", "notifyOnMention",
      "quietStart", "quietEnd", "emailCadence",
    ];
    const updateData: any = { updatedAt: new Date().toISOString() };
    for (const key of ALLOWED) {
      if (key in body && body[key] !== undefined) {
        if (typeof body[key] === "boolean" || ["quietStart","quietEnd","emailCadence"].includes(key)) {
          updateData[key] = body[key];
        }
      }
    }

    await db.update(notificationPreferences)
      .set(updateData)
      .where(eq(notificationPreferences.userId, userId));

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[preferences PATCH] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

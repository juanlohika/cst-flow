import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { notificationSubscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * POST /api/notifications/subscribe
 * Body: { endpoint, keys: { p256dh, auth }, userAgent? }
 *
 * Register a browser push subscription for the current user.
 * Idempotent: if the same endpoint is re-subscribed, we update the keys.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    await ensureAccessSchema();

    const body = await req.json();
    const endpoint = body?.endpoint;
    const p256dh = body?.keys?.p256dh;
    const authSecret = body?.keys?.auth;
    const userAgent = body?.userAgent || req.headers.get("user-agent") || null;

    if (!endpoint || !p256dh || !authSecret) {
      return NextResponse.json({ error: "endpoint, keys.p256dh, keys.auth required" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const existing = await db
      .select({ id: notificationSubscriptions.id })
      .from(notificationSubscriptions)
      .where(eq(notificationSubscriptions.endpoint, endpoint))
      .limit(1);

    if (existing[0]) {
      // Refresh keys + ownership in case the user logged in on a different account
      await db
        .update(notificationSubscriptions)
        .set({
          userId,
          p256dh,
          authSecret,
          userAgent,
          status: "active",
          lastUsedAt: now,
        })
        .where(eq(notificationSubscriptions.id, existing[0].id));
      return NextResponse.json({ id: existing[0].id, updated: true });
    }

    const id = `ns_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    await db.insert(notificationSubscriptions).values({
      id,
      userId,
      endpoint,
      p256dh,
      authSecret,
      userAgent,
      status: "active",
      lastUsedAt: now,
      createdAt: now,
    });

    return NextResponse.json({ id, created: true }, { status: 201 });
  } catch (error: any) {
    console.error("[subscribe] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/notifications/subscribe
 * Body: { endpoint } — remove a subscription (when the user opts out in browser)
 */
export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const body = await req.json();
    const endpoint = body?.endpoint;
    if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });

    await db
      .delete(notificationSubscriptions)
      .where(eq(notificationSubscriptions.endpoint, endpoint));

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[subscribe DELETE] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

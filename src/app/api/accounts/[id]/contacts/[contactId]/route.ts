import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientContacts, subscriberSessions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/** PATCH: update contact fields. Admin only. */
export async function PATCH(req: Request, { params }: { params: { id: string; contactId: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const body = await req.json();
    const ALLOWED = ["name", "email", "role", "phone", "status"] as const;
    const updateData: any = { updatedAt: new Date().toISOString() };
    for (const k of ALLOWED) {
      if (k in body && body[k] !== undefined) updateData[k] = body[k];
    }

    await db.update(clientContacts)
      .set(updateData)
      .where(and(
        eq(clientContacts.id, params.contactId),
        eq(clientContacts.clientProfileId, params.id)
      ));

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[contact PATCH] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** DELETE: revoke all sessions for the contact and remove the row. Admin only. */
export async function DELETE(_: Request, { params }: { params: { id: string; contactId: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    // Revoke any active sessions first (deleting the contact cascades, but this is cleaner)
    await db.update(subscriberSessions)
      .set({ status: "revoked" })
      .where(eq(subscriberSessions.contactId, params.contactId));

    await db.delete(clientContacts)
      .where(and(
        eq(clientContacts.id, params.contactId),
        eq(clientContacts.clientProfileId, params.id)
      ));

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[contact DELETE] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

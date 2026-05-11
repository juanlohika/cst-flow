import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientContacts, clientProfiles as clientProfilesTable } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/[id]/contacts — list contacts (any member of the account)
 * POST /api/accounts/[id]/contacts — create a contact (admin only)
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.user.id;
    const isAdmin = (session.user as any).role === "admin";
    await ensureAccessSchema();

    const allowed = await canAccessClient({ userId, isAdmin }, params.id);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const rows = await db
      .select({
        id: clientContacts.id,
        name: clientContacts.name,
        email: clientContacts.email,
        role: clientContacts.role,
        phone: clientContacts.phone,
        status: clientContacts.status,
        invitedAt: clientContacts.invitedAt,
        activatedAt: clientContacts.activatedAt,
        lastSeenAt: clientContacts.lastSeenAt,
        createdAt: clientContacts.createdAt,
      })
      .from(clientContacts)
      .where(eq(clientContacts.clientProfileId, params.id))
      .orderBy(asc(clientContacts.name));

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("[contacts GET] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    // Verify account exists
    const profileRows = await db.select({ id: clientProfilesTable.id })
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.id, params.id))
      .limit(1);
    if (profileRows.length === 0) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    const body = await req.json();
    const name = (body?.name || "").trim();
    const email = (body?.email || "").trim().toLowerCase();
    const role = body?.role || null;
    const phone = body?.phone || null;

    if (!name || !email) return NextResponse.json({ error: "Name and email required" }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    // Reject duplicate (same email within same account)
    const dup = await db.select({ id: clientContacts.id })
      .from(clientContacts)
      .where(and(
        eq(clientContacts.clientProfileId, params.id),
        eq(clientContacts.email, email)
      ))
      .limit(1);
    if (dup.length > 0) {
      return NextResponse.json({ error: "A contact with this email already exists for this account.", id: dup[0].id }, { status: 409 });
    }

    const id = `cc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    await db.insert(clientContacts).values({
      id,
      clientProfileId: params.id,
      name,
      email,
      role,
      phone,
      status: "invited",
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id, name, email, role, phone, status: "invited" }, { status: 201 });
  } catch (error: any) {
    console.error("[contacts POST] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

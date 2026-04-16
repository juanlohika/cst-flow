import { NextResponse } from "next/server";
import { db } from "@/db";
import { clientProfiles as clientProfilesTable } from "@/db/schema";
import { auth } from "@/auth";
import { eq, and } from "drizzle-orm";

/**
 * GET /api/meeting-prep/profiles/[id]
 * Fetch a single client profile by ID
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rows = await db.select()
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.id, params.id))
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const profile = rows[0];
    return NextResponse.json({
      ...profile,
      modulesAvailed: (() => { try { return JSON.parse(profile.modulesAvailed || "[]"); } catch { return []; } })(),
    });
  } catch (error: any) {
    console.error("GET /api/meeting-prep/profiles/[id] error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch profile" }, { status: 500 });
  }
}

/**
 * PATCH /api/meeting-prep/profiles/[id]
 * Update a client profile (partial update)
 * MIGRATED TO DRIZZLE
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ownership check with Drizzle
    const existing = await db.select({ id: clientProfilesTable.id, userId: clientProfilesTable.userId })
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.id, params.id))
      .limit(1);

    if (existing.length === 0 || existing[0].userId !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json();
    const {
      companyName,
      industry,
      modulesAvailed,
      engagementStatus,
      primaryContact,
      primaryContactEmail,
      specialConsiderations,
    } = body;

    // Drizzle update
    await db.update(clientProfilesTable)
      .set({
        ...(companyName !== undefined && { companyName }),
        ...(industry !== undefined && { industry }),
        ...(modulesAvailed !== undefined && { modulesAvailed: JSON.stringify(modulesAvailed) }),
        ...(engagementStatus !== undefined && { engagementStatus }),
        ...(primaryContact !== undefined && { primaryContact }),
        ...(primaryContactEmail !== undefined && { primaryContactEmail }),
        ...(specialConsiderations !== undefined && { specialConsiderations }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(clientProfilesTable.id, params.id));

    // Read back
    const updated = await db.select()
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.id, params.id))
      .limit(1);

    const profile = updated[0] || {};
    return NextResponse.json({
      ...profile,
      modulesAvailed: (() => { try { return JSON.parse(profile.modulesAvailed || "[]"); } catch { return []; } })(),
    });
  } catch (error: any) {
    console.error("PATCH /api/meeting-prep/profiles/[id] error:", error);
    return NextResponse.json({ error: error.message || "Failed to update profile" }, { status: 500 });
  }
}

/**
 * DELETE /api/meeting-prep/profiles/[id]
 * MIGRATED TO DRIZZLE
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ownership check with Drizzle
    const existing = await db.select({ id: clientProfilesTable.id, userId: clientProfilesTable.userId })
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.id, params.id))
      .limit(1);

    if (existing.length === 0 || existing[0].userId !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Drizzle delete
    await db.delete(clientProfilesTable).where(eq(clientProfilesTable.id, params.id));
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Delete profile error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete profile" }, { status: 500 });
  }
}

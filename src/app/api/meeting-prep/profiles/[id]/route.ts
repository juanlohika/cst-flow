import { NextResponse } from "next/server";
import { db } from "@/db";
import { clientProfiles as clientProfilesTable } from "@/db/schema";
import { auth } from "@/auth";
import { eq, and } from "drizzle-orm";
import { canAccessClient } from "@/lib/access/accounts";

// Fields that ONLY admins can edit — strategic / access-related metadata.
const ADMIN_ONLY_FIELDS = new Set([
  "tier",
  "groupTier",
  "groupName",
  "frequencyOverride",
  "pmEmail",
  "baEmail",
  "rmEmail",
  "assignedOnMonth",
  "clientShortName",
  "clientLongName",
  "engagementStatus",
  "specialConsiderations",
  "f2fFrequencyOverride",
]);

// Fields any team member with account access can edit.
const TEAM_EDITABLE_FIELDS = new Set([
  "lastCourtesyCall",
  "lastF2FVisit",
  "companyName",
  "industry",
  "modulesAvailed",
  "primaryContact",
  "primaryContactEmail",
]);

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
    const isAdmin = (session?.user as any)?.role === "admin";

    // Access check — admins always pass, team members need membership.
    const allowed = await canAccessClient({ userId, isAdmin }, params.id);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const existing = await db.select({ id: clientProfilesTable.id })
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.id, params.id))
      .limit(1);
    if (existing.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json();
    const {
      // legacy + team-editable
      companyName,
      industry,
      modulesAvailed,
      primaryContact,
      primaryContactEmail,
      // admin-only — strategic
      engagementStatus,
      specialConsiderations,
      clientShortName,
      clientLongName,
      groupName,
      tier,
      groupTier,
      frequencyOverride,
      pmEmail,
      baEmail,
      rmEmail,
      assignedOnMonth,
      // team-editable — operational
      lastCourtesyCall,
      lastF2FVisit,
      f2fFrequencyOverride,
    } = body;

    // Reject if any admin-only field is being touched by a non-admin
    if (!isAdmin) {
      const adminFieldsAttempted = Object.keys(body).filter(k => ADMIN_ONLY_FIELDS.has(k));
      if (adminFieldsAttempted.length > 0) {
        return NextResponse.json({
          error: `These fields are admin-only: ${adminFieldsAttempted.join(", ")}`,
        }, { status: 403 });
      }
    }

    // Drizzle update — only set fields the caller actually provided
    await db.update(clientProfilesTable)
      .set({
        ...(companyName !== undefined && { companyName }),
        ...(industry !== undefined && { industry }),
        ...(modulesAvailed !== undefined && { modulesAvailed: JSON.stringify(modulesAvailed) }),
        ...(engagementStatus !== undefined && { engagementStatus }),
        ...(primaryContact !== undefined && { primaryContact }),
        ...(primaryContactEmail !== undefined && { primaryContactEmail }),
        ...(specialConsiderations !== undefined && { specialConsiderations }),
        ...(clientShortName !== undefined && { clientShortName }),
        ...(clientLongName !== undefined && { clientLongName }),
        ...(groupName !== undefined && { groupName }),
        ...(tier !== undefined && { tier }),
        ...(groupTier !== undefined && { groupTier }),
        ...(frequencyOverride !== undefined && { frequencyOverride }),
        ...(pmEmail !== undefined && { pmEmail }),
        ...(baEmail !== undefined && { baEmail }),
        ...(rmEmail !== undefined && { rmEmail }),
        ...(assignedOnMonth !== undefined && { assignedOnMonth }),
        ...(lastCourtesyCall !== undefined && { lastCourtesyCall }),
        ...(lastF2FVisit !== undefined && { lastF2FVisit }),
        ...(f2fFrequencyOverride !== undefined && { f2fFrequencyOverride }),
        updatedAt: new Date().toISOString(),
      } as any)
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

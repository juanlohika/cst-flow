import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

/**
 * PATCH /api/meeting-prep/profiles/[id]
 * Update a client profile (partial update)
 * PRODUCTION-SAFE: 100% raw SQL
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Raw SQL instead of Prisma ORM findUnique
    const existing = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, userId FROM ClientProfile WHERE id = ?`, params.id
    );
    if (existing.length === 0 || existing[0].userId !== session.user.id) {
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

    const setClauses: string[] = [];
    const values: any[] = [];

    if (companyName !== undefined) { setClauses.push("companyName = ?"); values.push(companyName); }
    if (industry !== undefined) { setClauses.push("industry = ?"); values.push(industry); }
    if (modulesAvailed !== undefined) { setClauses.push("modulesAvailed = ?"); values.push(JSON.stringify(modulesAvailed)); }
    if (engagementStatus !== undefined) { setClauses.push("engagementStatus = ?"); values.push(engagementStatus); }
    if (primaryContact !== undefined) { setClauses.push("primaryContact = ?"); values.push(primaryContact); }
    if (primaryContactEmail !== undefined) { setClauses.push("primaryContactEmail = ?"); values.push(primaryContactEmail); }
    if (specialConsiderations !== undefined) { setClauses.push("specialConsiderations = ?"); values.push(specialConsiderations); }

    if (setClauses.length > 0) {
      setClauses.push("updatedAt = ?");
      values.push(new Date().toISOString());
      
      values.push(params.id);
      await prisma.$executeRawUnsafe(
        `UPDATE ClientProfile SET ${setClauses.join(", ")} WHERE id = ?`,
        ...values
      );
    }

    // Read back with raw SQL
    const updated = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, userId, companyName, industry, companySize,
              modulesAvailed, engagementStatus, primaryContact,
              primaryContactEmail, specialConsiderations,
              createdAt, updatedAt
       FROM ClientProfile WHERE id = ?`,
      params.id
    );

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
 * PRODUCTION-SAFE: 100% raw SQL
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Raw SQL ownership check
    const existing = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, userId FROM ClientProfile WHERE id = ?`, params.id
    );
    if (existing.length === 0 || existing[0].userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Raw SQL delete
    await prisma.$executeRawUnsafe(`DELETE FROM ClientProfile WHERE id = ?`, params.id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Delete profile error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete profile" }, { status: 500 });
  }
}

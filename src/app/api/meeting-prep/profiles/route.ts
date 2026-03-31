import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/meeting-prep/profiles
 * Fetch all client profiles for the current user
 * PRODUCTION-SAFE: Uses raw SQL to avoid Prisma schema-mismatch crashes on Turso
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // RAW SQL: Avoid Prisma ORM findMany which references ALL schema columns
    const profiles = await prisma.$queryRawUnsafe<any[]>(
      `SELECT cp.id, cp.userId, cp.companyName, cp.industry, cp.companySize,
              cp.modulesAvailed, cp.engagementStatus, cp.primaryContact,
              cp.primaryContactEmail, cp.specialConsiderations,
              cp.createdAt, cp.updatedAt
       FROM ClientProfile cp
       WHERE cp.userId = ?
       ORDER BY cp.createdAt DESC`,
      session.user.id
    );

    // Fetch meeting prep sessions separately (also raw SQL to be safe)
    const profileIds = profiles.map((p: any) => p.id);
    let sessions: any[] = [];
    if (profileIds.length > 0) {
      const placeholders = profileIds.map(() => "?").join(",");
      sessions = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, clientProfileId, meetingType, status, updatedAt,
                agendaContent, questionnaireContent, preparationChecklist,
                anticipatedRequirements, discussionGuide
         FROM MeetingPrepSession
         WHERE clientProfileId IN (${placeholders})
         ORDER BY updatedAt DESC`,
        ...profileIds
      );
    }

    // Merge sessions into profiles
    const sessionsByProfile: Record<string, any[]> = {};
    for (const s of sessions) {
      const pid = s.clientProfileId;
      if (!sessionsByProfile[pid]) sessionsByProfile[pid] = [];
      sessionsByProfile[pid].push(s);
    }

    const formatted = profiles.map((p: any) => ({
      ...p,
      meetingPrepSessions: sessionsByProfile[p.id] || [],
    }));

    return NextResponse.json(formatted);
  } catch (error: any) {
    console.error("Fetch profiles error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch profiles" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/meeting-prep/profiles
 * Create a new client profile
 * PRODUCTION-SAFE: 100% raw SQL — zero Prisma ORM calls
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    // STABILITY: Ensure the user record exists before creating profile (prevents FK error)
    // Using raw SQL to avoid Prisma upsert crash on Turso
    try {
      const existing = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM User WHERE id = ?`, session.user.id
      );
      if (existing.length === 0) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO User (id, name, email, role, status)
           VALUES (?, ?, ?, ?, 'approved')`,
          session.user.id,
          session.user.name || "CST User",
          session.user.email || `unknown_${Date.now()}@cst.com`,
          (session.user as any).role || "user"
        );
      }
    } catch (e) {
      console.warn("Profiles: User ensure failed (non-critical):", e);
    }

    if (!companyName?.trim()) {
      return NextResponse.json(
        { error: "Company name is required" },
        { status: 400 }
      );
    }

    const id = `cp_${Date.now()}`;
    const now = new Date().toISOString();
    await prisma.$executeRawUnsafe(
      `INSERT INTO ClientProfile (id, userId, companyName, industry, modulesAvailed, engagementStatus, primaryContact, primaryContactEmail, specialConsiderations, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      session.user.id,
      companyName,
      industry || "general",
      JSON.stringify(modulesAvailed || []),
      engagementStatus || "confirmed",
      primaryContact || "",
      primaryContactEmail || "",
      specialConsiderations || "",
      now,
      now
    );

    // Read back with raw SQL instead of Prisma ORM findUnique
    const created = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, userId, companyName, industry, companySize,
              modulesAvailed, engagementStatus, primaryContact,
              primaryContactEmail, specialConsiderations,
              createdAt, updatedAt
       FROM ClientProfile WHERE id = ?`,
      id
    );

    const profile = created[0] || {};
    return NextResponse.json({
      ...profile,
      modulesAvailed: (() => { try { return JSON.parse(profile.modulesAvailed || "[]"); } catch { return []; } })(),
    }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/meeting-prep/profiles error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create profile. Please run /api/auth/config to repair the database schema." },
      { status: 500 }
    );
  }
}

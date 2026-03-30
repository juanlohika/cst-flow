import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/meeting-prep/profiles
 * Fetch all client profiles for the current user
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Note: nested orderBy inside include can fail with the libsql adapter.
    // Fetch sessions separately and merge in code.
    const profiles = await prisma.clientProfile.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      include: { meetingPrepSessions: true },
    });

    const formatted = profiles.map((p) => ({
      ...p,
      meetingPrepSessions: [...p.meetingPrepSessions].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
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

    if (!companyName?.trim()) {
      return NextResponse.json(
        { error: "Company name is required" },
        { status: 400 }
      );
    }

    const profile = await prisma.clientProfile.create({
      data: {
        userId: session.user.id,
        companyName,
        industry: industry || "general",
        modulesAvailed: JSON.stringify(modulesAvailed || []),
        engagementStatus: engagementStatus || "confirmed",
        primaryContact,
        primaryContactEmail,
        specialConsiderations,
      },
    });

    const formatted = {
      ...profile,
      modulesAvailed: JSON.parse(profile.modulesAvailed || "[]"),
    };

    return NextResponse.json(formatted, { status: 201 });
  } catch (error: any) {
    console.error("Create profile error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create profile" },
      { status: 500 }
    );
  }
}

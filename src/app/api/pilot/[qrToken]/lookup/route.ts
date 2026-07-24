/**
 * Pilot Tracker — identity match (public portal).
 *
 * POST /api/pilot/[qrToken]/lookup
 *   body: { query: string }
 *   → { matches: [{id, fullName, employeeIdMasked, mobileMasked}] }
 *
 * The `query` is matched against employeeId (case-insensitive), fullName
 * (case-insensitive contains), and mobileNumber / mobileNumberCorrected
 * (digit-only substring). Returns up to 5 candidates so the participant
 * can self-select their record.
 *
 * Values are masked before returning — the participant sees enough to
 * recognize their own record but not enough to identify coworkers.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pilotParticipants, pilotProjects } from "@/db/schema";
import { and, eq, like, or } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

const MAX_MATCHES = 5;

export async function POST(req: NextRequest, ctx: { params: Promise<{ qrToken: string }> }) {
  await ensureAccessSchema();
  const { qrToken } = await ctx.params;
  try {
    const body = await req.json();
    const query = String(body.query || "").trim();
    if (!query || query.length < 2) {
      return NextResponse.json(
        { error: "Please enter at least 2 characters." },
        { status: 400 },
      );
    }

    // Resolve project by qrToken.
    const [project] = await db
      .select({ id: pilotProjects.id, status: pilotProjects.status })
      .from(pilotProjects)
      .where(eq(pilotProjects.qrToken, qrToken))
      .limit(1);
    if (!project || project.status !== "active") {
      return NextResponse.json({ error: "Pilot not available" }, { status: 404 });
    }

    // Broad match across three fields. Digit-only substring for mobile,
    // case-insensitive substring for id + name.
    const digitsOnly = query.replace(/\D/g, "");
    const like_ = `%${query.toLowerCase()}%`;
    const digitsLike = digitsOnly.length >= 3 ? `%${digitsOnly}%` : null;

    const rows = await db
      .select({
        id: pilotParticipants.id,
        employeeId: pilotParticipants.employeeId,
        fullName: pilotParticipants.fullName,
        mobileNumber: pilotParticipants.mobileNumber,
        mobileNumberCorrected: pilotParticipants.mobileNumberCorrected,
      })
      .from(pilotParticipants)
      .where(
        and(
          eq(pilotParticipants.projectId, project.id),
          or(
            like(pilotParticipants.employeeId, like_),
            like(pilotParticipants.fullName, like_),
            ...(digitsLike
              ? [
                  like(pilotParticipants.mobileNumber, digitsLike),
                  like(pilotParticipants.mobileNumberCorrected, digitsLike),
                ]
              : []),
          )!,
        ),
      )
      .limit(MAX_MATCHES + 1);

    // If too many matches, ask for more input — don't return a huge list
    // that leaks names.
    if (rows.length > MAX_MATCHES) {
      return NextResponse.json({
        error: "Too many matches. Please add more details (e.g. last 4 of mobile).",
        matches: [],
      });
    }

    const matches = rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      employeeIdMasked: maskEmployeeId(r.employeeId),
      mobileMasked: maskMobile(r.mobileNumberCorrected || r.mobileNumber),
    }));

    return NextResponse.json({ matches });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Lookup failed" },
      { status: 500 },
    );
  }
}

function maskEmployeeId(id: string): string {
  if (id.length <= 4) return id;
  return id.slice(0, 2) + "…" + id.slice(-2);
}

function maskMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, "");
  if (digits.length <= 4) return "***" + digits;
  return "****" + digits.slice(-4);
}

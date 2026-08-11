import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  courtesyCallHistory, clientProfiles, users as usersTable,
} from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET  /api/accounts/[id]/courtesy-calls   → list history (newest first)
 * POST /api/accounts/[id]/courtesy-calls   → log a new call
 *   body: { callDate: 'YYYY-MM-DD', notes?: string }
 *   Also updates clientProfiles.lastCourtesyCall to whichever date is latest.
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const isAdmin = (session.user as any).role === "admin";
    const allowed = await canAccessClient({ userId: session.user.id, isAdmin }, params.id);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const rows = await db
      .select({
        id: courtesyCallHistory.id,
        callDate: courtesyCallHistory.callDate,
        loggedByUserId: courtesyCallHistory.loggedByUserId,
        loggedByName: usersTable.name,
        notes: courtesyCallHistory.notes,
        createdAt: courtesyCallHistory.createdAt,
        momSentDate: courtesyCallHistory.momSentDate,
        periodLabel: courtesyCallHistory.periodLabel,
        plannedStart: courtesyCallHistory.plannedStart,
        plannedEnd: courtesyCallHistory.plannedEnd,
        complianceStatus: courtesyCallHistory.complianceStatus,
        rmUserId: courtesyCallHistory.rmUserId,
      })
      .from(courtesyCallHistory)
      .leftJoin(usersTable, eq(usersTable.id, courtesyCallHistory.loggedByUserId))
      .where(eq(courtesyCallHistory.clientProfileId, params.id))
      .orderBy(desc(courtesyCallHistory.callDate));

    // Resolve the account's expected cadence from tier / frequencyOverride so
    // the UI does not re-implement the policy. Reuses the same helper the
    // executive summary and Arima already use, so the three cannot disagree.
    const prof = await db
      .select({ tier: clientProfiles.tier, frequencyOverride: clientProfiles.frequencyOverride })
      .from(clientProfiles).where(eq(clientProfiles.id, params.id)).limit(1);

    let cadence: { label: string; days: number | null; source: string } = { label: "—", days: null, source: "unknown" };
    let tierMap: any = {};
    try {
      const { loadTierFrequencyMap, resolveAccountFrequency } = await import("@/lib/accounts/tier-frequency");
      tierMap = await loadTierFrequencyMap();
      cadence = resolveAccountFrequency({
        tier: prof[0]?.tier, frequencyOverride: prof[0]?.frequencyOverride, tierMap,
      });
    } catch (e) {
      console.error("[courtesy-calls GET] cadence resolve failed", e);
    }

    // Evidence links, grouped by call. Only links are stored — never images.
    let evidence: Record<string, any[]> = {};
    try {
      const { courtesyCallEvidence } = await import("@/db/schema");
      const ids = rows.map(r => r.id);
      if (ids.length) {
        const { inArray } = await import("drizzle-orm");
        const ev = await db.select().from(courtesyCallEvidence)
          .where(inArray(courtesyCallEvidence.courtesyCallId, ids));
        for (const e of ev) {
          (evidence[e.courtesyCallId] ||= []).push({
            id: e.id, kind: e.kind, link: e.driveWebViewLink,
            fileName: e.fileName, uploadedVia: e.uploadedVia,
          });
        }
      }
    } catch (e) {
      console.error("[courtesy-calls GET] evidence load failed", e);
    }

    // Build the year's PERIOD slots and merge in what has been recorded, so the
    // tab shows every slot — including future ones, letting an RM record an
    // invitation already sent for next month. This is the shape the personnel
    // metrics need ("planned vs completed"), not a list of calls.
    const year = Number(new URL(_.url).searchParams.get("year")) || new Date().getFullYear();
    let periods: any[] = [];
    try {
      const { periodsForYear, periodCompliance } = await import("@/lib/courtesy/periods");
      const { tierIntervals } = await import("@/lib/courtesy/tier-history");
      const { resolveAccountFrequency: resolveFreq } = await import("@/lib/accounts/tier-frequency");

      // Tier moves (reviewed quarterly), and tier drives cadence — so a year can
      // contain more than one cadence. Build the slots for each interval that
      // overlaps this year and judge each period against the cadence that was
      // actually in force, otherwise a promotion silently rewrites past scores.
      const intervals = await tierIntervals(params.id);
      const yStart = `${year}-01-01`, yEnd = `${year}-12-31`;
      const overlapping = intervals.filter(iv =>
        iv.effectiveFrom <= yEnd && (!iv.effectiveTo || iv.effectiveTo >= yStart));

      let slots: any[] = [];
      if (overlapping.length <= 1) {
        slots = periodsForYear(year, cadence.label);
      } else {
        const seen = new Set<string>();
        for (const iv of overlapping) {
          const ivCad = resolveFreq({ tier: iv.tier, frequencyOverride: iv.frequencyOverride, tierMap });
          for (const sl of periodsForYear(year, ivCad.label)) {
            // A slot belongs to the interval its window opens inside.
            const from = iv.effectiveFrom > yStart ? iv.effectiveFrom : yStart;
            const to = iv.effectiveTo && iv.effectiveTo < yEnd ? iv.effectiveTo : yEnd;
            if (sl.start >= from && sl.start <= to && !seen.has(sl.label)) {
              seen.add(sl.label);
              slots.push({ ...sl, tierAtTime: iv.tier, cadenceAtTime: ivCad.label });
            }
          }
        }
        slots.sort((a, b) => a.start.localeCompare(b.start));
      }
      const byPeriod = new Map(rows.filter(r => r.periodLabel).map(r => [r.periodLabel, r]));
      // Calls logged before periods existed have no label — attach them to the
      // slot their date falls in so history is not orphaned.
      const unlabelled = rows.filter(r => !r.periodLabel && r.callDate);
      periods = slots.map(slot => {
        const rec = byPeriod.get(slot.label)
          || unlabelled.find(r => r.callDate! >= slot.start && r.callDate! <= slot.end)
          || null;
        return {
          ...slot,
          callId: rec?.id ?? null,
          callDate: rec?.callDate ?? null,
          momSentDate: rec?.momSentDate ?? null,
          notes: rec?.notes ?? null,
          loggedByName: rec?.loggedByName ?? null,
          status: periodCompliance({
            slot, callDate: rec?.callDate, momSentDate: rec?.momSentDate,
          }),
        };
      });
    } catch (e) {
      console.error("[courtesy-calls GET] period build failed", e);
    }

    return NextResponse.json({ history: rows, cadence, evidence, periods, year });
  } catch (error: any) {
    console.error("[courtesy-calls GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const isAdmin = (session.user as any).role === "admin";
    const allowed = await canAccessClient({ userId: session.user.id, isAdmin }, params.id);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const callDate = String(body?.callDate || "").trim();
    if (!callDate || !/^\d{4}-\d{2}-\d{2}$/.test(callDate)) {
      return NextResponse.json({ error: "callDate is required in YYYY-MM-DD format" }, { status: 400 });
    }

    const id = `cc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const momSentDate = typeof body?.momSentDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.momSentDate)
      ? body.momSentDate : null;
    if (momSentDate && momSentDate < callDate) {
      return NextResponse.json({ error: "The MOM date cannot be before the call date." }, { status: 400 });
    }

    // Stamp the period this call satisfies, derived from the account's cadence,
    // so "planned vs completed per period" is answerable without re-deriving.
    let periodLabel: string | null = null, plannedStart: string | null = null, plannedEnd: string | null = null;
    try {
      const prof2 = await db.select({ tier: clientProfiles.tier, frequencyOverride: clientProfiles.frequencyOverride })
        .from(clientProfiles).where(eq(clientProfiles.id, params.id)).limit(1);
      const { loadTierFrequencyMap, resolveAccountFrequency } = await import("@/lib/accounts/tier-frequency");
      const { periodForDate } = await import("@/lib/courtesy/periods");
      const cad = resolveAccountFrequency({
        tier: prof2[0]?.tier, frequencyOverride: prof2[0]?.frequencyOverride,
        tierMap: await loadTierFrequencyMap(),
      });
      const slot = periodForDate(callDate, cad.label);
      if (slot) { periodLabel = slot.label; plannedStart = slot.start; plannedEnd = slot.end; }
    } catch (e) {
      console.error("[courtesy-calls POST] period stamp failed", e);
    }

    await db.insert(courtesyCallHistory).values({
      id,
      clientProfileId: params.id,
      periodLabel, plannedStart, plannedEnd,
      callDate,
      momSentDate,
      // A period is only compliant once BOTH the call and its MOM are recorded.
      complianceStatus: momSentDate ? "compliant" : "incomplete",
      loggedByUserId: session.user.id,
      rmUserId: session.user.id,
      notes: typeof body?.notes === "string" ? body.notes.trim() || null : null,
      createdAt: now,
      updatedAt: now,
    } as any);

    // Update clientProfiles.lastCourtesyCall ONLY if this is newer than what's there
    const profile = await db
      .select({ lastCourtesyCall: clientProfiles.lastCourtesyCall })
      .from(clientProfiles)
      .where(eq(clientProfiles.id, params.id))
      .limit(1);
    const existing = profile[0]?.lastCourtesyCall;
    if (!existing || callDate > existing) {
      await db.update(clientProfiles)
        .set({ lastCourtesyCall: callDate, updatedAt: now })
        .where(eq(clientProfiles.id, params.id));
    }

    return NextResponse.json({ ok: true, id });
  } catch (error: any) {
    console.error("[courtesy-calls POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/accounts/[id]/courtesy-calls
 *   body: { callId: string, momSentDate?: 'YYYY-MM-DD'|null, notes?: string }
 * Updates one logged call — used by the Courtesy Calls tab to record the MOM
 * after the fact, which is the common case (the call is logged on the day, the
 * minutes go out later).
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const isAdmin = (session.user as any).role === "admin";
    const allowed = await canAccessClient({ userId: session.user.id, isAdmin }, params.id);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const callId = String(body?.callId || "").trim();
    if (!callId) return NextResponse.json({ error: "callId is required" }, { status: 400 });

    // Scope the lookup to this account so a callId from another account cannot
    // be edited by someone who merely has access to this one.
    const existing = await db.select()
      .from(courtesyCallHistory)
      .where(eq(courtesyCallHistory.id, callId))
      .limit(1);
    const row = existing[0];
    if (!row || row.clientProfileId !== params.id) {
      return NextResponse.json({ error: "Call not found on this account" }, { status: 404 });
    }

    const patch: Record<string, any> = { updatedAt: new Date().toISOString() };

    if ("momSentDate" in body) {
      const v = body.momSentDate;
      if (v === null || v === "") {
        patch.momSentDate = null;
        patch.complianceStatus = "incomplete";
      } else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        if (row.callDate && v < row.callDate) {
          return NextResponse.json({ error: "The MOM date cannot be before the call date." }, { status: 400 });
        }
        patch.momSentDate = v;
        // Late if the call itself missed its planned window, otherwise compliant.
        patch.complianceStatus = row.plannedEnd && row.callDate && row.callDate > row.plannedEnd
          ? "late" : "compliant";
      } else {
        return NextResponse.json({ error: "momSentDate must be YYYY-MM-DD or null" }, { status: 400 });
      }
    }

    if (typeof body?.notes === "string") patch.notes = body.notes.trim() || null;

    await db.update(courtesyCallHistory).set(patch as any)
      .where(eq(courtesyCallHistory.id, callId));

    return NextResponse.json({ ok: true, id: callId, ...patch });
  } catch (error: any) {
    console.error("[courtesy-calls PATCH]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { runPrototype, type PrototypeInputs } from "@/lib/proposal/prototype";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/proposal-maker/prototype-generate
 *
 * Admin-only debug endpoint. Runs the AI-driven proposal generator against
 * the configured template with a fixed-ish input bundle so we can evaluate
 * output quality before committing to the full F.2 architecture.
 *
 * Body (all optional — defaults to the Manpower Costing addendum scenario):
 *   { inputs?: Partial<PrototypeInputs> }
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const body = await req.json().catch(() => ({}));
    const inputs: PrototypeInputs = {
      clientCompanyName: "Twincom Asia Pacific",
      preparedBy: "Lester Alarcon",
      submittedTo: "Wilson Ngo",
      projectTitle: "Manpower Costing Module Addendum",
      isAddendum: true,
      scopeNotes: "Add an hourly-rate field to the Site Visit Personnel record, and convert Column Y (Duration Decimal) into a Labor Cost column that auto-computes Hourly Rate × Actual Time Spent per Site Visit. Integrate the Billing Module with a Basic Payroll Summary report for consolidated manpower-cost reporting and export.",
      standardRate: "P100 + VAT",
      discountedRate: "P75 + VAT",
      currentSubscriptionRate: "P225",
      combinedRate: "P300 + VAT",
      guaranteedUsers: "30 Users",
      totalCost: "P12,000.00 + VAT",
      timelineNotes: "Standard rollout, 6-week timeline starting late May 2026.",
      clientSignatoryName: "Wilson Ngo",
      clientSignatoryTitle: "COO",
      moiSignatoryName: "Lester Alarcon",
      moiSignatoryTitle: "CST Manager",
      ...(body?.inputs || {}),
    };

    const result = await runPrototype({
      inputs,
      clientProfileId: body?.clientProfileId || null,
      generatedByUserId: session.user.id,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[proposal-maker prototype-generate]", error);
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}

/**
 * Pilot Tracker — XLSX roster template download.
 *
 * GET /api/accounts/[id]/pilot-tracker/import/template
 *   → .xlsx binary with headers, example row, and inline notes.
 *
 * Content-Disposition triggers a browser download.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";
import { generateTemplate } from "@/lib/pilot/bulk-import";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureAccessSchema();
  const actor = {
    userId: session.user.id as string,
    isAdmin: (session.user as any).role === "admin",
  };
  if (!(await canAccessClient(actor, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const buffer = generateTemplate();
  // NextResponse wants BodyInit — a Buffer works at runtime but the type
  // signature doesn't accept it. Cast through Uint8Array (which does).
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pilot-roster-template.xlsx"`,
      "Content-Length": String(buffer.length),
    },
  });
}

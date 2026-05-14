import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { generateBrdDocument } from "@/lib/arima/brd-generator";

export const dynamic = "force-dynamic";

/**
 * POST /api/eliana/brds/[id]/generate
 *
 * Generate (or regenerate) the full Tarkie-structured BRD document from a
 * captured [BRD] summary. Writes the result to brdDocument on the row.
 * Any signed-in CST OS user can trigger this.
 */
export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const result = await generateBrdDocument({ requestId: params.id });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ ok: true, brdDocument: result.brdDocument });
  } catch (error: any) {
    console.error("[eliana/brds/generate]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

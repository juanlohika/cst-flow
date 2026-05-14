import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { exportBrdToGoogleDocs } from "@/lib/arima/google-docs-export";

export const dynamic = "force-dynamic";

/**
 * POST /api/eliana/brds/[id]/export
 *
 * Export the BRD document to Google Docs. Creates a new doc in the
 * configured Drive folder (or updates the existing one if already exported).
 * Returns the Google Doc URL.
 */
export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const result = await exportBrdToGoogleDocs({ requestId: params.id });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ ok: true, docId: result.docId, docUrl: result.docUrl });
  } catch (error: any) {
    console.error("[eliana/brds/export]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

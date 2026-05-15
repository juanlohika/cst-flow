import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { exportBrdToDrive } from "@/lib/arima/drive-export";

export const dynamic = "force-dynamic";

/**
 * POST /api/eliana/brds/[id]/export
 *
 * Export the BRD to Google Drive as TWO files:
 *   - .docx (editable; opens in Google Docs viewer when clicked)
 *   - .pdf  (read-only; what Eliana/ARIMA can share with clients)
 *
 * Returns both Drive webViewLinks. Replacing an existing export
 * updates the same files in place.
 */
export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const result = await exportBrdToDrive({ requestId: params.id });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({
      ok: true,
      docxUrl: result.docxUrl,
      pdfUrl: result.pdfUrl,
      docxFileId: result.docxFileId,
      pdfFileId: result.pdfFileId,
    });
  } catch (error: any) {
    console.error("[eliana/brds/export]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

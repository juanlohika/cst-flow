import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { courtesyCallHistory, courtesyCallEvidence, clientProfiles } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";
import {
  ensureAccountEvidenceFolder, uploadEvidence, evidenceFileName,
} from "@/lib/courtesy/drive";

export const dynamic = "force-dynamic";

// Screenshots are small; anything larger is almost certainly not a screenshot.
const MAX_BYTES = 8 * 1024 * 1024;
const OK_MIME = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

/**
 * POST /api/accounts/[id]/courtesy-calls/evidence
 *   multipart: file, callId, kind?
 *
 * Files an invitation screenshot into the account's Drive folder (created on
 * first use) and records ONLY the resulting link. The same path serves the
 * Courtesy Calls tab and Arima's Telegram handler, so the two cannot drift.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const isAdmin = (session.user as any).role === "admin";
    if (!(await canAccessClient({ userId: session.user.id, isAdmin }, params.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const callId = String(form.get("callId") || "").trim();
    const kind = String(form.get("kind") || "invitation").trim();

    // A periodLabel may be sent INSTEAD of a callId: an invitation exists before
    // the call happens, so evidence must be attachable to a period that has no
    // call record yet. We create the placeholder row on demand.
    const periodLabel = String(form.get("periodLabel") || "").trim();
    const plannedStart = String(form.get("plannedStart") || "").trim();
    const plannedEnd = String(form.get("plannedEnd") || "").trim();

    if (!(file instanceof File)) return NextResponse.json({ error: "No file supplied" }, { status: 400 });
    if (!callId && !periodLabel) {
      return NextResponse.json({ error: "Either callId or periodLabel is required" }, { status: 400 });
    }
    if (!OK_MIME.has(file.type)) {
      return NextResponse.json({ error: `Unsupported file type ${file.type || "unknown"}. Use PNG, JPEG, WebP or PDF.` }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File is ${(file.size / 1048576).toFixed(1)} MB — the limit is 8 MB.` }, { status: 400 });
    }

    // Resolve the call row. When only a period was given, find or create it —
    // callDate stays NULL, so the period is still correctly "not yet called"
    // while carrying the invitation that was already sent.
    let call: any = null;
    if (callId) {
      // Scope to THIS account so a callId from elsewhere can't be attached to.
      const rows = await db.select().from(courtesyCallHistory)
        .where(eq(courtesyCallHistory.id, callId)).limit(1);
      call = rows[0];
      if (!call || call.clientProfileId !== params.id) {
        return NextResponse.json({ error: "Call not found on this account" }, { status: 404 });
      }
    } else {
      const existing = await db.select().from(courtesyCallHistory)
        .where(and(
          eq(courtesyCallHistory.clientProfileId, params.id),
          eq(courtesyCallHistory.periodLabel, periodLabel),
        )).limit(1);
      call = existing[0] || null;
      if (!call) {
        const newId = `cc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const now = new Date().toISOString();
        await db.insert(courtesyCallHistory).values({
          id: newId,
          clientProfileId: params.id,
          periodLabel,
          plannedStart: plannedStart || null,
          plannedEnd: plannedEnd || null,
          callDate: null,             // nothing has happened yet — only the invite exists
          momSentDate: null,
          complianceStatus: "pending",
          loggedByUserId: session.user.id,
          rmUserId: session.user.id,
          createdAt: now, updatedAt: now,
        } as any);
        const back = await db.select().from(courtesyCallHistory)
          .where(eq(courtesyCallHistory.id, newId)).limit(1);
        call = back[0];
      }
    }

    const prof = await db.select({ name: clientProfiles.companyName, short: clientProfiles.clientShortName })
      .from(clientProfiles).where(eq(clientProfiles.id, params.id)).limit(1);
    const accountName = prof[0]?.short || prof[0]?.name || "Account";

    const folder = await ensureAccountEvidenceFolder({ accountName, accountId: params.id });
    const filename = evidenceFileName({
      // Prefer the call date; else the period's start, so a pre-call invitation
      // is still named for the period it belongs to rather than 'today'.
      date: call.callDate || call.plannedStart || new Date().toISOString().slice(0, 10),
      kind, accountName, mimeType: file.type,
    });

    const up = await uploadEvidence({
      folderId: folder.folderId,
      buffer: Buffer.from(await file.arrayBuffer()),
      filename,
      mimeType: file.type,
    });

    const id = `cce_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    await db.insert(courtesyCallEvidence).values({
      id,
      courtesyCallId: callId,
      kind,
      driveFileId: up.fileId,
      driveWebViewLink: up.webViewLink,
      fileName: filename,
      uploadedVia: "web",
      uploadedByUserId: session.user.id,
      createdAt: new Date().toISOString(),
    } as any);

    return NextResponse.json({
      ok: true, id, link: up.webViewLink, fileName: filename,
      folderCreated: folder.created, folderUrl: folder.folderUrl,
    });
  } catch (error: any) {
    console.error("[courtesy evidence POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** DELETE ?evidenceId=… — removes the row. The Drive file is left in place. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const isAdmin = (session.user as any).role === "admin";
    if (!(await canAccessClient({ userId: session.user.id, isAdmin }, params.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const evidenceId = new URL(req.url).searchParams.get("evidenceId") || "";
    if (!evidenceId) return NextResponse.json({ error: "evidenceId is required" }, { status: 400 });

    // Confirm it belongs to a call on this account before removing it.
    const ev = await db.select().from(courtesyCallEvidence)
      .where(eq(courtesyCallEvidence.id, evidenceId)).limit(1);
    if (!ev[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const call = await db.select({ acct: courtesyCallHistory.clientProfileId })
      .from(courtesyCallHistory).where(eq(courtesyCallHistory.id, ev[0].courtesyCallId)).limit(1);
    if (call[0]?.acct !== params.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.delete(courtesyCallEvidence).where(eq(courtesyCallEvidence.id, evidenceId));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[courtesy evidence DELETE]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

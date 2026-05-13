import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientContacts, clientProfiles as clientProfilesTable } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { createMagicLink, buildMagicLinkUrl } from "@/lib/portal/auth";
import { getSmtpTransport } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * POST /api/accounts/[id]/contacts/[contactId]/invite (admin only)
 * Generates a magic link + sends it via email.
 */
export async function POST(req: Request, { params }: { params: { id: string; contactId: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    // Verify contact belongs to this account
    const rows = await db
      .select({
        id: clientContacts.id,
        name: clientContacts.name,
        email: clientContacts.email,
        clientProfileId: clientContacts.clientProfileId,
        companyName: clientProfilesTable.companyName,
      })
      .from(clientContacts)
      .leftJoin(clientProfilesTable, eq(clientProfilesTable.id, clientContacts.clientProfileId))
      .where(and(
        eq(clientContacts.id, params.contactId),
        eq(clientContacts.clientProfileId, params.id)
      ))
      .limit(1);

    const contact = rows[0];
    if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

    // Generate magic link
    const { token, expiresAt } = await createMagicLink({
      contactId: contact.id,
      contactEmail: contact.email,
      createdByUserId: session.user.id,
    });

    // Build the URL using the request host (most reliable)
    const hdrs = req.headers;
    const forwardedHost = hdrs.get("x-forwarded-host") || hdrs.get("host") || "";
    const host = forwardedHost.split(":")[0];
    const envBase = process.env.PUBLIC_BASE_URL || process.env.AUTH_URL;
    const baseUrl = envBase || (host ? `https://${host}` : "");
    const magicUrl = buildMagicLinkUrl(token, baseUrl);

    // Mark contact as invited
    const now = new Date().toISOString();
    await db.update(clientContacts)
      .set({ status: "invited", invitedAt: now, updatedAt: now })
      .where(eq(clientContacts.id, contact.id));

    // Send the onboarding email using the shared SMTP helper
    // (reads from DB globalSettings first, then env vars — same path the test-email button uses)
    let emailSent = false;
    let emailError: string | null = null;
    try {
      const smtp = await getSmtpTransport();
      if (!smtp) {
        emailError = "SMTP is not configured. Go to Admin → Credentials → Email Service to set it up, or copy the magic link manually.";
      } else {
        await smtp.transport.sendMail({
          from: `"ARIMA · Tarkie" <${smtp.from}>`,
          to: contact.email,
          subject: `You're invited to chat with the ${contact.companyName || "CST"} team on ARIMA`,
          html: buildInviteHtml({
            contactName: contact.name,
            companyName: contact.companyName || "your account",
            magicUrl,
            expiresAt,
          }),
          text: `Hi ${contact.name},\n\nThe team at ${contact.companyName || "your account"} has invited you to a shared conversation on ARIMA — a group chat where you can reach the CST team directly, with an AI assistant in between.\n\nJoin the conversation: ${magicUrl}\n\nThis link expires on ${new Date(expiresAt).toLocaleDateString()}.`,
        });
        emailSent = true;
      }
    } catch (mailErr: any) {
      emailError = mailErr?.message || "Email send failed";
      console.warn("[invite] email send failed:", emailError);
    }

    return NextResponse.json({
      ok: true,
      magicUrl,         // returned to admin so they can copy it as a backup
      emailSent,
      emailError,
      expiresAt,
    });
  } catch (error: any) {
    console.error("[invite POST] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function buildInviteHtml(args: { contactName: string; companyName: string; magicUrl: string; expiresAt: string }) {
  const expiresStr = new Date(args.expiresAt).toLocaleDateString();
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#050F27;background:#F0F4FC;">
  <div style="background:#fff;border-radius:20px;padding:32px 28px;box-shadow:0 4px 16px rgba(1,119,181,0.06);">
    <div style="text-align:center;margin-bottom:20px;">
      <div style="display:inline-block;width:52px;height:52px;background:linear-gradient(135deg,#0177b5,#015a9c);border-radius:14px;line-height:52px;color:#fff;font-size:24px;font-weight:bold;">♥</div>
      <p style="margin:8px 0 0;font-size:10px;font-weight:800;letter-spacing:2px;color:#0177b5;">ARIMA · POWERED BY TARKIE</p>
    </div>
    <h1 style="font-size:22px;font-weight:800;margin:0 0 14px;text-align:center;color:#050F27;">You're invited to chat with the team</h1>
    <p style="font-size:15px;line-height:1.6;color:#1E2933;margin:0 0 14px;">
      Hi ${escape_(args.contactName)},
    </p>
    <p style="font-size:15px;line-height:1.6;color:#1E2933;margin:0 0 14px;">
      The team at <strong>${escape_(args.companyName)}</strong> has invited you to a shared conversation in <strong>ARIMA</strong> — a unified group chat where you can reach the CST team directly and an AI assistant helps in between.
    </p>
    <p style="font-size:15px;line-height:1.6;color:#1E2933;margin:0 0 24px;">
      You'll be able to ask questions, request changes, share screenshots, and schedule meetings. Anything you send goes straight to the team. Type <strong>@arima</strong> if you want the AI to step in.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${args.magicUrl}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#0177b5,#015a9c);color:#fff;font-weight:700;text-decoration:none;border-radius:12px;font-size:14px;box-shadow:0 4px 14px rgba(1,119,181,0.3);">
        Join the conversation →
      </a>
    </div>
    <p style="font-size:13px;line-height:1.5;color:#284f9b;margin:0 0 8px;">
      This link is unique to you and expires on <strong>${expiresStr}</strong>. After clicking it once, your session stays active for 30 days on this device.
    </p>
    <p style="font-size:13px;line-height:1.5;color:#284f9b;margin:0 0 16px;">
      If the button doesn't work, copy and paste this URL into your browser:<br />
      <code style="font-size:11px;color:#0177b5;word-break:break-all;">${args.magicUrl}</code>
    </p>
    <hr style="border:none;border-top:1px solid #F0F4FC;margin:24px 0;" />
    <p style="font-size:11px;color:#284f9b;text-align:center;margin:0;">
      Didn't expect this email? You can ignore it safely — the link only works if someone has it.
    </p>
  </div>
</div>
  `;
}

function escape_(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" } as any)[c]);
}

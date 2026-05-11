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
          from: `"ARIMA" <${smtp.from}>`,
          to: contact.email,
          subject: `ARIMA — your direct line to the ${contact.companyName || "CST"} team`,
          html: buildInviteHtml({
            contactName: contact.name,
            companyName: contact.companyName || "your account",
            magicUrl,
            expiresAt,
          }),
          text: `Hi ${contact.name},\n\nYour account team has set up ARIMA for ${contact.companyName || "your account"}.\n\nOpen ARIMA: ${magicUrl}\n\nThis link expires on ${new Date(expiresAt).toLocaleDateString()}.`,
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
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1e293b;">
  <div style="text-align:center;margin-bottom:24px;">
    <div style="display:inline-block;width:48px;height:48px;background:linear-gradient(135deg,#fb7185,#ec4899);border-radius:16px;line-height:48px;color:#fff;font-size:24px;">♥</div>
  </div>
  <h1 style="font-size:20px;font-weight:800;margin:0 0 12px;text-align:center;">Hi ${escape_(args.contactName)},</h1>
  <p style="font-size:15px;line-height:1.55;color:#475569;margin:0 0 16px;">
    Your account team has set up <strong>ARIMA</strong>, an AI Relationship Manager for ${escape_(args.companyName)}.
  </p>
  <p style="font-size:15px;line-height:1.55;color:#475569;margin:0 0 24px;">
    ARIMA can help you with general inquiries, capture requests, schedule meetings, and route everything to the right person on the CST team. A real human is always behind ARIMA for anything sensitive.
  </p>
  <div style="text-align:center;margin:32px 0;">
    <a href="${args.magicUrl}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#fb7185,#ec4899);color:#fff;font-weight:700;text-decoration:none;border-radius:12px;font-size:14px;">
      Open ARIMA →
    </a>
  </div>
  <p style="font-size:13px;line-height:1.5;color:#64748b;margin:0 0 8px;">
    This link is unique to you and expires on <strong>${expiresStr}</strong>. After clicking it, your session stays active for 30 days on the device you used.
  </p>
  <p style="font-size:13px;line-height:1.5;color:#64748b;margin:0 0 16px;">
    If the button doesn't work, copy and paste this URL into your browser:<br />
    <code style="font-size:11px;color:#475569;word-break:break-all;">${args.magicUrl}</code>
  </p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
  <p style="font-size:11px;color:#94a3b8;text-align:center;margin:0;">
    Didn't expect this email? You can ignore it safely — the link only works if someone has it.
  </p>
</div>
  `;
}

function escape_(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" } as any)[c]);
}

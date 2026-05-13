import { NextResponse } from "next/server";
import { db } from "@/db";
import { clientContacts, clientProfiles as clientProfilesTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { createMagicLink, buildMagicLinkUrl } from "@/lib/portal/auth";
import { getSmtpTransport } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/auth/resend
 * Body: { email }
 *
 * Public, self-service endpoint. If `email` matches an active ClientContact,
 * we email them a fresh magic link. The response is intentionally generic so
 * an attacker can't probe which emails are registered contacts.
 *
 * Rate-limiting is informal — relies on SMTP throughput to discourage abuse.
 * Add a real rate limiter later if this becomes a target.
 */
export async function POST(req: Request) {
  try {
    await ensureAccessSchema();
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ ok: true, message: "If that email is on file, you'll receive a fresh link shortly." });
    }

    const rows = await db
      .select({
        id: clientContacts.id,
        name: clientContacts.name,
        email: clientContacts.email,
        status: clientContacts.status,
        clientProfileId: clientContacts.clientProfileId,
        companyName: clientProfilesTable.companyName,
      })
      .from(clientContacts)
      .leftJoin(clientProfilesTable, eq(clientProfilesTable.id, clientContacts.clientProfileId))
      .where(eq(clientContacts.email, email))
      .limit(1);
    const contact = rows[0];

    if (!contact || contact.status === "revoked") {
      // Always return the same response so we don't leak which emails are real
      return NextResponse.json({ ok: true, message: "If that email is on file, you'll receive a fresh link shortly." });
    }

    const { token, expiresAt } = await createMagicLink({
      contactId: contact.id,
      contactEmail: contact.email,
    });

    const hdrs = req.headers;
    const forwardedHost = hdrs.get("x-forwarded-host") || hdrs.get("host") || "";
    const host = forwardedHost.split(":")[0];
    const envBase = process.env.PUBLIC_BASE_URL || process.env.AUTH_URL;
    const baseUrl = envBase || (host ? `https://${host}` : "");
    const magicUrl = buildMagicLinkUrl(token, baseUrl);

    try {
      const smtp = await getSmtpTransport();
      if (smtp) {
        await smtp.transport.sendMail({
          from: `"ARIMA · Tarkie" <${smtp.from}>`,
          to: contact.email,
          subject: `Your fresh ARIMA access link`,
          html: buildResendHtml({
            contactName: contact.name,
            companyName: contact.companyName || "your account",
            magicUrl,
            expiresAt,
          }),
          text: `Hi ${contact.name},\n\nHere's a fresh link to get back into your ARIMA conversation with the ${contact.companyName || "CST"} team:\n\n${magicUrl}\n\nThis link expires on ${new Date(expiresAt).toLocaleDateString()} and works once. Your full conversation history will be there.`,
        });
      }
    } catch (mailErr: any) {
      console.warn("[portal/auth/resend] email failed:", mailErr?.message);
      // Still return ok — don't leak SMTP status
    }

    return NextResponse.json({ ok: true, message: "If that email is on file, you'll receive a fresh link shortly." });
  } catch (error: any) {
    console.error("[portal/auth/resend] error:", error);
    // Don't leak — return ok
    return NextResponse.json({ ok: true, message: "If that email is on file, you'll receive a fresh link shortly." });
  }
}

function buildResendHtml(args: { contactName: string; companyName: string; magicUrl: string; expiresAt: string }) {
  const expiresStr = new Date(args.expiresAt).toLocaleDateString();
  const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" } as any)[c]);
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#050F27;background:#F0F4FC;">
  <div style="background:#fff;border-radius:20px;padding:32px 28px;box-shadow:0 4px 16px rgba(1,119,181,0.06);">
    <div style="text-align:center;margin-bottom:20px;">
      <div style="display:inline-block;width:52px;height:52px;background:linear-gradient(135deg,#0177b5,#015a9c);border-radius:14px;line-height:52px;color:#fff;font-size:24px;font-weight:bold;">♥</div>
      <p style="margin:8px 0 0;font-size:10px;font-weight:800;letter-spacing:2px;color:#0177b5;">ARIMA · POWERED BY TARKIE</p>
    </div>
    <h1 style="font-size:20px;font-weight:800;margin:0 0 14px;text-align:center;color:#050F27;">Here's your fresh access link</h1>
    <p style="font-size:15px;line-height:1.6;color:#1E2933;margin:0 0 14px;">Hi ${escape(args.contactName)},</p>
    <p style="font-size:15px;line-height:1.6;color:#1E2933;margin:0 0 24px;">
      You requested a new link to get back into your ARIMA conversation with the <strong>${escape(args.companyName)}</strong> team. Your full chat history is still there waiting for you.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${args.magicUrl}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#0177b5,#015a9c);color:#fff;font-weight:700;text-decoration:none;border-radius:12px;font-size:14px;box-shadow:0 4px 14px rgba(1,119,181,0.3);">
        Open ARIMA →
      </a>
    </div>
    <p style="font-size:13px;line-height:1.5;color:#284f9b;margin:0 0 8px;">
      This link is unique to you and expires on <strong>${expiresStr}</strong>. It works once — after that, your device stays signed in for 6 months.
    </p>
    <hr style="border:none;border-top:1px solid #F0F4FC;margin:24px 0;" />
    <p style="font-size:11px;color:#284f9b;text-align:center;margin:0;">
      Didn't request this? You can ignore the email safely.
    </p>
  </div>
</div>
  `;
}

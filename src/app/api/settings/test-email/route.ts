import { NextResponse } from "next/server";
import { auth } from "@/auth";
import nodemailer from "nodemailer";
import { db } from "@/db";
import { globalSettings as globalSettingsTable } from "@/db/schema";

export const dynamic = "force-dynamic";

/** 
 * POST /api/settings/test-email 
 * MIGRATED TO DRIZZLE
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized or missing email profile" }, { status: 401 });
    }
    if ((session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let cfg: Record<string, string> = {};
    let appName = "Team OS";

    // 1. Load Settings From DB
    try {
      const settings = await db.select().from(globalSettingsTable);
      settings.forEach(s => { 
        if (s.key && s.value) cfg[s.key] = s.value; 
      });
      appName = cfg.app_name || appName;
    } catch (err: any) {
      console.warn("DB Read failed in test-email:", err.message);
    }

    // 2. Resolve SMTP Config (DB takes priority over Env)
    const host   = cfg.smtp_host || cfg.smtpHost || process.env.SMTP_HOST;
    let portRaw  = cfg.smtp_port || cfg.smtpPort || process.env.SMTP_PORT || "587";
    const port   = isNaN(parseInt(portRaw)) ? 587 : parseInt(portRaw);
    const secure = (cfg.smtp_secure || cfg.smtpSecure) === "true" || process.env.SMTP_SECURE === "true";
    const user   = cfg.smtp_user || cfg.smtpUser || process.env.SMTP_USER;
    const pass   = cfg.smtp_pass || cfg.smtpPass || process.env.SMTP_PASS;
    const from   = cfg.smtp_from || cfg.smtpFrom || process.env.SMTP_FROM || user;
    const to     = session.user.email;

    if (!host || !user || !pass) {
      return NextResponse.json({ 
        error: "SMTP is not fully configured. Please provide Host, Username, and Password in Settings -> Email." 
      }, { status: 400 });
    }

    // 3. Send via Nodemailer
    const transport = nodemailer.createTransport({ 
      host, 
      port, 
      secure, 
      auth: { user, pass },
      tls: { rejectUnauthorized: false } // Avoid issues with self-signed certs in enterprise envs
    });

    await transport.sendMail({
      from: `"${appName}" <${from}>`,
      to,
      subject: `✓ ${appName} SMTP Connection Test`,
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;padding:32px;background:#f9fafb;color:#1f2937;">
          <div style="max-width:480px;margin:0 auto;background:white;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1);border:1px solid #e5e7eb;">
            <div style="font-size:24px;font-weight:700;color:#111827;margin-bottom:12px;">Email Service Connected!</div>
            <p style="font-size:14px;line-height:1.6;color:#4b5563;">
              Your <strong>${appName}</strong> email configuration has been verified. 
              Future notifications and project updates will be delivered from:
            </p>
            <div style="background:#f3f4f6;padding:12px;border-radius:8px;font-family:monospace;font-size:13px;margin:20px 0;">
              ${from}
            </div>
            <p style="font-size:12px;color:#9ca3af;margin-top:24px;">Sent to ${to} at ${new Date().toLocaleString()}</p>
          </div>
        </div>
      `,
      text: `Your ${appName} email configuration is working!`,
    });

    return NextResponse.json({ success: true, to });

  } catch (error: any) {
    console.error("Test Email Error:", error);
    return NextResponse.json({ 
      error: error.message || "An unexpected error occurred while sending the test email.",
      code: error.code
    }, { status: 500 });
  }
}


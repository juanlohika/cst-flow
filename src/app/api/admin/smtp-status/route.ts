import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSmtpConfig, getSmtpTransport } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/smtp-status — admin-only
 * Returns whether SMTP is configured and where each setting came from (DB vs env vs default).
 * Used by the Email Service card to confirm config is being picked up correctly.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const cfg = await getSmtpConfig();
    const smtp = await getSmtpTransport();

    return NextResponse.json({
      configured: !!smtp,
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      user: cfg.user ? `${cfg.user.slice(0, 3)}***${cfg.user.split("@")[1] ? "@" + cfg.user.split("@")[1] : ""}` : null,
      from: cfg.from,
      hasPassword: !!cfg.pass,
    });
  } catch (error: any) {
    console.error("[admin/smtp-status] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

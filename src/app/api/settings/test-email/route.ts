import { NextResponse } from "next/server";
import { auth } from "@/auth";
import nodemailer from "nodemailer";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

const SETTINGS_FILE = path.join(process.cwd(), "config.json");

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let cfg: Record<string, any> = {};
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf-8");
    cfg = JSON.parse(raw);
  } catch {}

  const host   = cfg.smtpHost   || process.env.SMTP_HOST;
  const port   = parseInt(cfg.smtpPort || process.env.SMTP_PORT || "587");
  const secure = cfg.smtpSecure != null ? cfg.smtpSecure : (process.env.SMTP_SECURE === "true");
  const user   = cfg.smtpUser   || process.env.SMTP_USER;
  const pass   = cfg.smtpPass   || process.env.SMTP_PASS;
  const from   = cfg.smtpFrom   || process.env.SMTP_FROM || user;
  const to     = session.user.email!;

  if (!host || !user || !pass) {
    return NextResponse.json({ error: "SMTP not configured. Fill in Host, Username, and Password." }, { status: 400 });
  }

  // Fetch dynamic branding
  let appName = "Team OS";
  try {
    const { prisma } = await import("@/lib/prisma");
    const setting = await (prisma as any).globalSetting.findUnique({ where: { key: "app_name" } });
    if (setting?.value) appName = setting.value;
  } catch {}

  try {
    const transport = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
    await transport.sendMail({
      from: `"${appName}" <${from}>`,
      to,
      subject: `${appName} SMTP Test ✓`,
      html: `<div style="font-family:Inter,sans-serif;padding:32px;background:#f7f7f5;"><div style="max-width:480px;margin:0 auto;background:white;border-radius:12px;padding:32px;border:1px solid #E9EAEB;"><div style="font-size:24px;font-weight:700;color:#252B37;margin-bottom:12px;">✓ SMTP is working!</div><p style="color:#535862;font-size:14px;line-height:1.6;">Your ${appName} email configuration is set up correctly. Invite emails will be delivered from <strong>${from}</strong>.</p></div></div>`,
      text: `SMTP is working! Your ${appName} email configuration is set up correctly.`,
    });
    return NextResponse.json({ success: true, to });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}


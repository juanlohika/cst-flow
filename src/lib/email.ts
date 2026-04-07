import nodemailer from "nodemailer";
import fs from "fs/promises";
import path from "path";



const SETTINGS_FILE = path.join(process.cwd(), "config.json");
const APP_URL = process.env.AUTH_URL || process.env.NEXTAUTH_URL || "https://cst-flow--cst-flowdesk.asia-east1.hosted.app";

/* ─── Global Settings ────────────────────────────────────────── */
async function getGlobalSettings() {
  try {
    const { db } = await import("@/db");
    const { globalSettings } = await import("@/db/schema");
    
    const settings = await db.select().from(globalSettings);
    
    const config: Record<string, string> = {};
    settings.forEach((s: any) => {
      config[s.key] = s.value;
    });
    
    return {
      appName: config.app_name || "CST OS",
      logoUrl: config.bottom_logo_url || config.company_logo || ""
    };
  } catch (error) {
    console.error("error fetching global settings for email:", error);
    return { appName: "CST OS", logoUrl: "" };
  }
}


/* ─── SMTP config: GlobalSetting DB > env vars ────────────────────── */
async function getSmtpConfig() {
  const cfg: Record<string, any> = {};
  try {
    const { db } = await import("@/db");
    const { globalSettings } = await import("@/db/schema");
    const settings = await db.select().from(globalSettings);
    settings.forEach(s => { cfg[s.key] = s.value; });
  } catch (err) {
    console.warn("SMTP config read error:", err);
  }
  return {
    host:   (cfg.smtpHost || process.env.SMTP_HOST || "smtp.gmail.com").replace("smpt", "smtp"),
    port:   parseInt(cfg.smtpPort || process.env.SMTP_PORT || "587"),
    secure: cfg.smtpSecure === "true" || process.env.SMTP_SECURE === "true",
    user:   cfg.smtpUser   || process.env.SMTP_USER,
    pass:   cfg.smtpPass   || process.env.SMTP_PASS,
    from:   cfg.smtpFrom   || process.env.SMTP_FROM || cfg.smtpUser || process.env.SMTP_USER || "noreply@tarkie.app",
  };
}

async function getTransport() {
  const { host, port, secure, user, pass } = await getSmtpConfig();
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

/* ─── Invite Email Template ──────────────────────────────────── */
function inviteEmailHtml({
  inviteeName,
  invitedByName,
  inviteUrl,
  appName,
  logoUrl,
}: {
  inviteeName: string;
  invitedByName: string;
  inviteUrl: string;
  appName: string;
  logoUrl: string;
}): string {
  // Lucide SVG paths
  const icons = {
    zap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pill-icon"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pill-icon"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pill-icon"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/><path d="m9 16 2 2 4-4"/></svg>`,
    dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pill-icon"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
    sparkles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pill-icon"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>`
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>You're invited to ${appName}</title>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #f7f7f5;
    color: #252B37;
    -webkit-font-smoothing: antialiased;
    padding: 48px 16px;
  }
  .wrapper { max-width: 560px; margin: 0 auto; }
  /* Card */
  .card {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #E9EAEB;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04);
  }
  /* Header */
  .card-header {
    padding: 24px 32px;
    border-bottom: 1px solid #F5F5F5;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .logo-mark {
    width: 32px; height: 32px;
    background: #2162F9;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .logo-dot {
    width: 8px; height: 8px;
    background: #44EB7C;
    border-radius: 50%;
    display: inline-block;
  }
  .logo-name {
    font-size: 16px;
    font-weight: 700;
    color: #252B37;
    letter-spacing: -0.3px;
  }
  .logo-sub {
    font-size: 13px;
    font-weight: 400;
    color: #717680;
    margin-left: 4px;
  }
  /* Body */
  .card-body { padding: 40px 32px; }
  .eyebrow {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #2162F9;
    margin-bottom: 12px;
  }
  .heading {
    font-size: 26px;
    font-weight: 700;
    color: #252B37;
    line-height: 1.25;
    letter-spacing: -0.5px;
    margin-bottom: 16px;
  }
  .text {
    font-size: 14px;
    font-weight: 400;
    color: #535862;
    line-height: 1.65;
    margin-bottom: 12px;
  }
  .text strong { color: #252B37; font-weight: 600; }
  /* Feature pills */
  .features {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 24px 0;
  }
  .feature-pill {
    background: #F1F7FF;
    border: 1px solid #DBEAFE;
    border-radius: 20px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 500;
    color: #2162F9;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .pill-icon {
    width: 13px; height: 13px;
    stroke-width: 2.5;
    flex-shrink: 0;
  }
  /* CTA */
  .cta-wrap { margin: 28px 0 24px; }
  .cta {
    display: inline-block;
    background: #2162F9;
    color: #ffffff !important;
    font-size: 14px;
    font-weight: 600;
    padding: 13px 28px;
    border-radius: 8px;
    text-decoration: none;
    letter-spacing: -0.1px;
  }
  .cta:hover { background: #1a52d4; }
  /* URL fallback */
  .url-fallback {
    background: #FAFAFA;
    border: 1px solid #E9EAEB;
    border-radius: 8px;
    padding: 12px 16px;
    margin-top: 20px;
  }
  .url-fallback p {
    font-size: 11px;
    color: #717680;
    margin-bottom: 4px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .url-fallback a {
    font-size: 12px;
    color: #2162F9;
    word-break: break-all;
    text-decoration: none;
  }
  /* Divider */
  .divider {
    height: 1px;
    background: #F5F5F5;
    margin: 28px 0;
  }
  /* What you get */
  .section-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: #717680;
    margin-bottom: 14px;
  }
  .module-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 28px;
  }
  .module-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    background: #FAFAFA;
    border: 1px solid #F5F5F5;
    border-radius: 8px;
    padding: 12px;
  }
    font-size: 14px;
    color: #2162F9;
  }
  .module-icon svg {
    width: 14px; height: 14px;
    stroke-width: 2;
  }
  .module-info .module-name {
    font-size: 12px;
    font-weight: 600;
    color: #252B37;
    line-height: 1.3;
  }
  .module-info .module-desc {
    font-size: 11px;
    color: #717680;
    line-height: 1.4;
    margin-top: 1px;
  }
  /* Footer */
  .card-footer {
    padding: 20px 32px;
    background: #FAFAFA;
    border-top: 1px solid #F5F5F5;
  }
  .footer-text {
    font-size: 11px;
    color: #717680;
    line-height: 1.6;
  }
  .footer-text a { color: #717680; text-decoration: underline; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="card">
    <!-- Header -->
    <div class="card-header">
      ${logoUrl ? `
        <img src="${logoUrl}" alt="${appName}" style="height: 32px; width: auto; object-contain: contain;" />
      ` : `
        <span class="logo-mark"><span class="logo-dot"></span></span>
        <span>
          <span class="logo-name">Tarkie</span>
          <span class="logo-sub">${appName}</span>
        </span>
      `}
    </div>

    <!-- Body -->
    <div class="card-body">
      <p class="eyebrow">Team Invitation</p>
      <h1 class="heading">You're invited to<br/>join the workspace</h1>

      <p class="text">
        <strong>${invitedByName}</strong> has invited ${inviteeName ? `<strong>${inviteeName}</strong>` : "you"} to collaborate on <strong>${appName}</strong> — a modern project management workspace built for teams that move fast.
      </p>

      <p class="text">Click below to accept your invitation and get started. Your account will be set up automatically on first login.</p>

      <!-- Features -->
      <div class="features">
        <span class="feature-pill">${icons.zap} Task Management</span>
        <span class="feature-pill">${icons.clock} Timelines</span>
        <span class="feature-pill">${icons.calendar} Meetings</span>
        <span class="feature-pill">${icons.dashboard} Dashboard</span>
        <span class="feature-pill">${icons.sparkles} AI Tools</span>
      </div>

      <!-- CTA -->
      <div class="cta-wrap">
        <a href="${inviteUrl}" class="cta">Accept Invitation →</a>
      </div>

      <!-- URL fallback -->
      <div class="url-fallback">
        <p>Or copy this link into your browser</p>
        <a href="${inviteUrl}">${inviteUrl}</a>
      </div>

      <div class="divider"></div>

      <!-- Module highlights -->
      <p class="section-label">What you'll have access to</p>
      <div class="module-grid">
        <div class="module-item">
          <div class="module-icon" style="background:#EFF6FF;">${icons.zap}</div>
          <div class="module-info">
            <div class="module-name">Task Manager</div>
            <div class="module-desc">SOD/EOD planning, Kanban boards, timelines</div>
          </div>
        </div>
        <div class="module-item">
          <div class="module-icon" style="background:#F0FDF4;">${icons.dashboard}</div>
          <div class="module-info">
            <div class="module-name">Dashboard</div>
            <div class="module-desc">Man-hours monitoring, workload heatmap</div>
          </div>
        </div>
        <div class="module-item">
          <div class="module-icon" style="background:#FDF4FF;">${icons.calendar}</div>
          <div class="module-info">
            <div class="module-name">Meetings Hub</div>
            <div class="module-desc">AI prep, live transcription, minutes</div>
          </div>
        </div>
        <div class="module-item">
          <div class="module-icon" style="background:#FFF7ED;">${icons.sparkles}</div>
          <div class="module-info">
            <div class="module-name">AI Planning</div>
            <div class="module-desc">Smart scheduling, conflict detection</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="card-footer">
      <p class="footer-text">
        This invitation link expires in <strong>7 days</strong>. If you weren't expecting this invitation, you can safely ignore this email.<br/>
        ${appName} &middot; Built for modern teams &middot; <a href="${APP_URL}">${APP_URL.replace(/^https?:\/\//, "")}</a>
      </p>
    </div>
  </div>
</div>
</body>
</html>`;
}


/* ─── Portal Invite Email Template ──────────────────────────── */
function portalInviteEmailHtml({
  stakeholderName,
  projectName,
  senderName,
  portalUrl,
  appName,
  logoUrl,
}: {
  stakeholderName: string;
  projectName: string;
  senderName: string;
  portalUrl: string;
  appName: string;
  logoUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Project Roadmap Access – ${projectName}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #f7f7f5;
    color: #252B37;
    -webkit-font-smoothing: antialiased;
    padding: 48px 16px;
  }
  .wrapper { max-width: 560px; margin: 0 auto; }
  .card {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #E9EAEB;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04);
  }
  .card-header {
    padding: 20px 32px;
    border-bottom: 1px solid #F5F5F5;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .logo-mark {
    width: 32px; height: 32px;
    background: #2162F9;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .logo-dot { width: 8px; height: 8px; background: #44EB7C; border-radius: 50%; display: inline-block; }
  .logo-name { font-size: 16px; font-weight: 700; color: #252B37; letter-spacing: -0.3px; }
  .hero {
    background: linear-gradient(135deg, #2162F9 0%, #4f46e5 100%);
    padding: 36px 32px;
    text-align: center;
  }
  .hero-icon {
    width: 56px; height: 56px;
    background: rgba(255,255,255,0.15);
    border-radius: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
  }
  .hero-title {
    font-size: 22px;
    font-weight: 700;
    color: #fff;
    letter-spacing: -0.4px;
    margin-bottom: 6px;
  }
  .hero-sub {
    font-size: 13px;
    color: rgba(255,255,255,0.75);
    font-weight: 400;
  }
  .card-body { padding: 36px 32px; }
  .eyebrow {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #2162F9;
    margin-bottom: 10px;
  }
  .text {
    font-size: 14px;
    color: #535862;
    line-height: 1.7;
    margin-bottom: 14px;
  }
  .text strong { color: #252B37; font-weight: 600; }
  .project-box {
    background: #F1F7FF;
    border: 1px solid #DBEAFE;
    border-radius: 10px;
    padding: 16px 20px;
    margin: 20px 0;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .project-icon {
    width: 36px; height: 36px;
    background: #2162F9;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .project-label { font-size: 10px; font-weight: 700; color: #2162F9; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 2px; }
  .project-name { font-size: 15px; font-weight: 700; color: #252B37; }
  .notice {
    background: #FFFBEB;
    border: 1px solid #FDE68A;
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 12px;
    color: #92400E;
    margin-bottom: 24px;
    line-height: 1.5;
  }
  .cta-wrap { margin: 8px 0 24px; text-align: center; }
  .cta {
    display: inline-block;
    background: #2162F9;
    color: #ffffff !important;
    font-size: 14px;
    font-weight: 600;
    padding: 14px 36px;
    border-radius: 8px;
    text-decoration: none;
    letter-spacing: -0.1px;
  }
  .url-fallback {
    background: #FAFAFA;
    border: 1px solid #E9EAEB;
    border-radius: 8px;
    padding: 12px 16px;
    margin-top: 16px;
  }
  .url-fallback p { font-size: 11px; color: #717680; margin-bottom: 4px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
  .url-fallback a { font-size: 12px; color: #2162F9; word-break: break-all; text-decoration: none; }
  .card-footer {
    padding: 18px 32px;
    background: #FAFAFA;
    border-top: 1px solid #F5F5F5;
  }
  .footer-text { font-size: 11px; color: #717680; line-height: 1.6; }
  .footer-text a { color: #717680; text-decoration: underline; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="card">
    <div class="card-header">
      ${logoUrl ? `<img src="${logoUrl}" alt="${appName}" style="height:28px;width:auto;" />` : `<span class="logo-mark"><span class="logo-dot"></span></span><span class="logo-name">${appName}</span>`}
    </div>

    <div class="hero">
      ${logoUrl ? `
      <div class="hero-icon" style="background: rgba(255,255,255,0.2); padding: 4px; border: 1px solid rgba(255,255,255,0.3);">
        <img src="${logoUrl}" alt="${appName}" style="width: 42px; height: auto; object-fit: contain; filter: brightness(0) invert(1);" />
      </div>
      ` : `
      <div class="hero-icon">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
      </div>
      `}
      <div class="hero-title">Your Project Roadmap is Ready</div>
      <div class="hero-sub">View the latest progress and timeline updates</div>
    </div>

    <div class="card-body">
      <p class="eyebrow">Client Portal Access</p>
      <p class="text">Hi${stakeholderName ? ` <strong>${stakeholderName}</strong>` : ""},</p>
      <p class="text"><strong>${senderName}</strong> has shared a project roadmap with you on <strong>${appName}</strong>. You can now view the latest status, timelines, and delivery dates for:</p>

      <div class="project-box">
        <div class="project-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>
        </div>
        <div>
          <div class="project-label">Project</div>
          <div class="project-name">${projectName}</div>
        </div>
      </div>

      <div class="notice">
        <strong>How to access:</strong> Click the button below, then enter <strong>this email address</strong> to unlock the portal. You can view the full project schedule and upcoming delivery dates.
      </div>

      <div class="cta-wrap">
        <a href="${portalUrl}" class="cta">View Project Roadmap →</a>
      </div>

      <div class="url-fallback">
        <p>Or copy this link into your browser</p>
        <a href="${portalUrl}">${portalUrl}</a>
      </div>
    </div>

    <div class="card-footer">
      <p class="footer-text">
        Internal tasks and budget data are not shared — you only see client-facing milestones and delivery dates.<br/>
        ${appName} &middot; <a href="${APP_URL}">${APP_URL.replace(/^https?:\/\//, "")}</a>
      </p>
    </div>
  </div>
</div>
</body>
</html>`;
}

/* ─── Send portal invite to external stakeholder ─────────────── */
export async function sendPortalInviteEmail({
  to,
  stakeholderName,
  projectName,
  senderName,
  shareToken,
}: {
  to: string;
  stakeholderName: string;
  projectName: string;
  senderName: string;
  shareToken: string;
}) {
  const portalUrl = `${APP_URL}/share/${shareToken}`;
  const smtpCfg = await getSmtpConfig();
  const transport = await getTransport();
  const { appName, logoUrl } = await getGlobalSettings();

  await transport.sendMail({
    from: `"${appName}" <${smtpCfg.from}>`,
    to,
    subject: `${senderName} shared "${projectName}" roadmap with you`,
    html: portalInviteEmailHtml({ stakeholderName, projectName, senderName, portalUrl, appName, logoUrl }),
    text: `${senderName} has shared the "${projectName}" project roadmap with you.\n\nView it here: ${portalUrl}\n\nEnter your email (${to}) to unlock access.`,
  });
}

/* ─── Send invite ────────────────────────────────────────────── */
export async function sendInviteEmail({
  to,
  inviteeName,
  invitedByName,
  inviteToken,
}: {
  to: string;
  inviteeName: string;
  invitedByName: string;
  inviteToken: string;
}) {
  const inviteUrl = `${APP_URL}/auth/signin?invite=${encodeURIComponent(inviteToken)}&email=${encodeURIComponent(to)}`;

  const smtpCfg = await getSmtpConfig();
  const transport = await getTransport();
  const { appName, logoUrl } = await getGlobalSettings();

  await transport.sendMail({
    from: `"${appName}" <${smtpCfg.from}>`,
    to,
    subject: `${invitedByName} invited you to join ${appName}`,
    html: inviteEmailHtml({ inviteeName, invitedByName, inviteUrl, appName, logoUrl }),
    text: `${invitedByName} has invited you to join ${appName}.\n\nAccept your invitation: ${inviteUrl}\n\nThis link expires in 7 days.`,
  });
}


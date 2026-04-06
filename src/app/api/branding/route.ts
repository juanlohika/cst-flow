import { NextResponse } from "next/server";
import { db } from "@/db";
import { globalSettings } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * GET /api/branding
 * Public endpoint — no auth required.
 * Returns only the app name and logo for external pages (client portal, etc.)
 */
export async function GET() {
  try {
    const settings = await db.select().from(globalSettings);
    const cfg: Record<string, string> = {};
    settings.forEach(s => { cfg[s.key] = s.value; });

    return NextResponse.json({
      appName: cfg.app_name || "CST OS",
      logoUrl: cfg.bottom_logo_url || cfg.company_logo || "",
    });
  } catch {
    return NextResponse.json({ appName: "CST OS", logoUrl: "" });
  }
}

import { NextResponse } from "next/server";
import { db } from "@/db";
import { apps as appsTable } from "@/db/schema";
import { auth } from "@/auth";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

const DEFAULT_APPS = [
  { name: "Architect", slug: "architect", description: "Map and automate operational flows.", icon: "Workflow", href: "/architect", isActive: 1, sortOrder: 0 },
  { name: "BRD Maker", slug: "brd", description: "Generate PRD / BRD documents via AI.", icon: "ClipboardList", href: "/brd", isActive: 1, sortOrder: 1 },
  { name: "Timeline Maker", slug: "timeline", description: "Project scheduling and Gantt visualization.", icon: "Clock", href: "/timeline", isActive: 1, sortOrder: 2 },
  { name: "Mockup Builder", slug: "mockup", description: "Build and preview UI prototypes.", icon: "Paintbrush", href: "/mockup", isActive: 1, sortOrder: 3 },
  { name: "Meetings Hub", slug: "meetings", description: "Centralized meeting and transcription management.", icon: "Users", href: "/meetings", isActive: 1, sortOrder: 5 },
  { name: "ARIMA", slug: "arima", description: "AI-powered Relationship Manager for client check-ins and requirement capture.", icon: "Heart", href: "/arima", isActive: 1, sortOrder: 6 },
  { name: "Eliana", slug: "eliana", description: "AI Business Analyst for discovery and requirements elicitation. Captures structured BRDs from client conversations.", icon: "ClipboardList", href: "/eliana", isActive: 1, sortOrder: 7 },
];

export async function GET() {
  try {
    let apps = await db.select().from(appsTable).orderBy(asc(appsTable.sortOrder), asc(appsTable.name));

    // Auto-seed any DEFAULT_APPS that are missing from the DB (by slug)
    const existingSlugs = new Set(apps.map(a => a.slug));
    const missing = DEFAULT_APPS.filter(d => !existingSlugs.has(d.slug));
    if (missing.length > 0) {
      for (const d of missing) {
        await db.insert(appsTable).values({
          id: `app_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
          name: d.name,
          slug: d.slug,
          description: d.description,
          icon: d.icon,
          href: d.href,
          isActive: true,
          isBuiltIn: true,
          sortOrder: d.sortOrder,
        });
      }
      apps = await db.select().from(appsTable).orderBy(asc(appsTable.sortOrder), asc(appsTable.name));
    }

    return NextResponse.json(apps.length > 0 ? apps : DEFAULT_APPS);
  } catch (error: any) {
    console.error("Fetch apps error:", error);
    return NextResponse.json(DEFAULT_APPS);
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session || (session.user as any)?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { name, slug, description, icon, href, isActive, sortOrder } = await req.json();
    if (!name || !slug || !href) {
      return NextResponse.json({ error: "name, slug, href required" }, { status: 400 });
    }
    
    // Generate a secure ID or let the default cuid handle it
    // In this case, we'll let schema.ts's defaultFn handle it or provide it
    const id = `app_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    
    await db.insert(appsTable).values({
      id,
      name,
      slug,
      description: description ?? null,
      icon: icon ?? null,
      href,
      isActive: isActive !== false,
      isBuiltIn: false,
      sortOrder: sortOrder ?? 0,
    });
    
    return NextResponse.json({ id, name, slug, href });
  } catch (error: any) {
    console.error("Create app error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

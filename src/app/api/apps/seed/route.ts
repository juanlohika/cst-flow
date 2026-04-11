import { NextResponse } from "next/server";
import { db } from "@/db";
import { apps as appsTable } from "@/db/schema";
import { auth } from "@/auth";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const BUILT_IN_APPS = [
  { name: "Meetings Hub", slug: "meetings",    icon: "CalendarCheck", href: "/meetings",    sortOrder: 1, isBuiltIn: true },
  { name: "Architect",    slug: "architect",   icon: "GitBranch",     href: "/architect",   sortOrder: 2, isBuiltIn: true },
  { name: "BRD Maker",    slug: "brd",         icon: "FileText",      href: "/brd",         sortOrder: 3, isBuiltIn: true },
  { name: "Mockup Maker", slug: "mockup",      icon: "Paintbrush",    href: "/mockup",      sortOrder: 4, isBuiltIn: true },
  { name: "Timeline",     slug: "timeline",    icon: "Clock",         href: "/timeline",    sortOrder: 5, isBuiltIn: true },
  { name: "Meeting Prep", slug: "meeting-prep",icon: "ClipboardList", href: "/meeting-prep",sortOrder: 6, isBuiltIn: true },
  { name: "Tarkie AI",    slug: "tarkie-ai",   icon: "Sparkles",      href: "/addin",       sortOrder: 0, isBuiltIn: true, provider: "claude" },
];

export async function POST() {
  try {
    const session = await auth();
    if (!session || (session.user as any)?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    
    let seeded = 0;
    for (const app of BUILT_IN_APPS) {
      const existing = await db.select({ id: appsTable.id })
        .from(appsTable)
        .where(eq(appsTable.slug, app.slug))
        .limit(1);

      if (existing.length === 0) {
        const id = `app_${app.slug}_${Date.now().toString(36)}`;
        await db.insert(appsTable).values({
          id,
          name: app.name,
          slug: app.slug,
          icon: app.icon,
          href: app.href,
          isActive: true,
          isBuiltIn: app.isBuiltIn,
          sortOrder: app.sortOrder,
          provider: (app as any).provider ?? null,
        });
        seeded++;
      }
    }
    return NextResponse.json({ ok: true, seeded });
  } catch (error: any) {
    console.error("Seed apps error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

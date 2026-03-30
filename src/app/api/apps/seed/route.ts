import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

const BUILT_IN_APPS = [
  { name: "Meetings",     slug: "meetings",    icon: "CalendarCheck", href: "/meetings",    sortOrder: 1, isBuiltIn: true },
  { name: "Architect",    slug: "architect",   icon: "GitBranch",     href: "/architect",   sortOrder: 2, isBuiltIn: true },
  { name: "BRD Maker",    slug: "brd",         icon: "FileText",      href: "/brd",         sortOrder: 3, isBuiltIn: true },
  { name: "Mockup Maker", slug: "mockup",      icon: "Paintbrush",    href: "/mockup",      sortOrder: 4, isBuiltIn: true },
  { name: "Timeline",     slug: "timeline",    icon: "Clock",         href: "/timeline",    sortOrder: 5, isBuiltIn: true },
  { name: "Meeting Prep", slug: "meeting-prep",icon: "ClipboardList", href: "/meeting-prep",sortOrder: 0, isBuiltIn: true },
];

export async function POST() {
  try {
    const session = await auth();
    if (!session || (session.user as any)?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const now = new Date().toISOString();
    let seeded = 0;
    for (const app of BUILT_IN_APPS) {
      const existing = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM App WHERE slug = ?`, app.slug
      );
      if (existing.length === 0) {
        const id = `app_${app.slug}_${Date.now().toString(36)}`;
        await prisma.$executeRawUnsafe(
          `INSERT INTO App (id, name, slug, icon, href, isActive, isBuiltIn, sortOrder, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          id, app.name, app.slug, app.icon, app.href,
          app.isBuiltIn ? 1 : 0, app.sortOrder, now, now
        );
        seeded++;
      }
    }
    return NextResponse.json({ ok: true, seeded });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

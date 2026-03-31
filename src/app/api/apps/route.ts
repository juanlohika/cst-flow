import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

const DEFAULT_APPS = [
  { name: "Architect", slug: "architect", description: "Map and automate operational flows.", icon: "Workflow", href: "/architect", isActive: 1, sortOrder: 0 },
  { name: "BRD Maker", slug: "brd", description: "Generate PRD / BRD documents via AI.", icon: "ClipboardList", href: "/brd", isActive: 1, sortOrder: 1 },
  { name: "Roadmap", slug: "timeline", description: "Project scheduling and Gantt visualization.", icon: "Clock", href: "/timeline", isActive: 1, sortOrder: 2 },
  { name: "Mockup Builder", slug: "mockup", description: "Build and preview UI prototypes.", icon: "Paintbrush", href: "/mockup", isActive: 1, sortOrder: 3 },
  { name: "Daily Tasks", slug: "tasks", description: "Daily task tracking and reporting.", icon: "Zap", href: "/tasks", isActive: 1, sortOrder: 4 },
  { name: "Meetings Hub", slug: "meetings", description: "Centralized meeting and transcription management.", icon: "Users", href: "/meetings", isActive: 1, sortOrder: 5 },
];

export async function GET() {
  try {
    const apps = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, name, slug, description, icon, href, isActive, isBuiltIn, sortOrder
       FROM App ORDER BY sortOrder ASC, name ASC`
    );
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
    const id = `app_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    await prisma.$executeRawUnsafe(
      `INSERT INTO App (id, name, slug, description, icon, href, isActive, isBuiltIn, sortOrder, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      id, name, slug, description ?? null, icon ?? null, href,
      isActive !== false ? 1 : 0, sortOrder ?? 0, now, now
    );
    return NextResponse.json({ id, name, slug, href });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

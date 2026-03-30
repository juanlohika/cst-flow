import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

/** GET /api/skills — list skills, optionally filtered by category */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");
    const subcategory = searchParams.get("subcategory");
    const slug = searchParams.get("slug");
    const activeOnly = searchParams.get("activeOnly") !== "false";

    const where: any = {};
    if (category) where.category = category;
    if (subcategory) where.subcategory = subcategory;
    if (slug) where.slug = slug;
    if (activeOnly) where.isActive = true;

    const skills = await prisma.skill.findMany({
      where,
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });

    return NextResponse.json(skills);
  } catch (err: any) {
    console.error("GET /api/skills error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** POST /api/skills — create a new skill (admin only) */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { name, description, category, subcategory, slug, content, isActive, sortOrder } = body;

    if (!name || !category || !content) {
      return NextResponse.json(
        { error: "name, category, and content are required" },
        { status: 400 }
      );
    }

    const skill = await prisma.skill.create({
      data: {
        name,
        description: description || "",
        category,
        subcategory: subcategory || null,
        slug: slug || null,
        content,
        isActive: isActive !== false,
        isSystem: false,
        sortOrder: sortOrder || 0,
      },
    });

    return NextResponse.json(skill, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/skills error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

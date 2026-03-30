import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

/** PATCH /api/skills/[id] — update a skill */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { name, description, category, subcategory, slug, content, isActive, sortOrder } = body;

    const existing = await prisma.skill.findUnique({ where: { id: params.id } });
    if (!existing) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    const updated = await prisma.skill.update({
      where: { id: params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(subcategory !== undefined && { subcategory: subcategory || null }),
        ...(slug !== undefined && { slug: slug || null }),
        ...(content !== undefined && { content }),
        ...(isActive !== undefined && { isActive }),
        ...(sortOrder !== undefined && { sortOrder }),
        updatedAt: new Date(),
      },
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("PATCH /api/skills/[id] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** DELETE /api/skills/[id] — delete a skill (not allowed on system skills) */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existing = await prisma.skill.findUnique({ where: { id: params.id } });
    if (!existing) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    if (existing.isSystem) {
      return NextResponse.json(
        { error: "System skills cannot be deleted. You can disable them instead." },
        { status: 403 }
      );
    }

    await prisma.skill.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("DELETE /api/skills/[id] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

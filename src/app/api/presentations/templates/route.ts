import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { presentationTemplates } from "@/db/schema";
import { auth } from "@/auth";
import { eq, asc } from "drizzle-orm";

/**
 * GET /api/presentations/templates — list all active presentation templates
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const templates = await db.select({
      id: presentationTemplates.id,
      name: presentationTemplates.name,
      description: presentationTemplates.description,
      designSkillId: presentationTemplates.designSkillId,
      version: presentationTemplates.version,
      isActive: presentationTemplates.isActive,
    }).from(presentationTemplates)
      .where(eq(presentationTemplates.isActive, true))
      .orderBy(asc(presentationTemplates.name));

    return NextResponse.json(templates);
  } catch (err: any) {
    console.error("GET /api/presentations/templates error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

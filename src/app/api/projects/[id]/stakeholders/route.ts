import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projectStakeholders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const list = await db.select()
      .from(projectStakeholders)
      .where(eq(projectStakeholders.projectId, params.id));

    return NextResponse.json(list);
  } catch (error) {
    return new NextResponse("Error", { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const body = await req.json();
    const { fullName, email, role, hasPortalAccess } = body;

    if (!fullName) return new NextResponse("Full Name required", { status: 400 });

    const [inserted] = await db.insert(projectStakeholders).values({
      projectId: params.id,
      fullName,
      email,
      role,
      hasPortalAccess: !!hasPortalAccess
    }).returning();

    return NextResponse.json(inserted);
  } catch (error) {
    return new NextResponse("Error", { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const { searchParams } = new URL(req.url);
    const stakeholderId = searchParams.get("stakeholderId");

    if (!stakeholderId) return new NextResponse("Stakeholder ID required", { status: 400 });

    await db.delete(projectStakeholders)
      .where(and(
        eq(projectStakeholders.id, stakeholderId),
        eq(projectStakeholders.projectId, params.id)
      ));

    return new NextResponse("Deleted", { status: 200 });
  } catch (error) {
    return new NextResponse("Error", { status: 500 });
  }
}

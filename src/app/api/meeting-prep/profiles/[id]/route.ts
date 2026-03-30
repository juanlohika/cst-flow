import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

/**
 * PATCH /api/meeting-prep/profiles/[id]
 * Update a client profile (partial update)
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await prisma.clientProfile.findUnique({ where: { id: params.id } });
    if (!profile || profile.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json();
    const {
      companyName,
      industry,
      modulesAvailed,
      engagementStatus,
      primaryContact,
      primaryContactEmail,
      specialConsiderations,
    } = body;

    const updated = await prisma.clientProfile.update({
      where: { id: params.id },
      data: {
        ...(companyName !== undefined && { companyName }),
        ...(industry !== undefined && { industry }),
        ...(modulesAvailed !== undefined && { modulesAvailed: JSON.stringify(modulesAvailed) }),
        ...(engagementStatus !== undefined && { engagementStatus }),
        ...(primaryContact !== undefined && { primaryContact }),
        ...(primaryContactEmail !== undefined && { primaryContactEmail }),
        ...(specialConsiderations !== undefined && { specialConsiderations }),
      },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("Update profile error:", error);
    return NextResponse.json({ error: error.message || "Failed to update profile" }, { status: 500 });
  }
}

/**
 * DELETE /api/meeting-prep/profiles/[id]
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await prisma.clientProfile.findUnique({ where: { id: params.id } });
    if (!profile || profile.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.clientProfile.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Delete profile error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete profile" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  arimaRequests,
  arimaConversations,
  clientProfiles as clientProfilesTable,
  users as usersTable,
  arimaMessages,
} from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

async function loadAndAuthorize(id: string, userId: string, isAdmin: boolean) {
  const rows = await db
    .select({
      id: arimaRequests.id,
      conversationId: arimaRequests.conversationId,
      sourceMessageId: arimaRequests.sourceMessageId,
      userId: arimaRequests.userId,
      clientProfileId: arimaRequests.clientProfileId,
      title: arimaRequests.title,
      description: arimaRequests.description,
      category: arimaRequests.category,
      priority: arimaRequests.priority,
      status: arimaRequests.status,
      assignedTo: arimaRequests.assignedTo,
      dueDate: arimaRequests.dueDate,
      resolution: arimaRequests.resolution,
      resolvedAt: arimaRequests.resolvedAt,
      createdAt: arimaRequests.createdAt,
      updatedAt: arimaRequests.updatedAt,
      clientName: clientProfilesTable.companyName,
      clientCode: clientProfilesTable.clientCode,
      capturedByName: usersTable.name,
      capturedByEmail: usersTable.email,
    })
    .from(arimaRequests)
    .leftJoin(clientProfilesTable, eq(clientProfilesTable.id, arimaRequests.clientProfileId))
    .leftJoin(usersTable, eq(usersTable.id, arimaRequests.userId))
    .where(eq(arimaRequests.id, id))
    .limit(1);

  const r = rows[0];
  if (!r) return { error: { status: 404, message: "Not found" } } as const;
  if (isAdmin) return { request: r } as const;
  // Non-admin: must either be the capturer, or have membership on the client
  if (r.userId === userId) return { request: r } as const;
  if (r.clientProfileId) {
    const allowed = await canAccessClient({ userId, isAdmin }, r.clientProfileId);
    if (allowed) return { request: r } as const;
  }
  return { error: { status: 403, message: "Forbidden" } } as const;
}

/** GET /api/arima/requests/[id] — request + (optional) source conversation snippet */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const isAdmin = (session.user as any).role === "admin";
    await ensureAccessSchema();

    const result = await loadAndAuthorize(params.id, userId, isAdmin);
    if ("error" in result) {
      return NextResponse.json({ error: result.error.message }, { status: result.error.status });
    }

    // Pull the source conversation messages if linked
    let sourceMessages: any[] = [];
    let sourceConversation: any = null;
    if (result.request.conversationId) {
      const convRows = await db
        .select()
        .from(arimaConversations)
        .where(eq(arimaConversations.id, result.request.conversationId))
        .limit(1);
      sourceConversation = convRows[0] || null;
      sourceMessages = await db
        .select()
        .from(arimaMessages)
        .where(eq(arimaMessages.conversationId, result.request.conversationId))
        .orderBy(asc(arimaMessages.createdAt));
    }

    return NextResponse.json({
      request: result.request,
      sourceConversation,
      sourceMessages,
    });
  } catch (error: any) {
    console.error("[arima/requests GET id] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** PATCH /api/arima/requests/[id] — update title, status, priority, assignment, resolution */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const isAdmin = (session.user as any).role === "admin";
    await ensureAccessSchema();

    const auth_ = await loadAndAuthorize(params.id, userId, isAdmin);
    if ("error" in auth_) {
      return NextResponse.json({ error: auth_.error.message }, { status: auth_.error.status });
    }

    const body = await req.json();
    const ALLOWED = ["title", "description", "category", "priority", "status", "assignedTo", "dueDate", "resolution"];
    const updateData: any = { updatedAt: new Date().toISOString() };
    for (const key of ALLOWED) {
      if (key in body && body[key] !== undefined) {
        updateData[key] = body[key];
      }
    }
    // Auto-stamp resolvedAt when status moves to done
    if (updateData.status === "done" && !auth_.request.resolvedAt) {
      updateData.resolvedAt = new Date().toISOString();
    }
    // Clear resolvedAt if status moves away from done
    if (updateData.status && updateData.status !== "done" && auth_.request.resolvedAt) {
      updateData.resolvedAt = null;
    }

    await db.update(arimaRequests).set(updateData).where(eq(arimaRequests.id, params.id));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[arima/requests PATCH] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** DELETE /api/arima/requests/[id] — admin or capturer can delete */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const isAdmin = (session.user as any).role === "admin";
    await ensureAccessSchema();

    const auth_ = await loadAndAuthorize(params.id, userId, isAdmin);
    if ("error" in auth_) {
      return NextResponse.json({ error: auth_.error.message }, { status: auth_.error.status });
    }
    if (!isAdmin && auth_.request.userId !== userId) {
      return NextResponse.json({ error: "Only the capturer or an admin can delete." }, { status: 403 });
    }

    await db.delete(arimaRequests).where(eq(arimaRequests.id, params.id));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[arima/requests DELETE] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

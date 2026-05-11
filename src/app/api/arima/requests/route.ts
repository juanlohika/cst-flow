import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  arimaRequests,
  arimaConversations,
  clientProfiles as clientProfilesTable,
  users as usersTable,
} from "@/db/schema";
import { desc, eq, inArray, and, or, like, isNull } from "drizzle-orm";
import { listAccessibleClientIds, ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/arima/requests
 *
 * Query params:
 *   ?scope=mine|team     — mine (default) = requests YOU captured; team = all team requests (admin only)
 *   ?status=new|in-progress|done|archived
 *   ?priority=low|medium|high|urgent
 *   ?category=...
 *   ?clientProfileId=...
 *   ?search=...
 *
 * Access control:
 *   - Non-admins see only requests linked to clients they have AccountMembership for,
 *     PLUS requests with no client linked that they themselves created.
 *   - Admins see everything (with optional client filter).
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const isAdmin = (session.user as any).role === "admin";
    await ensureAccessSchema();

    const { searchParams } = new URL(req.url);
    const scope = searchParams.get("scope") || "mine";
    const status = searchParams.get("status");
    const priority = searchParams.get("priority");
    const category = searchParams.get("category");
    const filterClientId = searchParams.get("clientProfileId");
    const search = searchParams.get("search");

    if (scope === "team" && !isAdmin) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const conditions: any[] = [];

    // Status / priority / category filters
    if (status) conditions.push(eq(arimaRequests.status, status));
    if (priority) conditions.push(eq(arimaRequests.priority, priority));
    if (category) conditions.push(eq(arimaRequests.category, category));

    // Search across title and description
    if (search) {
      const q = `%${search}%`;
      conditions.push(or(like(arimaRequests.title, q), like(arimaRequests.description, q)));
    }

    // Access scoping
    if (scope === "mine") {
      // mine = requests the user captured personally
      conditions.push(eq(arimaRequests.userId, userId));
    } else if (!isAdmin) {
      // team scope but non-admin shouldn't reach here (rejected above) — defense in depth
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    // Client filter (optional)
    if (filterClientId) {
      // Verify caller has access to this client first
      const allowed = await listAccessibleClientIds({ userId, isAdmin });
      if (allowed !== null && !allowed.includes(filterClientId)) {
        return NextResponse.json({ error: "No access to this client" }, { status: 403 });
      }
      conditions.push(eq(arimaRequests.clientProfileId, filterClientId));
    } else if (!isAdmin && scope !== "mine") {
      // Non-admin team scope shouldn't be possible, but if we ever change that,
      // require client filtering to clientProfileIds they're members of.
      const allowed = await listAccessibleClientIds({ userId, isAdmin });
      if (allowed && allowed.length > 0) {
        conditions.push(inArray(arimaRequests.clientProfileId, allowed));
      } else {
        return NextResponse.json([]);
      }
    }

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
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(arimaRequests.createdAt));

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("[arima/requests GET] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/arima/requests — manual create (admin/team uses this to add a request not auto-captured)
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const isAdmin = (session.user as any).role === "admin";
    await ensureAccessSchema();

    const body = await req.json();
    const {
      title,
      description,
      category = "other",
      priority = "medium",
      status = "new",
      clientProfileId,
      assignedTo,
      dueDate,
      conversationId,
    } = body;

    if (!title?.trim()) {
      return NextResponse.json({ error: "Title required" }, { status: 400 });
    }

    if (clientProfileId) {
      const allowed = await listAccessibleClientIds({ userId, isAdmin });
      if (allowed !== null && !allowed.includes(clientProfileId)) {
        return NextResponse.json({ error: "No access to this client" }, { status: 403 });
      }
    }

    const id = `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    await db.insert(arimaRequests).values({
      id,
      userId,
      clientProfileId: clientProfileId || null,
      conversationId: conversationId || null,
      title: title.slice(0, 200),
      description: description || null,
      category,
      priority,
      status,
      assignedTo: assignedTo || null,
      dueDate: dueDate || null,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (error: any) {
    console.error("[arima/requests POST] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

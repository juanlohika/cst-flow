import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
function cuid() { return `kb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
const createId = cuid;

export const dynamic = "force-dynamic";

async function getBoard(projectId: string) {
  const boards = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM KanbanBoard WHERE projectId = ? LIMIT 1`, projectId
  );
  if (!boards.length) return null;
  const board = boards[0];
  const lanes = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM KanbanLane WHERE boardId = ? ORDER BY position ASC`, board.id
  );
  return { ...board, lanes };
}

// GET — fetch board + lanes (any authenticated user)
export async function GET(req: Request, { params }: { params: { projectId: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const board = await getBoard(params.projectId);
    return NextResponse.json(board);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST — create board (project creator or admin)
export async function POST(req: Request, { params }: { params: { projectId: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const project = await prisma.$queryRawUnsafe<any[]>(
      `SELECT createdBy FROM Project WHERE id = ? LIMIT 1`, params.projectId
    );
    if (!project.length) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const isCreator = project[0].createdBy === session.user.id;
    const isAdmin = (session.user as any).role === "admin";
    if (!isCreator && !isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { name = "Kanban Board", lanes = [] } = await req.json();
    const now = new Date().toISOString();
    const boardId = createId();

    await prisma.$executeRawUnsafe(
      `INSERT INTO KanbanBoard (id, projectId, name, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
      boardId, params.projectId, name, session.user.id, now, now
    );

    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i];
      await prisma.$executeRawUnsafe(
        `INSERT INTO KanbanLane (id, boardId, name, position, mappedStatus, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        createId(), boardId, lane.name, i, lane.mappedStatus || "pending", lane.color ?? null, now, now
      );
    }

    return NextResponse.json(await getBoard(params.projectId));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH — update lanes (project creator or admin); replaces all lanes
export async function PATCH(req: Request, { params }: { params: { projectId: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const boards = await prisma.$queryRawUnsafe<any[]>(
      `SELECT kb.id, p.createdBy FROM KanbanBoard kb JOIN Project p ON p.id = kb.projectId WHERE kb.projectId = ? LIMIT 1`,
      params.projectId
    );
    if (!boards.length) return NextResponse.json({ error: "Board not found" }, { status: 404 });

    const isCreator = boards[0].createdBy === session.user.id;
    const isAdmin = (session.user as any).role === "admin";
    if (!isCreator && !isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { name, lanes = [] } = await req.json();
    const boardId = boards[0].id;
    const now = new Date().toISOString();

    if (name) {
      await prisma.$executeRawUnsafe(
        `UPDATE KanbanBoard SET name = ?, updatedAt = ? WHERE id = ?`, name, now, boardId
      );
    }

    // Delete and re-insert all lanes (idempotent)
    await prisma.$executeRawUnsafe(`DELETE FROM KanbanLane WHERE boardId = ?`, boardId);
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i];
      await prisma.$executeRawUnsafe(
        `INSERT INTO KanbanLane (id, boardId, name, position, mappedStatus, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        lane.id || createId(), boardId, lane.name, i, lane.mappedStatus || "pending", lane.color ?? null, now, now
      );
    }

    await prisma.$executeRawUnsafe(`UPDATE KanbanBoard SET updatedAt = ? WHERE id = ?`, now, boardId);

    return NextResponse.json(await getBoard(params.projectId));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

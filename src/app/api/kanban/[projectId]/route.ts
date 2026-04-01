import { NextResponse } from "next/server";
import { db } from "@/db";
import { 
  kanbanBoards as kanbanBoardsTable, 
  kanbanLanes as kanbanLanesTable,
  projects as projectsTable,
  users as usersTable
} from "@/db/schema";
import { auth } from "@/auth";
import { eq, and, asc } from "drizzle-orm";

function cuid() { return `kb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
const createId = cuid;

export const dynamic = "force-dynamic";

/**
 * Helper to fetch a board with its lanes joined
 */
async function getBoard(projectId: string) {
  const boards = await db.select().from(kanbanBoardsTable).where(eq(kanbanBoardsTable.projectId, projectId)).limit(1);
  if (boards.length === 0) return null;
  const board = boards[0];
  const lanes = await db.select().from(kanbanLanesTable).where(eq(kanbanLanesTable.boardId, board.id)).orderBy(asc(kanbanLanesTable.position));
  return { ...board, lanes };
}

/** 
 * GET — fetch board + lanes 
 * MIGRATED TO DRIZZLE
 */
export async function GET(req: Request, { params }: { params: { projectId: string } } ) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const board = await getBoard(params.projectId);
    return NextResponse.json(board);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** 
 * POST — create board 
 * MIGRATED TO DRIZZLE
 */
export async function POST(req: Request, { params }: { params: { projectId: string } }) {
  try {
    const session = await auth();
    const currentUserId = session?.user?.id;
    if (!currentUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projectRows = await db.select({ createdBy: projectsTable.createdBy }).from(projectsTable).where(eq(projectsTable.id, params.projectId)).limit(1);
    if (projectRows.length === 0) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { name = "Kanban Board", lanes = [] } = await req.json();
    const now = new Date().toISOString();
    const boardId = createId();

    await db.transaction(async (tx) => {
      await tx.insert(kanbanBoardsTable).values({
        id: boardId,
        projectId: params.projectId,
        name,
        createdBy: currentUserId,
        createdAt: now,
        updatedAt: now
      });

      if (lanes.length > 0) {
        const laneValues = lanes.map((lane: any, i: number) => ({
          id: createId(),
          boardId,
          name: lane.name,
          position: i,
          mappedStatus: lane.mappedStatus || "pending",
          color: lane.color ?? null,
          createdAt: now,
          updatedAt: now
        }));
        await tx.insert(kanbanLanesTable).values(laneValues);
      }
    });

    return NextResponse.json(await getBoard(params.projectId));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** 
 * PATCH — update lanes (replaces all lanes) 
 * MIGRATED TO DRIZZLE
 */
export async function PATCH(req: Request, { params }: { params: { projectId: string } }) {
  try {
    const session = await auth();
    const currentUserId = session?.user?.id;
    if (!currentUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const joinRows = await db.select({ 
      id: kanbanBoardsTable.id, 
      createdBy: projectsTable.createdBy 
    })
    .from(kanbanBoardsTable)
    .innerJoin(projectsTable, eq(projectsTable.id, kanbanBoardsTable.projectId))
    .where(eq(kanbanBoardsTable.projectId, params.projectId))
    .limit(1);

    if (joinRows.length === 0) return NextResponse.json({ error: "Board not found" }, { status: 404 });

    const { name, lanes = [] } = await req.json();
    const boardId = joinRows[0].id;
    const now = new Date().toISOString();

    await db.transaction(async (tx) => {
      if (name) {
        await tx.update(kanbanBoardsTable).set({ name, updatedAt: now }).where(eq(kanbanBoardsTable.id, boardId));
      }

      // Delete and re-insert all lanes (idempotent)
      await tx.delete(kanbanLanesTable).where(eq(kanbanLanesTable.boardId, boardId));
      
      if (lanes.length > 0) {
        const laneValues = lanes.map((lane: any, i: number) => ({
          id: lane.id || createId(),
          boardId,
          name: lane.name,
          position: i,
          mappedStatus: lane.mappedStatus || "pending",
          color: lane.color ?? null,
          createdAt: now,
          updatedAt: now
        }));
        await tx.insert(kanbanLanesTable).values(laneValues);
      }

      await tx.update(kanbanBoardsTable).set({ updatedAt: now }).where(eq(kanbanBoardsTable.id, boardId));
    });

    return NextResponse.json(await getBoard(params.projectId));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

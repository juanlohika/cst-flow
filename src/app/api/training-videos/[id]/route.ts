import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const rows = await db.select().from(trainingVideos).where(eq(trainingVideos.id, params.id)).limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let content: any = null;
    let messages: any = [];
    try { content = row.scenes ? JSON.parse(row.scenes) : null; } catch {}
    try { messages = row.messages ? JSON.parse(row.messages) : []; } catch {}

    return NextResponse.json({
      video: {
        ...row,
        content,
        messages,
      },
    });
  } catch (error: any) {
    console.error("[training-videos/[id] GET]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}

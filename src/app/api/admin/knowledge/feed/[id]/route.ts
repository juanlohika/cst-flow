import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { knowledgeFeedEntries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: { status: 401, message: "Unauthorized" } } as const;
  if ((session.user as any).role !== "admin") return { error: { status: 403, message: "Admin only" } } as const;
  return { ok: true as const };
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();
    await db.delete(knowledgeFeedEntries).where(eq(knowledgeFeedEntries.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[knowledge/feed/id DELETE]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

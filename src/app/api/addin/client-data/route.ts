import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientProfiles } from "@/db/schema";
import { desc } from "drizzle-orm";

/**
 * GET /api/addin/client-data
 * Returns list of clients for the PowerPoint Add-in
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const clients = await db
      .select()
      .from(clientProfiles)
      .orderBy(desc(clientProfiles.updatedAt));

    return NextResponse.json(clients);
  } catch (err: any) {
    console.error("GET /api/addin/client-data error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

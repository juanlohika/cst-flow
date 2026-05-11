import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createLinkCode } from "@/lib/telegram/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * POST /api/telegram/link-code → generate a one-time code for the calling user.
 * Any signed-in CST OS user can generate one (linking is required to use admin commands later anyway).
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureAccessSchema();

    const { code, expiresAt } = await createLinkCode(session.user.id);
    return NextResponse.json({ code, expiresAt });
  } catch (error: any) {
    console.error("[telegram/link-code POST] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listActiveBindings, revokeBinding } from "@/lib/telegram/binding";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: { status: 401, message: "Unauthorized" } } as const;
  if ((session.user as any).role !== "admin") return { error: { status: 403, message: "Admin only" } } as const;
  return { ok: true as const };
}

/** GET /api/telegram/bindings → list all active Telegram bindings (admin only) */
export async function GET() {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) {
      return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    }
    await ensureAccessSchema();

    const bindings = await listActiveBindings();
    return NextResponse.json(bindings);
  } catch (error: any) {
    console.error("[telegram/bindings GET] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** DELETE /api/telegram/bindings?chatId=... → revoke a binding (admin only) */
export async function DELETE(req: Request) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) {
      return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    }
    await ensureAccessSchema();

    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get("chatId");
    if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

    await revokeBinding(chatId);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[telegram/bindings DELETE] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

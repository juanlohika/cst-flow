import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { listInternalKeys, createInternalBindKey } from "@/lib/telegram/bind-keys";
import { getTelegramConfig } from "@/lib/telegram/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/telegram-bindings/internal-rooms
 *
 * Internal-scope bind keys — GCs not tied to any client account or user.
 * Used for pilot-tracker "beta registration request" broadcasts. Returns:
 *   - rooms: every existing internal key (with active binding, if any)
 *   - botUsername: for the deep-link URL
 *
 * These channels are outbound-only. Arima never runs its intelligence
 * loop inside them.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const [rooms, cfg] = await Promise.all([listInternalKeys(), getTelegramConfig()]);
    return NextResponse.json({
      botUsername: cfg.botUsername || null,
      rooms,
    });
  } catch (error: any) {
    console.error("[telegram-bindings/internal-rooms GET]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}

/**
 * POST /api/admin/telegram-bindings/internal-rooms
 * Body: { label? }
 *
 * Creates a new internal-scope bind key. No account, no user attached.
 * The admin generates a t.me/<bot>?startgroup=BIND_<token> deep link from
 * the returned key.accessToken and taps it in Telegram to bind a GC.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const body = await req.json().catch(() => ({}));
    const label = body?.label ? String(body.label).trim() : undefined;
    const key = await createInternalBindKey({
      label,
      createdBy: session.user.id,
    });
    return NextResponse.json({ key }, { status: 201 });
  } catch (error: any) {
    console.error("[telegram-bindings/internal-rooms POST]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}

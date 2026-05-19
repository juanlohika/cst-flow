import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientProfiles as clientProfilesTable } from "@/db/schema";
import { asc } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { listKeysForAccount } from "@/lib/telegram/bind-keys";
import { getTelegramConfig } from "@/lib/telegram/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/telegram-bindings
 *
 * Admin-only. Returns every account with its bind keys + active bindings,
 * plus the bot username so the UI can construct t.me deep links.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const accounts = await db
      .select({
        id: clientProfilesTable.id,
        companyName: clientProfilesTable.companyName,
        clientCode: clientProfilesTable.clientCode,
        tier: clientProfilesTable.tier,
        rmEmail: clientProfilesTable.rmEmail,
        pmEmail: clientProfilesTable.pmEmail,
      })
      .from(clientProfilesTable)
      .orderBy(asc(clientProfilesTable.companyName));

    // Fetch keys + active bindings for every account in parallel.
    const results = await Promise.all(
      accounts.map(async (a) => ({
        account: a,
        keys: await listKeysForAccount(a.id),
      })),
    );

    const cfg = await getTelegramConfig();

    return NextResponse.json({
      botUsername: cfg.botUsername || null,
      accounts: results,
    });
  } catch (error: any) {
    console.error("[telegram-bindings GET]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}

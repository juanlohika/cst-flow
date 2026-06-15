/**
 * Pin Validator project routes.
 *
 *   GET   /api/accounts/[id]/pin-validator
 *     → returns the project for this account if one exists (or null).
 *
 *   POST  /api/accounts/[id]/pin-validator
 *     → activates Pin Validator for the account. Idempotent — if a project
 *       already exists, returns it instead of failing. Creates a per-account
 *       Google Sheet in the Pin Validator Drive folder and records the
 *       PinValidatorProject row.
 *
 * Auth: signed-in CST OS users only. The actor must have access to the
 * target account via the existing canAccessClient() rule.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientProfiles, pinValidatorProjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";
import { provisionAccountSheet } from "@/lib/pin-validator/sheets";

export const dynamic = "force-dynamic";

interface ActorContext {
  userId: string;
  isAdmin: boolean;
}

async function authorizeActor(): Promise<
  { actor: ActorContext } | { error: { status: number; message: string } }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: { status: 401, message: "Unauthorized" } };
  }
  await ensureAccessSchema();
  return {
    actor: {
      userId: session.user.id as string,
      isAdmin: (session.user as any).role === "admin",
    },
  };
}

async function loadActiveProject(clientProfileId: string) {
  const rows = await db
    .select()
    .from(pinValidatorProjects)
    .where(
      and(
        eq(pinValidatorProjects.clientProfileId, clientProfileId),
        eq(pinValidatorProjects.status, "active"),
      ),
    )
    .limit(1);
  return rows[0] || null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorizeActor();
  if ("error" in a) {
    return NextResponse.json({ error: a.error.message }, { status: a.error.status });
  }
  if (!(await canAccessClient(a.actor, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const project = await loadActiveProject(id);
    return NextResponse.json({ project });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load Pin Validator project" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorizeActor();
  if ("error" in a) {
    return NextResponse.json({ error: a.error.message }, { status: a.error.status });
  }
  if (!(await canAccessClient(a.actor, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Idempotent: if an active project already exists for this account, just
    // return it. The button on the AccountHub treats this as "open my project".
    const existing = await loadActiveProject(id);
    if (existing) return NextResponse.json({ project: existing, created: false });

    const profile = await db
      .select({ companyName: clientProfiles.companyName })
      .from(clientProfiles)
      .where(eq(clientProfiles.id, id))
      .limit(1);
    if (profile.length === 0) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const provisioned = await provisionAccountSheet({
      companyName: profile[0].companyName,
    });

    const now = new Date().toISOString();
    const newId = `pvp_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
    await db.insert(pinValidatorProjects).values({
      id: newId,
      clientProfileId: id,
      googleSheetId: provisioned.sheetId,
      googleSheetUrl: provisioned.sheetUrl,
      name: provisioned.name,
      status: "active",
      createdByUserId: a.actor.userId,
      createdAt: now,
      updatedAt: now,
    });

    const project = await loadActiveProject(id);
    return NextResponse.json({ project, created: true });
  } catch (e: any) {
    console.error("[pin-validator/activate] failed:", e);
    return NextResponse.json(
      { error: e?.message || "Failed to activate Pin Validator" },
      { status: 500 },
    );
  }
}

import { db } from "@/db";
import {
  arimaChannelBindings,
  clientProfiles as clientProfilesTable,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";

export interface BindingInfo {
  id: string;
  chatId: string;
  chatTitle: string | null;
  clientProfileId: string;
  clientName: string;
  clientCode: string | null;
  status: string;
  boundAt: string;
  /** Phase 20: which agent leads this room — "arima" (RM) or "eliana" (BA). Defaults to arima. */
  agentMode: "arima" | "eliana";
}

export async function getActiveBindingForChat(chatId: number | string): Promise<BindingInfo | null> {
  const rows = await db
    .select({
      id: arimaChannelBindings.id,
      chatId: arimaChannelBindings.chatId,
      chatTitle: arimaChannelBindings.chatTitle,
      clientProfileId: arimaChannelBindings.clientProfileId,
      status: arimaChannelBindings.status,
      boundAt: arimaChannelBindings.boundAt,
      agentMode: arimaChannelBindings.agentMode,
      clientName: clientProfilesTable.companyName,
      clientCode: clientProfilesTable.clientCode,
    })
    .from(arimaChannelBindings)
    .leftJoin(clientProfilesTable, eq(clientProfilesTable.id, arimaChannelBindings.clientProfileId))
    .where(
      and(
        eq(arimaChannelBindings.channel, "telegram"),
        eq(arimaChannelBindings.chatId, String(chatId)),
        eq(arimaChannelBindings.status, "active")
      )
    )
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    chatId: r.chatId,
    chatTitle: r.chatTitle,
    clientProfileId: r.clientProfileId,
    clientName: r.clientName || "Unknown",
    clientCode: r.clientCode,
    status: r.status,
    boundAt: r.boundAt,
    agentMode: ((r as any).agentMode === "eliana" ? "eliana" : "arima"),
  };
}

export async function findClientByAccessToken(accessToken: string): Promise<{ id: string; companyName: string; clientCode: string | null } | null> {
  if (!accessToken || accessToken.length < 16) return null;
  const rows = await db
    .select({
      id: clientProfilesTable.id,
      companyName: clientProfilesTable.companyName,
      clientCode: clientProfilesTable.clientCode,
    })
    .from(clientProfilesTable)
    .where(eq(clientProfilesTable.accessToken, accessToken.trim()))
    .limit(1);
  return rows[0] || null;
}

export async function createBinding(args: {
  chatId: number | string;
  chatTitle: string | null;
  clientProfileId: string;
  boundByUserId: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const id = `bnd_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;

  // If a previous binding (active or revoked) exists for this chat, mark it revoked and insert a new one.
  await db
    .update(arimaChannelBindings)
    .set({ status: "revoked", revokedAt: now })
    .where(
      and(
        eq(arimaChannelBindings.channel, "telegram"),
        eq(arimaChannelBindings.chatId, String(args.chatId)),
        eq(arimaChannelBindings.status, "active")
      )
    );

  await db.insert(arimaChannelBindings).values({
    id,
    channel: "telegram",
    chatId: String(args.chatId),
    chatTitle: args.chatTitle,
    clientProfileId: args.clientProfileId,
    boundByUserId: args.boundByUserId,
    status: "active",
    boundAt: now,
  });
}

export async function revokeBinding(chatId: number | string): Promise<boolean> {
  const now = new Date().toISOString();
  await db
    .update(arimaChannelBindings)
    .set({ status: "revoked", revokedAt: now })
    .where(
      and(
        eq(arimaChannelBindings.channel, "telegram"),
        eq(arimaChannelBindings.chatId, String(chatId)),
        eq(arimaChannelBindings.status, "active")
      )
    );
  return true;
}

export async function listActiveBindings(): Promise<BindingInfo[]> {
  const rows = await db
    .select({
      id: arimaChannelBindings.id,
      chatId: arimaChannelBindings.chatId,
      chatTitle: arimaChannelBindings.chatTitle,
      clientProfileId: arimaChannelBindings.clientProfileId,
      status: arimaChannelBindings.status,
      boundAt: arimaChannelBindings.boundAt,
      agentMode: arimaChannelBindings.agentMode,
      clientName: clientProfilesTable.companyName,
      clientCode: clientProfilesTable.clientCode,
    })
    .from(arimaChannelBindings)
    .leftJoin(clientProfilesTable, eq(clientProfilesTable.id, arimaChannelBindings.clientProfileId))
    .where(
      and(
        eq(arimaChannelBindings.channel, "telegram"),
        eq(arimaChannelBindings.status, "active")
      )
    );

  return rows.map(r => ({
    id: r.id,
    chatId: r.chatId,
    chatTitle: r.chatTitle,
    clientProfileId: r.clientProfileId,
    clientName: r.clientName || "Unknown",
    clientCode: r.clientCode,
    status: r.status,
    boundAt: r.boundAt,
    agentMode: ((r as any).agentMode === "eliana" ? "eliana" : "arima"),
  }));
}

/**
 * @mention parsing and resolution for the unified group chat.
 *
 * Two formats are handled:
 *  - Telegram-style: a "mention" entity in message.entities[] (e.g. "@lester")
 *    or a "text_mention" entity that already contains the user object.
 *  - Portal-style: inline tokens like "@[Lester Alarcon](user:abc123)" which
 *    we emit from the MentionInput component on the portal side.
 *
 * Resolution looks up:
 *  - Internal team members of the bound account (CST OS users with an
 *    AccountMembership for this client) by Telegram username or display name.
 *  - External contacts (ClientContact rows) for the same account.
 *  - The bot itself (returned as type:'arima' when text contains @arima).
 */
import { db } from "@/db";
import {
  users as usersTable,
  accountMemberships,
  telegramAccountLinks,
  clientContacts,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";

export type MentionRef = {
  type: "internal" | "external" | "arima";
  id: string | null;
  name: string;
  telegramUsername?: string | null;
};

const ARIMA_RE = /(^|[^a-z0-9_])@arima\b/i;
const PORTAL_TOKEN_RE = /@\[([^\]]+)\]\((user|contact):([^)]+)\)/g;

export async function resolveTelegramMentions(args: {
  text: string;
  entities: Array<{ type: string; offset: number; length: number; user?: { id: number; username?: string; first_name?: string }; }>;
  clientProfileId: string;
}): Promise<MentionRef[]> {
  const out: MentionRef[] = [];
  if (ARIMA_RE.test(args.text)) out.push({ type: "arima", id: null, name: "ARIMA" });

  if (!args.entities?.length) return dedupe(out);

  // Collect @usernames + text_mention user IDs from the entities
  const usernamesTagged: string[] = [];
  const telegramUserIdsTagged: string[] = [];
  for (const e of args.entities) {
    if (e.type === "mention") {
      const handle = args.text.slice(e.offset + 1, e.offset + e.length);
      if (handle && handle.toLowerCase() !== "arima") usernamesTagged.push(handle.toLowerCase());
    } else if (e.type === "text_mention" && e.user?.id) {
      telegramUserIdsTagged.push(String(e.user.id));
    }
  }

  if (!usernamesTagged.length && !telegramUserIdsTagged.length) return dedupe(out);

  // Find the internal members of this account, then filter to those whose
  // Telegram link matches one of the tagged @usernames or user IDs.
  const members = await db
    .select({
      userId: accountMemberships.userId,
      name: usersTable.name,
      email: usersTable.email,
    })
    .from(accountMemberships)
    .leftJoin(usersTable, eq(usersTable.id, accountMemberships.userId))
    .where(eq(accountMemberships.clientProfileId, args.clientProfileId));

  if (members.length > 0) {
    const memberIds = members.map(m => m.userId);
    const links = await db
      .select({
        cstUserId: telegramAccountLinks.cstUserId,
        telegramUserId: telegramAccountLinks.telegramUserId,
        telegramUsername: telegramAccountLinks.telegramUsername,
      })
      .from(telegramAccountLinks)
      .where(and(
        inArray(telegramAccountLinks.cstUserId, memberIds),
        eq(telegramAccountLinks.status, "active"),
      ));

    for (const link of links) {
      const u = (link.telegramUsername || "").toLowerCase();
      if (
        (u && usernamesTagged.includes(u)) ||
        telegramUserIdsTagged.includes(link.telegramUserId)
      ) {
        const m = members.find(mm => mm.userId === link.cstUserId);
        out.push({
          type: "internal",
          id: link.cstUserId,
          name: m?.name || link.telegramUsername || "team member",
          telegramUsername: link.telegramUsername || null,
        });
      }
    }
  }

  return dedupe(out);
}

export async function resolvePortalMentions(args: {
  text: string;
  clientProfileId: string;
}): Promise<{ mentions: MentionRef[]; cleanText: string }> {
  const found: MentionRef[] = [];
  if (ARIMA_RE.test(args.text)) found.push({ type: "arima", id: null, name: "ARIMA" });

  const userIds: string[] = [];
  const contactIds: string[] = [];
  let m: RegExpExecArray | null;
  PORTAL_TOKEN_RE.lastIndex = 0;
  while ((m = PORTAL_TOKEN_RE.exec(args.text)) !== null) {
    const kind = m[2];
    const id = m[3];
    if (kind === "user") userIds.push(id);
    else if (kind === "contact") contactIds.push(id);
  }

  if (userIds.length > 0) {
    const rows = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds));
    const links = await db
      .select({ cstUserId: telegramAccountLinks.cstUserId, telegramUsername: telegramAccountLinks.telegramUsername })
      .from(telegramAccountLinks)
      .where(and(inArray(telegramAccountLinks.cstUserId, userIds), eq(telegramAccountLinks.status, "active")));
    for (const r of rows) {
      const link = links.find(l => l.cstUserId === r.id);
      found.push({
        type: "internal",
        id: r.id,
        name: r.name || "team member",
        telegramUsername: link?.telegramUsername || null,
      });
    }
  }

  if (contactIds.length > 0) {
    const rows = await db
      .select({ id: clientContacts.id, name: clientContacts.name })
      .from(clientContacts)
      .where(inArray(clientContacts.id, contactIds));
    for (const r of rows) {
      found.push({ type: "external", id: r.id, name: r.name || "client" });
    }
  }

  // Rewrite portal tokens into plain "@Name" for both display and the AI prompt.
  const cleanText = args.text.replace(PORTAL_TOKEN_RE, (_full, label) => `@${label}`);

  return { mentions: dedupe(found), cleanText };
}

function dedupe(refs: MentionRef[]): MentionRef[] {
  const seen = new Set<string>();
  const out: MentionRef[] = [];
  for (const r of refs) {
    const key = `${r.type}:${r.id || r.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Format an outbound message for Telegram so internal team members get a
 * native ping when they're @-mentioned from the portal side.
 * Example: "@lester" pings their Telegram client.
 */
export function formatMentionsForTelegram(text: string, mentions: MentionRef[]): string {
  let out = text;
  for (const m of mentions) {
    if (m.type !== "internal" || !m.telegramUsername) continue;
    const safe = m.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`@${safe}\\b`, "g"), `@${m.telegramUsername}`);
  }
  return out;
}

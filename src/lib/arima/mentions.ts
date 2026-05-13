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
  bindingContactAccess,
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
  bindingId?: string | null;
}): Promise<MentionRef[]> {
  const out: MentionRef[] = [];
  if (ARIMA_RE.test(args.text)) out.push({ type: "arima", id: null, name: "ARIMA" });

  // Collect @usernames + text_mention user IDs from the entities
  const usernamesTagged: string[] = [];
  const telegramUserIdsTagged: string[] = [];
  for (const e of args.entities || []) {
    if (e.type === "mention") {
      const handle = args.text.slice(e.offset + 1, e.offset + e.length);
      if (handle && handle.toLowerCase() !== "arima") usernamesTagged.push(handle.toLowerCase());
    } else if (e.type === "text_mention" && e.user?.id) {
      telegramUserIdsTagged.push(String(e.user.id));
    }
  }

  // Telegram entities don't include mentions for non-Telegram users (e.g. our
  // external portal contacts have no @handle on Telegram). So also walk the
  // raw text for any @Word tokens that *could* be a portal-contact name. Skip
  // tokens that already matched an entity to avoid double-resolving them.
  const looseTokens: string[] = [];
  const looseRe = /(^|[^a-z0-9_])@([a-zA-Z][a-zA-Z0-9_]{1,40})/g;
  let lm: RegExpExecArray | null;
  while ((lm = looseRe.exec(args.text)) !== null) {
    const t = lm[2].toLowerCase();
    if (t === "arima") continue;
    if (usernamesTagged.includes(t)) continue;
    looseTokens.push(t);
  }

  if (!usernamesTagged.length && !telegramUserIdsTagged.length && !looseTokens.length) return dedupe(out);

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

  // ─── Portal contacts ─────────────────────────────────────────────
  // Resolve loose @Word tokens (plain mentions Telegram doesn't tag because
  // the target isn't a Telegram user) against the portal contacts on this
  // account. If a bindingId is provided, restrict to contacts routed to it.
  const candidateTokens = Array.from(new Set<string>([...usernamesTagged, ...looseTokens]));
  if (candidateTokens.length > 0) {
    let contacts = await db
      .select({ id: clientContacts.id, name: clientContacts.name, email: clientContacts.email })
      .from(clientContacts)
      .where(eq(clientContacts.clientProfileId, args.clientProfileId));

    if (args.bindingId && contacts.length > 0) {
      const grants = await db
        .select({ contactId: bindingContactAccess.contactId })
        .from(bindingContactAccess)
        .where(and(
          eq(bindingContactAccess.bindingId, args.bindingId),
          inArray(bindingContactAccess.contactId, contacts.map(c => c.id))
        ));
      const allowed = new Set(grants.map(g => g.contactId));
      // If any explicit grant exists for this binding, scope to those; otherwise
      // fall back to all account contacts (legacy mode pre-Phase 16 grants).
      if (allowed.size > 0) contacts = contacts.filter(c => allowed.has(c.id));
    }

    for (const c of contacts) {
      const normName = (c.name || "").toLowerCase().replace(/\s+/g, "");
      const firstName = (c.name || "").split(/\s+/)[0]?.toLowerCase() || "";
      const emailLocal = (c.email || "").split("@")[0]?.toLowerCase() || "";
      for (const tok of candidateTokens) {
        if (tok === normName || tok === firstName || tok === emailLocal) {
          out.push({ type: "external", id: c.id, name: c.name });
          break;
        }
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

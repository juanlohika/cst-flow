/**
 * Shared knowledge repository helpers.
 *
 * Every AI agent (ARIMA, Eliana, future) reads from this single source of
 * truth at runtime. Documents are versioned (uploading a new version archives
 * the prior one). Feed entries are time-stamped notes that show up as
 * "what's new in Tarkie" context. Modules are the structured product catalog.
 *
 * buildAgentKnowledgeContext() is the main entry point — call it inside
 * runArima/runEliana to inject the right slice of knowledge into the system
 * prompt.
 */
import { db } from "@/db";
import {
  knowledgeDocuments,
  knowledgeDocumentVersions,
  knowledgeFeedEntries,
  knowledgeModules,
  knowledgeAgentAccess,
} from "@/db/schema";
import { and, asc, desc, eq, gt, isNull, or } from "drizzle-orm";

export type AgentId = "arima" | "eliana" | (string & {});
export type Audience = "all" | "internal" | "external";

const DEFAULT_AUDIENCE_BY_AGENT: Record<string, Audience[]> = {
  arima: ["all", "external"],     // ARIMA talks to clients — sees the client-safe stuff
  eliana: ["all", "external", "internal"], // Eliana is internal BA — sees everything
};

const RECENT_FEED_DAYS = 30;
const MODULE_DESCRIPTION_CAP = 6000; // total chars for the catalog block
const PLAYBOOK_CAP = 8000;
const FEED_CAP = 2500;

function audienceFilterForAgent(agentId: AgentId): Audience[] {
  return DEFAULT_AUDIENCE_BY_AGENT[agentId] || ["all"];
}

/**
 * Build the markdown block injected into the agent's system prompt.
 * Includes:
 *   - The active "playbook" document (capped)
 *   - The module catalog (capped, truncated by relevance order)
 *   - The last 30 days of feed entries (capped)
 *   - Any other "active" documents tagged for this agent (referenced by title,
 *     full content fetched lazily by an explicit lookup tool — Phase 21)
 */
export async function buildAgentKnowledgeContext(agentId: AgentId): Promise<string> {
  const allowedAudience = audienceFilterForAgent(agentId);

  const lines: string[] = [];
  lines.push("## SHARED KNOWLEDGE (Tarkie product context)");
  lines.push("");
  lines.push("The information below is the latest from the Tarkie team's shared knowledge repository. Reference these facts when answering — do not invent module names, features, or pricing that isn't listed here. If the user asks about something not covered, say so plainly and offer to bring in a human teammate.");
  lines.push("");

  // 1) Playbook (or first active "playbook" category document)
  try {
    const playbookRows = await db
      .select({ title: knowledgeDocuments.title, content: knowledgeDocuments.content, audience: knowledgeDocuments.audience })
      .from(knowledgeDocuments)
      .where(and(
        eq(knowledgeDocuments.category, "playbook"),
        eq(knowledgeDocuments.status, "active"),
      ))
      .orderBy(desc(knowledgeDocuments.updatedAt))
      .limit(1);
    const p = playbookRows[0];
    if (p && allowedAudience.includes((p.audience as Audience) || "all")) {
      lines.push(`### ${p.title}`);
      lines.push("");
      lines.push(truncate(p.content, PLAYBOOK_CAP));
      lines.push("");
    }
  } catch {}

  // 2) Module catalog
  try {
    const mods = await db
      .select({
        name: knowledgeModules.name,
        category: knowledgeModules.category,
        description: knowledgeModules.description,
        whoItsFor: knowledgeModules.whoItsFor,
        keyFeatures: knowledgeModules.keyFeatures,
        priceNote: knowledgeModules.priceNote,
        status: knowledgeModules.status,
        audience: knowledgeModules.audience,
      })
      .from(knowledgeModules)
      .where(eq(knowledgeModules.status, "active"))
      .orderBy(asc(knowledgeModules.name));

    const visibleMods = mods.filter(m => allowedAudience.includes((m.audience as Audience) || "all"));

    if (visibleMods.length > 0) {
      lines.push("### Tarkie Module Catalog");
      lines.push("");
      lines.push("These are the current Tarkie modules. When a client asks if you can do X, check whether an existing module already solves it before suggesting a custom build:");
      lines.push("");
      let used = 0;
      for (const m of visibleMods) {
        const block = formatModule(m);
        if (used + block.length > MODULE_DESCRIPTION_CAP) {
          lines.push(`_…${visibleMods.length - (visibleMods.indexOf(m))} more modules omitted for length._`);
          break;
        }
        lines.push(block);
        used += block.length;
      }
      lines.push("");
    }
  } catch {}

  // 3) Recent feed entries
  try {
    const cutoff = new Date(Date.now() - RECENT_FEED_DAYS * 86_400_000).toISOString();
    const now = new Date().toISOString();
    const feed = await db
      .select({
        title: knowledgeFeedEntries.title,
        body: knowledgeFeedEntries.body,
        publishedAt: knowledgeFeedEntries.publishedAt,
        audience: knowledgeFeedEntries.audience,
        expiresAt: knowledgeFeedEntries.expiresAt,
      })
      .from(knowledgeFeedEntries)
      .where(and(
        gt(knowledgeFeedEntries.publishedAt, cutoff),
        or(isNull(knowledgeFeedEntries.expiresAt), gt(knowledgeFeedEntries.expiresAt, now)),
      ))
      .orderBy(desc(knowledgeFeedEntries.publishedAt));

    const visibleFeed = feed.filter(f => allowedAudience.includes((f.audience as Audience) || "all"));

    if (visibleFeed.length > 0) {
      lines.push("### What's new (last 30 days)");
      lines.push("");
      let used = 0;
      for (const f of visibleFeed) {
        const date = (f.publishedAt || "").split("T")[0];
        const block = `**${date} · ${f.title}**\n${f.body}\n`;
        if (used + block.length > FEED_CAP) break;
        lines.push(block);
        used += block.length;
      }
      lines.push("");
    }
  } catch {}

  // 4) Other active documents — list titles only so the model knows they exist
  try {
    const otherDocs = await db
      .select({ title: knowledgeDocuments.title, category: knowledgeDocuments.category, audience: knowledgeDocuments.audience })
      .from(knowledgeDocuments)
      .where(and(
        eq(knowledgeDocuments.status, "active"),
      ))
      .orderBy(asc(knowledgeDocuments.title));
    const visible = otherDocs.filter(d => d.category !== "playbook" && allowedAudience.includes((d.audience as Audience) || "all"));
    if (visible.length > 0) {
      lines.push("### Other reference documents available");
      lines.push("(Mention by title if relevant — full content can be retrieved by the team on request.)");
      lines.push("");
      for (const d of visible) {
        lines.push(`- **${d.title}** (${d.category})`);
      }
      lines.push("");
    }
  } catch {}

  if (lines.length <= 4) {
    // Repository is empty — return empty so we don't pollute the prompt
    return "";
  }

  return lines.join("\n");
}

function formatModule(m: {
  name: string; category: string | null; description: string;
  whoItsFor: string | null; keyFeatures: string | null; priceNote: string | null;
}): string {
  const parts: string[] = [];
  parts.push(`**${m.name}**${m.category ? ` _(${m.category})_` : ""}`);
  parts.push(m.description);
  if (m.whoItsFor) parts.push(`*For:* ${m.whoItsFor}`);
  if (m.keyFeatures) parts.push(`*Key features:* ${m.keyFeatures}`);
  if (m.priceNote) parts.push(`*Availability:* ${m.priceNote}`);
  return parts.join("\n") + "\n";
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n\n_…truncated, see full document in admin._";
}

/**
 * Persist a new version of a document. If a doc with this slug exists, we
 * archive the prior content into KnowledgeDocumentVersion and overwrite the
 * active row. If it's brand new, we create it with version 1.
 */
export async function upsertKnowledgeDocument(args: {
  slug: string;
  title: string;
  category: string;
  content: string;
  sourceMime?: string | null;
  sourceBytes?: number | null;
  audience?: Audience;
  changeNote?: string | null;
  userId: string | null;
}): Promise<{ id: string; version: number; created: boolean }> {
  const existing = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.slug, args.slug))
    .limit(1);

  const now = new Date().toISOString();

  if (existing.length === 0) {
    const id = `kdoc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    await db.insert(knowledgeDocuments).values({
      id,
      slug: args.slug,
      title: args.title,
      category: args.category,
      content: args.content,
      sourceMime: args.sourceMime || null,
      sourceBytes: args.sourceBytes ?? null,
      version: 1,
      status: "active",
      audience: args.audience || "all",
      createdAt: now,
      updatedAt: now,
      createdByUserId: args.userId,
    });
    await db.insert(knowledgeDocumentVersions).values({
      id: `kdocv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
      documentId: id,
      version: 1,
      title: args.title,
      content: args.content,
      changeNote: args.changeNote || null,
      createdAt: now,
      createdByUserId: args.userId,
    });
    return { id, version: 1, created: true };
  }

  const current = existing[0];
  const nextVersion = (current.version || 1) + 1;
  // Snapshot the OLD content into the version history before overwriting
  await db.insert(knowledgeDocumentVersions).values({
    id: `kdocv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
    documentId: current.id,
    version: current.version,
    title: current.title,
    content: current.content,
    changeNote: null,
    createdAt: current.updatedAt,
    createdByUserId: current.createdByUserId || null,
  });
  await db.update(knowledgeDocuments)
    .set({
      title: args.title,
      category: args.category,
      content: args.content,
      sourceMime: args.sourceMime ?? current.sourceMime,
      sourceBytes: args.sourceBytes ?? current.sourceBytes,
      version: nextVersion,
      audience: args.audience || current.audience,
      updatedAt: now,
    })
    .where(eq(knowledgeDocuments.id, current.id));
  // Also save the NEW version snapshot so version history is contiguous
  await db.insert(knowledgeDocumentVersions).values({
    id: `kdocv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
    documentId: current.id,
    version: nextVersion,
    title: args.title,
    content: args.content,
    changeNote: args.changeNote || null,
    createdAt: now,
    createdByUserId: args.userId,
  });
  return { id: current.id, version: nextVersion, created: false };
}

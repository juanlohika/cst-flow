/**
 * Phase 22 — BRD document generator.
 *
 * After Eliana emits a [BRD] summary block (parsed into an arimaRequest row
 * with category='brd'), this module runs ONE additional model call that
 * expands the 6-field summary into a full Tarkie-structured BRD document:
 * Executive Summary, As-Is process with Mermaid diagram, To-Be process with
 * Mermaid diagram, Fit-Gap Analysis, Functional Requirements per platform
 * (Field App / Dashboard / Manager App), User Stories, Acceptance Criteria,
 * Settings, Priority Summary, Approval Details.
 *
 * Stored as a Markdown blob on the arimaRequest row (brdDocument). The
 * frontend renders it with markdown + Mermaid support. An optional follow-up
 * step exports the document to Google Docs (Phase 22.1).
 *
 * Best-effort: failures are recorded in brdStatus='error' + brdError so the
 * UI can offer a "Regenerate" action.
 */
import { db } from "@/db";
import { arimaRequests, clientProfiles as clientProfilesTable, skills as skillsTable } from "@/db/schema";
import { and, eq, desc, asc } from "drizzle-orm";
import { getModelForApp, generateWithRetry } from "@/lib/ai";

const BRD_GENERATOR_INSTRUCTION = `You are the Tarkie BRD Generator.

Given:
- A structured [BRD] summary that Eliana captured from a client discovery session
- The Tarkie company context (modules, three surfaces, terminology)
- The client account context

Your job: produce a COMPLETE, professional Business Requirements Document in Markdown that follows the Tarkie standard structure EXACTLY.

## OUTPUT RULES

- Return ONLY the BRD markdown content. No preamble, no conversation, no "here is the BRD". Just the document.
- Use H1 for the title, H2 for sections, H3 for subsections.
- Use Markdown tables for any structured data (stakeholders, requirements, settings, acceptance criteria).
- For process flows, embed Mermaid sequenceDiagram code blocks. Always fence as \`\`\`mermaid.
- Segment Functional Requirements per Tarkie surface: Field App, Control Tower Dashboard, Manager App. List all three even if one is "Not Applicable".
- When a requirement involves an admin setting, name the setting INLINE (e.g., "Setting: 'Allow cancellation of visit without check-in' (Team scope, default OFF)").
- Mark any information you don't have as "[TO BE CONFIRMED]" — never invent stakeholders, dates, or details.
- The output must read like a developer can pick it up and start building. Concrete, specific, testable.

## DOCUMENT STRUCTURE (MANDATORY ORDER)

# [Title from summary]

| Revision | Date | Description | Status |
|----------|------|-------------|--------|
| Revision 0 | [CURRENT_DATE] | Initial BRD draft based on Eliana discovery | Issued |

## 1. Executive Summary
2-3 paragraphs.

## 2. Project Background
Client context + the business problem.

## 3. Objectives
Bullet list of measurable outcomes.

## 4. Scope

| In-Scope | Out-of-Scope |
|----------|--------------|
| ... | ... |

## 5. Stakeholders

| Role | Platform | Description |
|------|----------|-------------|

## 6. Current Process (As-Is)

Narrative paragraph + Mermaid sequenceDiagram.

\`\`\`mermaid
sequenceDiagram
  participant F as Field User
  participant S as Tarkie System
  ...
\`\`\`

## 7. Proposed Solution (To-Be)

Narrative paragraph + Mermaid sequenceDiagram showing the new flow.

## 8. Fit-Gap Analysis

| Process Area | Current State | Tarkie Capability | Gap | Recommendation | Requirement Type | Priority (H/M/L) |
|--------------|---------------|-------------------|-----|----------------|------------------|-------------------|

## 9. Functional Requirements per Platform

### 9.1 Field App

| Req ID | Description | Setting? | Priority | Platform |
|--------|-------------|----------|----------|----------|

### 9.2 Control Tower Dashboard

| Req ID | Description | Setting? | Priority | Platform |
|--------|-------------|----------|----------|----------|

### 9.3 Manager App

| Req ID | Description | Setting? | Priority | Platform |
|--------|-------------|----------|----------|----------|

## 10. User Stories by Role

| Role | Story | Acceptance |
|------|-------|------------|

Settings should be named inline within the story. Example:
"As a system admin, I can enable the setting 'Require photo on every visit submission' at the Team level so that ..."

## 11. User Stories by Platform

### Field App Stories
- As a field agent, I can ...

### Dashboard Stories
- As a system admin, I can ...

### Manager App Stories
- As a supervisor, I can ...

## 12. Acceptance Criteria

| Platform | Criterion | Pass Condition |
|----------|-----------|----------------|

For settings: include both ON and OFF cases.

## 13. Functional Constraints

### 13.1 Standardization & Scalability
Can this be a standard Tarkie feature or is it client-specific?

### 13.2 Client-Specific Nuances
What's unique to [Client Name].

## 14. Priority Summary

**High Priority Must-Haves**:
- ...

**Nice-to-Have (future phase)**:
- ...

## 15. Approval Details

| Role | Name | Date | Status |
|------|------|------|--------|
| Prepared by | ARIMA / Eliana — Tarkie AI BA | [CURRENT_DATE] | Draft |
| Client Approval | [TO BE CONFIRMED] | | Pending |
| Internal Approval | [TO BE CONFIRMED] | | Pending |

## 16. Missing Information

If anything was unclear or unconfirmed during discovery, list it here so the team knows what to follow up on.

---

NOW GENERATE THE BRD.`;

export interface BrdSummary {
  title: string;
  business_goal?: string;
  current_workaround?: string;
  proposed_approach?: string;
  related_module?: string;
  estimated_complexity?: string;
  notes?: string;
  priority?: string;
}

/**
 * Parse the structured description field on an arimaRequest with category='brd'
 * back into a summary object. The description is stored as multi-line markdown
 * by parseRequestBlock — we re-extract by looking for "**Field:** value" rows.
 */
export function parseBrdSummary(args: { title: string; description: string | null; priority?: string }): BrdSummary {
  const out: BrdSummary = { title: args.title, priority: args.priority };
  const desc = args.description;
  if (!desc) return out;
  const grab = (label: string): string | undefined => {
    const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]*)`, "i");
    const m = desc.match(re);
    return m ? m[1].trim() : undefined;
  };
  out.business_goal = grab("Business goal");
  out.current_workaround = grab("Current workaround");
  out.proposed_approach = grab("Proposed approach");
  out.related_module = grab("Related module");
  out.estimated_complexity = grab("Estimated complexity");
  out.notes = grab("Notes");
  return out;
}

/**
 * Build the prompt the BRD generator receives: the playbook from the skill
 * table + the client context + the captured summary.
 */
async function buildBrdGeneratorPrompt(args: {
  summary: BrdSummary;
  clientProfileId: string | null;
}): Promise<string> {
  const lines: string[] = [BRD_GENERATOR_INSTRUCTION];

  // Inject the Tarkie playbook skills so the generator knows the conventions
  try {
    const rows = await db
      .select({ content: skillsTable.content })
      .from(skillsTable)
      .where(and(eq(skillsTable.category, "brd"), eq(skillsTable.isActive, true)))
      .orderBy(asc(skillsTable.sortOrder));
    if (rows.length > 0) {
      lines.push("\n\n---\n\n## TARKIE BRD CONVENTIONS (from admin-configured skills)\n");
      lines.push(rows.map(r => r.content.trim()).join("\n\n---\n\n"));
    }
  } catch {}

  // Inject client profile context
  if (args.clientProfileId) {
    try {
      const clientRows = await db
        .select()
        .from(clientProfilesTable)
        .where(eq(clientProfilesTable.id, args.clientProfileId))
        .limit(1);
      const client = clientRows[0];
      if (client) {
        const modules = (() => {
          try {
            const arr = JSON.parse(client.modulesAvailed || "[]");
            return Array.isArray(arr) && arr.length > 0 ? arr.join(", ") : "(none specified)";
          } catch {
            return client.modulesAvailed || "(none specified)";
          }
        })();
        lines.push("\n\n---\n\n## CLIENT CONTEXT\n");
        lines.push(`- **Company:** ${client.companyName}`);
        lines.push(`- **Industry:** ${client.industry || "Unknown"}`);
        if (client.companySize) lines.push(`- **Company size:** ${client.companySize}`);
        lines.push(`- **Modules contracted:** ${modules}`);
        lines.push(`- **Engagement status:** ${client.engagementStatus || "unknown"}`);
        if ((client as any).intelligenceContent) {
          lines.push("\n### Account intelligence\n");
          lines.push(String((client as any).intelligenceContent).slice(0, 2500));
        }
      }
    } catch {}
  }

  // Inject the captured BRD summary
  lines.push("\n\n---\n\n## CAPTURED BRD SUMMARY (Eliana's discovery output)\n");
  lines.push(`- **Title:** ${args.summary.title}`);
  if (args.summary.business_goal) lines.push(`- **Business goal:** ${args.summary.business_goal}`);
  if (args.summary.current_workaround) lines.push(`- **Current workaround:** ${args.summary.current_workaround}`);
  if (args.summary.proposed_approach) lines.push(`- **Proposed approach:** ${args.summary.proposed_approach}`);
  if (args.summary.related_module) lines.push(`- **Related module:** ${args.summary.related_module}`);
  if (args.summary.estimated_complexity) lines.push(`- **Estimated complexity:** ${args.summary.estimated_complexity}`);
  if (args.summary.notes) lines.push(`- **Notes:** ${args.summary.notes}`);
  if (args.summary.priority) lines.push(`- **Priority:** ${args.summary.priority}`);

  lines.push("\n\n---\n\nNow produce the full BRD document. Output only the Markdown.");

  const currentDate = new Date().toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  return lines.join("\n").replace(/\[CURRENT_DATE\]/g, currentDate);
}

/**
 * Generate the full Tarkie-structured BRD document from a captured summary
 * and write it to the arimaRequest row. Idempotent — safe to call multiple
 * times to regenerate.
 */
export async function generateBrdDocument(args: {
  requestId: string;
}): Promise<{ ok: boolean; brdDocument?: string; error?: string }> {
  // Load the request
  const rows = await db.select().from(arimaRequests).where(eq(arimaRequests.id, args.requestId)).limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: "Request not found" };
  if (row.category !== "brd") return { ok: false, error: "Only category='brd' rows can have a BRD document generated" };

  // Mark generating
  await db.update(arimaRequests)
    .set({ brdStatus: "generating", brdError: null, updatedAt: new Date().toISOString() } as any)
    .where(eq(arimaRequests.id, row.id));

  try {
    const summary = parseBrdSummary({
      title: row.title,
      description: row.description,
      priority: row.priority,
    });

    const prompt = await buildBrdGeneratorPrompt({
      summary,
      clientProfileId: row.clientProfileId,
    });

    const model = await getModelForApp("brd").catch(() => null);
    if (!model) throw new Error("BRD Maker model not configured");

    const result = await generateWithRetry(model, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const brdMarkdown = (result?.response?.text?.() || "").trim();
    if (!brdMarkdown) throw new Error("Model returned empty BRD document");

    const now = new Date().toISOString();
    await db.update(arimaRequests)
      .set({
        brdDocument: brdMarkdown,
        brdGeneratedAt: now,
        brdStatus: "document-ready",
        brdError: null,
        updatedAt: now,
      } as any)
      .where(eq(arimaRequests.id, row.id));

    return { ok: true, brdDocument: brdMarkdown };
  } catch (e: any) {
    const errMsg = e?.message || "BRD generation failed";
    await db.update(arimaRequests)
      .set({
        brdStatus: "error",
        brdError: errMsg.slice(0, 1000),
        updatedAt: new Date().toISOString(),
      } as any)
      .where(eq(arimaRequests.id, row.id));
    return { ok: false, error: errMsg };
  }
}

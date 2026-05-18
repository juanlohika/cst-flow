/**
 * Phase B — AI rollup for AccountAssessment.
 *
 * After an RM submits a Health Assessment, we send the long-text answers
 * (alongside the structured scores) to Gemini to produce:
 *   - 3-4 sentence executive summary
 *   - bullet list of risks
 *   - bullet list of opportunities
 *   - bullet list of notable requests
 *
 * Runs as fire-and-forget after submit. Failure is non-fatal — the structured
 * answers + raw responsesJson stay intact, only the AI fields are missing,
 * and admin can re-run via /api/accounts/[id]/assessments/[assId]/regenerate.
 */
import { db } from "@/db";
import { accountAssessments, clientProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getModelForApp, generateWithRetry } from "@/lib/ai";

const SYSTEM_PROMPT = `You are the CST OS Account Health Analyst.

A Relationship Manager (RM) at Mobile Optima / Tarkie has just submitted a structured Health Assessment for one of their client accounts. Your job is to roll up the assessment into four short, CEO-readable artifacts:

1. AI_SUMMARY — 3-4 sentences. The state of this account in plain language. Lead with the most important fact (e.g. low EBA, expansion ready, churn risk). Avoid filler like "this account is performing well overall".

2. RISKS — 0 to 5 bullets. Concrete risks the CEO should know about. Pull from: low EBA scores, third-party SSOT, recent contact churn, gaps mentioned in the long-text answers. Each bullet under 20 words.

3. OPPORTUNITIES — 0 to 5 bullets. Concrete openings to act on. Pull from: high EBA + V5 readiness, requested modules, "what's working well" answers. Each bullet under 20 words.

4. NOTABLE_REQUESTS — 0 to 5 bullets. The client's most concrete asks, lifted from the RM's open-text answer about open requests. Each bullet under 15 words. Skip if no asks were mentioned.

OUTPUT FORMAT — return EXACTLY this JSON, no markdown fences, no prose before or after:

{
  "summary": "...",
  "risks": ["..."],
  "opportunities": ["..."],
  "notableRequests": ["..."]
}

Empty arrays are fine. Do not invent risks/opportunities not grounded in the assessment. Do not name the RM. Do not reference "the assessment" or "the survey" in the summary — write it as if it's a CRM card.`;

interface RollupResult {
  ok: boolean;
  summary?: string;
  risks?: string[];
  opportunities?: string[];
  notableRequests?: string[];
  error?: string;
}

export async function rollupAssessment(args: { assessmentId: string }): Promise<RollupResult> {
  const rows = await db
    .select()
    .from(accountAssessments)
    .where(eq(accountAssessments.id, args.assessmentId))
    .limit(1);
  const assessment = rows[0];
  if (!assessment) return { ok: false, error: "Assessment not found" };

  const clientRows = await db
    .select({
      companyName: clientProfiles.companyName,
      industry: clientProfiles.industry,
      modulesAvailed: clientProfiles.modulesAvailed,
    })
    .from(clientProfiles)
    .where(eq(clientProfiles.id, assessment.clientProfileId))
    .limit(1);
  const client = clientRows[0];

  const responses = safeParseJson(assessment.responsesJson, {});

  const prompt = buildPrompt({ assessment, client, responses });

  try {
    const model = await getModelForApp("brd-maker"); // reuse the same model config
    if (!model) throw new Error("No model configured");

    const result = await generateWithRetry(model, {
      contents: [
        { role: "user", parts: [{ text: SYSTEM_PROMPT + "\n\n---\n\n" + prompt }] },
      ],
    });

    const raw = (result?.response?.text?.() || "").trim();
    if (!raw) throw new Error("Model returned empty response");

    const parsed = extractJson(raw);
    if (!parsed) throw new Error("Couldn't parse model output as JSON");

    const summary = String(parsed.summary || "").trim();
    const risks = Array.isArray(parsed.risks) ? parsed.risks.map((s: any) => String(s).trim()).filter(Boolean) : [];
    const opportunities = Array.isArray(parsed.opportunities) ? parsed.opportunities.map((s: any) => String(s).trim()).filter(Boolean) : [];
    const notableRequests = Array.isArray(parsed.notableRequests) ? parsed.notableRequests.map((s: any) => String(s).trim()).filter(Boolean) : [];

    await db
      .update(accountAssessments)
      .set({
        aiSummary: summary,
        aiRisks: JSON.stringify(risks),
        aiOpportunities: JSON.stringify(opportunities),
        notableRequests: JSON.stringify(notableRequests),
        aiRollupStatus: "ok",
        aiRollupError: null,
        aiRollupAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(accountAssessments.id, args.assessmentId));

    return { ok: true, summary, risks, opportunities, notableRequests };
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    await db
      .update(accountAssessments)
      .set({
        aiRollupStatus: "failed",
        aiRollupError: errMsg.slice(0, 800),
        aiRollupAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(accountAssessments.id, args.assessmentId));
    return { ok: false, error: errMsg };
  }
}

function buildPrompt(args: { assessment: any; client?: any; responses: any }): string {
  const a = args.assessment;
  const c = args.client;

  const parts: string[] = [];
  parts.push("CLIENT CONTEXT");
  if (c) {
    parts.push(`Industry: ${c.industry || "Unknown"}`);
    parts.push(`Modules in use: ${parseModulesForDisplay(c.modulesAvailed)}`);
  }
  parts.push("");

  parts.push("STRUCTURED ANSWERS");
  parts.push(`Overall satisfaction: ${a.satisfaction ?? "—"} / 5`);
  parts.push(`EBA — Decision Maker: ${a.ebaDecisionMaker ?? "—"} / 5${a.ebaDecisionMakerNote ? ` ("${a.ebaDecisionMakerNote}")` : ""}`);
  parts.push(`EBA — Admin: ${a.ebaAdmin ?? "—"} / 5${a.ebaAdminNote ? ` ("${a.ebaAdminNote}")` : ""}`);
  parts.push(`Recent contact change: ${a.contactChangeRecent ? "Yes" : "No"}${a.contactChangeNote ? ` — ${a.contactChangeNote}` : ""}`);
  parts.push(`Tarkie is SSOT: ${a.isTarkieSsot === true ? "Yes" : a.isTarkieSsot === false ? "No" : "Unknown"}${a.thirdPartySsot ? ` (third-party: ${a.thirdPartySsot})` : ""}`);
  parts.push(`V5 readiness: ${a.v5Readiness ?? "—"} / 5`);
  if (a.requestedModules) {
    const mods = safeParseJson(a.requestedModules, []);
    if (Array.isArray(mods) && mods.length > 0) {
      parts.push(`Requested modules: ${mods.join(", ")}`);
    }
  }
  parts.push("");

  parts.push("LONG-TEXT ANSWERS");
  const r = args.responses || {};
  if (r.b1_overall_state) parts.push(`Q: Overall state of this account\nA: ${r.b1_overall_state}`);
  if (r.b2_whats_working) parts.push(`Q: What is working well\nA: ${r.b2_whats_working}`);
  if (r.b3_gaps_pain_points) parts.push(`Q: Gaps or pain points repeatedly raised\nA: ${r.b3_gaps_pain_points}`);
  if (r.d3_why_not_ssot) parts.push(`Q: Why is Tarkie not SSOT, and what would make it so\nA: ${r.d3_why_not_ssot}`);
  if (r.e1_open_requests) parts.push(`Q: Most notable open requests right now\nA: ${r.e1_open_requests}`);
  if (r.e4_single_action) parts.push(`Q: Single action to most strengthen this account in 90 days\nA: ${r.e4_single_action}`);
  if (r.e5_other) parts.push(`Q: Anything else the CEO should know\nA: ${r.e5_other}`);

  return parts.join("\n");
}

function safeParseJson(raw: string | null | undefined, fallback: any): any {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function extractJson(raw: string): any | null {
  // Strip markdown fences if present
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(stripped); } catch {}
  // Look for a JSON object inside the text
  const match = stripped.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return null;
}

function parseModulesForDisplay(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.join(", ") || "None";
  } catch {}
  return String(raw);
}

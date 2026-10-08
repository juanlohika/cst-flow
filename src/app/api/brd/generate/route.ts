import { NextResponse } from "next/server";
import { getClaudeModel, getModelForApp, generateWithRetry, getGroqModel,
         readAIConfig, GROQ_MODELS } from "@/lib/ai";
import { db } from "@/db";
import { skills as skillsTable, brdGenerationLogs, users as usersTable } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import mammoth from "mammoth";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";

/**
 * Skills that tell the assistant how to use a TOOL rather than how to write the
 * document. Excluded from the generation prompt to keep the token budget for
 * the BRD itself.
 */
const TOOL_ONLY_SKILLS = new Set(["skill-brd-share-pdf"]);

interface Attachment {
  name: string;
  mimeType: string;
  data: string; // base64
}

/**
 * BRD Generation Route — Phase 20.1 rewrite
 *
 * Previously: loaded ONE skill (most recently updated), then unconditionally
 * appended three hardcoded prompt blocks (DOCUMENT_STANDARDS, TAGLISH_RULE,
 * CONVERSATION_GUARDRAIL). This meant edits in /admin/skills were partially
 * ignored because the hardcoded blocks came LAST in the prompt — and LLMs
 * weight later instructions more heavily.
 *
 * Now: loads ALL active skills with category="brd", concatenated in sortOrder
 * (ascending — lower sortOrder = higher priority, comes first). No hardcoded
 * prompt content. The skill table is the single source of truth.
 *
 * The previously-hardcoded blocks have been promoted to seedable skills:
 *   - brd-document-standards (sortOrder 10)
 *   - brd-taglish-rule       (sortOrder 20)
 *   - brd-conversation-guardrail (sortOrder 30)
 *
 * The main playbook lives in `brd-default` at sortOrder 0 so it always
 * leads the prompt.
 */

/**
 * Pull a title out of the generated BRD. The playbook asks for a top-level
 * heading, so take the first one; fall back to the first non-empty line that
 * reads like a title. Returns null rather than guessing badly.
 */
function extractBrdTitle(markdown: string): string | null {
  if (!markdown) return null;
  const heading = markdown.match(/^\s{0,3}#{1,2}\s+(.+?)\s*$/m);
  if (heading) {
    const t = heading[1].replace(/[*_`#]/g, "").trim();
    if (t) return t.slice(0, 200);
  }
  for (const raw of markdown.split("\n").slice(0, 10)) {
    const line = raw.replace(/[*_`#|>-]/g, "").trim();
    if (line.length >= 8 && line.length <= 200 && !line.endsWith(".")) return line;
  }
  return null;
}

/**
 * Record that a BRD was generated. Metadata only — the document body is never
 * stored. Deliberately swallows its own errors: a logging failure must not
 * cost the user their BRD.
 */
async function logBrdGeneration(entry: {
  session: any;
  title: string | null;
  isFirstDraft: boolean;
  model: string | null;
  messageCount: number;
  contentLength: number;
  durationMs: number;
  errorMessage?: string | null;
}) {
  try {
    const userId = entry.session?.user?.id ?? null;
    let userName = entry.session?.user?.name ?? null;
    let userEmail = entry.session?.user?.email ?? null;

    // The JWT stamps id and role but not reliably a name, so read it once when
    // it is missing — the log is only useful if it says who.
    if (userId && !userName) {
      try {
        const [row] = await db
          .select({ name: usersTable.name, email: usersTable.email })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        if (row) { userName = row.name ?? userName; userEmail = row.email ?? userEmail; }
      } catch { /* name lookup is a nicety, not a reason to drop the row */ }
    }

    await db.insert(brdGenerationLogs).values({
      userId,
      userName,
      userEmail,
      title: entry.title,
      isFirstDraft: entry.isFirstDraft,
      model: entry.model,
      messageCount: entry.messageCount,
      contentLength: entry.contentLength,
      durationMs: entry.durationMs,
      errorMessage: entry.errorMessage ?? null,
    });
  } catch (err) {
    console.error("BRD usage log write failed:", err);
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  // Usage logging needs to know who ran this. The route stays usable without a
  // session (it never required one) — the row is simply written with no user.
  const session = await auth().catch(() => null);
  let logCtx = { messageCount: 0, isFirstDraft: true, modelId: null as string | null };

  try {
    await ensureAccessSchema();
    const { prompt, messages, systemInstruction, attachments, model: modelOverride } =
      await req.json();
    logCtx.messageCount = Array.isArray(messages) ? messages.length : 0;
    // A conversation that is only the opening turn is the first draft of a BRD;
    // anything later is a refinement of one already on screen.
    logCtx.isFirstDraft = logCtx.messageCount <= 1;
    const currentDate = new Date().toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    if (!prompt && (!messages || messages.length === 0)) {
      return NextResponse.json({ error: "Prompt required" }, { status: 400 });
    }

    // Use the app's configured provider (set in Admin → Apps → BRD Maker)
    // Falls back to global primary provider if no app-specific override
    // A model picked in the BRD Maker UI wins over the app/global default.
    // Only Groq ids are accepted, so the picker cannot select a paid provider.
    const model = await (async () => {
      if (modelOverride && GROQ_MODELS.some((m) => m.id === modelOverride)) {
        const cfg = await readAIConfig();
        if (cfg.groqApiKey) return getGroqModel(cfg.groqApiKey, modelOverride);
      }
      return getModelForApp("brd").catch(async (e) => {
        console.warn("[brd/generate] getModelForApp failed, trying Claude directly:", e.message);
        return getClaudeModel();
      });
    })();

    // Load ALL active BRD skills, concatenated in priority order.
    // Lower sortOrder = appears first (= higher priority in the prompt).
    let baseInstruction = "";
    let skillCount = 0;
    try {
      const rows = await db
        .select()
        .from(skillsTable)
        .where(and(eq(skillsTable.category, "brd"), eq(skillsTable.isActive, true)))
        .orderBy(asc(skillsTable.sortOrder), asc(skillsTable.name));

      // Groq's free tier allows 8,000 tokens per MINUTE across prompt +
      // completion. The BRD skills alone were ~3,900 tokens, which left too
      // little for a full document and returned 413. Tool-usage skills do not
      // shape the document, so they are excluded from the writing prompt.
      const WRITING_SKILLS = rows.filter(s => !TOOL_ONLY_SKILLS.has(s.id));
      skillCount = WRITING_SKILLS.length;
      if (WRITING_SKILLS.length > 0) {
        baseInstruction = WRITING_SKILLS.map(s => s.content.trim()).join("\n\n---\n\n");
      }
    } catch (dbErr: any) {
      console.error("[brd/generate] Failed to fetch BRD skills:", dbErr);
      return NextResponse.json({
        error: "BRD Maker is misconfigured — could not load BRD skills from the admin console. Please contact your admin.",
        diagnostic: dbErr?.message,
      }, { status: 500 });
    }

    // Loud failure if nothing was loaded — previously this silently fell
    // back to a generic instruction, which made the BRD output look "off"
    // with no visible reason why.
    if (!baseInstruction) {
      // Caller might have sent a systemInstruction override (rare; legacy).
      // Honor it but warn.
      if (systemInstruction) {
        console.warn("[brd/generate] No active BRD skills in DB — falling back to caller-provided systemInstruction.");
        baseInstruction = String(systemInstruction);
      } else {
        return NextResponse.json({
          error: "BRD Maker has no active skills configured. Go to /admin/skills and ensure at least one skill with category='brd' is active.",
        }, { status: 500 });
      }
    }

    const finalSystemInstruction = `${baseInstruction}\n\n---\n\nCURRENT DATE: ${currentDate}`;

    // ─── Build the content + handle attachments ─────────────────────
    const attachmentList: Attachment[] = Array.isArray(attachments) ? attachments : [];
    const docTexts: string[] = [];
    for (const att of attachmentList) {
      if (att.mimeType.includes("wordprocessingml") || att.mimeType === "application/msword") {
        try {
          const buffer = Buffer.from(att.data, "base64");
          const { value } = await mammoth.extractRawText({ buffer });
          docTexts.push(`[Attached Doc: ${att.name}]\n${value}`);
        } catch (err) {}
      }
    }

    const inlineAttachments = attachmentList.filter(
      a => a.mimeType.startsWith("image/") || a.mimeType === "application/pdf"
    );

    let requestContents: any[] = [];
    if (messages && messages.length > 0) {
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        const isLast = i === messages.length - 1;
        const parts: any[] = [{ text: m.content }];
        if (isLast && m.role === "user") {
          if (docTexts.length > 0) parts[0].text += "\n\n" + docTexts.join("\n\n");
          for (const att of inlineAttachments) {
            parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
          }
        }
        requestContents.push({ role: m.role === "model" ? "model" : "user", parts });
      }
    } else {
      const parts: any[] = [{ text: prompt }];
      if (docTexts.length > 0) parts[0].text += "\n\n" + docTexts.join("\n\n");
      for (const att of inlineAttachments) {
        parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
      }
      requestContents = [{ role: "user", parts }];
    }

    const result = await generateWithRetry(model, {
      contents: requestContents,
      systemInstruction: { role: "system", parts: [{ text: finalSystemInstruction }] },
      // Enough for a full 15-section BRD (~3,200 tokens observed) while staying
      // inside Groq's 8,000 tokens-per-minute free-tier allowance.
      generationConfig: { maxOutputTokens: 4300 },
    });

    const generated = result.response.text();
    logCtx.modelId = (model as any).modelId ?? null;

    await logBrdGeneration({
      session,
      title: extractBrdTitle(generated),
      isFirstDraft: logCtx.isFirstDraft,
      model: logCtx.modelId,
      messageCount: logCtx.messageCount,
      contentLength: generated.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      content: generated,
      meta: { skillsLoaded: skillCount, model: logCtx.modelId },
    });
  } catch (error: any) {
    console.error("BRD Generation error:", error);
    // Log failures too — a tool that errors for someone is worth seeing.
    await logBrdGeneration({
      session,
      title: null,
      isFirstDraft: logCtx.isFirstDraft,
      model: logCtx.modelId,
      messageCount: logCtx.messageCount,
      contentLength: 0,
      durationMs: Date.now() - startedAt,
      errorMessage: String(error?.message ?? error).slice(0, 500),
    });
    const isOverloaded = error?.status === 503 || error?.message?.toLowerCase().includes("overload");
    return NextResponse.json({ error: error.message }, { status: isOverloaded ? 503 : 500 });
  }
}

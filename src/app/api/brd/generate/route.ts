import { NextResponse } from "next/server";
import { getClaudeModel, getModelForApp, generateWithRetry } from "@/lib/ai";
import { db } from "@/db";
import { skills as skillsTable } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import mammoth from "mammoth";

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
export async function POST(req: Request) {
  try {
    const { prompt, messages, systemInstruction, attachments } = await req.json();
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
    const model = await getModelForApp("brd").catch(async (e) => {
      console.warn("[brd/generate] getModelForApp failed, trying Claude directly:", e.message);
      return getClaudeModel();
    });

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

      skillCount = rows.length;
      if (rows.length > 0) {
        baseInstruction = rows.map(s => s.content.trim()).join("\n\n---\n\n");
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
    });

    return NextResponse.json({
      content: result.response.text(),
      meta: { skillsLoaded: skillCount },
    });
  } catch (error: any) {
    console.error("BRD Generation error:", error);
    const isOverloaded = error?.status === 503 || error?.message?.toLowerCase().includes("overload");
    return NextResponse.json({ error: error.message }, { status: isOverloaded ? 503 : 500 });
  }
}

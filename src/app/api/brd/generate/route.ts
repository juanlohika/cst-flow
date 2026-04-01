import { NextResponse } from "next/server";
import { getClaudeModel } from "@/lib/ai";
import { db } from "@/db";
import { skills as skillsTable } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import mammoth from "mammoth";

interface Attachment {
  name: string;
  mimeType: string;
  data: string; // base64
}

const DOCUMENT_STANDARDS = `
DOCUMENT STANDARDS (MANDATORY):
1. HEADER: The title must ALWAYS be the COMPLETE project title as an H1 (# Title).
2. REVISION HISTORY: Add a "Revision History" table immediately after the title but before the Executive Summary.
   Columns: Revision | Date | Description | Status
   Fill with "Revision 0 | [CURRENT_DATE] | Initial BRD draft based on requirements | Issued"
3. TARKIE ECOSYSTEM: Always segment requirements for "Field App", "Dashboard", and "Manager App".
4. DATES: Use the provided current date for any date fields.
`.trim();

const CONVERSATION_GUARDRAIL = `
CRITICAL BEHAVIOR RULE: 
- If this is the start of a project or a new feature request, DO NOT generate a full BRD yet.
- Instead, perform STEP 1 (Project Setup) or STEP 2 (Deep Dive) of your discovery process.
- Ask the user the numbered questions required by your mission.
- Only generate the "STEP 5 — GENERATE BRD DRAFT" once you have enough details about the Field App, Dashboard, and Manager App capabilities.
`.trim();

export async function POST(req: Request) {
  try {
    const { prompt, messages, systemInstruction, attachments } = await req.json();
    const currentDate = new Date().toLocaleDateString("en-US", { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });

    if (!prompt && (!messages || messages.length === 0)) {
      return NextResponse.json({ error: "Prompt required" }, { status: 400 });
    }

    const model = await getClaudeModel();

    let dbSkill = "";
    try {
      const skills = await db.select()
        .from(skillsTable)
        .where(and(eq(skillsTable.category, "brd"), eq(skillsTable.isActive, true)))
        .orderBy(desc(skillsTable.updatedAt))
        .limit(1);
      
      if (skills.length > 0) dbSkill = skills[0].content;
    } catch (dbErr) {
      console.error("Failed to fetch BRD skill:", dbErr);
    }

    const fallbackInstruction = `You are a professional Business Analyst. Use the Tarkie Standard BRD Framework to elicit requirements (Field App, Dashboard, Manager App) and generate drafts only when Steps 1-3 are complete.`;
    const baseInstruction = dbSkill || systemInstruction || fallbackInstruction;
    
    // Inject the new document standards and real-time date
    const finalSystemInstruction = `
${baseInstruction}

CURRENT DATE: ${currentDate}

---
${DOCUMENT_STANDARDS}

---
${CONVERSATION_GUARDRAIL}

---
ADDITIONAL INSTRUCTIONS:
- If the user asks for a BRD but hasn't provided Step 1 (Overview) or Step 2 (Process Flow) details, you MUST pause and ask the specific questions from those steps.
- Do NOT hallucinate names or objectives.
- Be concise but thorough.
`.trim();

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

    const result = await model.generateContent({
      contents: requestContents,
      systemInstruction: { role: "system", parts: [{ text: finalSystemInstruction }] },
    });

    return NextResponse.json({ content: result.response.text() });
  } catch (error: any) {
    console.error("BRD Generation error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

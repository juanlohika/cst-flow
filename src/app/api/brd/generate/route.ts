import { NextResponse } from "next/server";
import { getClaudeModel } from "@/lib/ai";
import { prisma } from "@/lib/prisma";
import mammoth from "mammoth";

interface Attachment {
  name: string;
  mimeType: string;
  data: string; // base64
}

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
    if (!prompt && (!messages || messages.length === 0)) {
      return NextResponse.json({ error: "Prompt or messages required" }, { status: 400 });
    }

    // Always use Claude for BRD (best at complex business logic and vision)
    const model = await getClaudeModel();

    // Fetch the active BRD skill from the database (your "360 Ecosystem" prompt)
    let dbSkill = "";
    try {
      const skill = await (prisma as any).skill.findFirst({
        where: { category: "brd", isActive: true },
        orderBy: { updatedAt: 'desc' }
      });
      if (skill) dbSkill = skill.content;
    } catch (dbErr) {
      console.error("Failed to fetch BRD skill from DB:", dbErr);
    }

    const fallbackInstruction = `You are a Senior Business Analyst creating a BRD. Ensure you cover the Tarkie 360 ecosystem: Field App, Dashboard, and Manager App.`;
    const baseInstruction = dbSkill || systemInstruction || fallbackInstruction;
    
    // Inject the conversational guardrail to prevent premature generation
    const finalSystemInstruction = `${baseInstruction}\n\n---\n${CONVERSATION_GUARDRAIL}`;

    const attachmentList: Attachment[] = Array.isArray(attachments) ? attachments : [];

    // Pre-process Word files (docx)
    const docTexts: string[] = [];
    for (const att of attachmentList) {
      if (att.mimeType.includes("wordprocessingml") || att.mimeType === "application/msword") {
        try {
          const buffer = Buffer.from(att.data, "base64");
          const { value } = await mammoth.extractRawText({ buffer });
          docTexts.push(`Content of attached document "${att.name}":\n${value}`);
        } catch (err) {
          console.error(`Mammoth error on ${att.name}:`, err);
        }
      }
    }

    // Inline attachments (Images and PDFs)
    const inlineAttachments = attachmentList.filter(
      a => a.mimeType.startsWith("image/") || a.mimeType === "application/pdf"
    );

    let requestContents: any[] = [];
    if (messages && messages.length > 0) {
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        const isLast = i === messages.length - 1;
        const parts: any[] = [{ text: m.content }];

        // On the last user message, attach visual/doc data
        if (isLast && m.role === "user") {
          // Add Word text
          if (docTexts.length > 0) {
            parts[0].text += "\n\n" + docTexts.join("\n\n");
          }
          // Add Inline data (Images/PDFs)
          for (const att of inlineAttachments) {
            parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
          }
        }

        requestContents.push({
          role: m.role === "model" ? "model" : "user",
          parts
        });
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

    const text = result.response.text();

    return NextResponse.json({ content: text });
  } catch (error: any) {
    console.error("Error generating BRD:", error);
    return NextResponse.json({ error: error.message || "Failed to generate BRD" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getModelForApp, getClaudeModel, generateWithRetry } from "@/lib/ai";
import mammoth from "mammoth";

interface Attachment {
  name: string;
  mimeType: string;
  data: string; // base64
}

// CSS variable definitions injected into every generated HTML output
const CSS_VARS_BLOCK = `
  /* Tarkie Design System tokens */
  --color-surface-default: #FFFFFF;
  --color-surface-subtle: #FAFAFA;
  --color-surface-muted: #F5F5F5;
  --color-surface-table-header: #FCFCFC;
  --color-text-primary: #252B37;
  --color-text-muted: #535862;
  --color-text-secondary: #717680;
  --color-border-default: #E9EAEB;
  --color-blue-500: #2162F9;
  --color-blue-50: #F1F7FF;
  --color-green-500: #17B26A;
  --color-ember-500: #EF4444;
  --color-yellow-500: #F79009;
`.trim();

const TAGLISH_RULE = `
SUPPORTED LANGUAGE (TAGLISH): The input description or feedback may contain a mix of English and Filipino (Taglish). You must comprehend the meaning in both languages and ensure the final mockup UI (labels, buttons, placeholder data) is written in formal, professional English.
`;

const BASE_SYSTEM_INSTRUCTION = `You are a senior UI engineer who converts designs and descriptions into pixel-perfect, self-contained HTML mockups.
${TAGLISH_RULE}

OUTPUT FORMAT — NON-NEGOTIABLE:
- Return ONLY a complete valid HTML document. No markdown. No code fences. No explanation. No comments outside the HTML.
- The <style> tag in <head> MUST begin with a :root block that defines ALL CSS custom properties used. Copy the token values exactly as given below.
- Use Inter font via Google Fonts: <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
- Every element must look like a real production UI — not a wireframe, not a generic Bootstrap page.
- Use realistic placeholder data (real names, dates, numbers, status labels).

REQUIRED :root BLOCK — include verbatim in every output:
:root {
${CSS_VARS_BLOCK}
}

CONTENT RULES — CRITICAL:
- When the user requests a specific screen (e.g. "kanban board", "dashboard", "form", "table"), generate the FULL CONTENT of that screen.
- Do NOT generate a navigation sidebar/shell where the requested feature is only shown as a menu item. The requested feature IS the main content.
- If the user says "kanban board", the entire viewport must be filled with a working kanban board layout with columns and cards — not a nav that mentions kanban.
- If a sidebar nav is appropriate context, keep it minimal (collapsed or simple). The primary focus area must contain the actual requested UI component.
- Fill every column/section with at least 3–5 realistic placeholder items so the layout looks populated, not empty.

SCREENSHOT REPLICATION RULES (applies when an image is attached):
1. Study the screenshot before generating any HTML.
2. Identify every UI region: nav, header/toolbar, table/list, cards, modals, etc.
3. Match the layout structure exactly — same column count, same proportions, same stacking order.
4. Match spacing: measure visual gaps between elements and reproduce them.
5. Match typography: size hierarchy, weights, color contrast.
6. Match component shapes: border radius, borders, shadow styles.
7. Do NOT add elements that are not in the screenshot.
8. Do NOT remove elements that ARE in the screenshot.
9. The screenshot takes absolute priority over your own aesthetic preferences.

ITERATION RULES (applies when previous HTML is provided):
- When asked to change, add, or fix something, return the FULL updated HTML — not a diff or partial snippet.
- Only change what was explicitly requested. Preserve everything else.`;

export async function POST(req: Request) {
  try {
    const { prompt, messages, brdContext, designSkill, attachments, previousHtml } = await req.json();
    if (!prompt && (!messages || messages.length === 0)) {
      return NextResponse.json({ error: "Prompt or messages required" }, { status: 400 });
    }

    // Use app-specific provider if set, otherwise fall back to Claude (best vision quality)
    let model: any;
    try {
      model = await getModelForApp("mockup");
    } catch {
      model = await getClaudeModel();
    }

    // Design skill goes FIRST — it overrides the base instruction where they conflict
    const systemInstruction = designSkill
      ? `${designSkill}\n\n---\n\n${BASE_SYSTEM_INSTRUCTION}`
      : BASE_SYSTEM_INSTRUCTION;

    const attachmentList: Attachment[] = Array.isArray(attachments) ? attachments : [];

    // Pre-process Word files — extract text (Gemini doesn't support docx natively)
    const wordTextParts: { name: string; text: string }[] = [];
    for (const att of attachmentList) {
      if (att.mimeType.includes("wordprocessingml") || att.mimeType === "application/msword") {
        try {
          const buffer = Buffer.from(att.data, "base64");
          const result = await mammoth.extractRawText({ buffer });
          wordTextParts.push({ name: att.name, text: result.value });
        } catch {
          wordTextParts.push({ name: att.name, text: "[Could not extract text from document]" });
        }
      }
    }

    const inlineAttachments = attachmentList.filter(
      (a) => a.mimeType.startsWith("image/") || a.mimeType === "application/pdf"
    );

    const hasImages = inlineAttachments.some((a) => a.mimeType.startsWith("image/"));

    let requestContents: any[] = [];

    if (messages && messages.length > 0) {
      for (let idx = 0; idx < messages.length; idx++) {
        const m = messages[idx];
        const isLastUserMessage = idx === messages.length - 1 && m.role === "user";
        const parts: any[] = [];

        let textContent = m.content;

        // Inject BRD context into the first user message
        if (idx === 0 && m.role === "user" && brdContext) {
          textContent = `BRD Context:\n${brdContext}\n\n---\n\n${textContent}`;
        }

        // For the last user message: prefix with screenshot analysis instruction if images attached
        if (isLastUserMessage && hasImages) {
          textContent = `I am attaching a screenshot. Study it carefully before generating HTML.\n\nYour task: ${textContent || "Replicate this screen as a high-fidelity HTML mockup. Match the layout, spacing, typography, and components exactly."}`;
        }

        // For the last user message: inject previous HTML as context for iteration
        if (isLastUserMessage && previousHtml) {
          textContent += `\n\n---\nPREVIOUS HTML OUTPUT (modify this, do not start from scratch):\n${previousHtml}`;
        }

        parts.push({ text: textContent });

        // Inline images + PDFs on last user message
        if (isLastUserMessage) {
          for (const att of inlineAttachments) {
            parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
          }
          for (const doc of wordTextParts) {
            parts.push({ text: `\n\nDocument content from "${doc.name}":\n${doc.text}` });
          }
        }

        requestContents.push({ role: m.role, parts });
      }
    } else {
      const parts: any[] = [];
      let userText = brdContext ? `BRD Context:\n${brdContext}\n\n---\n\n${prompt}` : prompt;

      if (hasImages) {
        userText = `I am attaching a screenshot. Study it carefully before generating HTML.\n\nYour task: ${userText || "Replicate this screen as a high-fidelity HTML mockup. Match the layout, spacing, typography, and components exactly."}`;
      }

      if (previousHtml) {
        userText += `\n\n---\nPREVIOUS HTML OUTPUT (modify this, do not start from scratch):\n${previousHtml}`;
      }

      parts.push({ text: userText });

      for (const att of inlineAttachments) {
        parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
      }
      for (const doc of wordTextParts) {
        parts.push({ text: `\n\nDocument content from "${doc.name}":\n${doc.text}` });
      }

      requestContents = [{ role: "user", parts }];
    }

    const result = await generateWithRetry(model, {
      contents: requestContents,
      systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
    });

    // Strip any accidental markdown fences from the response
    let html = result.response.text().trim();
    const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/);
    if (fence) html = fence[1].trim();

    return NextResponse.json({ html });
  } catch (error: any) {
    console.error("Error generating mockup:", error);
    return NextResponse.json({ error: error.message || "Failed to generate mockup" }, { status: 500 });
  }
}

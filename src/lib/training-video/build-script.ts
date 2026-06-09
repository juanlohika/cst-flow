/**
 * Phase G.1 — Gemini-driven script generation for training videos.
 *
 * Pipeline:
 *   1. Caller passes the PPTX bytes + optional user prompt.
 *   2. We send the whole PPTX as inlineData to Gemini in a single call.
 *   3. Gemini returns a JSON list of scenes (one per slide, in order).
 *   4. Each scene has a title, narration script (TTS source), and caption.
 *
 * Why one big call: keeps the scenes coherent. Gemini sees the whole deck
 * at once and writes scripts that flow naturally from one slide to the next.
 *
 * Skills (loaded from /admin/skills, category="training-video") are
 * concatenated and prepended to the system prompt — same pattern as
 * BRD + Proposal Maker.
 */
import { getModelForApp, generateWithRetry } from "@/lib/ai";
import { db } from "@/db";
import { skills as skillsTable } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import type { TrainingVideoContent, TrainingScene, AiNotes } from "./types";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export interface BuildScriptArgs {
  pptxBuffer: Buffer;
  title: string;
  userPrompt?: string;
  language?: string;
}

export interface ChatRefineArgs {
  userMessage: string;
  currentContent: TrainingVideoContent;
  language?: string;
}

export interface AiResult {
  ok: boolean;
  content?: TrainingVideoContent;
  reply?: string;
  error?: string;
  rawAi?: string;
}

/**
 * Initial script generation — runs once per video at upload time.
 */
export async function buildScriptFromPptx(args: BuildScriptArgs): Promise<AiResult> {
  const model = await getModelForApp("training-videos").catch(() => null);
  if (!model) return { ok: false, error: "No AI model configured" };

  const skillsBlock = await loadSkillsBlock();
  const promptText = buildInitialPrompt({
    skillsBlock,
    title: args.title,
    userPrompt: args.userPrompt || "",
    language: args.language || "en-US",
  });

  const result = await generateWithRetry(model, {
    contents: [{
      role: "user",
      parts: [
        { text: promptText },
        { inlineData: { mimeType: PPTX_MIME, data: args.pptxBuffer.toString("base64") } },
      ],
    }],
  });

  const raw = (result?.response?.text?.() || "").trim();
  const parsed = parseAiResponse(raw);
  if (!parsed) return { ok: false, error: "AI returned non-JSON output", rawAi: raw };
  return { ok: true, content: parsed.content, reply: parsed.reply };
}

/**
 * Conversational refinement — re-runs script gen with the existing content
 * + the new user message. AI returns updated content (or null if just a
 * clarifying question) plus a chat reply.
 */
export async function refineScriptWithChat(args: ChatRefineArgs): Promise<AiResult> {
  const model = await getModelForApp("training-videos").catch(() => null);
  if (!model) return { ok: false, error: "No AI model configured" };

  const skillsBlock = await loadSkillsBlock();
  const promptText = buildRefinePrompt({
    skillsBlock,
    currentContent: args.currentContent,
    userMessage: args.userMessage,
    language: args.language || "en-US",
  });

  const result = await generateWithRetry(model, {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
  });

  const raw = (result?.response?.text?.() || "").trim();
  const parsed = parseAiResponse(raw);
  if (!parsed) return { ok: false, error: "AI returned non-JSON output", rawAi: raw };

  // If AI didn't produce updated content (e.g. it just asked a question),
  // keep the existing content. Caller decides whether to persist.
  return {
    ok: true,
    content: parsed.content || args.currentContent,
    reply: parsed.reply,
  };
}

// ─────────────────────────────────────────────────────────────────────

async function loadSkillsBlock(): Promise<string> {
  try {
    const rows = await db.select()
      .from(skillsTable)
      .where(and(eq(skillsTable.category, "training-video"), eq(skillsTable.isActive, true)))
      .orderBy(asc(skillsTable.sortOrder), asc(skillsTable.name));
    if (rows.length === 0) return "";
    return rows.map(s => s.content.trim()).join("\n\n---\n\n");
  } catch (e) {
    console.warn("[training-video/build-script] skill load failed:", e);
    return "";
  }
}

function buildInitialPrompt(args: {
  skillsBlock: string;
  title: string;
  userPrompt: string;
  language: string;
}): string {
  return `${args.skillsBlock ? args.skillsBlock + "\n\n---\n\n" : ""}You are generating narration scripts for a training video at Tarkie (MobileOptima, Inc.). A team member uploaded a PowerPoint deck. Your job: read every slide and produce a scene-by-scene narration script that will be turned into voiceover audio.

Each slide becomes ONE scene. Read both the slide text AND the speaker notes (if present). Speaker notes are the preferred narration source when available.

═══════════════════════════════════════════════════════════
OUTPUT FORMAT (STRICT JSON ONLY — no markdown fences, no commentary)
═══════════════════════════════════════════════════════════
{
  "reply": "string — short conversational message to the team member (1-2 sentences). Acknowledge what you produced and flag anything that needs review.",
  "content": {
    "title": "${escapeJson(args.title)}",
    "scenes": [
      {
        "order": 1,
        "title": "Welcome",
        "narrationScript": "Welcome to Tarkie. In this short training, you'll learn how to set up your account.",
        "sourceSlideNumber": 1,
        "caption": "Welcome to Tarkie. In this short training, you'll learn how to set up your account.",
        "aiNote": "Used the speaker notes directly."
      }
    ],
    "aiNotes": {
      "inferred": ["I assumed the audience is new field promoters."],
      "missing": ["Confirm the call-to-action at the end."],
      "summary": "Generated narration for 7 slides covering account setup and first check-in."
    }
  }
}

═══════════════════════════════════════════════════════════
VOICE & STYLE GUIDELINES
═══════════════════════════════════════════════════════════
- AUDIENCE: new field staff using Tarkie. Friendly, encouraging, plain language.
- SENTENCES: 1-3 short sentences per scene. Each scene narrates for roughly 5-15 seconds.
- NO JARGON: skip "leverage", "synergy", "best-in-class", "robust", "seamless".
- ACTIVE VOICE: "You'll tap the check-in button" not "the check-in button will be tapped".
- NAME THINGS DIRECTLY: "the green Check-In button" not "the action button on the screen".
- CONTINUITY: scenes should flow into each other. Don't repeat introductions. Each scene assumes the user just heard the previous one.
- CAPTION = NARRATION: for v1, the caption text matches the spoken text word-for-word. Future versions may shorten captions.
- LANGUAGE: ${args.language}. If the source slides are in Taglish, match the mix the slides use.

═══════════════════════════════════════════════════════════
RULES
═══════════════════════════════════════════════════════════
1. Read the ENTIRE deck before generating. Don't write the first scene until you understand the arc.
2. NEVER invent content not implied by the slide + notes. If a slide is empty, generate a placeholder narration and flag it in aiNotes.missing.
3. NEVER write "[insert X]" or "TBD" in the narrationScript. Either write real text or leave the scene blank and flag it.
4. Preserve the slide order. One scene per slide.
5. If a slide is a section divider (only a title, no detail), keep its scene short ("Next, let's talk about field check-ins.").
6. The final scene should have a clean closing line ("That's it for now. Tap the check-in button to start your first day.").

═══════════════════════════════════════════════════════════
GUIDANCE FROM THE TEAM MEMBER (optional)
═══════════════════════════════════════════════════════════
${args.userPrompt || "(none — use your best judgment)"}

═══════════════════════════════════════════════════════════
THE POWERPOINT FILE IS ATTACHED BELOW AS INLINE DATA.

Read it carefully. Produce the JSON.`;
}

function buildRefinePrompt(args: {
  skillsBlock: string;
  currentContent: TrainingVideoContent;
  userMessage: string;
  language: string;
}): string {
  return `${args.skillsBlock ? args.skillsBlock + "\n\n---\n\n" : ""}You are refining an existing training video script for Tarkie. The current script is shown below. The team member has a request — apply it.

═══════════════════════════════════════════════════════════
CURRENT SCRIPT
═══════════════════════════════════════════════════════════
${JSON.stringify(args.currentContent, null, 2)}

═══════════════════════════════════════════════════════════
TEAM MEMBER'S REQUEST
═══════════════════════════════════════════════════════════
${args.userMessage}

═══════════════════════════════════════════════════════════
OUTPUT FORMAT (STRICT JSON ONLY — no markdown fences)
═══════════════════════════════════════════════════════════
{
  "reply": "string — short conversational message acknowledging the change (1-2 sentences)",
  "content": { ...the FULL updated TrainingVideoContent JSON object with the change applied... } | null
}

═══════════════════════════════════════════════════════════
RULES
═══════════════════════════════════════════════════════════
1. If the request is a clarifying question (e.g. "what tone are you using?"), reply conversationally and set content=null (don't change anything).
2. If the request is a change ("make scene 3 more energetic", "shorten scene 5"), apply it and return the FULL updated content. Don't try to emit a diff.
3. Preserve all unchanged scenes exactly as they were. Don't rewrite scenes you weren't asked to change.
4. If the user asks to reorder scenes, do so but renumber the order field.
5. If the user asks to delete a scene, omit it and renumber.
6. NEVER invent content not implied by the original slide. Flag uncertainty in aiNotes.missing.
7. Update aiNotes.summary briefly to reflect what changed.
8. LANGUAGE: ${args.language}. Match the existing scenes' language.

Produce the JSON.`;
}

function parseAiResponse(raw: string): { reply?: string; content?: TrainingVideoContent } | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { parsed = JSON.parse(match[0]); } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object") return null;

  const reply = typeof parsed.reply === "string" ? parsed.reply : "";
  const content = parsed.content ? normalizeContent(parsed.content) : undefined;
  return { reply, content };
}

function normalizeContent(parsed: any): TrainingVideoContent {
  return {
    title: String(parsed.title || "Untitled Training Video"),
    scenes: Array.isArray(parsed.scenes)
      ? parsed.scenes.map((s: any, i: number): TrainingScene => ({
          order: Number(s.order || i + 1),
          title: String(s.title || `Scene ${i + 1}`),
          narrationScript: String(s.narrationScript || ""),
          sourceSlideNumber: s.sourceSlideNumber != null ? Number(s.sourceSlideNumber) : undefined,
          caption: String(s.caption || s.narrationScript || ""),
          durationSec: s.durationSec != null ? Number(s.durationSec) : undefined,
          audioDriveFileId: s.audioDriveFileId || null,
          audioDriveUrl: s.audioDriveUrl || null,
          audioDurationSec: s.audioDurationSec != null ? Number(s.audioDurationSec) : null,
          edited: !!s.edited,
          aiNote: s.aiNote ? String(s.aiNote) : undefined,
        }))
      : [],
    aiNotes: parsed.aiNotes ? normalizeAiNotes(parsed.aiNotes) : undefined,
  };
}

function normalizeAiNotes(parsed: any): AiNotes {
  return {
    inferred: Array.isArray(parsed.inferred) ? parsed.inferred.map(String) : [],
    missing: Array.isArray(parsed.missing) ? parsed.missing.map(String) : [],
    summary: String(parsed.summary || ""),
  };
}

function escapeJson(s: string): string {
  return s.replace(/"/g, '\\"');
}

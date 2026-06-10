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

export interface BuildScriptFromVideoArgs {
  /** Keyframes extracted by the worker (base64 JPEGs + timestamps). */
  frames: Array<{ timestampSec: number; jpegBase64: string }>;
  /** Total video duration. Helps the AI set the last scene's end timestamp. */
  durationSec: number;
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
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: 16384,
    },
  });

  const raw = (result?.response?.text?.() || "").trim();
  const parsed = parseAiResponse(raw);
  if (!parsed) return { ok: false, error: "AI returned non-JSON output", rawAi: raw };
  return { ok: true, content: parsed.content, reply: parsed.reply };
}

/**
 * Initial script generation from a screen recording's keyframes.
 * AI sees the frames + their timestamps and segments the video into scenes
 * with sourceStart/EndSec ranges. Narration is regenerated; original audio
 * will be replaced by TTS in the final render.
 */
export async function buildScriptFromVideoFrames(args: BuildScriptFromVideoArgs): Promise<AiResult> {
  const model = await getModelForApp("training-videos").catch(() => null);
  if (!model) return { ok: false, error: "No AI model configured" };

  // Sample down to ~40 frames max. Beyond that, Gemini's output token budget
  // starts truncating mid-JSON for long screen recordings. Spacing the
  // frames evenly across the timeline preserves enough visual context.
  const sampledFrames = downsampleFrames(args.frames, 40);

  const skillsBlock = await loadSkillsBlock();
  const promptText = buildVideoPrompt({
    skillsBlock,
    title: args.title,
    userPrompt: args.userPrompt || "",
    language: args.language || "en-US",
    durationSec: args.durationSec,
    frameCount: sampledFrames.length,
  });

  const parts: any[] = [{ text: promptText }];
  for (const f of sampledFrames) {
    parts.push({ text: `[t=${f.timestampSec.toFixed(1)}s]` });
    parts.push({ inlineData: { mimeType: "image/jpeg", data: f.jpegBase64 } });
  }

  const result = await generateWithRetry(model, {
    contents: [{ role: "user", parts }],
    generationConfig: {
      // Force JSON output so we never get markdown preamble or prose.
      responseMimeType: "application/json",
      // High ceiling so 15+ scenes don't get truncated.
      maxOutputTokens: 16384,
    },
  });
  const raw = (result?.response?.text?.() || "").trim();
  const parsed = parseAiResponse(raw);
  if (!parsed) return { ok: false, error: "AI returned non-JSON output", rawAi: raw };
  return { ok: true, content: parsed.content, reply: parsed.reply };
}

/**
 * Evenly downsample a frame array to roughly `target` frames while keeping
 * the first and last frames. Drops middle frames as needed.
 */
function downsampleFrames<T>(frames: T[], target: number): T[] {
  if (frames.length <= target) return frames;
  const out: T[] = [];
  const step = (frames.length - 1) / (target - 1);
  for (let i = 0; i < target; i++) {
    out.push(frames[Math.round(i * step)]);
  }
  return out;
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
HOW TO NARRATE — IDENTIFY THE SLIDE KIND FIRST
═══════════════════════════════════════════════════════════
Before writing each scene's narration, decide what KIND of slide it is. Different kinds get narrated differently. Most decks mix all of these.

A. TITLE / WELCOME slide (first slide, big title, no steps)
   → Short overview. Set up what the training covers. 1-3 sentences.
   → Example: "Welcome to Tarkie. In this training, you'll learn how to record a complete field visit, from check-in through expense tagging."

B. SECTION DIVIDER (just a section name, no detail)
   → Short bridge. 1 sentence.
   → Example: "Next, let's go through the visit check-in flow."

C. OVERVIEW / AGENDA / SUMMARY slide (lists topics or sections, no steps)
   → Walk through the items the slide lists. Read each item plainly.
   → Don't compress 5 items into "a few things" — name each one.

D. STEP-BY-STEP slide (the slide shows steps 1, 2, 3 / numbered actions / a procedure)
   → Read EVERY step shown. In order. Don't summarize. Don't skip.
   → Use natural connecting language between steps: "First…", "Then…", "After that…", "Once that's done…", "Finally…".
   → If the slide says "Step 1: Tap Check-In. Step 2: Pick the customer. Step 3: Snap a photo." then the narration must cover all three steps in order — not "tap a few things to check in."
   → Length scales with step count. A 5-step slide produces a longer narration than a 1-step slide. THIS IS EXPECTED. Don't try to keep all scenes the same length.

E. CONCEPT / EXPLANATION slide (describes what something is, why it matters)
   → Explain the concept using the slide's own framing. Don't editorialize. Don't add information not on the slide.

F. SCREENSHOT / UI DIAGRAM (an app screenshot with callouts or labels)
   → Describe what's on screen and what each labeled element does. Read every callout/label, in reading order (top-to-bottom, left-to-right).

G. CLOSING / "THANK YOU" slide
   → Short wrap-up. Repeat the next action if there is one. 1-2 sentences.

═══════════════════════════════════════════════════════════
LENGTH RULES (READ CAREFULLY — THIS IS WHERE PEOPLE GET IT WRONG)
═══════════════════════════════════════════════════════════
- The narration's length MUST scale with the slide's content density. Do not impose a fixed time target like "all scenes 10-15 seconds."
- If a slide has 1 bullet, the narration is short (one sentence).
- If a slide has 8 bullets or 6 numbered steps, the narration is long (one paragraph). It is normal and good for a step-heavy slide to take 60+ seconds to narrate.
- NEVER drop steps to keep the narration short. If the slide shows 6 steps, the narration covers 6 steps.
- NEVER add steps the slide doesn't have. If the slide shows 3 steps, the narration covers exactly 3.

═══════════════════════════════════════════════════════════
VOICE & STYLE
═══════════════════════════════════════════════════════════
- AUDIENCE: new field staff using Tarkie. Friendly, plain, second person ("you'll tap…", "next, you select…").
- ACTIVE VOICE. NAME THINGS DIRECTLY ("the green Check-In button" beats "the action button").
- NO JARGON: skip "leverage", "synergy", "best-in-class", "robust", "seamless".
- CONTINUITY: scenes flow into each other. Don't repeat the intro. Each scene assumes the listener just heard the previous one.
- LANGUAGE: ${args.language}. If the deck is Taglish, match its mix.

═══════════════════════════════════════════════════════════
CAPTION FIELD
═══════════════════════════════════════════════════════════
The caption shown on screen needs to be readable in lower-third area, so it's SHORTER than the full narration. Set caption to a condensed line (≤ 100 chars) that summarizes the scene — typically the slide title or a key phrase. The narration is the full spoken text; the caption is the visual subtitle.

═══════════════════════════════════════════════════════════
RULES
═══════════════════════════════════════════════════════════
1. Read the ENTIRE deck before generating. Decide the slide kinds first, then write narrations.
2. PREFER speaker notes when they're present and substantive — they're usually the script the author intended. Treat slide content as the structure, notes as the voice.
3. NEVER invent content not on the slide or in its notes. If a slide is empty, write a placeholder and flag it in aiNotes.missing.
4. NEVER write "[insert X]" or "TBD" in narrationScript. Either write real narration or flag it.
5. One scene per slide. Preserve slide order.
6. Final scene gets a clean closing line that names the next action ("That's it for now. Open Tarkie and tap Check-In to start your first day.").

═══════════════════════════════════════════════════════════
GUIDANCE FROM THE TEAM MEMBER (optional)
═══════════════════════════════════════════════════════════
${args.userPrompt || "(none — use your best judgment)"}

═══════════════════════════════════════════════════════════
THE POWERPOINT FILE IS ATTACHED BELOW AS INLINE DATA.

Read it carefully. Produce the JSON.`;
}

function buildVideoPrompt(args: {
  skillsBlock: string;
  title: string;
  userPrompt: string;
  language: string;
  durationSec: number;
  frameCount: number;
}): string {
  return `${args.skillsBlock ? args.skillsBlock + "\n\n---\n\n" : ""}You are generating narration scripts for a training video at Tarkie (MobileOptima, Inc.). A team member uploaded a SCREEN RECORDING of someone using the Tarkie app. You see ${args.frameCount} keyframes sampled at regular intervals, each labeled with its timestamp [t=Ns]. The total video is ${args.durationSec.toFixed(1)} seconds long.

Your job: segment the recording into LOGICAL SCENES based on what's happening on screen, then write a narration script for each scene. The original audio will be REPLACED by TTS narration in the final video — you don't need to match the original audio, only the visuals.

═══════════════════════════════════════════════════════════
WHAT TO LOOK FOR (scene boundaries)
═══════════════════════════════════════════════════════════
- A NEW screen appears (different app section, new modal, settings page → main page)
- The user starts a NEW TASK (was filling a form, now submitting; was browsing, now tapping action)
- A clear pause / completion (loading screen, success message, then continuing)
- Tutorial-style "step changes" (introducing a feature, then demonstrating, then result)

Segment based on logical content, not a fixed scene count. A 60-second quick demo may need 4 scenes; a 5-minute walkthrough may need 15+. Don't over-segment (less than 5 seconds per scene is usually too granular) and don't under-segment (a 2-minute scene is usually doing too much).

═══════════════════════════════════════════════════════════
OUTPUT FORMAT (STRICT JSON ONLY — no markdown fences)
═══════════════════════════════════════════════════════════
{
  "reply": "Short message acknowledging what you saw + how you segmented it (1-2 sentences).",
  "content": {
    "title": "${escapeJson(args.title)}",
    "scenes": [
      {
        "order": 1,
        "title": "Opening the app",
        "narrationScript": "When you open Tarkie, you'll see your home screen with today's tasks listed.",
        "sourceSlideNumber": 0,
        "caption": "When you open Tarkie, you'll see your home screen with today's tasks listed.",
        "aiNote": "Scene shows app launch + home screen. Set source range 0-8s based on the frames.",
        "sourceStartSec": 0,
        "sourceEndSec": 8
      }
    ],
    "aiNotes": {
      "inferred": ["I segmented based on screen transitions."],
      "missing": ["Confirm the audience — I assumed new field staff."],
      "summary": "Drafted 5 scenes for the check-in tutorial recording."
    }
  }
}

═══════════════════════════════════════════════════════════
CRITICAL FIELD-LEVEL RULES (for screen-recording scenes)
═══════════════════════════════════════════════════════════
- sourceStartSec / sourceEndSec: REQUIRED. Both in whole seconds. Use the [t=Ns] labels in the frames to pick boundaries. Each scene's range should cover the screen activity that scene describes.
- Scenes must be in chronological order (order=1 has the earliest sourceStartSec).
- Scenes must be CONTIGUOUS: scene N+1's sourceStartSec should equal scene N's sourceEndSec (no gaps, no overlaps).
- Sum of all (sourceEndSec - sourceStartSec) should equal ${args.durationSec.toFixed(1)} (the total video length).
- narrationScript: describe what's happening on screen for the NEW audience (field staff using Tarkie for the first time). Don't transcribe the original speaker — you can't hear them and the new voice will replace it.

═══════════════════════════════════════════════════════════
HOW TO NARRATE — SCENE KIND MATTERS
═══════════════════════════════════════════════════════════
Decide what each segment is:
- OPENING (first scene, app launch / home screen) → short overview, set up the demo. 1-2 sentences.
- ACTION sequence (the user performs a series of taps / fills a form / completes a flow) → describe EVERY action shown, in order, using connecting language ("first you…", "then…", "after that…"). Don't summarize.
- RESULT / CONFIRMATION (a success message, completed state) → describe what the user sees and what it means.
- TRANSITION (loading, brief pause) → very short or merge into the next scene.
- CLOSING (final state, end of demo) → short wrap-up + next action.

═══════════════════════════════════════════════════════════
LENGTH RULES
═══════════════════════════════════════════════════════════
- Narration length scales with how much is happening on screen, NOT with a fixed time target.
- An action-heavy scene (user taps 5 different things) should produce a LONG narration that names each action. A confirmation screen (single success message) should be SHORT.
- NEVER skip actions to fit a shorter narration. If the user does 6 things, the narration covers 6 things.

═══════════════════════════════════════════════════════════
VOICE & STYLE
═══════════════════════════════════════════════════════════
- AUDIENCE: new field staff. Friendly, plain, second-person ("you'll tap…").
- ACTION-ORIENTED: "Tap the green Check-In button" beats "the user taps a button".
- NAME UI ELEMENTS DIRECTLY (button names, screen labels, field names visible in the frames).
- NO JARGON: skip "leverage", "synergy", "best-in-class".
- LANGUAGE: ${args.language}.

═══════════════════════════════════════════════════════════
GUIDANCE FROM THE TEAM MEMBER (optional)
═══════════════════════════════════════════════════════════
${args.userPrompt || "(none — use your best judgment)"}

═══════════════════════════════════════════════════════════
THE KEYFRAMES FOLLOW — read them carefully, then produce the JSON.`;
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

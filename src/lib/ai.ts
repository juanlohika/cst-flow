import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";

const SETTINGS_FILE = path.join(process.cwd(), "config.json");

// ─── Config types ─────────────────────────────────────────────────────────────

export interface AIConfig {
  primaryProvider: "ollama" | "groq" | "gemini" | "claude";
  ollamaEndpoint: string;
  ollamaModel: string;
  groqApiKey: string;
  geminiApiKey: string;
  anthropicApiKey: string;
  // legacy single-key field (kept for backwards compat)
  apiKey?: string;
}

export async function readAIConfig(): Promise<AIConfig> {
  // 1. Initial defaults from Environment Variables (Low Priority)
  const config: AIConfig = {
    primaryProvider: (process.env.PRIMARY_AI_PROVIDER || "groq") as any,
    ollamaEndpoint: process.env.OLLAMA_ENDPOINT || "http://localhost:11434",
    ollamaModel: process.env.OLLAMA_MODEL || "llama3.2",
    groqApiKey: process.env.GROQ_API_KEY || "",
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  };

  // 2. Overlay settings from Database (High Priority / User Choice)
  try {
    const { db } = await import("@/db");
    const { globalSettings } = await import("@/db/schema");
    
    const settings = await db.select().from(globalSettings);
    const raw: Record<string, string> = {};
    settings.forEach(s => { raw[s.key] = s.value; });

    if (raw.primaryProvider) config.primaryProvider = raw.primaryProvider as any;
    if (raw.ollamaEndpoint) config.ollamaEndpoint = raw.ollamaEndpoint;
    if (raw.ollamaModel)    config.ollamaModel = raw.ollamaModel;
    if (raw.groqApiKey)     config.groqApiKey = raw.groqApiKey;
    if (raw.geminiApiKey)   config.geminiApiKey = raw.geminiApiKey;
    if (raw.anthropicApiKey) config.anthropicApiKey = raw.anthropicApiKey;
    
    // Backwards compat for legacy "apiKey" field
    if (raw.apiKey && !config.groqApiKey && !config.geminiApiKey) {
      if (raw.apiKey.startsWith("gsk_")) config.groqApiKey = raw.apiKey;
      else config.geminiApiKey = raw.apiKey;
    }
  } catch (error) {
    console.warn("AI Config DB fetch partially failed, using env defaults:", error);
  }

  return config;
}

/** Legacy helper — reads primary key for server-side routes */
export async function getStoredApiKey(): Promise<string> {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const config = await readAIConfig();
  if (config.primaryProvider === "groq") return config.groqApiKey;
  if (config.primaryProvider === "gemini") return config.geminiApiKey;
  if (config.primaryProvider === "claude") return config.anthropicApiKey;
  return ""; // ollama needs no key
}

export interface AIModel {
  generateContent: (input: any) => Promise<{ response: { text: () => string } }>;
  transcribeAudio?: (audioBuffer: Buffer, mimeType: string) => Promise<string>;
}

/**
 * Returns the primary configured model adapter.
 * All adapters expose: await model.generateContent(promptOrObject)
 *                       → { response: { text() } }
 */
export async function getGeminiModel(apiKeyOverride?: string): Promise<AIModel> {
  // If a key override is provided (from x-gemini-key header)
  if (apiKeyOverride && apiKeyOverride.length > 10) {
    if (apiKeyOverride.startsWith("gsk_")) return buildGroqAdapter(apiKeyOverride);
    return buildGeminiAdapter(apiKeyOverride);
  }

  const config = await readAIConfig();

  switch (config.primaryProvider) {
    case "ollama":
      return buildOllamaAdapter(config.ollamaEndpoint, config.ollamaModel);
    case "groq":
      if (!config.groqApiKey) throw new Error("Groq API key not set. Go to Admin → Settings.");
      return buildGroqAdapter(config.groqApiKey);
    case "claude":
      if (!config.anthropicApiKey) throw new Error("Anthropic API key not set. Go to Admin → Settings.");
      return buildClaudeAdapter(config.anthropicApiKey);
    case "gemini":
    default:
      if (!config.geminiApiKey) throw new Error("Gemini API key is missing. Please go to Admin → Settings and add your Google Gemini API key.");
      return buildGeminiAdapter(config.geminiApiKey);
  }
}

/**
 * Returns a Claude adapter specifically.
 * Used by routes that benefit from Claude's superior instruction-following (e.g. Mockup Maker).
 * Falls back to the primary provider if no Anthropic key is configured.
 */
export async function getClaudeModel() {
  const config = await readAIConfig();
  if (config.anthropicApiKey) {
    return buildClaudeAdapter(config.anthropicApiKey);
  }
  // If we wanted Claude but no key is set, try to fallback safely OR error clearly
  if (config.geminiApiKey) {
    console.warn("Anthropic key missing, falling back to Gemini for Tarkie AI.");
    return buildGeminiAdapter(config.geminiApiKey);
  }
  throw new Error("No AI API keys configured (Claude or Gemini). Please go to Admin → Settings to configure your AI brains.");
}

/**
 * Returns the AI model configured for a specific app slug.
 * Reads the app's `provider` field from the DB; falls back to the global primary provider.
 * Usage: const model = await getModelForApp("brd")
 */
export async function getModelForApp(slug: string) {
  const { db } = await import("@/db");
  const { apps } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const config = await readAIConfig();

  let provider: string | null = null;
  try {
    const rows = await db.select({ provider: apps.provider })
      .from(apps)
      .where(eq(apps.slug, slug))
      .limit(1);
    provider = rows[0]?.provider ?? null;
  } catch (err) {
    console.error(`AI Model App lookup failed for ${slug}:`, err);
  }

  // Resolve which provider to use: app override → global default
  const resolved = provider || config.primaryProvider;

  switch (resolved) {
    case "claude":
      if (!config.anthropicApiKey) throw new Error(`Claude (Anthropic) API key is missing. Go to Admin → Settings.`);
      return buildClaudeAdapter(config.anthropicApiKey);
    case "gemini":
      if (!config.geminiApiKey) throw new Error(`Gemini API key is missing. Go to Admin → Settings.`);
      return buildGeminiAdapter(config.geminiApiKey);
    case "groq":
      if (!config.groqApiKey) throw new Error(`Groq API key not set. Go to Admin → Settings.`);
      return buildGroqAdapter(config.groqApiKey);
    case "ollama":
      return buildOllamaAdapter(config.ollamaEndpoint, config.ollamaModel);
    default:
      return getGeminiModel();
  }
}

// ─── Ollama adapter ───────────────────────────────────────────────────────────

function buildOllamaAdapter(endpoint: string, model: string) {
  const base = endpoint.replace(/\/$/, "");
  console.log(`[AI] Provider: Ollama  Endpoint: ${base}  Model: ${model}`);

  return {
    generateContent: async (input: string | any) => {
      const messages: { role: string; content: string }[] = [];

      if (typeof input === "string") {
        messages.push({ role: "user", content: input });
      } else {
        if (input.systemInstruction) {
          const parts = input.systemInstruction.parts as any[];
          messages.push({ role: "system", content: parts.map((p: any) => p.text).join("\n") });
        }
        if (input.contents) {
          for (const c of input.contents) {
            const text = c.parts.map((p: any) => p.text ?? "").join("\n");
            messages.push({ role: c.role === "model" ? "assistant" : "user", content: text });
          }
        }
        if (messages.length === 0 && input.prompt) {
          messages.push({ role: "user", content: String(input.prompt) });
        }
      }

      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: false }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Ollama error: ${err}`);
      }

      const data = await res.json();
      const content: string = data.message?.content ?? "";
      return { response: { text: () => content } };
    },
  };
}

// ─── Groq adapter ─────────────────────────────────────────────────────────────

function buildGroqAdapter(apiKey: string) {
  const groq = new Groq({ apiKey });
  const MODEL = "llama-3.3-70b-versatile";
  console.log(`[AI] Provider: Groq  Model: ${MODEL}`);

  return {
    generateContent: async (input: string | any) => {
      const messages: Groq.Chat.ChatCompletionMessageParam[] = [];

      if (typeof input === "string") {
        messages.push({ role: "user", content: input });
      } else {
        if (input.systemInstruction) {
          const parts = input.systemInstruction.parts as any[];
          messages.push({ role: "system", content: parts.map((p: any) => p.text).join("\n") });
        }
        if (input.contents) {
          for (const c of input.contents) {
            const text = c.parts.map((p: any) => p.text ?? "").join("\n");
            messages.push({ role: c.role === "model" ? "assistant" : "user", content: text });
          }
        }
        if (messages.length === 0 && input.prompt) {
          messages.push({ role: "user", content: String(input.prompt) });
        }
      }

      const completion = await groq.chat.completions.create({
        model: MODEL,
        messages,
        temperature: input?.generationConfig?.temperature ?? 0.7,
      });

      const content = completion.choices[0]?.message?.content ?? "";
      return { response: { text: () => content } };
    },
    transcribeAudio: async (audioBuffer: Buffer, mimeType: string) => {
      // Create a temporary file because Groq SDK requires a File object or similar
      // We can use a FormBody approach if needed
      const transcript = await groq.audio.transcriptions.create({
        file: await Groq.toFile(audioBuffer, `audio.${mimeType.split("/")[1] || "wav"}`, { type: mimeType }),
        model: "whisper-large-v3",
      });
      return transcript.text;
    }
  };
}

// ─── Gemini adapter ───────────────────────────────────────────────────────────

function buildGeminiAdapter(apiKey: string) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  console.log("[AI] Provider: Gemini  Model: gemini-2.0-flash");
  
  return {
    generateContent: async (input: any) => {
      return model.generateContent(input);
    },
    transcribeAudio: async (audioBuffer: Buffer, mimeType: string) => {
      // Gemini can transcribe audio by sending it as inlineData
      const result = await model.generateContent([
        {
          inlineData: {
            mimeType,
            data: audioBuffer.toString("base64")
          }
        },
        "Transcribe this audio. Return ONLY the transcription, no other text."
      ]);
      return result.response.text();
    }
  };
}

// ─── Claude adapter ───────────────────────────────────────────────────────────

function buildClaudeAdapter(apiKey: string) {
  const client = new Anthropic({ apiKey });
  const MODEL = "claude-sonnet-4-5";
  console.log(`[AI] Provider: Claude  Model: ${MODEL}`);

  return {
    generateContent: async (input: string | any) => {
      let system: string | undefined;
      const messages: Anthropic.MessageParam[] = [];

      if (typeof input === "string") {
        messages.push({ role: "user", content: input });
      } else {
        // Extract system instruction
        if (input.systemInstruction) {
          const parts = input.systemInstruction.parts as any[];
          system = parts.map((p: any) => p.text).join("\n");
        }

        // Convert Gemini-format contents to Claude message params
        if (input.contents) {
          for (const c of input.contents) {
            const role: "user" | "assistant" = c.role === "model" ? "assistant" : "user";

            // Build Claude content blocks from Gemini parts
            const contentBlocks: Anthropic.ContentBlockParam[] = [];
            for (const part of c.parts as any[]) {
              if (part.text) {
                contentBlocks.push({ type: "text", text: part.text });
              } else if (part.inlineData) {
                const { mimeType, data } = part.inlineData;
                if (mimeType.startsWith("image/")) {
                  contentBlocks.push({
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                      data,
                    },
                  });
                } else if (mimeType === "application/pdf") {
                  // Claude supports PDFs as document blocks
                  contentBlocks.push({
                    type: "document",
                    source: {
                      type: "base64",
                      media_type: "application/pdf",
                      data,
                    },
                  } as any);
                }
                // Other mime types (docx etc) are pre-converted to text before reaching here
              }
            }

            // Simplify to plain string if only one text block (cleaner for Claude)
            const content =
              contentBlocks.length === 1 && contentBlocks[0].type === "text"
                ? contentBlocks[0].text
                : contentBlocks;

            messages.push({ role, content });
          }
        }

        // Fallback for simple prompt input
        if (messages.length === 0 && input.prompt) {
          messages.push({ role: "user", content: String(input.prompt) });
        }
      }

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8096,
        ...(system ? { system } : {}),
        messages,
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      return { response: { text: () => text } };
    },
  };
}

// ─── Shared retry helper ──────────────────────────────────────────────────────
/**
 * Calls model.generateContent(input) with automatic retry on Claude 529 overload.
 * Retries up to 3 times with 4s / 8s / 15s backoff.
 * All AI routes should use this instead of calling model.generateContent directly.
 */
export async function generateWithRetry(model: any, input: any, fallbackModel?: any): Promise<any> {
  const delays = [4000, 8000, 15000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await model.generateContent(input);
    } catch (err: any) {
      const msg = err?.message || "";

      // Billing / credit error — fall back to Gemini immediately, no retry
      const isBilling =
        msg.includes("credit balance is too low") ||
        msg.includes("insufficient_quota") ||
        msg.includes("billing") ||
        (err?.status === 400 && msg.includes("credit"));
      if (isBilling) {
        console.warn("[AI] Claude billing error — falling back to Gemini:", msg);
        if (fallbackModel) return await fallbackModel.generateContent(input);
        // Build a Gemini fallback on the fly
        const config = await readAIConfig();
        if (config.geminiApiKey) {
          const gemini = buildGeminiAdapter(config.geminiApiKey);
          return await gemini.generateContent(input);
        }
        const e: any = new Error("Claude credit balance is too low. Please top up at console.anthropic.com → Plans & Billing. No Gemini fallback key is configured either.");
        e.status = 402;
        throw e;
      }

      const isOverloaded =
        err?.status === 529 ||
        msg.toLowerCase().includes("overload") ||
        err?.error?.type === "overloaded_error";
      if (isOverloaded && attempt < delays.length) {
        console.warn(`[AI] Claude overloaded, retrying in ${delays[attempt]}ms (attempt ${attempt + 1})`);
        await new Promise(r => setTimeout(r, delays[attempt]));
        continue;
      }
      if (isOverloaded) {
        const e: any = new Error("Claude is temporarily overloaded. Please wait a moment and try again.");
        e.status = 503;
        throw e;
      }
      throw err;
    }
  }
}

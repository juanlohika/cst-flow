/**
 * Phase G.1 — Gemini TTS integration.
 *
 * Gemini's TTS surface lives at:
 *   https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 * with responseModalities=["AUDIO"] and a prebuiltVoiceConfig in
 * generationConfig.speechConfig.voiceConfig.
 *
 * The Node SDK doesn't expose this yet, so we call the REST endpoint
 * directly via fetch. Returns the raw PCM audio bytes; we wrap to MP3 via
 * lame-encoded WAV header (more on this below).
 *
 * IMPORTANT: Gemini TTS returns 24kHz, 16-bit, mono PCM audio. We wrap
 * those PCM bytes in a WAV container and store as .wav (universally playable).
 * MP3 encoding would require lame/ffmpeg which we can't run in the App Hosting
 * runtime — WAV files are slightly larger but play everywhere, including
 * inside Drive's preview, and the size is fine at this volume.
 */
import { readAIConfig } from "@/lib/ai";

const TTS_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export interface SynthesizeArgs {
  text: string;
  voice: string;             // e.g. "Charon"
  model?: string;            // e.g. "gemini-2.5-flash-preview-tts"
  stylePrompt?: string;
  language?: string;
}

export interface SynthesizeResult {
  ok: boolean;
  audio?: Buffer;            // WAV bytes
  mimeType?: string;         // "audio/wav"
  durationSec?: number;      // estimated from sample count
  error?: string;
}

const DEFAULT_MODEL = "gemini-2.5-flash-preview-tts";
const SAMPLE_RATE = 24000;   // Gemini TTS native rate
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

export async function synthesizeSpeech(args: SynthesizeArgs): Promise<SynthesizeResult> {
  const config = await readAIConfig();
  if (!config.geminiApiKey) {
    return { ok: false, error: "Gemini API key not configured. Set it in Admin → Settings." };
  }
  if (!args.text || !args.text.trim()) {
    return { ok: false, error: "Empty text — nothing to synthesize." };
  }

  const model = args.model || DEFAULT_MODEL;
  // Style prompts are passed as a prefix to the text — Gemini interprets the
  // leading instruction as a style cue. e.g. "Read in a lively, informative tone: <text>"
  const stylePrefix = args.stylePrompt
    ? `${args.stylePrompt.trim()}: `
    : "";
  const finalText = stylePrefix + args.text.trim();

  const url = `${TTS_API_URL}/${model}:generateContent?key=${config.geminiApiKey}`;
  const body = {
    contents: [{
      parts: [{ text: finalText }],
    }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: args.voice,
          },
        },
      },
    },
  };

  // Gemini's TTS preview model has a tight per-minute rate limit (~3 RPM on
  // free tier). When we generate audio for a multi-scene video we hit 429
  // partway through unless we slow down. Retry with backoff so the user
  // doesn't need to babysit and click "Regenerate audio" for half the scenes.
  const RETRY_DELAYS_MS = [20_000, 40_000, 60_000];
  let res: Response | null = null;
  let lastErr = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      lastErr = `Gemini TTS request failed: ${e?.message || e}`;
      res = null;
    }
    if (res && res.status !== 429) break;
    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      continue;
    }
  }
  if (!res) {
    return { ok: false, error: lastErr || "Gemini TTS request failed after retries" };
  }
  try {
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Gemini TTS HTTP ${res.status}: ${errText.slice(0, 300)}` };
    }
    const data = await res.json();
    // Response shape: { candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] } }] }
    const part = data?.candidates?.[0]?.content?.parts?.[0];
    const inlineData = part?.inlineData || part?.inline_data;
    if (!inlineData?.data) {
      return { ok: false, error: `Gemini TTS returned no audio data. Response: ${JSON.stringify(data).slice(0, 300)}` };
    }
    const pcmBytes = Buffer.from(inlineData.data, "base64");
    const wav = wrapPcmAsWav(pcmBytes);
    const sampleCount = pcmBytes.length / (BITS_PER_SAMPLE / 8) / CHANNELS;
    const durationSec = sampleCount / SAMPLE_RATE;
    return {
      ok: true,
      audio: wav,
      mimeType: "audio/wav",
      durationSec,
    };
  } catch (e: any) {
    return { ok: false, error: `Gemini TTS request failed: ${e?.message || e}` };
  }
}

/**
 * Wrap raw PCM bytes (16-bit, 24kHz, mono) in a WAV container so the file
 * is playable as audio/wav everywhere. WAV header is 44 bytes; the data
 * chunk follows immediately. Done in pure Node — no native deps.
 */
function wrapPcmAsWav(pcm: Buffer): Buffer {
  const byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
  const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);
  const dataSize = pcm.length;
  const chunkSize = 36 + dataSize;

  const header = Buffer.alloc(44);
  // RIFF header
  header.write("RIFF", 0);
  header.writeUInt32LE(chunkSize, 4);
  header.write("WAVE", 8);
  // fmt chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);              // PCM fmt chunk size
  header.writeUInt16LE(1, 20);                // PCM = 1
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  // data chunk
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

/**
 * Generate an SRT-format caption file from the scenes. Cue start times are
 * computed by summing each scene's audio duration (with a small pad).
 * v1: one caption cue per scene, full narration text.
 */
export function buildSrt(scenes: Array<{ caption: string; audioDurationSec?: number | null }>): string {
  const PAD_SEC = 0.4;
  const lines: string[] = [];
  let cursor = 0;
  let cueNum = 1;
  for (const scene of scenes) {
    const dur = (scene.audioDurationSec ?? estimateDurationByText(scene.caption)) + PAD_SEC;
    const start = cursor;
    const end = cursor + dur;
    lines.push(String(cueNum));
    lines.push(`${formatSrtTime(start)} --> ${formatSrtTime(end)}`);
    lines.push(scene.caption.trim());
    lines.push("");
    cursor = end;
    cueNum++;
  }
  return lines.join("\n");
}

/** Same content as SRT but with WebVTT header for browser/HTML5 video support. */
export function buildVtt(scenes: Array<{ caption: string; audioDurationSec?: number | null }>): string {
  const PAD_SEC = 0.4;
  const lines: string[] = ["WEBVTT", ""];
  let cursor = 0;
  for (const scene of scenes) {
    const dur = (scene.audioDurationSec ?? estimateDurationByText(scene.caption)) + PAD_SEC;
    const start = cursor;
    const end = cursor + dur;
    lines.push(`${formatVttTime(start)} --> ${formatVttTime(end)}`);
    lines.push(scene.caption.trim());
    lines.push("");
    cursor = end;
  }
  return lines.join("\n");
}

function estimateDurationByText(text: string): number {
  // ~150 words per minute = 2.5 wps = 0.4 sec per word; min 2s, max 30s.
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.min(30, Math.max(2, words * 0.4));
}

function formatSrtTime(seconds: number): string {
  // hh:mm:ss,mmm
  const ms = Math.round((seconds % 1) * 1000);
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

function formatVttTime(seconds: number): string {
  // hh:mm:ss.mmm (note dot vs comma)
  return formatSrtTime(seconds).replace(",", ".");
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }
function pad3(n: number): string { return String(n).padStart(3, "0"); }

/**
 * Run TTS across many scenes serially with a between-call delay to stay
 * under Gemini's per-minute rate limit. synthesizeSpeech already retries
 * 429s with backoff, but pacing the calls up-front means we usually never
 * hit a 429 in the first place — faster end-to-end than wait-then-retry.
 *
 * onProgress fires after every scene (success or skip) so the caller can
 * persist a progress %% the UI can poll.
 */
export interface SceneInput {
  order: number;
  narrationScript: string;
}
export interface SceneAudio {
  order: number;
  ok: boolean;
  audio?: Buffer;
  durationSec?: number;
  error?: string;
}
export async function synthesizeScenes(args: {
  scenes: SceneInput[];
  voice: string;
  model?: string;
  stylePrompt?: string;
  language?: string;
  // Delay between scenes (default 12s — Gemini free is 3 RPM = one every 20s
  // and we want headroom for the actual request time which is ~5-8s).
  betweenScenesMs?: number;
  onProgress?: (done: number, total: number, current?: { order: number; status: "ok" | "error"; error?: string }) => void | Promise<void>;
}): Promise<SceneAudio[]> {
  const delay = args.betweenScenesMs ?? 12_000;
  const total = args.scenes.length;
  const results: SceneAudio[] = [];

  for (let i = 0; i < args.scenes.length; i++) {
    const scene = args.scenes[i];
    if (!scene.narrationScript?.trim()) {
      results.push({ order: scene.order, ok: false, error: "Empty narration" });
      await args.onProgress?.(i + 1, total, { order: scene.order, status: "error", error: "Empty narration" });
      continue;
    }

    const tts = await synthesizeSpeech({
      text: scene.narrationScript,
      voice: args.voice,
      model: args.model,
      stylePrompt: args.stylePrompt,
      language: args.language,
    });
    if (tts.ok && tts.audio) {
      results.push({ order: scene.order, ok: true, audio: tts.audio, durationSec: tts.durationSec });
      await args.onProgress?.(i + 1, total, { order: scene.order, status: "ok" });
    } else {
      results.push({ order: scene.order, ok: false, error: tts.error });
      await args.onProgress?.(i + 1, total, { order: scene.order, status: "error", error: tts.error });
    }

    if (i < args.scenes.length - 1 && delay > 0) {
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return results;
}

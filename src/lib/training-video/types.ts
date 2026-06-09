/**
 * Phase G.1 — Training Video Generator types.
 *
 * One TrainingVideo row stores its scenes as a JSON blob matching this shape.
 * Same source of truth drives the chat refinement UI and (later) the MP4
 * renderer. Keep the shape stable; AI prompts depend on it.
 */

export interface TrainingScene {
  /** 1-based position in the video. */
  order: number;
  /** Short label for the scene (e.g. "Welcome", "Set up your account"). */
  title: string;
  /** Spoken narration text — 1-3 natural sentences. The TTS source. */
  narrationScript: string;
  /** Optional: which slide number from the source PPTX this scene maps to. */
  sourceSlideNumber?: number;
  /** Caption text. v1 stores one caption line per scene; future versions
   *  could split into multi-cue timing. */
  caption: string;
  /** Estimated on-screen duration in seconds (audio duration + small pad). */
  durationSec?: number;
  /** Drive file id of the rendered audio mp3 for this scene. Null until TTS runs. */
  audioDriveFileId?: string | null;
  /** Drive URL for direct playback in the UI. */
  audioDriveUrl?: string | null;
  /** Estimated audio duration in seconds — used for caption pacing. */
  audioDurationSec?: number | null;
  /** Whether the script has been edited by a human since AI generated it. */
  edited?: boolean;
  /** AI notes about what it inferred for this scene (optional). */
  aiNote?: string;
}

export interface AiNotes {
  inferred: string[];
  missing: string[];
  summary: string;
}

/** Full content blob stored on TrainingVideo.scenes JSON column. */
export interface TrainingVideoContent {
  title: string;
  scenes: TrainingScene[];
  aiNotes?: AiNotes;
}

export interface VoiceOption {
  id: string;            // e.g. "Charon"
  label: string;         // human-readable name
  description?: string;  // "informative, lively" etc.
  recommended?: boolean; // Charon is default
}

/** The 30 prebuilt Gemini voices. Order = order shown in the dropdown. */
export const GEMINI_VOICES: VoiceOption[] = [
  { id: "Charon", label: "Charon", description: "Informative, lively — best for product trainers", recommended: true },
  { id: "Kore", label: "Kore", description: "Firm, confident" },
  { id: "Aoede", label: "Aoede", description: "Breezy, conversational" },
  { id: "Puck", label: "Puck", description: "Upbeat, friendly" },
  { id: "Fenrir", label: "Fenrir", description: "Excitable, energetic" },
  { id: "Leda", label: "Leda", description: "Youthful, clear" },
  { id: "Orus", label: "Orus", description: "Firm, deliberate" },
  { id: "Zephyr", label: "Zephyr", description: "Bright, articulate" },
  { id: "Sulafat", label: "Sulafat", description: "Warm, knowledgeable" },
  { id: "Achernar", label: "Achernar", description: "Soft, measured" },
  { id: "Achird", label: "Achird", description: "Casual, neighborly" },
  { id: "Algenib", label: "Algenib", description: "Gravelly, mature" },
  { id: "Algieba", label: "Algieba", description: "Smooth, professional" },
  { id: "Alnilam", label: "Alnilam", description: "Steady, narrator-like" },
  { id: "Autonoe", label: "Autonoe", description: "Bright, expressive" },
  { id: "Callirrhoe", label: "Callirrhoe", description: "Easy-going, relaxed" },
  { id: "Despina", label: "Despina", description: "Smooth, gentle" },
  { id: "Enceladus", label: "Enceladus", description: "Breathy, intimate" },
  { id: "Erinome", label: "Erinome", description: "Clear, neutral" },
  { id: "Gacrux", label: "Gacrux", description: "Mature, dignified" },
  { id: "Iapetus", label: "Iapetus", description: "Clear, no-nonsense" },
  { id: "Laomedeia", label: "Laomedeia", description: "Upbeat, animated" },
  { id: "Pulcherrima", label: "Pulcherrima", description: "Forward, direct" },
  { id: "Rasalgethi", label: "Rasalgethi", description: "Informative, factual" },
  { id: "Sadachbia", label: "Sadachbia", description: "Lively, sharp" },
  { id: "Sadaltager", label: "Sadaltager", description: "Knowledgeable, precise" },
  { id: "Schedar", label: "Schedar", description: "Even, trustworthy" },
  { id: "Umbriel", label: "Umbriel", description: "Easy-going, calm" },
  { id: "Vindemiatrix", label: "Vindemiatrix", description: "Gentle, soft-spoken" },
  { id: "Zubenelgenubi", label: "Zubenelgenubi", description: "Casual, approachable" },
];

export function isValidVoice(id: string): boolean {
  return GEMINI_VOICES.some(v => v.id === id);
}

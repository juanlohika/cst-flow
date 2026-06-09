/**
 * Caption file generation. We use ASS (Advanced SubStation Alpha) because
 * ffmpeg's libass filter renders ASS with full styling control: font face,
 * outline, shadow, position, bold — much more than SRT supports.
 *
 * Style: white Quicksand bold, dark outline + soft shadow, positioned in
 * the lower-third. Looks professional, readable on phones.
 */
import type { RenderScene } from "./types.js";

const PAD_SEC = 0.4;

interface AssOpts {
  /** "9:16" or "16:9" — drives margin sizing. */
  aspectRatio: "9:16" | "16:9";
}

export function buildAssCaptions(scenes: RenderScene[], opts: AssOpts): string {
  // Resolution for the [Script Info] section. ASS scales relative to this.
  const playResX = opts.aspectRatio === "9:16" ? 1080 : 1920;
  const playResY = opts.aspectRatio === "9:16" ? 1920 : 1080;
  // Caption sizing scaled to short edge so it looks right in both orientations.
  const fontSize = opts.aspectRatio === "9:16" ? 56 : 44;
  // Position: vertical → lower third with ~180px bottom margin; horizontal → ~120px.
  const marginV = opts.aspectRatio === "9:16" ? 180 : 120;
  const marginLR = opts.aspectRatio === "9:16" ? 60 : 120;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Quicksand,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,1,2,${marginLR},${marginLR},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events: string[] = [];
  let cursor = 0;
  for (const scene of scenes) {
    const dur = (scene.audioDurationSec || estimateDurationByText(scene.caption || scene.narrationScript)) + PAD_SEC;
    const start = cursor;
    const end = cursor + dur;
    const text = (scene.caption || scene.narrationScript).trim().replace(/\n/g, "\\N");
    events.push(`Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Caption,,0,0,0,,${text}`);
    cursor = end;
  }

  return header + events.join("\n") + "\n";
}

/** ASS time format: H:MM:SS.cs (centiseconds) */
function formatAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
}

function estimateDurationByText(text: string): number {
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.min(30, Math.max(2, words * 0.4));
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }

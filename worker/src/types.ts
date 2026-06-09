/**
 * Render-job spec sent by CST OS to the worker.
 * Mirrors the TrainingScene + TrainingVideo schema (no transitive imports —
 * the worker is independent of the Next.js app).
 */

export interface RenderScene {
  order: number;
  title: string;
  narrationScript: string;
  caption: string;
  /** Drive file id of the scene's audio (WAV). Required for scenes with audio. */
  audioDriveFileId: string;
  /** Audio duration in seconds. Drives caption timing + scene length. */
  audioDurationSec: number;
  /** Optional: Drive file id of a slide image (PNG/JPG). For PPTX sources. */
  slideImageDriveFileId?: string;
  /** Optional: source video segment (for screen-recording inputs). */
  sourceVideoDriveFileId?: string;
  sourceStartSec?: number;
  sourceEndSec?: number;
}

export interface RenderJob {
  /** CST OS's TrainingVideo id. We use it for the output filename + Drive folder. */
  videoId: string;
  /** Human-readable title (becomes the MP4 filename). */
  title: string;
  /** Drive folder id where the final MP4 should be uploaded. */
  outputFolderId: string;
  /** "9:16" (vertical 1080×1920) or "16:9" (horizontal 1920×1080). */
  aspectRatio: "9:16" | "16:9";
  scenes: RenderScene[];
  /** Source PPTX file id (we'll convert it to per-slide PNGs at render time). */
  sourcePptxDriveFileId?: string;
  /** Source MP4 (screen recording) — when present, slide images are unused. */
  sourceVideoDriveFileId?: string;
  /** Service account JSON for Drive operations (passed in by CST OS). */
  serviceAccountJson: string;
}

export interface RenderResult {
  ok: boolean;
  mp4DriveFileId?: string;
  mp4DriveUrl?: string;
  durationSec?: number;
  error?: string;
}

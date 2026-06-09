/**
 * Extract keyframes from a source video for AI vision analysis.
 *
 * Called by CST OS at the start of the screen-recording creation flow.
 * Returns base64-encoded JPEGs (small, 480px wide) so the calling Next.js
 * code can pass them straight to Gemini Vision without re-fetching from Drive.
 *
 * Sampling strategy: one frame every N seconds (default 2s). This is a
 * trade-off: more frames = better scene detection, but more vision calls
 * downstream. 2s gives us ~30 frames per minute of video, which is enough
 * to detect screen-change boundaries cleanly.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
import { buildDriveCtx, downloadFile } from "./drive.js";

export interface ExtractFramesArgs {
  /** Drive file id of the source MP4. */
  sourceVideoDriveFileId: string;
  /** Sampling interval in seconds. Default 2. */
  intervalSec?: number;
  /** Service account JSON for Drive access. */
  serviceAccountJson: string;
}

export interface ExtractedFrame {
  /** Time in seconds at which this frame was captured. */
  timestampSec: number;
  /** JPEG bytes, base64-encoded. ~10-50KB at 480px width. */
  jpegBase64: string;
  /** Original frame width in pixels (480 by default). */
  width: number;
}

export interface ExtractFramesResult {
  ok: boolean;
  durationSec?: number;
  frames?: ExtractedFrame[];
  error?: string;
}

export async function extractFrames(args: ExtractFramesArgs): Promise<ExtractFramesResult> {
  const workDir = await fs.mkdtemp(path.join("/tmp", "frames-"));
  try {
    const ctx = buildDriveCtx(args.serviceAccountJson);
    const buf = await downloadFile(ctx, args.sourceVideoDriveFileId);
    const videoPath = path.join(workDir, "source.mp4");
    await fs.writeFile(videoPath, buf);

    // Probe duration
    const { stdout: probeOut } = await exec("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ]);
    const durationSec = parseFloat(probeOut.trim());
    if (!isFinite(durationSec) || durationSec <= 0) {
      return { ok: false, error: "Could not determine video duration" };
    }

    // Extract frames at fixed interval — scale to 480px wide for AI vision
    const intervalSec = Math.max(1, args.intervalSec || 2);
    const fps = `1/${intervalSec}`;
    const outPattern = path.join(workDir, "frame_%04d.jpg");
    await exec("ffmpeg", [
      "-y",
      "-i", videoPath,
      "-vf", `fps=${fps},scale=480:-2`,
      "-q:v", "5",       // JPEG quality 1-31 (5 = good)
      outPattern,
    ], { timeout: 300_000 });

    // Read each frame as base64
    const files = (await fs.readdir(workDir))
      .filter(f => f.startsWith("frame_") && f.endsWith(".jpg"))
      .sort();

    const frames: ExtractedFrame[] = [];
    for (let i = 0; i < files.length; i++) {
      const bytes = await fs.readFile(path.join(workDir, files[i]));
      frames.push({
        timestampSec: i * intervalSec,
        jpegBase64: bytes.toString("base64"),
        width: 480,
      });
    }

    return { ok: true, durationSec, frames };
  } catch (e: any) {
    console.error("[frames] failed:", e);
    return { ok: false, error: e?.message || String(e) };
  } finally {
    try { await fs.rm(workDir, { recursive: true, force: true }); } catch {}
  }
}

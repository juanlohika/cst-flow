/**
 * Render orchestration for the training video worker.
 *
 * Two input shapes are supported:
 *
 *   1. PPTX source — sourcePptxDriveFileId is set. We:
 *      - Convert PPTX → PDF (LibreOffice)
 *      - Rasterize PDF → one PNG per slide (pdftoppm)
 *      - For each scene: build a segment that shows its slide PNG for the
 *        duration of its audio, mux audio in, burn captions
 *      - Concat segments → final MP4
 *
 *   2. Screen recording source — sourceVideoDriveFileId is set. We:
 *      - Use the original video footage as the visual track
 *      - For each scene with sourceStart/EndSec, trim that segment
 *      - Replace original audio with the TTS audio for that scene
 *      - Burn captions on top
 *      - Concat segments → final MP4
 *
 * Both paths share caption generation + final upload.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
import { buildAssCaptions } from "./captions.js";
import { buildDriveCtx, downloadFile, uploadMp4, convertPptxToPdf, rasterizePdfToPngs } from "./drive.js";
import type { RenderJob, RenderResult, RenderScene } from "./types.js";

const RES_VERTICAL = { w: 1080, h: 1920 };
const RES_HORIZONTAL = { w: 1920, h: 1080 };

export async function renderJob(job: RenderJob): Promise<RenderResult> {
  const workDir = await fs.mkdtemp(path.join("/tmp", "render-"));
  try {
    const ctx = buildDriveCtx(job.serviceAccountJson);
    const res = job.aspectRatio === "16:9" ? RES_HORIZONTAL : RES_VERTICAL;

    // 1) Build the captions file (ASS) once for the whole video
    const assPath = path.join(workDir, "captions.ass");
    await fs.writeFile(assPath, buildAssCaptions(job.scenes, { aspectRatio: job.aspectRatio }));

    // 2) Download all scene audios in parallel
    const audioPaths: Record<number, string> = {};
    await Promise.all(job.scenes.map(async (scene) => {
      if (!scene.audioDriveFileId) return;
      const buf = await downloadFile(ctx, scene.audioDriveFileId);
      const audioPath = path.join(workDir, `audio_${String(scene.order).padStart(2, "0")}.wav`);
      await fs.writeFile(audioPath, buf);
      audioPaths[scene.order] = audioPath;
    }));

    // 3) Prepare per-scene visuals
    const slidePngs = job.sourcePptxDriveFileId
      ? await preparePptxSlides({ job, ctx, workDir })
      : [];
    const sourceVideoPath = job.sourceVideoDriveFileId
      ? await prepareSourceVideo({ job, ctx, workDir })
      : null;

    // 4) Render one segment per scene
    const segmentPaths: string[] = [];
    for (const scene of job.scenes) {
      const segPath = path.join(workDir, `seg_${String(scene.order).padStart(2, "0")}.mp4`);
      const audioPath = audioPaths[scene.order];
      if (!audioPath) {
        console.warn(`[render] skipping scene ${scene.order}: no audio`);
        continue;
      }
      const duration = scene.audioDurationSec + 0.4;  // small pad so audio doesn't clip

      if (job.sourcePptxDriveFileId) {
        // Visual = corresponding slide PNG (1-indexed)
        const slideIdx = (scene.order - 1) % Math.max(1, slidePngs.length);
        const slidePath = slidePngs[slideIdx];
        if (!slidePath) {
          console.warn(`[render] no slide for scene ${scene.order}, skipping`);
          continue;
        }
        await renderImageSegment({
          slidePath,
          audioPath,
          duration,
          resolution: res,
          outPath: segPath,
        });
      } else if (sourceVideoPath) {
        // Visual = trimmed segment from the source video
        const start = scene.sourceStartSec ?? 0;
        const end = scene.sourceEndSec ?? (start + duration);
        await renderVideoSegment({
          sourceVideoPath,
          startSec: start,
          durationSec: Math.max(end - start, duration),
          audioPath,
          resolution: res,
          outPath: segPath,
        });
      } else {
        // Black background fallback — should never hit in practice
        await renderBlackSegment({
          audioPath,
          duration,
          resolution: res,
          outPath: segPath,
        });
      }
      segmentPaths.push(segPath);
    }

    if (segmentPaths.length === 0) {
      return { ok: false, error: "No scenes produced — check that scene audios exist." };
    }

    // 5) Concat segments via the concat demuxer (no re-encode of unchanged segments)
    const concatListPath = path.join(workDir, "concat.txt");
    const concatBody = segmentPaths.map(p => `file '${p}'`).join("\n");
    await fs.writeFile(concatListPath, concatBody);
    const concatPath = path.join(workDir, "concat.mp4");
    await exec("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatListPath,
      "-c", "copy",
      "-movflags", "+faststart",
      concatPath,
    ], { timeout: 600_000 });

    // 6) Burn captions on top of the concat (re-encode happens here once)
    const finalPath = path.join(workDir, "final.mp4");
    // libass needs the ASS path escaped for the filter graph
    const assForFilter = assPath.replace(/:/g, "\\:").replace(/'/g, "\\'");
    await exec("ffmpeg", [
      "-y",
      "-i", concatPath,
      "-vf", `subtitles=${assForFilter}:fontsdir=/usr/share/fonts/truetype/quicksand`,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      finalPath,
    ], { timeout: 600_000 });

    // 7) Upload to Drive
    const today = new Date().toISOString().slice(0, 10);
    const safeTitle = job.title.replace(/[\/\\]+/g, " ").replace(/\s+/g, " ").trim() || "Training Video";
    const mp4Name = `${today} — ${safeTitle}.mp4`;
    const uploaded = await uploadMp4(ctx, {
      folderId: job.outputFolderId,
      name: mp4Name,
      filePath: finalPath,
    });

    // 8) Compute final duration (sum of audio durations + pads)
    const totalDuration = job.scenes.reduce((sum, s) => sum + (s.audioDurationSec || 0) + 0.4, 0);

    return {
      ok: true,
      mp4DriveFileId: uploaded.fileId,
      mp4DriveUrl: uploaded.webViewLink,
      durationSec: totalDuration,
    };
  } catch (e: any) {
    console.error("[render] failed:", e);
    return { ok: false, error: e?.message || String(e) };
  } finally {
    // Always clean up the temp workdir
    try { await fs.rm(workDir, { recursive: true, force: true }); } catch {}
  }
}

// ─── Segment renderers ───────────────────────────────────────────────────

/**
 * Image segment — slide PNG over the duration of the scene audio.
 * The slide is centered, scaled to fit short edge with letterboxing if needed.
 */
async function renderImageSegment(args: {
  slidePath: string;
  audioPath: string;
  duration: number;
  resolution: { w: number; h: number };
  outPath: string;
}): Promise<void> {
  // Fit slide on a black canvas at target resolution.
  const filter = `scale=${args.resolution.w}:${args.resolution.h}:force_original_aspect_ratio=decrease,pad=${args.resolution.w}:${args.resolution.h}:(ow-iw)/2:(oh-ih)/2:color=0x111827`;
  await exec("ffmpeg", [
    "-y",
    "-loop", "1",
    "-framerate", "30",
    "-i", args.slidePath,
    "-i", args.audioPath,
    "-vf", filter,
    "-t", String(args.duration),
    "-c:v", "libx264",
    "-preset", "fast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    args.outPath,
  ], { timeout: 300_000 });
}

/**
 * Video segment — trim the source recording, scale/pad to target resolution,
 * replace audio with the TTS narration.
 */
async function renderVideoSegment(args: {
  sourceVideoPath: string;
  startSec: number;
  durationSec: number;
  audioPath: string;
  resolution: { w: number; h: number };
  outPath: string;
}): Promise<void> {
  const filter = `scale=${args.resolution.w}:${args.resolution.h}:force_original_aspect_ratio=decrease,pad=${args.resolution.w}:${args.resolution.h}:(ow-iw)/2:(oh-ih)/2:color=0x111827`;
  await exec("ffmpeg", [
    "-y",
    "-ss", String(args.startSec),
    "-t", String(args.durationSec),
    "-i", args.sourceVideoPath,
    "-i", args.audioPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-vf", filter,
    "-c:v", "libx264",
    "-preset", "fast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    args.outPath,
  ], { timeout: 300_000 });
}

/** Black fallback — used only when no slide and no source video are available. */
async function renderBlackSegment(args: {
  audioPath: string;
  duration: number;
  resolution: { w: number; h: number };
  outPath: string;
}): Promise<void> {
  await exec("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=0x111827:s=${args.resolution.w}x${args.resolution.h}:d=${args.duration}:r=30`,
    "-i", args.audioPath,
    "-c:v", "libx264",
    "-preset", "fast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    args.outPath,
  ], { timeout: 300_000 });
}

// ─── Source preparation ─────────────────────────────────────────────────

async function preparePptxSlides(args: {
  job: RenderJob;
  ctx: any;
  workDir: string;
}): Promise<string[]> {
  if (!args.job.sourcePptxDriveFileId) return [];
  const buf = await downloadFile(args.ctx, args.job.sourcePptxDriveFileId);
  const pptxPath = path.join(args.workDir, "source.pptx");
  await fs.writeFile(pptxPath, buf);
  const pdfPath = await convertPptxToPdf({ pptxPath, outDir: args.workDir });
  const dpi = args.job.aspectRatio === "9:16" ? 200 : 150;
  return rasterizePdfToPngs({ pdfPath, outDir: args.workDir, dpi });
}

async function prepareSourceVideo(args: {
  job: RenderJob;
  ctx: any;
  workDir: string;
}): Promise<string | null> {
  if (!args.job.sourceVideoDriveFileId) return null;
  const buf = await downloadFile(args.ctx, args.job.sourceVideoDriveFileId);
  const videoPath = path.join(args.workDir, "source.mp4");
  await fs.writeFile(videoPath, buf);
  return videoPath;
}

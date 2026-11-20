/**
 * Ghostscript compression for scanned PDFs.
 *
 * Phone scans (iPhone Notes / Files) store every page as a full-colour photo
 * on a very large page (about 27 x 45 in at 72 ppi). Downsampling by dpi does
 * nothing on such pages, so when page 1 is much larger than A4 we fit the
 * pages onto A4 first. Normal-size PDFs keep their page size.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const GS = process.env.GHOSTSCRIPT_PATH || "gs";

export type Quality = "small" | "standard" | "high";

export const QUALITY_PRESETS: Record<Quality, { dpi: number; jpegQ: number }> = {
  small: { dpi: 100, jpegQ: 60 }, // team default
  standard: { dpi: 150, jpegQ: 70 },
  high: { dpi: 300, jpegQ: 80 },
};

const A4 = { w: 595, h: 842 };
const OVERSIZE_FACTOR = 1.3;

export interface PageInfo {
  pages: number | null;
  firstPage: { w: number; h: number } | null;
  encrypted: boolean;
}

export function parsePdfInfo(out: string): PageInfo {
  const pagesMatch = out.match(/File has (\d+) pages?/i);
  const box = out.match(
    /Page 1 MediaBox:\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\](?:\s*Rotate\s*=\s*(-?\d+))?/i,
  );
  let firstPage: PageInfo["firstPage"] = null;
  if (box) {
    let w = Math.abs(parseFloat(box[3]) - parseFloat(box[1]));
    let h = Math.abs(parseFloat(box[4]) - parseFloat(box[2]));
    const rotate = box[5] ? Math.abs(parseInt(box[5], 10)) % 180 : 0;
    if (rotate === 90) [w, h] = [h, w];
    firstPage = { w, h };
  }
  return {
    pages: pagesMatch ? parseInt(pagesMatch[1], 10) : null,
    firstPage,
    encrypted: /password|encrypt/i.test(out) && !pagesMatch,
  };
}

export function targetPage(fp: PageInfo["firstPage"]): { w: number; h: number } | null {
  if (!fp) return null;
  if (Math.max(fp.w, fp.h) <= A4.h * OVERSIZE_FACTOR) return null;
  return fp.w > fp.h ? { w: A4.h, h: A4.w } : { ...A4 };
}

export function buildGsArgs(input: string, output: string, quality: Quality, fit: { w: number; h: number } | null): string[] {
  const { dpi, jpegQ } = QUALITY_PRESETS[quality];
  const args = [
    "-q", "-dSAFER", "-dBATCH", "-dNOPAUSE",
    "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5",
    "-dDetectDuplicateImages=true",
    "-dDownsampleColorImages=true", "-dColorImageDownsampleType=/Bicubic",
    `-dColorImageResolution=${dpi}`, "-dColorImageDownsampleThreshold=1.0",
    "-dDownsampleGrayImages=true", "-dGrayImageDownsampleType=/Bicubic",
    `-dGrayImageResolution=${dpi}`, "-dGrayImageDownsampleThreshold=1.0",
    "-dAutoFilterColorImages=false", "-dColorImageFilter=/DCTEncode",
    "-dAutoFilterGrayImages=false", "-dGrayImageFilter=/DCTEncode",
    `-dJPEGQ=${jpegQ}`,
  ];
  if (fit) args.push(`-dDEVICEWIDTHPOINTS=${fit.w}`, `-dDEVICEHEIGHTPOINTS=${fit.h}`, "-dFIXEDMEDIA", "-dPDFFitPage");
  args.push(`-sOutputFile=${output}`, input);
  return args;
}

export class UserFacingError extends Error {}

export async function pdfInfo(input: string): Promise<PageInfo> {
  try {
    // -dBATCH matters: without it gs drops into its interactive prompt and waits on stdin.
    const { stdout, stderr } = await run(GS, ["-q", "-dNODISPLAY", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-dPDFINFO", "-dLastPage=1", input], {
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return parsePdfInfo(`${stdout}\n${stderr}`);
  } catch (err: any) {
    const out = `${err?.stdout ?? ""}\n${err?.stderr ?? ""}`;
    const parsed = parsePdfInfo(out);
    return /password/i.test(out) ? { ...parsed, encrypted: true } : parsed;
  }
}

export async function compressFile(input: string, output: string, quality: Quality) {
  const info = await pdfInfo(input);
  if (info.encrypted) throw new UserFacingError("This PDF is password-protected. Remove the password first, then try again.");
  const fit = targetPage(info.firstPage);
  try {
    await run(GS, buildGsArgs(input, output, quality, fit), { timeout: 8 * 60_000, maxBuffer: 10 * 1024 * 1024 });
  } catch (err: any) {
    console.warn(`[pdf] ghostscript failed: ${String(err?.stderr || err?.message).slice(0, 500)}`);
    throw new UserFacingError("This PDF could not be compressed. It may be damaged or password-protected.");
  }
  return { pages: info.pages, resizedToA4: !!fit };
}

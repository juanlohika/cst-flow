import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import JSZip from "jszip";

/**
 * POST /api/addin/patch-slide
 *
 * Receives the .pptx as base64 (read via Office.context.document.getFileAsync),
 * patches the target slide's XML with the given text replacements,
 * and returns the patched slide as a base64-encoded .pptx for
 * insertSlidesFromBase64() in the add-in.
 *
 * Body: {
 *   fileBase64: string,    // base64 of the full .pptx from getFileAsync
 *   slideIndex: number,    // 1-based slide number
 *   suggestions: { original: string, replacement: string }[]
 * }
 *
 * Returns: { base64: string, replaced: number }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { fileBase64, slideIndex, suggestions } = body;

    if (!fileBase64) return NextResponse.json({ error: "Missing fileBase64" }, { status: 400 });
    if (!slideIndex) return NextResponse.json({ error: "Missing slideIndex" }, { status: 400 });
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      return NextResponse.json({ error: "Missing suggestions" }, { status: 400 });
    }

    // ── 1. Decode base64 to buffer ────────────────────────────────────────────
    const pptxBuffer = Buffer.from(fileBase64, "base64");
    console.log(`[patch-slide] Received file buffer: ${pptxBuffer.byteLength} bytes`);

    // ── 2. Unzip the .pptx ────────────────────────────────────────────────────
    const zip = await JSZip.loadAsync(pptxBuffer);

    // ── 3. Find the target slide XML ──────────────────────────────────────────
    const slideFile = zip.file(`ppt/slides/slide${slideIndex}.xml`);
    if (!slideFile) {
      const slideFiles = Object.keys(zip.files).filter(f => f.match(/ppt\/slides\/slide\d+\.xml/));
      console.error(`[patch-slide] slide${slideIndex}.xml not found. Available:`, slideFiles);
      return NextResponse.json(
        { error: `Slide ${slideIndex} not found. Available: ${slideFiles.join(", ")}` },
        { status: 400 }
      );
    }

    let slideXml = await slideFile.async("string");
    console.log(`[patch-slide] Slide XML length: ${slideXml.length}`);

    // ── 4. Apply text replacements ────────────────────────────────────────────
    let replaced = 0;

    for (const s of suggestions) {
      if (!s.original || s.replacement === undefined) continue;

      const escapedOriginal = escapeXml(s.original);
      const escapedReplacement = escapeXml(s.replacement);
      const before = slideXml;

      // Case 1: exact match with XML-escaped value in <a:t> tag
      slideXml = slideXml.split(`<a:t>${escapedOriginal}</a:t>`).join(`<a:t>${escapedReplacement}</a:t>`);

      // Case 2: unescaped literal match
      if (slideXml === before) {
        slideXml = slideXml.split(`<a:t>${s.original}</a:t>`).join(`<a:t>${s.replacement}</a:t>`);
      }

      // Case 3: <a:t> with xml:space="preserve" or other attributes
      if (slideXml === before) {
        const re = new RegExp(`<a:t(?:[^>]*)>${escapeRegex(escapedOriginal)}<\\/a:t>`, "g");
        const patched = slideXml.replace(re, `<a:t>${escapedReplacement}</a:t>`);
        if (patched !== slideXml) slideXml = patched;
      }

      if (slideXml !== before) {
        replaced++;
        console.log(`[patch-slide] ✓ Replaced "${s.original}" → "${s.replacement}"`);
      } else {
        const samples = slideXml.match(/<a:t(?:[^>]*)>[^<]{1,60}<\/a:t>/g)?.slice(0, 10) || [];
        console.warn(`[patch-slide] No match for "${s.original}". Samples:`, samples);
      }
    }

    if (replaced === 0) {
      return NextResponse.json({ error: "No matches found in slide XML", replaced: 0 }, { status: 422 });
    }

    // ── 5. Write patched XML back ─────────────────────────────────────────────
    zip.file(`ppt/slides/slide${slideIndex}.xml`, slideXml);

    // ── 6. Get the slide's id from presentation.xml (needed for sourceSlideIds) ─
    let slideId: number | null = null;
    try {
      const presXml = await zip.file("ppt/presentation.xml")!.async("string");
      // <p:sldId id="256" r:id="rId2"/> — find the Nth sldId element (1-based)
      const matches = [...presXml.matchAll(/<p:sldId[^>]+id="(\d+)"/g)];
      if (matches[slideIndex - 1]) {
        slideId = parseInt(matches[slideIndex - 1][1], 10);
        console.log(`[patch-slide] slide ${slideIndex} has sldId: ${slideId}`);
      }
    } catch (e) {
      console.warn("[patch-slide] Could not read slideId from presentation.xml:", e);
    }

    // ── 7. Rezip and return as base64 ─────────────────────────────────────────
    const patchedBuffer = await zip.generateAsync({
      type: "base64",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    console.log(`[patch-slide] Done. ${replaced} replacements.`);
    return NextResponse.json({ base64: patchedBuffer, replaced, slideId });

  } catch (err: any) {
    console.error("[patch-slide] Error:", err);
    return NextResponse.json({ error: err.message || "Server error" }, { status: 500 });
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

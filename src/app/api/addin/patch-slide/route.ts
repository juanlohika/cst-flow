import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import JSZip from "jszip";

/**
 * POST /api/addin/patch-slide
 *
 * Downloads the PowerPoint file from OneDrive via Microsoft Graph,
 * patches the target slide's XML with the given text replacements,
 * and returns the patched slide as a base64-encoded .pptx for
 * insertSlidesFromBase64() in the add-in.
 *
 * Body: {
 *   graphToken: string,       // from OfficeRuntime.auth.getAccessTokenAsync()
 *   fileId: string,           // OneDrive file ID
 *   slideIndex: number,       // 1-based slide number
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
    const { graphToken, fileId, slideIndex, suggestions } = body;

    if (!graphToken) return NextResponse.json({ error: "Missing graphToken" }, { status: 400 });
    if (!fileId) return NextResponse.json({ error: "Missing fileId" }, { status: 400 });
    if (!slideIndex) return NextResponse.json({ error: "Missing slideIndex" }, { status: 400 });
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      return NextResponse.json({ error: "Missing suggestions" }, { status: 400 });
    }

    // ── 1. Exchange the add-in token for a Graph token (On-Behalf-Of flow) ──────
    console.log(`[patch-slide] Exchanging token via OBO flow...`);
    const oboRes = await fetch(
      `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          client_id: process.env.AZURE_CLIENT_ID!,
          client_secret: process.env.AZURE_CLIENT_SECRET!,
          assertion: graphToken,
          scope: "https://graph.microsoft.com/Files.ReadWrite offline_access",
          requested_token_use: "on_behalf_of",
        }),
      }
    );

    if (!oboRes.ok) {
      const oboErr = await oboRes.text();
      console.error("[patch-slide] OBO token exchange failed:", oboErr);
      return NextResponse.json({ error: `Token exchange failed: ${oboErr}` }, { status: 401 });
    }

    const oboData = await oboRes.json();
    const accessToken = oboData.access_token;
    console.log(`[patch-slide] OBO token obtained successfully`);

    // ── 2. Download the .pptx from OneDrive via Graph API ─────────────────────
    console.log(`[patch-slide] Downloading file ${fileId} from OneDrive...`);
    const downloadRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: "follow",
      }
    );

    if (!downloadRes.ok) {
      const errText = await downloadRes.text();
      console.error("[patch-slide] Graph download failed:", errText);
      return NextResponse.json(
        { error: `Graph API error: ${downloadRes.status} ${errText}` },
        { status: 502 }
      );
    }

    const pptxBuffer = await downloadRes.arrayBuffer();
    console.log(`[patch-slide] Downloaded ${pptxBuffer.byteLength} bytes`);

    // ── 2. Unzip the .pptx ────────────────────────────────────────────────────
    const zip = await JSZip.loadAsync(pptxBuffer);

    // ── 3. Find the target slide XML ──────────────────────────────────────────
    // Slides are at ppt/slides/slide1.xml, slide2.xml, etc.
    const slideFile = zip.file(`ppt/slides/slide${slideIndex}.xml`);
    if (!slideFile) {
      // List available slides for debugging
      const slideFiles = Object.keys(zip.files).filter(f => f.match(/ppt\/slides\/slide\d+\.xml/));
      console.error(`[patch-slide] slide${slideIndex}.xml not found. Available:`, slideFiles);
      return NextResponse.json(
        { error: `Slide ${slideIndex} not found in file. Available: ${slideFiles.join(", ")}` },
        { status: 400 }
      );
    }

    let slideXml = await slideFile.async("string");
    console.log(`[patch-slide] Slide XML length: ${slideXml.length}`);

    // ── 4. Apply text replacements ────────────────────────────────────────────
    // PowerPoint stores text in <a:t> tags inside the slide XML.
    // A single visible "cell value" may be split across multiple <a:t> tags
    // if it has mixed formatting. We handle both single and split cases.
    let replaced = 0;

    for (const s of suggestions) {
      if (!s.original || s.replacement === undefined) continue;

      const escapedOriginal = escapeXml(s.original);
      const escapedReplacement = escapeXml(s.replacement);

      const before = slideXml;

      // Case 1: text sits in a single <a:t> tag (most common)
      slideXml = slideXml.split(`<a:t>${escapedOriginal}</a:t>`).join(`<a:t>${escapedReplacement}</a:t>`);

      // Case 2: unescaped fallback
      if (slideXml === before) {
        slideXml = slideXml.split(`<a:t>${s.original}</a:t>`).join(`<a:t>${s.replacement}</a:t>`);
      }

      // Case 3: text has a space or formatting run split — use regex
      if (slideXml === before) {
        // Match <a:t> possibly with xml:space="preserve" attribute
        const re = new RegExp(`<a:t(?:[^>]*)>${escapeRegex(escapedOriginal)}<\\/a:t>`, "g");
        const patched = slideXml.replace(re, `<a:t>${escapedReplacement}</a:t>`);
        if (patched !== slideXml) slideXml = patched;
      }

      if (slideXml !== before) {
        replaced++;
        console.log(`[patch-slide] ✓ Replaced "${s.original}" → "${s.replacement}"`);
      } else {
        // Log sample <a:t> values to help debug mismatches
        const samples = slideXml.match(/<a:t(?:[^>]*)>[^<]{1,60}<\/a:t>/g)?.slice(0, 15) || [];
        console.warn(`[patch-slide] No match for "${s.original}". Sample <a:t> values:`, samples);
      }
    }

    if (replaced === 0) {
      return NextResponse.json({ error: "No matches found in slide XML", replaced: 0 }, { status: 422 });
    }

    // ── 5. Write patched XML back into the zip ────────────────────────────────
    zip.file(`ppt/slides/slide${slideIndex}.xml`, slideXml);

    // ── 6. Rezip and return as base64 ─────────────────────────────────────────
    const patchedBuffer = await zip.generateAsync({
      type: "base64",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    console.log(`[patch-slide] Done. ${replaced} replacements. Returning base64 pptx.`);
    return NextResponse.json({ base64: patchedBuffer, replaced });

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

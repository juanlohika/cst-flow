/**
 * Pilot Tracker — Gemini vision verification of version screenshots.
 *
 * Called fire-and-forget from the participant screenshot upload route.
 * Extracts the app version string from the uploaded screenshot using
 * Gemini vision, compares to the project's targetAppVersion, and writes
 * back to the participant record.
 *
 * Decision matrix (see spec §7):
 *   - AI reads a version + matches targetAppVersion → auto verified
 *   - AI reads a version + clearly differs           → auto mismatch
 *   - AI can't read confidently (UNCERTAIN)         → stays pending (manual)
 *   - Gemini API error                              → stays pending (manual)
 *
 * The AI's raw extraction is stored in versionAiExtractedText for audit,
 * so CST can see what Gemini thought even after they manually override.
 *
 * Version-matching is fuzzy on purpose: "5.1.7-beta", "5.1.7", "v5.1.7"
 * all match "5.1.7-beta". We compare the core semver-ish digits only,
 * because participants may screenshot a build that displays the version
 * with different embellishments than the admin typed.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { updateParticipant } from "./participant-mutations";

interface VerifyArgs {
  participantId: string;
  screenshotBuffer: Buffer;
  screenshotMimeType: string;
  targetVersion: string | null;
}

interface VerifyResult {
  status: "verified" | "mismatch" | "pending";
  extractedText: string | null;
  error?: string;
}

/**
 * Prompt the model to return a strict JSON object we can parse. Keeping
 * the format tight avoids the LLM waxing philosophical about the image.
 *
 * `UNCERTAIN` in either field means "I don't see this clearly enough to
 * assert one way or another." Falls back to manual review.
 */
function buildPrompt(targetVersion: string | null): string {
  return [
    "You are examining a screenshot of a mobile app's 'About' or 'More' or 'Settings' screen.",
    "Task: Extract the app version string displayed on the screen.",
    "",
    targetVersion
      ? `The expected version is: "${targetVersion}". Answer whether what you see matches.`
      : "There's no expected version provided — just extract what you see.",
    "",
    "Respond with ONLY a JSON object with these exact fields:",
    "{",
    '  "extracted": "the version string you see (e.g. \\"5.1.7-beta\\") or \\"UNCERTAIN\\" if you cannot read it clearly",',
    targetVersion
      ? '  "verdict": "MATCH" | "MISMATCH" | "UNCERTAIN"'
      : '  "verdict": "UNCERTAIN"',
    "}",
    "",
    "Rules:",
    "- If the screenshot is not an app version screen, or you cannot see a version, use UNCERTAIN.",
    "- Version comparison: ignore leading 'v', ignore build suffixes like '-beta' or '(1234)'. Compare the core digits.",
    '- Example: extracted "5.1.7-beta (2103)" matches target "5.1.7". Verdict: MATCH.',
    '- Example: extracted "5.0.2" against target "5.1.7". Verdict: MISMATCH.',
    "- If unsure, prefer UNCERTAIN over guessing.",
    "- Do not include markdown code fences. Return the raw JSON only.",
  ].join("\n");
}

/**
 * Run vision verification on a screenshot. Never throws — errors are
 * captured in the return value and the DB is updated with pending state.
 */
export async function verifyVersionScreenshot(args: VerifyArgs): Promise<VerifyResult> {
  const { participantId, screenshotBuffer, screenshotMimeType, targetVersion } = args;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[pilot/verifier] GEMINI_API_KEY missing — leaving as pending");
    return { status: "pending", extractedText: null, error: "GEMINI_API_KEY not set" };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = buildPrompt(targetVersion);
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: screenshotMimeType,
          data: screenshotBuffer.toString("base64"),
        },
      },
      prompt,
    ]);
    const rawText = result.response.text().trim();

    // Model may return with code fences despite instructions; strip them.
    const clean = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    let parsed: { extracted?: string; verdict?: string } | null = null;
    try {
      parsed = JSON.parse(clean);
    } catch {
      console.warn("[pilot/verifier] non-JSON response:", clean);
      await writePending(participantId, `Non-JSON response: ${clean.slice(0, 200)}`);
      return { status: "pending", extractedText: clean, error: "Non-JSON model response" };
    }

    const extracted = String(parsed?.extracted || "").trim();
    const verdict = String(parsed?.verdict || "").trim().toUpperCase();

    // No target version → we can only extract, not compare. Save extract + leave pending.
    if (!targetVersion) {
      await writePending(participantId, extracted || null);
      return { status: "pending", extractedText: extracted || null };
    }

    // AI uncertain → manual review
    if (verdict === "UNCERTAIN" || !extracted || extracted === "UNCERTAIN") {
      await writePending(participantId, extracted || null);
      return { status: "pending", extractedText: extracted || null };
    }

    // AI decisive → apply the verdict + also double-check with our own
    // fuzzy match (belt-and-suspenders). If AI says MATCH but our fuzzy
    // check disagrees, we trust our fuzzy result — the model has been
    // known to hallucinate "match" on borderline cases.
    const fuzzyMatch = fuzzyVersionMatch(extracted, targetVersion);
    const status: "verified" | "mismatch" =
      verdict === "MATCH" && fuzzyMatch ? "verified" : "mismatch";

    await updateParticipant(
      participantId,
      {
        versionVerified: status,
        versionVerifiedByAi: true,
        versionAiExtractedText: extracted,
        reportedVersion: extracted, // helpful for the admin roster view
      },
      { actor: "ai" },
    );

    return { status, extractedText: extracted };
  } catch (e: any) {
    console.warn("[pilot/verifier] Gemini call failed:", e?.message || e);
    await writePending(
      participantId,
      null,
      `Gemini error: ${e?.message || String(e)}`,
    );
    return {
      status: "pending",
      extractedText: null,
      error: e?.message || "Gemini call failed",
    };
  }
}

/**
 * Write "pending" state with optional extracted text + note. Used when
 * the model is uncertain or errors out — the record lands in the manual
 * review queue.
 */
async function writePending(
  participantId: string,
  extractedText: string | null,
  errorNote?: string,
): Promise<void> {
  try {
    await updateParticipant(
      participantId,
      {
        versionVerified: "pending",
        versionVerifiedByAi: false,
        versionAiExtractedText: extractedText,
      },
      {
        actor: "ai",
        note: errorNote || (extractedText ? `AI extracted: ${extractedText}` : undefined),
      },
    );
  } catch (e) {
    console.warn("[pilot/verifier] writePending failed:", e);
  }
}

/**
 * Fuzzy version match: "5.1.7-beta" and "5.1.7" should match. Extracts
 * digit-sequences separated by dots and compares as tuples. Extra
 * suffixes on either side are ignored.
 *
 * Returns true if the leading numeric part of `a` equals the leading
 * numeric part of `b`.
 */
function fuzzyVersionMatch(a: string, b: string): boolean {
  const na = extractSemverCore(a);
  const nb = extractSemverCore(b);
  if (!na || !nb) return false;
  return na === nb;
}

function extractSemverCore(s: string): string | null {
  // Grab the first x.y or x.y.z pattern.
  const m = s.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  const parts = [m[1], m[2] || "0", m[3] || "0"];
  return parts.join(".");
}

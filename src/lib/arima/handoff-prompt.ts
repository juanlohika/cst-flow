/**
 * Composes PROMPT.md — the handoff from Arima to a coding assistant.
 *
 * WHY A FILE AND NOT A CHAT MESSAGE
 * ---------------------------------
 * The obvious design is for Arima to post a prompt into the group and for
 * someone to copy it. A file is better for four reasons:
 *
 *   - It lives WITH the evidence it describes, permanently. A chat message
 *     scrolls away; the folder does not.
 *   - The handoff becomes one line — a folder path — instead of a wall of text.
 *   - If Arima misread the requirement, you edit the file rather than re-running
 *     the whole gathering exchange.
 *   - It is auditable later: what was asked, what evidence existed, what came out.
 *
 * WHAT IT DELIBERATELY DOES NOT CONTAIN
 * -------------------------------------
 * Exact values read off screenshots. Arima describes what it saw; the assistant
 * that picks this up reads the images itself. See the vision policy in
 * evidence-filing.ts — a misread digit stated as fact is worse than no value.
 */

import type { GatherSession } from "./session";

export interface HandoffEvidence {
  fileName: string;
  kind: string;
  driveWebViewLink: string;
  visionSummary: string | null;
  uploadedByName: string | null;
}

export interface HandoffInput {
  session: GatherSession;
  evidence: HandoffEvidence[];
  /** What the requester asked for, in their words where possible. */
  requirement: string;
  /** What happens today — the current behaviour, as discussed. */
  currentBehaviour?: string | null;
  /** What they want instead. */
  requestedBehaviour?: string | null;
  /** Open questions Arima could not resolve in the chat. */
  openQuestions?: string[];
  /** Who was in the conversation. */
  participants?: string[];
  /** Account / client this concerns. */
  accountName?: string | null;
  /** What the output should be: artifact | ticket | brd | unsure */
  deliverable?: string | null;
}

function bullet(items: string[]): string {
  return items.filter(Boolean).map((i) => `- ${i}`).join("\n");
}

export function composeHandoffPrompt(input: HandoffInput): string {
  const { session, evidence } = input;
  const screenshots = evidence.filter((e) => e.kind === "screenshot");
  const recordings = evidence.filter((e) => e.kind === "recording");
  const documents = evidence.filter((e) => e.kind === "document");

  const lines: string[] = [];

  lines.push(`# ${session.requestTitle || "Requirement"}`);
  lines.push("");
  lines.push(
    `_Gathered by Arima on ${session.startedAt.slice(0, 10)}` +
      (input.accountName ? ` for ${input.accountName}` : "") +
      `. Evidence folder: ${session.driveDisplayPath || "(see link below)"}._`
  );
  lines.push("");

  // ── The ask ──
  lines.push("## What is being asked for");
  lines.push("");
  lines.push(input.requirement.trim());
  lines.push("");

  if (input.currentBehaviour) {
    lines.push("## Current behaviour");
    lines.push("");
    lines.push(input.currentBehaviour.trim());
    lines.push("");
  }

  if (input.requestedBehaviour) {
    lines.push("## Requested behaviour");
    lines.push("");
    lines.push(input.requestedBehaviour.trim());
    lines.push("");
  }

  // ── Evidence ──
  lines.push("## Evidence");
  lines.push("");
  if (!evidence.length) {
    lines.push("_No files were attached to this request._");
    lines.push("");
  } else {
    lines.push(
      `${screenshots.length} screenshot${screenshots.length === 1 ? "" : "s"}` +
        (recordings.length ? `, ${recordings.length} recording${recordings.length === 1 ? "" : "s"}` : "") +
        (documents.length ? `, ${documents.length} document${documents.length === 1 ? "" : "s"}` : "") +
        ` in this folder.`
    );
    lines.push("");

    if (screenshots.length) {
      lines.push("### Screenshots");
      lines.push("");
      for (const s of screenshots) {
        lines.push(`**${s.fileName}**${s.uploadedByName ? ` — shared by ${s.uploadedByName}` : ""}`);
        if (s.visionSummary) lines.push(`> ${s.visionSummary.replace(/\n+/g, " ")}`);
        lines.push("");
      }
    }

    if (recordings.length) {
      lines.push("### Recordings");
      lines.push("");
      for (const r of recordings) {
        lines.push(`- \`${r.fileName}\`${r.uploadedByName ? ` — shared by ${r.uploadedByName}` : ""}`);
      }
      lines.push("");
      lines.push(
        "_Arima cannot read video. Extract frames at the moments that matter " +
          "(ffmpeg) and read those._"
      );
      lines.push("");
    }

    if (documents.length) {
      lines.push("### Documents");
      lines.push("");
      for (const d of documents) lines.push(`- \`${d.fileName}\``);
      lines.push("");
    }
  }

  // ── The caveat that matters most ──
  lines.push("## Important — read the evidence yourself");
  lines.push("");
  lines.push(
    "The screenshot notes above are **descriptions of what is on screen**, not " +
      "transcriptions. Arima runs on a small vision model and deliberately does " +
      "not quote exact formulas, field values or numbers, because a misread digit " +
      "stated as fact becomes a false premise."
  );
  lines.push("");
  lines.push("**Open the files in the folder and read the exact values before relying on any of them.**");
  lines.push("");

  if (input.openQuestions?.length) {
    lines.push("## Open questions");
    lines.push("");
    lines.push("Arima could not resolve these in the chat:");
    lines.push("");
    lines.push(bullet(input.openQuestions));
    lines.push("");
  }

  // ── What to produce ──
  lines.push("## Suggested next step");
  lines.push("");
  const deliverable = (input.deliverable || "").toLowerCase();
  if (deliverable.includes("artifact")) {
    lines.push(
      "Build an artifact documenting this requirement for the development team — " +
        "current behaviour, requested behaviour, and the evidence inline. Developers " +
        "need the visualisation, not only the text."
    );
  } else if (deliverable.includes("ticket")) {
    lines.push("Write a ticket title and description for this requirement.");
  } else if (deliverable.includes("brd")) {
    lines.push("Draft a BRD for this requirement in the Tarkie structure.");
  } else {
    lines.push(
      "Confirm with the requester whether this should become an artifact, a ticket, " +
        "or a BRD, then produce it."
    );
  }
  lines.push("");

  if (input.participants?.length) {
    lines.push("---");
    lines.push("");
    lines.push(`_In the conversation: ${input.participants.join(", ")}._`);
  }

  return lines.join("\n");
}

/**
 * The one-liner Arima posts into the group. Short on purpose — the detail is in
 * the file, and a wall of text in a busy GC gets skimmed.
 */
export function composeChatHandoff(session: GatherSession, evidenceCount: number): string {
  const count = evidenceCount === 1 ? "1 file" : `${evidenceCount} files`;
  return (
    `Filed. ${count} saved and a handoff written.\n\n` +
    `📁 ${session.driveDisplayPath || "Evidence folder"}\n` +
    `${session.driveFolderUrl || ""}\n\n` +
    `Open \`PROMPT.md\` in that folder and paste the path into Claude Code to build it.`
  );
}

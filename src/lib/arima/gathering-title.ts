/**
 * Derives a working title for a gathering session from the message that woke it.
 *
 * The title becomes the Drive folder name, so it has to be produced
 * synchronously and cheaply — before any model call, and without one. Arima can
 * rename the session later once it understands the requirement properly; this
 * only has to be good enough to find the folder by eye.
 */

/** Words that start a request but say nothing about what it is about. */
const LEAD_NOISE = [
  "arima", "hi", "hello", "hey", "please", "pls", "can you", "could you",
  "kindly", "i need you to", "i need", "we need", "help me", "help us",
  "let's", "lets", "we have to", "i want you to", "i want", "pakiusap",
  "paki", "pwede", "puwede", "sana",
];

/** The verb that names the action, stripped so the title says the SUBJECT. */
const ACTION_WORDS = [
  "document", "write up", "writeup", "capture", "log", "file",
  "raise a ticket for", "raise a ticket", "create a ticket for",
  "create a ticket", "ticket for", "prepare", "gather", "collect",
  "make an artifact for", "create an artifact for", "artifact for",
  "a brd for", "brd for",
];

/** Trailing words that add nothing to a folder name. */
const TRAIL_NOISE = ["please", "pls", "thanks", "thank you", "salamat", "po", "na"];

function stripLeading(text: string, phrases: string[]): string {
  let out = text;
  let changed = true;
  // Loop because requests stack: "Arima please can you document…"
  while (changed) {
    changed = false;
    const lower = out.toLowerCase().trimStart();
    for (const p of phrases) {
      if (lower.startsWith(p + " ") || lower === p) {
        out = out.trimStart().slice(p.length).trimStart();
        // Drop a leading comma or colon left behind by the removed phrase.
        out = out.replace(/^[,:;-]\s*/, "");
        changed = true;
        break;
      }
    }
  }
  return out;
}

function stripTrailing(text: string, phrases: string[]): string {
  let out = text.trim();
  let changed = true;
  while (changed) {
    changed = false;
    const lower = out.toLowerCase();
    for (const p of phrases) {
      if (lower.endsWith(" " + p)) {
        out = out.slice(0, out.length - p.length - 1).trimEnd();
        changed = true;
        break;
      }
    }
    out = out.replace(/[.!?,;:]+$/, "").trimEnd();
  }
  return out;
}

/**
 * Turn "@arima please document the issue with the MTD computation field" into
 * "the issue with the MTD computation field".
 *
 * Falls back to a dated placeholder when nothing useful survives — an unnamed
 * folder is better than a folder named after filler words.
 */
export function deriveRequestTitle(message: string): string {
  if (!message) return "Untitled request";

  // Remove the @mention wherever it sits, plus any bot-username form.
  let t = message.replace(/@arima\b/gi, " ").replace(/@\w*arima\w*/gi, " ");
  // Collapse whitespace and newlines — a title is one line.
  t = t.replace(/\s+/g, " ").trim();

  t = stripLeading(t, LEAD_NOISE);
  t = stripLeading(t, ACTION_WORDS);
  // "document THIS requirement" / "capture THE issue" — drop the article left over.
  t = t.replace(/^(this|that|these|those|the|a|an)\s+/i, "");
  t = stripLeading(t, LEAD_NOISE);
  t = stripTrailing(t, TRAIL_NOISE);

  // Only the first sentence — the rest is usually detail, not a name.
  const firstSentence = t.split(/(?<=[.!?])\s+/)[0] || t;
  t = firstSentence.trim();

  if (t.length < 3) return "Untitled request";
  if (t.length > 70) {
    // Cut on a word boundary so the folder name does not end mid-word.
    const cut = t.slice(0, 70);
    const lastSpace = cut.lastIndexOf(" ");
    t = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
  }
  // Capitalise the first letter; leave the rest as typed so product names and
  // acronyms (MTD, BRD, STR) keep their casing.
  return t.charAt(0).toUpperCase() + t.slice(1);
}

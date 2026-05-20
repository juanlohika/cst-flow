/**
 * Phase F.2 (B7) — Proposal content shape. This is the JSON that the AI
 * produces and that both the HTML preview page and the PDF render consume.
 * One source of truth: edit a proposal → re-render the preview → click
 * export → get a PDF that matches.
 *
 * Keep it human-readable. Future Telegram-chat-driven generation should be
 * able to inspect this shape and ask the user for any missing required fields.
 */

export interface ProposalContent {
  /** Short title that appears in the doc header and version-tracking. */
  title: string;
  /** ISO date the proposal was prepared. */
  proposalDate: string;

  client: {
    /** Full company name. */
    name: string;
    signatory?: {
      name: string;
      title: string;
    };
  };

  /** MOI side of the signoff. Defaults to the generating user's profile. */
  moi: {
    signatory: {
      name: string;
      title: string;
    };
  };

  /** Version tracking row. Each generation creates a new Proposal row; the
   *  history (1, 2, 3…) is tracked at the DB level, not embedded here. */
  version: {
    number: number;
    date: string;          // ISO date
    preparedBy: string;
    submittedTo: string;
    description: string;   // one-liner about this version
  };

  /** Body sections, in order. Each section has a heading + paragraphs. The
   *  AI decides which sections apply to the proposal — there's no required
   *  set, but the system prompt nudges toward a standard structure. */
  sections: ProposalSection[];

  /** Cost / pricing block. Optional — informational proposals may omit it. */
  cost?: ProposalCost;

  /** Estimated timeline phases. Optional. */
  timeline?: TimelinePhase[];

  /** Whether this is an addendum (changes the introductory phrasing). */
  isAddendum?: boolean;

  /** AI's notes about what it inferred + what's missing. Shown in the
   *  preview's "draft notes" sidebar for transparency. */
  aiNotes?: {
    inferred: string[];     // e.g., "I assumed standard 6-week rollout"
    missing: string[];      // e.g., "Confirm guaranteed user count"
    summary: string;
  };
}

export interface ProposalSection {
  /** Heading text (e.g., "Project Objectives", "Scope of Work"). */
  heading: string;
  /** Array of paragraph blocks. Each is either plain text or a bullet list. */
  blocks: ProposalBlock[];
}

export type ProposalBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] };

export interface ProposalCost {
  /** Line items in the cost table. Description + cost, both rendered styled. */
  lines: ProposalCostLine[];
  /** Summary rows below the line items. */
  guaranteedUsers?: string;   // e.g., "30 Users"
  combinedRate?: string;      // e.g., "P300.00 + VAT" for addendum cases
  totalCost: string;          // e.g., "P12,000.00 + VAT" — large, bold
}

export interface ProposalCostLine {
  description: string;
  /** Standard rate (if a discount is applied, this is the "before" price). */
  standardRate?: string;
  /** Discounted rate. When present, rendered in red+bold. */
  discountedRate?: string;
  /** Pricing unit text — e.g., "Per Month Per User". */
  unit?: string;
  /** Optional sub-bullets describing what's included in this line. */
  bullets?: string[];
}

export interface TimelinePhase {
  phase: string;          // e.g., "Prerequisites & Config"
  detailedSteps: string;  // e.g., "Proposal Approval & Account Configuration"
  responsible: string;    // e.g., "Client / Tarkie"
  targetDate: string;     // e.g., "May 29, 2026" or "June 1-30, 2026"
}

// ProposalUserInputs (form-driven flow) was removed when we switched to the
// conversational chat-on-left UI. The new flow uses ChatTurnArgs in
// build-content.ts to drive the AI turn-by-turn.

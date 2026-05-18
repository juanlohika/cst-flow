/**
 * Phase B+ — Account Health color logic.
 *
 * Given an AccountAssessment row (the latest for an account), compute a
 * health score 0-100 and bucket it into green | yellow | red. If there's
 * no assessment yet, the account is "unassessed" (grey).
 *
 * The same function powers:
 *   - Account list view "Health" column chip
 *   - Account detail header strip
 *   - RM campaign queue (Phase C)
 *   - Executive summary aggregates + PDF (Phase D)
 *
 * Scoring (max 100):
 *   EBA-DM        25 pts — (score / 5) * 25
 *   EBA-Admin     20 pts — (score / 5) * 20
 *   Satisfaction  15 pts — (score / 5) * 15
 *   V5 Readiness  15 pts — (score / 5) * 15
 *   Tarkie SSOT   15 pts — true: 15, false: 0, null: 7
 *   No churn      10 pts — contactChangeRecent=false: 10, true: 0
 *
 * Bands:
 *   ≥ 70 → green
 *   40-69 → yellow
 *   < 40 → red
 *
 * Critical overrides — force RED regardless of score:
 *   - any EBA score ≤ 2 (low-trust relationship)
 *   - satisfaction ≤ 2
 *   - Tarkie not SSOT AND a specific third-party tool is named
 *     (active displacement, not just "we don't know yet")
 */

export type HealthColor = "green" | "yellow" | "red" | "grey";

export interface HealthInput {
  satisfaction?: number | null;
  ebaDecisionMaker?: number | null;
  ebaAdmin?: number | null;
  v5Readiness?: number | null;
  isTarkieSsot?: boolean | null;
  thirdPartySsot?: string | null;
  contactChangeRecent?: boolean | null;
}

export interface HealthResult {
  color: HealthColor;
  score: number;            // 0-100
  rawScore: number;         // before critical overrides
  reasons: string[];        // human-readable bullets explaining the color
  isCritical: boolean;      // true when a critical override fired
}

const WEIGHTS = {
  ebaDM: 25,
  ebaAdmin: 20,
  satisfaction: 15,
  v5Readiness: 15,
  ssot: 15,
  noChurn: 10,
};

export function computeHealth(input: HealthInput | null | undefined): HealthResult {
  if (!input) {
    return { color: "grey", score: 0, rawScore: 0, reasons: ["No assessment yet"], isCritical: false };
  }

  // ── Score components ──
  const ebaDMScore = scoreRating(input.ebaDecisionMaker, WEIGHTS.ebaDM);
  const ebaAdminScore = scoreRating(input.ebaAdmin, WEIGHTS.ebaAdmin);
  const satScore = scoreRating(input.satisfaction, WEIGHTS.satisfaction);
  const v5Score = scoreRating(input.v5Readiness, WEIGHTS.v5Readiness);

  let ssotScore: number;
  if (input.isTarkieSsot === true) ssotScore = WEIGHTS.ssot;
  else if (input.isTarkieSsot === false) ssotScore = 0;
  else ssotScore = WEIGHTS.ssot / 2;  // unknown gets half-credit (don't punish absence of data)

  const noChurnScore = input.contactChangeRecent ? 0 : WEIGHTS.noChurn;

  const rawScore = ebaDMScore + ebaAdminScore + satScore + v5Score + ssotScore + noChurnScore;
  const score = Math.round(rawScore);

  // ── Critical overrides ──
  const criticalReasons: string[] = [];
  if (isLowScore(input.ebaDecisionMaker)) criticalReasons.push(`EBA with Decision Maker is ${input.ebaDecisionMaker}/5`);
  if (isLowScore(input.ebaAdmin)) criticalReasons.push(`EBA with Admin is ${input.ebaAdmin}/5`);
  if (isLowScore(input.satisfaction)) criticalReasons.push(`Satisfaction is ${input.satisfaction}/5`);
  if (input.isTarkieSsot === false && input.thirdPartySsot && input.thirdPartySsot.trim()) {
    criticalReasons.push(`Tarkie displaced by ${input.thirdPartySsot}`);
  }
  const isCritical = criticalReasons.length > 0;

  // ── Determine color ──
  let color: HealthColor;
  if (isCritical) {
    color = "red";
  } else if (score >= 70) {
    color = "green";
  } else if (score >= 40) {
    color = "yellow";
  } else {
    color = "red";
  }

  // ── Build reasons list (for tooltips / detail header) ──
  const reasons: string[] = [];
  if (isCritical) {
    // Lead with the critical signals
    reasons.push(...criticalReasons);
  }

  // Add general signals where they're notable
  if (!isCritical) {
    if (color === "green") {
      reasons.push(`Score ${score}/100 — strong across the board`);
    } else if (color === "yellow") {
      reasons.push(`Score ${score}/100 — middling, watch for slippage`);
    } else {
      reasons.push(`Score ${score}/100 — below threshold`);
    }
  }
  if (input.contactChangeRecent) reasons.push("Recent contact change");
  if (input.isTarkieSsot === false && !criticalReasons.some(r => r.includes("displaced"))) {
    reasons.push("Tarkie is not SSOT");
  }

  return { color, score, rawScore, reasons, isCritical };
}

function scoreRating(value: number | null | undefined, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const clamped = Math.max(0, Math.min(5, value));
  return (clamped / 5) * max;
}

function isLowScore(v: number | null | undefined): boolean {
  return typeof v === "number" && v >= 1 && v <= 2;
}

// ─── UI helpers ─────────────────────────────────────────────────────────────
export const HEALTH_COLORS: Record<HealthColor, {
  label: string;
  hex: string;       // for charts / inline SVG
  tailwindBg: string;
  tailwindText: string;
  tailwindBorder: string;
  tailwindRing: string;
  emoji: string;
}> = {
  green: {
    label: "Healthy",
    hex: "#10b981",
    tailwindBg: "bg-emerald-50",
    tailwindText: "text-emerald-700",
    tailwindBorder: "border-emerald-200",
    tailwindRing: "ring-emerald-300",
    emoji: "🟢",
  },
  yellow: {
    label: "Watch",
    hex: "#f59e0b",
    tailwindBg: "bg-amber-50",
    tailwindText: "text-amber-700",
    tailwindBorder: "border-amber-200",
    tailwindRing: "ring-amber-300",
    emoji: "🟡",
  },
  red: {
    label: "Critical",
    hex: "#ef4444",
    tailwindBg: "bg-rose-50",
    tailwindText: "text-rose-700",
    tailwindBorder: "border-rose-200",
    tailwindRing: "ring-rose-300",
    emoji: "🔴",
  },
  grey: {
    label: "Unassessed",
    hex: "#94a3b8",
    tailwindBg: "bg-slate-100",
    tailwindText: "text-slate-500",
    tailwindBorder: "border-slate-200",
    tailwindRing: "ring-slate-300",
    emoji: "⚪",
  },
};

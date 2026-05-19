/**
 * Phase E.7 — Account lifecycle helpers.
 *
 * Engagement status canonical values:
 *   exploration                 — Acquisition team pre-contract.
 *   pending                     — Endorsed by Acquisition but no CST assigned yet.
 *   new-client-implementation   — Active rollout (between contract signed and Go-live).
 *   hypercare                   — 0-90 days post-Go-live. Active concierge support.
 *   maintenance                 — Steady state. Driven by tier-based CC + F2F cadence.
 *
 * Legacy values normalized to:
 *   confirmed   → maintenance
 *   exploratory → exploration
 */

export const LIFECYCLE_STATUSES = [
  "exploration",
  "pending",
  "new-client-implementation",
  "hypercare",
  "maintenance",
] as const;
export type LifecycleStatus = typeof LIFECYCLE_STATUSES[number];

export const STATUS_LABELS: Record<LifecycleStatus, string> = {
  "exploration": "Exploration",
  "pending": "Pending",
  "new-client-implementation": "New Client Implementation",
  "hypercare": "Hypercare",
  "maintenance": "Maintenance",
};

export const STATUS_DESCRIPTIONS: Record<LifecycleStatus, string> = {
  "exploration": "Acquisition team is exploring this prospect — pre-contract.",
  "pending": "Acquisition has endorsed the account but no CST team member is assigned yet.",
  "new-client-implementation": "Active implementation between contract signed and Go-live.",
  "hypercare": "First 90 days post-Go-live. Heavy concierge support, frequent check-ins.",
  "maintenance": "Steady state. Driven by tier-based courtesy call cadence.",
};

/**
 * Normalize legacy and free-form values into the canonical set.
 */
export function normalizeStatus(raw: string | null | undefined): LifecycleStatus {
  if (!raw) return "exploration";
  const norm = String(raw).toLowerCase().trim();
  switch (norm) {
    case "exploratory":
    case "exploration":
      return "exploration";
    case "pending":
      return "pending";
    case "new-client-implementation":
    case "new client implementation":
    case "implementation":
      return "new-client-implementation";
    case "hypercare":
      return "hypercare";
    case "maintenance":
    case "confirmed":            // legacy default — most existing accounts
      return "maintenance";
    default:
      return "exploration";
  }
}

const HYPERCARE_DURATION_DAYS = 90;

export type HypercareStatus = "in-window" | "approaching-end" | "overdue" | "n/a";

export interface HypercareInfo {
  status: HypercareStatus;
  daysInHypercare: number | null;
  daysRemaining: number | null;
  reason: string;
}

/**
 * Compute hypercare timing for an account.
 *   - "in-window":         engagementStatus = 'hypercare' AND goLiveDate set AND <= 90 days
 *   - "approaching-end":   same but 75-90 days in
 *   - "overdue":           > 90 days in hypercare without status flip
 *   - "n/a":               not currently in hypercare
 */
export function hypercareInfo(args: {
  engagementStatus: string | null | undefined;
  goLiveDate: string | null | undefined;
}): HypercareInfo {
  const status = normalizeStatus(args.engagementStatus);
  if (status !== "hypercare") {
    return { status: "n/a", daysInHypercare: null, daysRemaining: null, reason: "Not in hypercare." };
  }
  if (!args.goLiveDate) {
    return { status: "n/a", daysInHypercare: null, daysRemaining: null, reason: "Hypercare flag set but no Go-live date — please update profile." };
  }
  const goLive = new Date(args.goLiveDate).getTime();
  if (Number.isNaN(goLive)) {
    return { status: "n/a", daysInHypercare: null, daysRemaining: null, reason: "Invalid Go-live date format." };
  }
  const daysIn = Math.floor((Date.now() - goLive) / (24 * 60 * 60 * 1000));
  const daysRemaining = HYPERCARE_DURATION_DAYS - daysIn;
  if (daysIn > HYPERCARE_DURATION_DAYS) {
    return { status: "overdue", daysInHypercare: daysIn, daysRemaining, reason: `Past 90 days (${daysIn} days in). Reassess: promote to Maintenance or extend hypercare with a reason.` };
  }
  if (daysIn >= HYPERCARE_DURATION_DAYS - 14) {
    return { status: "approaching-end", daysInHypercare: daysIn, daysRemaining, reason: `${daysRemaining} days left in hypercare window. Plan the transition.` };
  }
  return { status: "in-window", daysInHypercare: daysIn, daysRemaining, reason: `Day ${daysIn} of 90 in hypercare.` };
}

export function statusBadgeColor(status: LifecycleStatus): "slate" | "amber" | "blue" | "indigo" | "emerald" {
  switch (status) {
    case "exploration": return "slate";
    case "pending": return "amber";
    case "new-client-implementation": return "blue";
    case "hypercare": return "indigo";
    case "maintenance": return "emerald";
  }
}

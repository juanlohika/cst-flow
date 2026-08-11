/**
 * Courtesy-call PERIODS — the row an RM records against, and the unit the
 * personnel metrics count.
 *
 * The metrics sheet this replaces asks two questions per account per month:
 * "Planned CC This Month" and "Completed". So a period is not a label on a
 * call — it is a slot that exists whether or not the call happened, which is
 * what makes "planned vs completed" answerable at all.
 *
 * Cadence decides how many slots a year has:
 *   monthly        → 12 slots, 2026-01 … 2026-12
 *   every-2-months →  6 slots, labelled by the month they open
 *   quarterly      →  4 slots, 2026-Q1 … 2026-Q4
 *   every-6-months →  2 slots, 2026-H1, 2026-H2
 *   yearly         →  1 slot,  2026
 *
 * A quarterly account is due ONCE in the quarter — any call inside the window
 * satisfies it — which is the behaviour asked for ("it applies to the quarter
 * months"), rather than three monthly slots the RM would appear to miss.
 */

export type PeriodSlot = {
  label: string;        // "2026-08" | "2026-Q3" | "2026-H2" | "2026"
  start: string;        // YYYY-MM-DD inclusive
  end: string;          // YYYY-MM-DD inclusive — last day the call still counts
  /** Human form for a dropdown: "August 2026", "Q3 2026". */
  display: string;
};

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];

function lastDayOfMonth(year: number, month1: number) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}
function ymd(y: number, m1: number, d: number) {
  return `${y}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** How many months one slot spans, from a frequency label. */
export function monthsPerPeriod(frequency: string | null | undefined): number {
  switch ((frequency || "").toLowerCase()) {
    case "monthly":         return 1;
    case "every-2-months":  return 2;
    case "every-3-months":
    case "quarterly":       return 3;
    case "every-6-months":  return 6;
    case "yearly":          return 12;
    default:                return 0;   // unknown → no slots, do not invent them
  }
}

/**
 * Every slot in a calendar year for a given cadence — including future ones, so
 * an RM can record an invitation they have already sent for next month.
 */
export function periodsForYear(year: number, frequency: string | null | undefined): PeriodSlot[] {
  const span = monthsPerPeriod(frequency);
  if (span === 0) return [];

  const out: PeriodSlot[] = [];
  for (let m = 1; m <= 12; m += span) {
    const endMonth = Math.min(m + span - 1, 12);
    const start = ymd(year, m, 1);
    const end = ymd(year, endMonth, lastDayOfMonth(year, endMonth));

    let label: string, display: string;
    if (span === 1) {
      label = `${year}-${String(m).padStart(2, "0")}`;
      display = `${MONTHS[m - 1]} ${year}`;
    } else if (span === 3) {
      const q = Math.floor((m - 1) / 3) + 1;
      label = `${year}-Q${q}`;
      display = `Q${q} ${year} (${MONTHS[m - 1].slice(0, 3)}–${MONTHS[endMonth - 1].slice(0, 3)})`;
    } else if (span === 6) {
      const h = m === 1 ? 1 : 2;
      label = `${year}-H${h}`;
      display = `H${h} ${year} (${MONTHS[m - 1].slice(0, 3)}–${MONTHS[endMonth - 1].slice(0, 3)})`;
    } else if (span === 12) {
      label = `${year}`;
      display = `${year} (full year)`;
    } else {
      // 2-monthly and any other span: label by the month the slot opens
      label = `${year}-${String(m).padStart(2, "0")}`;
      display = `${MONTHS[m - 1].slice(0, 3)}–${MONTHS[endMonth - 1].slice(0, 3)} ${year}`;
    }
    out.push({ label, start, end, display });
  }
  return out;
}

/** The slot a given date falls inside, or null when the cadence is unknown. */
export function periodForDate(date: string, frequency: string | null | undefined): PeriodSlot | null {
  const year = Number(date.slice(0, 4));
  if (!year) return null;
  return periodsForYear(year, frequency).find(p => date >= p.start && date <= p.end) || null;
}

/** The slot we are in today. */
export function currentPeriod(frequency: string | null | undefined, today?: string): PeriodSlot | null {
  return periodForDate(today || new Date().toISOString().slice(0, 10), frequency);
}

/**
 * Compliance for ONE slot, given what was recorded against it. Kept here rather
 * than in the UI so the tab, the nudge and the future metrics page cannot
 * disagree about what "compliant" means.
 *
 *   compliant  — call inside the window AND minutes sent
 *   late       — both recorded, but the call landed after the window closed
 *   incomplete — call recorded, minutes not
 *   missed     — window has closed with no call
 *   pending    — window still open, nothing recorded yet
 */
export function periodCompliance(args: {
  slot: Pick<PeriodSlot, "start" | "end">;
  callDate: string | null | undefined;
  momSentDate: string | null | undefined;
  today?: string;
}): "compliant" | "late" | "incomplete" | "missed" | "pending" {
  const t = args.today || new Date().toISOString().slice(0, 10);
  if (!args.callDate) return t > args.slot.end ? "missed" : "pending";
  if (!args.momSentDate) return "incomplete";
  return args.callDate > args.slot.end ? "late" : "compliant";
}

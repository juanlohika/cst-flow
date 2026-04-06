/**
 * Business Day Calculation Utility
 * 
 * Logic for CST FlowDesk:
 * - Skips Saturdays and Sundays.
 * - Handles the 'Client Padding' buffer.
 */

/**
 * Adds business days (Monday-Friday) to a given date.
 */
export function addBusinessDays(date: Date | string, days: number): Date {
  const result = new Date(date);
  if (isNaN(result.getTime())) return new Date(); // Safety fallback to 'now'
  
  let daysAdded = 0;
  while (daysAdded < days) {
    result.setUTCDate(result.getUTCDate() + 1);
    // 0 = Sunday, 6 = Saturday
    const dayOfWeek = result.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      daysAdded++;
    }
  }
  
  return result;
}

/**
 * Formats a date for the SQLite-compatible ISO string using UTC.
 */
export function formatToISODate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Calculates the 'Client Padded' end date based on internal end date and padding.
 */
export function calculateClientEndDate(internalEnd: string, padding: number): string | null {
  if (!internalEnd) return null;
  const d = new Date(internalEnd);
  if (isNaN(d.getTime())) return null;

  // Use the UTC-aware adding logic
  const paddedDate = addBusinessDays(d, padding);
  return formatToISODate(paddedDate);
}

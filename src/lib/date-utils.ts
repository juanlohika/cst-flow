/**
 * Adds a number of days to a date, skipping Saturdays and Sundays.
 */
export function addDaysSkippingWeekends(dateStr: string, days: number): string {
  if (!dateStr) return "";
  let d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay(); // 0 = Sun, 6 = Sat
    if (day !== 0 && day !== 6) {
      remaining--;
    }
  }
  return d.toISOString().split("T")[0];
}

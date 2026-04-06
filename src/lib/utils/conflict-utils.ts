import { addBusinessDays, formatToISODate } from "./business-days";
export { formatToISODate };

/**
 * Counts the number of business days (Mon-Fri) between two dates inclusive.
 */
export function countBusinessDays(startDate: string | Date, endDate: string | Date): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 1;
  if (start > end) return 0;

  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return Math.max(1, count); // Ensure at least 1 day for division
}

/**
 * Calculates the daily load for a single task.
 */
export function calculateDailyTaskLoad(plannedHours: number, startDate: string, endDate: string): number {
  const days = countBusinessDays(startDate, endDate);
  return plannedHours / days;
}

interface BasicTask {
  owner: string;
  startDate: string;
  endDate: string;
  durationHours: number;
}

/**
 * Calculates the total load for a specific user on a specific date across all provided tasks.
 */
export function calculateUserDailyLoad(owner: string, date: Date | string, tasks: BasicTask[]): number {
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);
  
  // If it's a weekend, load is 0
  const dayOfWeek = targetDate.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return 0;

  const targetDateStr = formatToISODate(targetDate);

  return tasks.reduce((total, task) => {
    if (task.owner !== owner) return total;
    
    const start = new Date(task.startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(task.endDate);
    end.setHours(0, 0, 0, 0);

    // If target date is within task range
    if (targetDate >= start && targetDate <= end) {
      return total + calculateDailyTaskLoad(task.durationHours, task.startDate, task.endDate);
    }
    return total;
  }, 0);
}

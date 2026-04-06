import { addBusinessDays, formatToISODate } from "./business-days";
export { formatToISODate };

/**
 * Counts the number of business days (Mon-Fri) between two dates inclusive using UTC.
 */
export function countBusinessDays(startDate: string | Date, endDate: string | Date): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 1;
  if (start > end) return 0;

  let count = 0;
  const current = new Date(start);
  // Ensure we are working with UTC midnight
  current.setUTCHours(0, 0, 0, 0);
  const targetEnd = new Date(end);
  targetEnd.setUTCHours(0, 0, 0, 0);

  while (current <= targetEnd) {
    const dayOfWeek = current.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
    current.setUTCDate(current.getUTCDate() + 1);
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
 * Calculates the total load for a specific user on a specific date across all provided tasks (internal + external) using UTC.
 */
export function calculateUserDailyLoad(
  owner: string, 
  date: Date | string, 
  tasks: BasicTask[],
  externalTasks?: BasicTask[]
): number {
  const targetDate = new Date(date);
  targetDate.setUTCHours(0, 0, 0, 0);
  
  // If it's a weekend, load is 0
  const dayOfWeek = targetDate.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return 0;

  const combinedTasks = externalTasks ? [...tasks, ...externalTasks] : tasks;

  return combinedTasks.reduce((total, task) => {
    if (task.owner !== owner) return total;
    
    // Parse task dates as UTC
    const start = new Date(task.startDate);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(task.endDate);
    end.setUTCHours(0, 0, 0, 0);

    // If target date is within task range
    if (targetDate >= start && targetDate <= end) {
      return total + calculateDailyTaskLoad(task.durationHours, task.startDate, task.endDate);
    }
    return total;
  }, 0);
}

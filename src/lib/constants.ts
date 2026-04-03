/**
 * CST FlowDesk - Application Constants
 * 
 * Centralizing strings to prevent 'Magic String' fragmentation and ensure 
 * 100% permission consistency throughout the system.
 */

export const USER_STATUS = {
  ACTIVE: "active",   // Standardized from 'approved'
  PENDING: "pending",
  BLOCKED: "blocked", // Archived users
} as const;

export type UserStatus = typeof USER_STATUS[keyof typeof USER_STATUS];

export const APP_GROUPS = {
  AI_INTELLIGENCE: "AI Intelligence",
  ADMINISTRATION: "Administration",
} as const;

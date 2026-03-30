/**
 * Generates a stable 4-digit numeric serial code from a string ID.
 * Used to provide "simple number" reference codes (e.g., MTG-1234).
 */
export function getNumericRef(id: string): string {
  if (!id) return "0000";
  
  // Simple deterministic hash
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Map to a 4-digit positive number (0000-9999)
  const absHash = Math.abs(hash);
  const serial = (absHash % 10000).toString().padStart(4, "0");
  
  return serial;
}

/**
 * Formats a reference number with a prefix (MTG or ACCT).
 */
export function formatRef(id: string, prefix: "MTG" | "ACCT"): string {
  return `${prefix}-${getNumericRef(id)}`;
}

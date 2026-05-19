import { redirect } from "next/navigation";

/**
 * The Executive Summary has moved to /account-health (top-level app, gated by
 * the `canAccessAccountHealth` module flag). This shim preserves old links.
 */
export default function ExecutiveSummaryLegacyRedirect() {
  redirect("/account-health");
}

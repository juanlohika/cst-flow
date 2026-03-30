// Accounts page — the full UI lives in /meeting-prep/page.tsx during the transition.
// This file re-exports it so both /accounts and /meeting-prep resolve to the same component.
// The LeftNav and all links now point to /accounts.
export { default } from "@/app/(app)/meeting-prep/page";

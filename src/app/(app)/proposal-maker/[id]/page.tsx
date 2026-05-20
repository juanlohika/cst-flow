import { redirect } from "next/navigation";

/**
 * Legacy route — proposals are now edited+previewed in the unified chat-left/
 * preview-right UI at /proposal-maker. We redirect with ?resume= so the
 * existing draft loads in that flow.
 */
export default function ProposalDetailLegacyRedirect({ params }: { params: { id: string } }) {
  redirect(`/proposal-maker?resume=${params.id}`);
}

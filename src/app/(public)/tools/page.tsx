import { redirect } from "next/navigation";

/** Tools Portal home. Only one tool for now, so go straight to it. */
export default function ToolsPortalHome({ searchParams }: { searchParams: { error?: string } }) {
  redirect(searchParams?.error ? `/tools/pdf-compressor?error=${encodeURIComponent(searchParams.error)}` : "/tools/pdf-compressor");
}

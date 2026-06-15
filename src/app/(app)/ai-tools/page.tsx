"use client";

/**
 * AI Tools — landing page.
 *
 * Top: quota meter (visible to ALL signed-in CST OS users so the team-wide
 * Google Maps geocoding budget is monitored together).
 *
 * Below: list of available AI Tools. For now: Pin Validator. As we add more
 * (Eliana, Architect, etc.) they get cards here too.
 */
import Link from "next/link";
import { useEffect } from "react";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";
import { QuotaMeter } from "@/components/pin-validator/QuotaMeter";

export default function AiToolsPage() {
  useBreadcrumbs([{ label: "AI Tools", href: "/ai-tools" }]);
  // Reuse the same hook signature even though there's no nested route yet.
  useEffect(() => {
    // no-op
  }, []);

  return (
    <div className="container py-10 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          AI Tools
        </h1>
        <p className="text-sm text-slate-500">
          Internal CST utilities. Available to every CST OS team member.
        </p>
      </header>

      {/* Shared-cost monitor — visible to everyone so the team knows where
          the team-wide Google Maps quota stands. */}
      <QuotaMeter />

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">
          Tools
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <ToolCard
            href="/ai-tools/pin-validator"
            emoji="📍"
            title="Pin Validator"
            blurb="Generate a Google Sheet of store coordinates, geocode store names, then send a magic link to client validators to confirm the pins. Used per account; activate from an account's hub."
            footer="Activate per account · Magic-link client review"
          />
          {/* Add more tool cards here as they ship. */}
        </div>
      </section>
    </div>
  );
}

function ToolCard(props: {
  href: string;
  emoji: string;
  title: string;
  blurb: string;
  footer: string;
}) {
  return (
    <Link
      href={props.href}
      className="block rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-xl">
          {props.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold text-slate-900">
            {props.title}
          </div>
          <p className="mt-1 text-sm text-slate-500 leading-relaxed">
            {props.blurb}
          </p>
        </div>
      </div>
      <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
        {props.footer}
      </div>
    </Link>
  );
}

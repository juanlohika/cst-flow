"use client";

/**
 * Admin reference: how Arima's requirement-gathering works.
 *
 * This page is documentation, not a control surface. It exists because the
 * wake/gather/rest behaviour and the Drive filing convention are decisions that
 * will be forgotten within a month of shipping, and the next admin to look at a
 * bound group needs to know why Arima stays quiet most of the time.
 */

import { useState } from "react";
import {
  BookOpen, FolderTree, Gauge, HardDrive, MessageSquare,
  Moon, ChevronRight, AlertTriangle, CheckCircle2, Image as ImageIcon, Trash2,
} from "lucide-react";

type Section = "flow" | "folders" | "storage" | "limits" | "retention" | "troubleshoot";

const NAV: { id: Section; label: string; icon: any }[] = [
  { id: "flow",        label: "How a gathering works", icon: MessageSquare },
  { id: "folders",     label: "Where files are filed",  icon: FolderTree },
  { id: "storage",     label: "Why links, not bytes",   icon: HardDrive },
  { id: "limits",      label: "Rate limits",            icon: Gauge },
  { id: "retention",   label: "Retention",              icon: Trash2 },
  { id: "troubleshoot",label: "Troubleshooting",        icon: AlertTriangle },
];

export default function ArimaEvidenceDocsPage() {
  const [section, setSection] = useState<Section>("flow");

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-[11px] text-slate-500 mb-1">
          <a href="/admin" className="hover:text-slate-700">Admin</a>
          <ChevronRight className="w-3 h-3" />
          <span>Arima Evidence &amp; Handoff</span>
        </div>
        <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-slate-400" />
          Arima Evidence &amp; Handoff
        </h1>
        <p className="text-[13px] text-slate-600 mt-1 max-w-3xl">
          How Arima gathers a requirement from a Telegram group, files the evidence to
          Drive, and hands off to a coding assistant. Reference for admins — there is
          nothing to configure on this page.
        </p>
      </div>

      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = section === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setSection(n.id)}
                className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors ${
                  active
                    ? "bg-slate-900 text-white font-medium"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
                {n.label}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0">
          {section === "flow" && <FlowSection />}
          {section === "folders" && <FoldersSection />}
          {section === "storage" && <StorageSection />}
          {section === "limits" && <LimitsSection />}
          {section === "retention" && <RetentionSection />}
          {section === "troubleshoot" && <TroubleshootSection />}
        </div>
      </div>
    </div>
  );
}

function Card({ children, title, icon: Icon }: any) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 mb-4">
      {title && (
        <h2 className="text-[15px] font-semibold text-slate-900 mb-3 flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-slate-400" />}
          {title}
        </h2>
      )}
      <div className="text-[13px] text-slate-700 leading-relaxed space-y-3">{children}</div>
    </div>
  );
}

function Mono({ children }: any) {
  return (
    <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 text-[12px] font-mono">
      {children}
    </code>
  );
}

function Note({ children, tone = "info" }: any) {
  const tones: any = {
    info: "bg-blue-50 border-blue-200 text-blue-900",
    warn: "bg-amber-50 border-amber-200 text-amber-900",
    good: "bg-emerald-50 border-emerald-200 text-emerald-900",
  };
  return (
    <div className={`rounded-lg border p-3 text-[12.5px] leading-relaxed ${tones[tone]}`}>
      {children}
    </div>
  );
}

function FlowSection() {
  return (
    <>
      <Card title="Arima wakes, gathers, then rests" icon={Moon}>
        <p>
          In a bound group Arima is <strong>not</strong> a permanent listener. It stays
          quiet until someone tags it with something that reads like a requirement, works
          through the thread with you, then goes back to sleep.
        </p>
        <p>
          This is deliberate. Before, every message in a bound group — including ones
          between two humans that had nothing to do with Arima — was written to the
          diagnostic log with the full system prompt attached. A busy group generated that
          traffic all day for no benefit.
        </p>
      </Card>

      <Card title="The four states">
        <div className="space-y-3">
          {[
            ["WAKE", "Someone tags @arima with a request — \"document this\", \"raise a ticket for…\", \"@arima can you capture this requirement\". Arima reads back the last 10 messages for context so it understands what was already discussed.", "bg-slate-900"],
            ["GATHER", "Arima reads everything in the thread and files any screenshot to Drive automatically. It speaks only when it needs something — a clarifying question, or a note that a file landed. It does not acknowledge every message; a busy group stays readable.", "bg-blue-600"],
            ["CONFIRM", "When Arima believes it has enough, it summarises what it captured and asks whether anything is missing.", "bg-amber-600"],
            ["REST", "On a yes, Arima writes PROMPT.md, posts the folder link, and sleeps. It also rests on its own after 15 minutes of silence, so a forgotten session cannot stay awake.", "bg-emerald-600"],
          ].map(([label, body, colour]) => (
            <div key={label as string} className="flex gap-3">
              <span className={`${colour} text-white text-[10px] font-semibold tracking-wide px-2 py-1 rounded h-fit shrink-0 w-[72px] text-center`}>
                {label}
              </span>
              <p className="text-[13px] text-slate-700">{body}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Waking it, and sending it back to sleep">
        <p>
          Arima wakes on a tag plus intent. Words like <Mono>document</Mono>,{" "}
          <Mono>requirement</Mono>, <Mono>ticket</Mono>, <Mono>bug</Mono>,{" "}
          <Mono>enhancement</Mono>, <Mono>capture</Mono> or <Mono>artifact</Mono> start a
          gathering session. A plain question still gets a plain answer without starting one.
        </p>
        <p>
          To end a session early, say <Mono>/rest</Mono>, &ldquo;thanks Arima&rdquo; or
          &ldquo;salamat Arima&rdquo;. Confirming its summary ends it too.
        </p>
        <Note tone="info">
          Only one session runs per group at a time. Tagging Arima again while it is
          already gathering adds to the current session rather than starting a second one.
        </Note>
      </Card>

      <Card title="What Arima does with screenshots" icon={ImageIcon}>
        <p>
          Arima looks at each screenshot and writes a short note about{" "}
          <strong>what is on screen</strong> — which module it appears to be, what the
          user was doing, whether something looks wrong. That note goes into the handoff
          so the next reader has orientation.
        </p>
        <Note tone="warn">
          <strong>It does not transcribe exact values.</strong> Arima runs on a small
          vision model. The evidence that matters in a Tarkie requirement is dense UI —
          a formula, a field showing <Mono>0.5</Mono> where 50% was expected — and a
          misread digit stated as fact becomes a false premise nobody catches. Exact
          values are read later, from the files themselves.
        </Note>
      </Card>

      <Card title="The handoff">
        <p>
          When a session rests, Arima writes <Mono>PROMPT.md</Mono> into the evidence
          folder and posts the folder link in the group. The file contains the
          requirement, current versus requested behaviour, a list of the evidence with
          Arima&rsquo;s notes, and any questions it could not resolve.
        </p>
        <p>
          You then paste the folder path into Claude Code and ask for the artifact,
          ticket or BRD. The assistant reads the actual screenshots at that point.
        </p>
        <Note tone="good">
          The handoff stays manual on purpose. You see what Arima understood before
          anything is built on it — which matters precisely because Arima does not
          transcribe exact values.
        </Note>
      </Card>
    </>
  );
}

function FoldersSection() {
  return (
    <>
      <Card title="Folder convention" icon={FolderTree}>
        <p>
          Evidence goes into the <strong>CST - ARIMA</strong> shared drive, under a{" "}
          <Mono>Requirements</Mono> folder created on first use — beside the{" "}
          <Mono>BRD</Mono>, <Mono>Proposals</Mono> and <Mono>Tarkie v5 CST OS</Mono>{" "}
          folders Arima already files into. Nothing needs configuring. Arima works
          out the sub-path from the binding it is responding in.
        </p>
        <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 text-[11.5px] leading-relaxed overflow-x-auto font-mono">{`CST - ARIMA/                        ← shared drive
  BRD/                              ← (existing)
  Proposals/                        ← (existing)
  Tarkie v5 CST OS/                 ← (existing)
  Requirements/                     ← created on first use
    Landlite Corp — a1b2c3/         ← client-scoped rooms
      2026-10-08 — Share of Display cap/
        screenshots/
        recordings/
        PROMPT.md
    _Internal/
      MOI/                          ← internal + team rooms
        2026-10-08 — MTD auto-compute/
          screenshots/
          recordings/
          PROMPT.md`}</pre>
        <Note tone="info">
          The account folder format — <Mono>Name — last6ofId</Mono> — matches what{" "}
          <Mono>Tarkie v5 CST OS</Mono> already uses, so the two read the same way.
        </Note>
      </Card>

      <Card title="The rules behind it">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Client rooms file under the client.</strong> A binding with{" "}
            <Mono>scopeType: client</Mono> files under that account&rsquo;s name, with the
            last six characters of the account id appended so two similarly-named clients
            never collide.
          </li>
          <li>
            <strong>Internal and team rooms file under <Mono>_Internal</Mono>.</strong>{" "}
            The leading underscore sorts it above the client folders so internal work is
            not lost alphabetically among them.
          </li>
          <li>
            <strong>Dates come first, in <Mono>YYYY-MM-DD</Mono>.</strong> Folders sort
            chronologically, and the slug after the dash makes them findable.
          </li>
          <li>
            <strong>Folders are created only when a file is about to land in them,</strong>{" "}
            so Drive does not fill with empty directories.
          </li>
          <li>
            <strong>Names are sanitised.</strong> <Mono>&amp;</Mono> becomes{" "}
            <Mono>and</Mono>; <Mono>/ \ : * ? &quot; &lt; &gt; |</Mono> become hyphens.
          </li>
        </ul>
      </Card>

      <Card title="File naming">
        <p>
          Files are named <Mono>2026-10-08 1430 - 02.png</Mono> — date, time, and the
          order they arrived in. If the sender typed a caption it is appended, so a
          captioned screenshot is findable by what it was called.
        </p>
        <Note tone="warn">
          <strong>Dates are local time, never UTC.</strong> This is not a style
          preference. Converting to UTC rolls the date back a day for anything running
          before 8 AM in Manila, so a folder created at 7 AM would be filed under
          yesterday. The CE reports exporter learned this the hard way.
        </Note>
      </Card>
    </>
  );
}

function StorageSection() {
  return (
    <>
      <Card title="The database stores links; Drive stores bytes" icon={HardDrive}>
        <p>
          When a photo arrives from Telegram it is uploaded to Drive immediately, and the
          database keeps only the Drive file id and link.
        </p>
        <p>
          Previously the raw image was base64-encoded into the message row and kept
          forever. Base64 inflates a file by about a third, so an 8 MB photo became
          roughly 10.7 MB of text inside a single database row.
        </p>
        <Note tone="warn">
          Against Turso&rsquo;s 9 GB ceiling that is about <strong>840 photos</strong>.
          A team posting ten screenshots a day would have filled the database in a few
          months — while Drive, which has the space for them, sat unused.
        </Note>
      </Card>

      <Card title="What changed, and what did not">
        <div className="space-y-2">
          <div className="flex gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <p>
              <strong>New messages</strong> upload to Drive and store a link.
            </p>
          </div>
          <div className="flex gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <p>
              <strong>Diagnostic logging</strong> no longer writes a row for every
              human-to-human message in a bound group — only for turns where Arima is
              actually awake.
            </p>
          </div>
          <div className="flex gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p>
              <strong>Photos already stored</strong> before this change are left alone.
              They are not large enough to be a problem today, and rewriting live rows
              carries more risk than it removes.
            </p>
          </div>
        </div>
      </Card>

      <Card title="Checking the size">
        <p>
          The Turso dashboard shows database size and monthly row reads. Row reads
          usually hit the free-tier limit before storage does, so watch both.
        </p>
      </Card>
    </>
  );
}

function LimitsSection() {
  return (
    <>
      <Card title="A burst gets slower, never fails" icon={Gauge}>
        <p>
          Groq&rsquo;s free tier allows <strong>8,000 tokens per minute</strong> across
          prompt and response combined. An image costs roughly 1,600 of those, so about
          four screenshots fill a minute.
        </p>
        <p>
          Every AI call now passes through a shared token budget. If ten screenshots
          arrive at once, Arima processes them all — it simply paces itself, waiting for
          the window to clear between batches. Nothing is dropped.
        </p>
      </Card>

      <Card title="How the pacing works">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Before each call, the cost is estimated and checked against what has been
            spent in the last 60 seconds.
          </li>
          <li>
            If the window is full, the call waits instead of firing and failing.
          </li>
          <li>
            After the first response, Groq&rsquo;s own{" "}
            <Mono>x-ratelimit-remaining-tokens</Mono> header replaces the estimate — so
            we stop guessing as soon as the provider tells us the truth.
          </li>
          <li>
            If a rate-limit error still comes back, the{" "}
            <Mono>retry-after</Mono> value is honoured exactly rather than guessed at.
          </li>
          <li>
            The budget targets 80% of the stated limit, leaving room for estimation error.
          </li>
        </ul>
      </Card>

      <Card title="What you will notice">
        <p>
          A long batch of screenshots takes longer to acknowledge. That is the throttle
          working. If it feels slow, the cause is the free tier, not the code — a paid
          Groq tier or routing Arima to Gemini removes the ceiling.
        </p>
        <Note tone="info">
          The budget is per container. If App Hosting runs more than one instance, each
          keeps its own count, and the provider&rsquo;s own headers are what keep the
          total honest.
        </Note>
      </Card>
    </>
  );
}

function RetentionSection() {
  return (
    <>
      <Card title="What gets cleared, and what never does" icon={Trash2}>
        <p>
          Four tables grow with use and have no natural end. A weekly sweep clears
          what has aged out of usefulness.
        </p>
        <Note tone="good">
          <strong>Nothing that records what was asked for is ever deleted.</strong>{" "}
          Requests, evidence links, conversation messages and the BRD usage log all
          stay. Clearing diagnostics is housekeeping; clearing the record would be
          data loss.
        </Note>
      </Card>

      <Card title="The policy">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left border-b border-slate-200">
                <th className="py-2 pr-4 font-semibold text-slate-700">What</th>
                <th className="py-2 pr-4 font-semibold text-slate-700">Kept for</th>
                <th className="py-2 font-semibold text-slate-700">Why</th>
              </tr>
            </thead>
            <tbody className="text-slate-600">
              {[
                ["Turn diagnostics", "60 days", "Debugging history. Each row can hold the full system prompt and model output."],
                ["Tool-call audit", "180 days", "Answers “did Arima actually do that?” Pending approvals are never deleted."],
                ["Finished gatherings", "90 days", "The session row only; its evidence links are kept."],
                ["Knowledge doc versions", "last 10", "Each version stores a full copy of the document."],
                ["Exported BRD blobs", "until exported", "Cleared once the Google Doc exists — the Doc is the real artifact, and the link is kept."],
              ].map(([a, b, c]) => (
                <tr key={a as string} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-medium text-slate-800">{a}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{b}</td>
                  <td className="py-2">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Running it">
        <p>
          <Mono>POST /api/cron/retention</Mono> — admin session, or the{" "}
          <Mono>x-cron-secret</Mono> header using the same secret as the portfolio
          cron.
        </p>
        <p>
          <strong>Run it with <Mono>?dry=1</Mono> first.</strong> That counts what
          would be removed without deleting anything.
        </p>
        <p>
          Suggested schedule: weekly, Sunday 03:00. There is no urgency — the point
          is that growth stops being unbounded, not that it is trimmed daily. Each
          run is capped at 5,000 rows per table so it cannot lock the database on a
          large backlog; run it again to drain more.
        </p>
      </Card>

      <Card title="Silent turns are no longer logged">
        <p>
          Arima used to write a diagnostic row for every message in every bound
          group, including conversations it was not part of — recording, at length,
          that nothing happened.
        </p>
        <p>
          Now only turns where Arima is actually awake are logged. If you are
          debugging a group where it is not waking when it should, set{" "}
          <Mono>ARIMA_LOG_SILENT_TURNS=1</Mono> to bring the old behaviour back
          temporarily.
        </p>
      </Card>
    </>
  );
}

function TroubleshootSection() {
  const items = [
    {
      q: "Arima did not respond when I tagged it",
      a: "Check the group is bound (Admin → Telegram Bindings) and the binding is active. In a group, Arima only replies when @arima appears in the message — a reply to one of its messages does not count unless it also tags it.",
    },
    {
      q: "Arima replied but did not start gathering",
      a: "It only starts a session when the message reads like a requirement. Words like \"document\", \"requirement\", \"ticket\", \"bug\" or \"capture\" trigger it. Asking \"@arima what is this account's tier\" is a question, not a gathering request.",
    },
    {
      q: "Screenshots are not being filed",
      a: "Evidence goes to the CST - ARIMA shared drive with no setup needed, so this almost always means the Google service account is missing or has lost access to that drive. Check Admin → Google Integration, and confirm the service account email listed there is a member of CST - ARIMA. Arima will say so in the chat rather than failing silently.",
    },
    {
      q: "A screen recording was ignored",
      a: "Arima handles photos. Video and documents sent through Telegram are not downloaded — and a document sent with no caption is dropped entirely. Upload recordings straight into the evidence folder Arima links, and it will reference them in the handoff.",
    },
    {
      q: "Arima's description of a screenshot is wrong",
      a: "Expected within limits — it describes rather than transcribes, on a small vision model. Correct it in the chat and it will use your correction. Exact values should be read from the files themselves, not from Arima's notes.",
    },
    {
      q: "A session seems stuck awake",
      a: "Sessions expire after 15 minutes of silence, evaluated when the next message arrives. Say /rest to end one immediately.",
    },
    {
      q: "Everything is slow when several screenshots arrive",
      a: "The rate-limit throttle is pacing the batch so nothing is dropped. See the Rate limits section.",
    },
  ];
  return (
    <>
      {items.map((it) => (
        <Card key={it.q} title={it.q}>
          <p>{it.a}</p>
        </Card>
      ))}
      <Card title="Where to look next">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <a href="/admin/arima-debug" className="text-blue-600 hover:underline">
              Agent Debug
            </a>{" "}
            — raw input and output per turn, and why a turn was skipped.
          </li>
          <li>
            <a href="/admin/telegram-bindings" className="text-blue-600 hover:underline">
              Telegram Bindings
            </a>{" "}
            — which chats are bound, and to what.
          </li>
          <li>
            <a href="/admin/google-integration" className="text-blue-600 hover:underline">
              Google Integration
            </a>{" "}
            — service account and Drive folder settings.
          </li>
        </ul>
      </Card>
    </>
  );
}

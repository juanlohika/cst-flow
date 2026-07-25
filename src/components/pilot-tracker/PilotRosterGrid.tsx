"use client";

/**
 * PilotTrackerTab → Roster grid.
 *
 * Shows participants with:
 *   - Funnel counts at the top (Stage 0 → 6 buckets)
 *   - Filter chips (stage, flag, search)
 *   - Table with employee, current stage, issue flag, mobile (original vs
 *     corrected), version status, last activity
 *   - Row click → detail drawer with editable fields (email, invite
 *     accepted, app updated, beta registered toggle, version verify)
 *
 * All row edits go through PATCH /api/accounts/[id]/pilot-tracker/participants
 * which calls updateParticipant() → re-derives stage + flag automatically.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, AlertTriangle, CheckCircle2, Clock, Download, UserCheck, Trash2, RefreshCw, Copy as CopyIcon, Check, ChevronDown, ChevronsUp } from "lucide-react";
import { useToast } from "@/components/ui/ToastContext";

interface Participant {
  id: string;
  projectId: string;
  employeeId: string;
  fullName: string;
  mobileNumber: string;
  mobileNumberCorrected: string | null;
  mobileConfirmed: boolean;
  playstoreEmail: string | null;
  emailConfirmedIsPlaystore: boolean;
  workEmail: string | null;
  workEmailConfirmed: boolean;
  betaRegistered: boolean;
  betaRegisteredAt: string | null;
  invitationAcceptedDeclared: boolean;
  invitationLinkFailed: boolean;
  appUpdatedDeclared: boolean;
  reportedVersion: string | null;
  versionScreenshotDriveId: string | null;
  versionScreenshotUrl: string | null;
  versionConfirmedByUser: boolean;
  versionVerified: "pending" | "verified" | "mismatch";
  versionVerifiedByAi: boolean;
  versionAiExtractedText: string | null;
  currentStage: number;
  issueFlag: string;
  lastActivityAt: string;
  lastActivityBy: string | null;
  // CST-side resolution timestamps for portal-driven corrections. When
  // set, the participant drops out of the corresponding "blocked" count
  // and (via the state machine) becomes eligible for Stage 7.
  contactCorrectionResolvedAt: string | null;
  emailCorrectionResolvedAt: string | null;
}

interface Payload {
  participants: Participant[];
  total: number;
  stageCounts: number[];
  flagCounts: Record<string, number>;
  blockedByStage?: {
    s1: number;    // email corrected by user
    s2: number;    // CLICKED_NOT_REGISTERED + INVITE_NOT_RECEIVED + NOT_YET
    s3: number;    // stuck at stage 3 (no activity 3+ days)
    s4: number;    // mobile/work email corrected by user
    s5: number;    // mobile confirmed but work email still pending
    s6: number;    // VERSION_MISMATCH
  };
  // Participants who explicitly tapped "Not yet" on Screen C — decorated
  // with a secondary "Not yet accepted" chip in the Flag column and
  // included in the Step-2 blocker union filter.
  notYetIds?: string[];
}

// Which synthetic flag each stage's red pill maps to when tapped. Keep in
// sync with the API's flag parameter handling.
const STAGE_BLOCK_FILTER: Record<number, string | null> = {
  0: null,
  1: "EMAIL_CORRECTED_BY_USER",
  2: "STAGE2_BLOCKED",  // union of CLICKED_NOT_REGISTERED + INVITE_NOT_RECEIVED + NOT_YET_ACCEPTED
  3: "STUCK_STAGE3",
  4: "CONTACT_CORRECTED_BY_USER",
  5: "WORK_EMAIL_PENDING",
  6: "VERSION_MISMATCH",
  7: null,  // "Complete (no blockers)" is by definition blocker-free
};

const STAGE_LABELS = [
  "Imported",
  "Email captured",
  "Beta registered",
  "Invitation accepted",
  "App updated",
  "Mobile & work email confirmed",
  "Version verified",
  "Complete (no blockers)",
];

const FLAG_LABELS: Record<string, string> = {
  CLICKED_NOT_REGISTERED: "Accepted but not registered",
  VERSION_MISMATCH: "Wrong app version",
  INVITE_NOT_RECEIVED: "Invite link didn't work",
  WRONG_EMAIL: "Email looks wrong",
  AWAITING_REGISTRATION: "Waiting on dev",
  STALE: "No activity",
  NONE: "On track",
  // Synthetic filters exposed by the "X blocked" pills on the stage cards.
  // These aren't stored on participant.issueFlag; the API resolves them
  // via change-log / activity-timestamp queries.
  EMAIL_CORRECTED_BY_USER: "Play Store email corrected",
  CONTACT_CORRECTED_BY_USER: "Mobile / work email corrected",
  STUCK_STAGE3: "Stuck at App update (3+ days)",
  WORK_EMAIL_PENDING: "Work email confirmation pending",
  NOT_YET_ACCEPTED: "Not yet accepted",
  STAGE2_BLOCKED: "Blocked at beta invitation",
};

const FLAG_COLORS: Record<string, string> = {
  CLICKED_NOT_REGISTERED: "bg-red-100 text-red-800 border-red-200",
  VERSION_MISMATCH: "bg-red-100 text-red-800 border-red-200",
  INVITE_NOT_RECEIVED: "bg-orange-100 text-orange-800 border-orange-200",
  WRONG_EMAIL: "bg-amber-100 text-amber-800 border-amber-200",
  AWAITING_REGISTRATION: "bg-blue-100 text-blue-800 border-blue-200",
  STALE: "bg-gray-100 text-gray-700 border-gray-200",
  NONE: "bg-green-100 text-green-800 border-green-200",
  EMAIL_CORRECTED_BY_USER: "bg-rose-100 text-rose-800 border-rose-200",
  CONTACT_CORRECTED_BY_USER: "bg-rose-100 text-rose-800 border-rose-200",
  STUCK_STAGE3: "bg-red-100 text-red-800 border-red-200",
  WORK_EMAIL_PENDING: "bg-rose-100 text-rose-800 border-rose-200",
  NOT_YET_ACCEPTED: "bg-rose-100 text-rose-800 border-rose-200",
  STAGE2_BLOCKED: "bg-red-100 text-red-800 border-red-200",
};

interface Props {
  accountId: string;
  projectId: string;
  refreshTrigger: number;
  // Reference screenshot URL shown side-by-side with participant uploads
  // during manual verification review.
  referenceScreenshotUrl?: string | null;
}

export function PilotRosterGrid({ accountId, refreshTrigger, referenceScreenshotUrl }: Props) {
  const { showToast } = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<string>("");
  const [flagFilter, setFlagFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Participant | null>(null);
  // Multi-select for bulk operations.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const refresh = useCallback(async (opts: { silent?: boolean } = {}) => {
    // Silent refreshes (polling / focus) don't flip the loading state, so
    // the "Loading roster…" placeholder doesn't flicker every 15s. Only
    // user-initiated loads (initial mount, filter change, refreshTrigger)
    // show the loading UI. Errors on silent refreshes are logged and
    // dropped — no toast — so a transient blip doesn't spam the CST.
    if (!opts.silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (stageFilter) params.set("stage", stageFilter);
      if (flagFilter) params.set("flag", flagFilter);
      if (search.trim()) params.set("search", search.trim());
      const url = `/api/accounts/${accountId}/pilot-tracker/participants?${params.toString()}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      setData(json);
    } catch (e: any) {
      if (!opts.silent) {
        showToast(`Load failed: ${e.message}`, "error");
      } else {
        console.warn("[pilot-tracker] silent refresh failed:", e?.message || e);
      }
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, [accountId, stageFilter, flagFilter, search, showToast]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshTrigger]);

  // Realtime-ish refresh so participant portal updates land in the roster
  // without the CST admin having to manually reload. Two triggers:
  //   1. A short interval poll (15s) — enough for stage-transition drift
  //      like a participant confirming Screen 5 to appear promptly.
  //   2. window "focus" — returning to the tab after a while (e.g. after
  //      going to Telegram to ping the dev) shows the newest state
  //      immediately, before the next tick.
  //
  // We pause polling while the tab isn't visible (document.hidden) to
  // avoid pointless traffic. The dependency array only reacts to `refresh`
  // (which itself changes when filters / accountId do), so the interval
  // re-arms cleanly when the closure is rebuilt.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) return;
      refresh({ silent: true });
    };
    const intervalId = window.setInterval(tick, 15_000);
    const onFocus = () => {
      if (!cancelled) refresh({ silent: true });
    };
    const onVisibility = () => {
      if (!cancelled && typeof document !== "undefined" && !document.hidden) {
        refresh({ silent: true });
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const clearFilters = () => {
    setStageFilter("");
    setFlagFilter("");
    setSearch("");
  };

  const anyFilter = stageFilter !== "" || flagFilter !== "" || search.trim() !== "";

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    if (!data) return;
    const visibleIds = data.participants.map((p) => p.id);
    const allSelected = visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    // Two-step confirm — first the count, then a typed-in yes-word — because
    // this is destructive and pilots with hundreds of rows would be painful
    // to rebuild from XLSX. The re-import path is idempotent by employeeId,
    // so bulk-delete-then-reimport is still cheap; the friction here is
    // guarding against a mis-click on the toolbar.
    if (!confirm(`Delete ${selectedIds.size} participant(s)? This can't be undone from the app.`)) return;
    setBulkBusy(true);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/pilot-tracker/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "delete",
            participantIds: Array.from(selectedIds),
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      showToast(`Deleted ${json.deleted} participant(s).`, "success");
      setSelectedIds(new Set());
      refresh();
    } catch (e: any) {
      showToast(`Delete failed: ${e.message}`, "error");
    } finally {
      setBulkBusy(false);
    }
  };

  // Bulk CST override — advance every selected participant to `stage`.
  // Cumulative: the API satisfies all earlier stages too, and never
  // demotes anyone already further along. This is the batch twin of the
  // per-participant "CST override" tray in the drawer.
  const advanceSelectedToStage = async (stage: number) => {
    if (selectedIds.size === 0) return;
    const label = STAGE_LABELS[stage];
    if (
      !confirm(
        `Advance ${selectedIds.size} participant(s) to "${stage}. ${label}"?\n\n` +
          `This also satisfies every earlier stage. Participants already past ` +
          `this stage are left alone. Auditable in the change log.`,
      )
    ) {
      return;
    }
    setBulkBusy(true);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/pilot-tracker/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "advanceStage",
            stage,
            participantIds: Array.from(selectedIds),
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      // Surface the no-email skips explicitly — silently doing nothing for
      // those rows is exactly the kind of thing that erodes trust in a
      // bulk tool. Name a couple so CST knows where to look.
      const skipped: Array<{ employeeId: string; fullName: string }> =
        json.skippedNoEmail || [];
      let msg = `Advanced ${json.advanced} to stage ${stage}.`;
      if (json.unchanged) msg += ` ${json.unchanged} already there.`;
      if (skipped.length) {
        const names = skipped.slice(0, 3).map((s) => s.employeeId).join(", ");
        msg += ` Skipped ${skipped.length} with no Play Store email (${names}${
          skipped.length > 3 ? "…" : ""
        }).`;
      }
      showToast(msg, skipped.length ? "info" : "success");
      setSelectedIds(new Set());
      refresh();
    } catch (e: any) {
      showToast(`Bulk advance failed: ${e.message}`, "error");
    } finally {
      setBulkBusy(false);
    }
  };

  const markSelectedRegistered = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Mark ${selectedIds.size} participant(s) as beta-registered on Play?`)) return;
    setBulkBusy(true);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/pilot-tracker/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "markRegistered",
            participantIds: Array.from(selectedIds),
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      showToast(`Marked ${json.advanced} as registered.`, "success");
      setSelectedIds(new Set());
      refresh();
    } catch (e: any) {
      showToast(`Failed: ${e.message}`, "error");
    } finally {
      setBulkBusy(false);
    }
  };

  // Fast-lookup set of participant IDs that tapped "Not yet" on Screen C.
  // Used to decorate the Flag column with a secondary rose chip.
  const notYetIdSet = useMemo(
    () => new Set<string>(data?.notYetIds || []),
    [data?.notYetIds],
  );

  if (loading && !data) {
    return <div className="p-4 text-gray-500 text-sm">Loading roster…</div>;
  }
  if (!data) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      {/* ── Funnel ─────────────────────────────────────────────────── */}
      <div className="p-4 border-b border-gray-200">
        <h4 className="text-sm font-semibold text-gray-900 mb-3">
          Funnel · {data.total} participants
        </h4>
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-3">
          {STAGE_LABELS.map((label, i) => {
            // Card is stage-filter primary. The bottom row is a secondary
            // click target that jumps to the matching flag filter — we
            // rely on stopPropagation so the outer stage-filter isn't
            // toggled at the same time. Stages with no mapped block
            // filter (0 = nothing has happened yet, 7 = complete by
            // definition) render no pill at all — a "0 blocked" chip on
            // "Complete (no blockers)" is a contradiction in terms, and
            // on Stage 0 it implies a signal we don't compute.
            const blocked =
              i === 1 ? data.blockedByStage?.s1 ?? 0
              : i === 2 ? data.blockedByStage?.s2 ?? 0
              : i === 3 ? data.blockedByStage?.s3 ?? 0
              : i === 4 ? data.blockedByStage?.s4 ?? 0
              : i === 5 ? data.blockedByStage?.s5 ?? 0
              : i === 6 ? data.blockedByStage?.s6 ?? 0
              : 0;  // stage 7 = complete; no blocker signal
            const blockFilter = STAGE_BLOCK_FILTER[i];
            const blockedActive = blockFilter != null && flagFilter === blockFilter;
            const stageActive = stageFilter === String(i);
            // Two separate <button>s side by side in the card. Nesting a
            // click target inside another <button> triggers both handlers
            // on tap in mobile browsers even with stopPropagation, which
            // was making the pill and the card fight each other.
            const isCompleteStage = i === 7;
            return (
              <div
                key={i}
                className={`text-left rounded-md border p-2 transition flex flex-col ${
                  stageActive
                    ? "border-blue-500 bg-blue-50 ring-1 ring-blue-300"
                    : isCompleteStage
                    ? "border-emerald-200 bg-emerald-50/40"
                    : "border-gray-200 bg-white"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setStageFilter(stageActive ? "" : String(i))}
                  className="text-left hover:bg-black/[0.02] rounded -mx-0.5 -mt-0.5 px-0.5 pt-0.5"
                >
                  <div className="text-lg font-semibold text-gray-900">
                    {data.stageCounts[i] || 0}
                  </div>
                  <div className="text-xs text-gray-500 leading-tight mt-0.5">
                    {i}. {label}
                  </div>
                </button>
                {blockFilter ? (
                  <button
                    type="button"
                    disabled={blocked === 0}
                    onClick={() => {
                      // Tapping the pill shows ALL blocked participants
                      // for this signal, regardless of current stage.
                      // Someone who corrected their playstoreEmail
                      // yesterday may have moved past Stage 1 today —
                      // ANDing with the stage filter would hide them.
                      // Clear the stage filter when we activate the pill.
                      if (blockedActive) {
                        setFlagFilter("");
                      } else {
                        setStageFilter("");
                        setFlagFilter(blockFilter);
                      }
                    }}
                    className={`self-start inline-block mt-1.5 text-[10px] leading-none rounded-full px-1.5 py-0.5 border ${
                      blocked > 0
                        ? blockedActive
                          ? "bg-red-600 border-red-600 text-white cursor-pointer"
                          : "bg-red-50 border-red-200 text-red-700 hover:bg-red-100 cursor-pointer"
                        : "bg-gray-50 border-gray-200 text-gray-400 cursor-default"
                    }`}
                  >
                    {blocked} blocked
                  </button>
                ) : (
                  // No blocker signal for this stage. Render an invisible
                  // spacer of the same height as the pill so all eight
                  // cards in the funnel row stay vertically aligned.
                  <span
                    aria-hidden="true"
                    className="self-start inline-block mt-1.5 text-[10px] leading-none px-1.5 py-0.5 border border-transparent invisible"
                  >
                    &nbsp;
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {/* Flag chips */}
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(FLAG_LABELS).map((f) => {
            const count = data.flagCounts[f] || 0;
            if (count === 0 && f !== "NONE") return null;
            const active = flagFilter === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFlagFilter(active ? "" : f)}
                className={`text-xs px-2 py-1 rounded-full border ${
                  FLAG_COLORS[f]
                } ${active ? "ring-2 ring-offset-1 ring-blue-400" : ""}`}
              >
                {FLAG_LABELS[f]} · {count}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────── */}
      <div className="px-4 py-2 border-b border-gray-200 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-sm min-w-[200px]">
          <Search size={14} className="absolute left-2 top-2.5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee ID, name, mobile, email…"
            className="w-full pl-7 pr-2 py-1.5 border border-gray-300 rounded-md text-sm"
          />
        </div>
        {anyFilter && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"
          >
            <X size={12} /> Clear filters
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => refresh({ silent: true })}
          className="inline-flex items-center gap-1 text-xs text-gray-700 hover:text-gray-900 px-2 py-1 border border-gray-300 rounded disabled:opacity-50"
          disabled={loading}
          title="Refresh now (also auto-refreshes every 15s while this tab is visible)"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
        <a
          href={`/api/accounts/${accountId}/pilot-tracker/export?mode=devEmails`}
          className="inline-flex items-center gap-1 text-xs text-gray-700 hover:text-gray-900 px-2 py-1 border border-gray-300 rounded"
          title="Emails at AWAITING_REGISTRATION + CLICKED_NOT_REGISTERED for dev to add"
        >
          <Download size={12} /> Dev emails CSV
        </a>
        <a
          href={`/api/accounts/${accountId}/pilot-tracker/export?mode=roster`}
          className="inline-flex items-center gap-1 text-xs text-gray-700 hover:text-gray-900 px-2 py-1 border border-gray-300 rounded"
        >
          <Download size={12} /> Full roster CSV
        </a>
      </div>

      {/* ── Bulk actions bar ────────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="px-4 py-2 border-b border-blue-200 bg-blue-50 flex items-center gap-3 text-sm">
          <span className="text-blue-900 font-medium">
            {selectedIds.size} selected
          </span>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-blue-800 hover:text-blue-900"
          >
            Clear
          </button>
          <div className="flex-1" />
          <BulkStageMenu
            count={selectedIds.size}
            busy={bulkBusy}
            onPick={advanceSelectedToStage}
          />
          <button
            type="button"
            onClick={markSelectedRegistered}
            disabled={bulkBusy}
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-white text-blue-700 border border-blue-300 rounded text-xs font-medium hover:bg-blue-100 disabled:opacity-50"
          >
            <UserCheck size={12} />
            {bulkBusy ? "Working…" : "Mark as beta-registered on Play"}
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            disabled={bulkBusy}
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-white text-red-700 border border-red-300 rounded text-xs font-medium hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 size={12} />
            Delete selected
          </button>
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────── */}
      <div className="overflow-auto max-h-[500px]">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <Th>
                <input
                  type="checkbox"
                  checked={
                    data.participants.length > 0 &&
                    data.participants.every((p) => selectedIds.has(p.id))
                  }
                  onChange={toggleAllVisible}
                />
              </Th>
              <Th>Emp ID</Th>
              <Th>Name</Th>
              <Th>Stage</Th>
              <Th>Flag</Th>
              <Th>Emails</Th>
              <Th>Mobile</Th>
              <Th>Version</Th>
              <Th>Last activity</Th>
            </tr>
          </thead>
          <tbody>
            {data.participants.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-500 text-sm">
                  No participants match these filters.
                </td>
              </tr>
            )}
            {data.participants.map((p) => (
              <tr
                key={p.id}
                onClick={() => setSelected(p)}
                className="border-t border-gray-100 hover:bg-blue-50 cursor-pointer"
              >
                <Td>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(p.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSelected(p.id)}
                  />
                </Td>
                <Td className="font-mono text-xs">{p.employeeId}</Td>
                <Td>{p.fullName}</Td>
                <Td>
                  <StageBadge stage={p.currentStage} />
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <FlagBadge flag={p.issueFlag} />
                    {notYetIdSet.has(p.id) && p.currentStage < 3 && (
                      <FlagBadge flag="NOT_YET_ACCEPTED" />
                    )}
                  </div>
                </Td>
                <Td className="text-xs text-gray-600 max-w-[220px]">
                  <div className="truncate" title={p.workEmail || ""}>
                    <span className="text-[10px] uppercase text-gray-400 mr-1">W</span>
                    {p.workEmail || "—"}
                  </div>
                  <div className="truncate text-gray-500" title={p.playstoreEmail || ""}>
                    <span className="text-[10px] uppercase text-gray-400 mr-1">P</span>
                    {p.playstoreEmail || "—"}
                  </div>
                </Td>
                <Td className="text-xs">
                  {p.mobileNumberCorrected ? (
                    <span title={`Original: ${p.mobileNumber}`}>
                      <span className="text-amber-700 font-medium">
                        {p.mobileNumberCorrected}
                      </span>
                      <span className="text-gray-400 ml-1">*</span>
                    </span>
                  ) : (
                    p.mobileNumber
                  )}
                </Td>
                <Td>
                  <VersionBadge participant={p} />
                </Td>
                <Td className="text-xs text-gray-500">
                  {formatRelativeTime(p.lastActivityAt)}
                  {p.lastActivityBy && (
                    <span className="text-gray-400 block text-[10px]">
                      by {p.lastActivityBy}
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Detail drawer ────────────────────────────────────────────── */}
      {selected && (
        <ParticipantDrawer
          accountId={accountId}
          participant={selected}
          referenceScreenshotUrl={referenceScreenshotUrl}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ─── Bulk stage-advance menu ─────────────────────────────────────────

/**
 * Dropdown that advances every selected participant to a chosen stage —
 * the batch equivalent of the drawer's CST override tray.
 *
 * Why a menu and not one button per stage: seven inline buttons would
 * dominate the selection bar, and the operation is deliberate enough that
 * one extra click is a feature, not friction. Stage 0 is absent — it's
 * "imported, nothing done yet", which is where rows already start; there's
 * nothing to advance TO, and the API only accepts 1–7.
 */
function BulkStageMenu({
  count,
  busy,
  onPick,
}: {
  count: number;
  busy: boolean;
  onPick: (stage: number) => void;
}) {
  const [open, setOpen] = useState(false);

  // Close on outside click / Escape. Without this the menu lingers over
  // the table and swallows row clicks.
  useEffect(() => {
    if (!open) return;
    const onDown = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        <ChevronsUp size={12} />
        {busy ? "Working…" : "Advance stage"}
        <ChevronDown size={12} className={open ? "rotate-180 transition" : "transition"} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-72 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
            <div className="text-xs font-semibold text-gray-900">
              Advance {count} participant{count === 1 ? "" : "s"} to…
            </div>
            <div className="text-[10px] text-gray-500 leading-tight mt-0.5">
              Bypass the portal when you&apos;ve already confirmed with them.
              Earlier stages are satisfied automatically; nobody is demoted.
            </div>
          </div>
          <div className="py-1 max-h-72 overflow-y-auto">
            {STAGE_LABELS.map((label, i) => {
              if (i === 0) return null;  // nothing to advance to
              const isComplete = i === 7;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    onPick(i);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 disabled:opacity-50 flex items-center gap-2 ${
                    isComplete ? "text-emerald-800 font-medium" : "text-gray-800"
                  }`}
                >
                  {isComplete && <CheckCircle2 size={12} className="shrink-0" />}
                  <span>
                    {i}. {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cell components ─────────────────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left px-3 py-2 text-xs font-medium text-gray-600 whitespace-nowrap">
      {children}
    </th>
  );
}
function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-3 py-2 whitespace-nowrap ${className || ""}`}>
      {children}
    </td>
  );
}

function StageBadge({ stage }: { stage: number }) {
  const label = STAGE_LABELS[stage] || "Unknown";
  // Stage 7 = "Complete (no blockers)" is the truest finish line and
  // gets the strongest green treatment. Stage 6 is "on target build but
  // CST has residual work" — an intermediate green.
  const isFullyComplete = stage === 7;
  const isVersionVerified = stage === 6;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded ${
        isFullyComplete
          ? "bg-emerald-100 text-emerald-800"
          : isVersionVerified
          ? "bg-green-100 text-green-800"
          : stage >= 3
          ? "bg-blue-100 text-blue-800"
          : "bg-gray-100 text-gray-700"
      }`}
    >
      {(isFullyComplete || isVersionVerified) && <CheckCircle2 size={12} />}
      {stage}. {label}
    </span>
  );
}

function FlagBadge({ flag }: { flag: string }) {
  if (flag === "NONE") return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${
        FLAG_COLORS[flag] || FLAG_COLORS.NONE
      }`}
    >
      {(flag === "CLICKED_NOT_REGISTERED" || flag === "VERSION_MISMATCH") && (
        <AlertTriangle size={11} />
      )}
      {FLAG_LABELS[flag] || flag}
    </span>
  );
}

function VersionBadge({ participant }: { participant: Participant }) {
  if (!participant.versionScreenshotDriveId) {
    return <span className="text-xs text-gray-400">—</span>;
  }
  if (participant.versionVerified === "verified") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
        <CheckCircle2 size={12} /> verified
        {participant.versionVerifiedByAi && (
          <span className="text-gray-400 text-[10px]">(ai)</span>
        )}
      </span>
    );
  }
  if (participant.versionVerified === "mismatch") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-700 font-medium">
        <AlertTriangle size={12} /> mismatch
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-blue-700 font-medium">
      <Clock size={12} /> pending
    </span>
  );
}

function formatRelativeTime(ts: string): string {
  const now = Date.now();
  const then = new Date(ts).getTime();
  if (Number.isNaN(then)) return ts;
  const diffMs = now - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

// ─── Detail drawer ──────────────────────────────────────────────────

function ParticipantDrawer({
  accountId,
  participant,
  referenceScreenshotUrl,
  onClose,
  onSaved,
}: {
  accountId: string;
  participant: Participant;
  referenceScreenshotUrl?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [form, setForm] = useState({
    betaRegistered: participant.betaRegistered,
    versionVerified: participant.versionVerified as "pending" | "verified" | "mismatch",
    workEmail: participant.workEmail || "",
    playstoreEmail: participant.playstoreEmail || "",
    reportedVersion: participant.reportedVersion || "",
  });

  // 1-click copy for the corrected values (mobile / work email / play-store
  // email) — CST needs to paste these into the Users profile module, and
  // typing them by hand is error-prone.
  const copyToClipboard = async (value: string, tag: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(tag);
      setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1500);
    } catch (e: any) {
      showToast(`Copy failed: ${e.message}`, "error");
    }
  };

  // Mark a portal-driven correction as resolved (i.e. CST mirrored it
  // into the Users module already). Drops the participant out of the
  // corresponding Stage-1 / Stage-4 blocker count and, if they're at
  // Stage 6, promotes them to Stage 7 (Complete, no blockers).
  const markResolved = async (kind: "contact" | "email") => {
    setBusy(true);
    try {
      const updates: Record<string, unknown> =
        kind === "contact"
          ? { contactCorrectionResolved: true }
          : { emailCorrectionResolved: true };
      const res = await fetch(
        `/api/accounts/${accountId}/pilot-tracker/participants`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: participant.id, updates }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      showToast(
        json.stageChanged
          ? `Marked resolved. Stage advanced to ${json.newStage}.`
          : "Marked resolved.",
        "success",
      );
      onSaved();
    } catch (e: any) {
      showToast(`Failed: ${e.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const deleteOne = async () => {
    // Match the confirm-word style of the bulk delete — same destructive
    // op, same standard of caution. onSaved() refreshes the roster.
    const label = `${participant.fullName} (${participant.employeeId})`;
    if (!confirm(`Delete ${label}? This can't be undone from the app.`)) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/pilot-tracker/participants?participantId=${encodeURIComponent(participant.id)}`,
        { method: "DELETE" },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      showToast(`Deleted ${label}.`, "success");
      onSaved();
    } catch (e: any) {
      showToast(`Delete failed: ${e.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const patch: any = {};
      if (form.betaRegistered !== participant.betaRegistered) {
        patch.betaRegistered = form.betaRegistered;
      }
      if (form.versionVerified !== participant.versionVerified) {
        patch.versionVerified = form.versionVerified;
      }
      if (form.playstoreEmail !== (participant.playstoreEmail || "")) {
        patch.playstoreEmail = form.playstoreEmail || null;
      }
      if (form.workEmail !== (participant.workEmail || "")) {
        patch.workEmail = form.workEmail || null;
      }
      if (form.reportedVersion !== (participant.reportedVersion || "")) {
        patch.reportedVersion = form.reportedVersion || null;
      }
      if (Object.keys(patch).length === 0) {
        showToast("No changes to save.", "info");
        setBusy(false);
        return;
      }
      const res = await fetch(
        `/api/accounts/${accountId}/pilot-tracker/participants`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: participant.id, updates: patch }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      showToast(
        json.stageChanged
          ? `Saved. Stage advanced to ${json.newStage}.`
          : "Saved.",
        "success",
      );
      onSaved();
    } catch (e: any) {
      showToast(`Save failed: ${e.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  // Render via portal to document.body so no ancestor's stacking context
  // (e.g. the AccountHub tab bar) can clip us. z-[100] beats any modal
  // header in the app that uses z-50.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 bg-black/30 z-[100] flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full bg-white shadow-xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500 font-mono">
              {participant.employeeId}
            </div>
            <div className="text-lg font-semibold text-gray-900">
              {participant.fullName}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-900 p-1"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <ReadField label="Stage">
            <StageBadge stage={participant.currentStage} />
          </ReadField>
          <ReadField label="Flag">
            <FlagBadge flag={participant.issueFlag} />
          </ReadField>

          <CstStageOverride
            accountId={accountId}
            participant={participant}
            onSaved={onSaved}
          />

          <ReadField label="Mobile">
            {participant.mobileNumberCorrected ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-amber-700 font-medium">
                    {participant.mobileNumberCorrected}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(participant.mobileNumberCorrected || "", "mobile")
                    }
                    className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                    title="Copy corrected mobile"
                  >
                    {copied === "mobile" ? (
                      <>
                        <Check size={11} /> Copied
                      </>
                    ) : (
                      <>
                        <CopyIcon size={11} /> Copy
                      </>
                    )}
                  </button>
                  <span className="text-gray-400 text-xs">
                    (original: {participant.mobileNumber})
                  </span>
                </div>
              </div>
            ) : (
              participant.mobileNumber
            )}
          </ReadField>

          {/* Contact-correction resolve marker — visible whenever the
              participant has corrected mobile OR work email. Green banner
              once CST has mirrored the change into the Users module. */}
          {(participant.mobileNumberCorrected ||
            (participant.workEmail && participant.workEmailConfirmed)) && (
            <div
              className={`rounded-md border p-2 text-xs ${
                participant.contactCorrectionResolvedAt
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              {participant.contactCorrectionResolvedAt ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={14} />
                  Contact correction resolved
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => markResolved("contact")}
                    className="ml-auto text-[10px] text-emerald-700 hover:underline disabled:opacity-50"
                    title="Undo — mark as still-outstanding"
                  >
                    Undo
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <AlertTriangle size={14} />
                  <span>Mirror this correction into the Users module, then mark resolved.</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => markResolved("contact")}
                    className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    <CheckCircle2 size={11} /> Mark resolved
                  </button>
                </div>
              )}
            </div>
          )}

          <hr className="border-gray-100" />

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Work email <span className="text-gray-400 font-normal">(admin sign-in / OTP target)</span>
            </label>
            <div className="flex gap-1">
              <input
                type="email"
                value={form.workEmail}
                onChange={(e) => setForm({ ...form, workEmail: e.target.value })}
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                placeholder="user@company.com"
              />
              {participant.workEmail && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(participant.workEmail || "", "workEmail")}
                  className="inline-flex items-center gap-1 text-[11px] px-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                  title="Copy work email"
                >
                  {copied === "workEmail" ? (
                    <>
                      <Check size={11} /> Copied
                    </>
                  ) : (
                    <>
                      <CopyIcon size={11} /> Copy
                    </>
                  )}
                </button>
              )}
            </div>
            {participant.workEmailConfirmed && (
              <span className="text-xs text-green-600 mt-0.5 inline-block">
                ✓ Participant confirmed this on the portal
              </span>
            )}
            <p className="text-[10px] text-gray-500 mt-0.5">
              Leave blank for field-only users (mobile OTP). Setting a value
              here makes Screen 4 show a work-email confirm.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Play Store email <span className="text-gray-400 font-normal">(Google account on the phone)</span>
            </label>
            <div className="flex gap-1">
              <input
                type="email"
                value={form.playstoreEmail}
                onChange={(e) => setForm({ ...form, playstoreEmail: e.target.value })}
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                placeholder="user@gmail.com"
              />
              {participant.playstoreEmail && (
                <button
                  type="button"
                  onClick={() =>
                    copyToClipboard(participant.playstoreEmail || "", "psEmail")
                  }
                  className="inline-flex items-center gap-1 text-[11px] px-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                  title="Copy Play Store email"
                >
                  {copied === "psEmail" ? (
                    <>
                      <Check size={11} /> Copied
                    </>
                  ) : (
                    <>
                      <CopyIcon size={11} /> Copy
                    </>
                  )}
                </button>
              )}
            </div>
            {participant.emailConfirmedIsPlaystore && (
              <span className="text-xs text-green-600 mt-0.5 inline-block">
                ✓ Participant acknowledged this is their Play Store email
              </span>
            )}
          </div>

          {/* Email correction resolve marker */}
          {participant.playstoreEmail &&
            participant.emailConfirmedIsPlaystore &&
            /* Only show if there's a portal-driven correction on record —
               a fresh roster-supplied email that the participant confirmed
               without editing has no blocker. Approximate by checking if
               emailCorrectionResolvedAt is null AND participant later
               changed the email via portal (which sets it back to null via
               the correction path). If we don't have signal either way,
               we still show the button for CST convenience. */ (
              <div
                className={`rounded-md border p-2 text-xs ${
                  participant.emailCorrectionResolvedAt
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-900"
                }`}
              >
                {participant.emailCorrectionResolvedAt ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} />
                    Email correction resolved
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => markResolved("email")}
                      className="ml-auto text-[10px] text-emerald-700 hover:underline disabled:opacity-50"
                      title="Undo — mark as still-outstanding"
                    >
                      Undo
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <AlertTriangle size={14} />
                    <span>Only tap "Mark resolved" if the participant edited their Play Store email and you've synced downstream.</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => markResolved("email")}
                      className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      <CheckCircle2 size={11} /> Mark resolved
                    </button>
                  </div>
                )}
              </div>
            )}

          <div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={form.betaRegistered}
                onChange={(e) => setForm({ ...form, betaRegistered: e.target.checked })}
              />
              <span>
                Beta registered on Play (Stage 2 gate)
              </span>
            </label>
            {form.betaRegistered && participant.betaRegisteredAt && (
              <p className="text-xs text-gray-500 mt-0.5 ml-6">
                Since {new Date(participant.betaRegisteredAt).toLocaleString()}
              </p>
            )}
          </div>

          <ReadField label="Invitation accepted (declared)">
            {participant.invitationAcceptedDeclared ? "Yes" : "No"}
            {participant.invitationLinkFailed && (
              <span className="text-xs text-orange-600 ml-2">
                (link didn't work)
              </span>
            )}
          </ReadField>

          <ReadField label="App updated (declared)">
            {participant.appUpdatedDeclared ? "Yes" : "No"}
          </ReadField>

          {participant.versionScreenshotUrl && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Version screenshot review
              </label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div className="border border-gray-200 rounded p-2 text-center">
                  <div className="text-[10px] text-gray-500 mb-1">Participant</div>
                  <a
                    href={participant.versionScreenshotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Open in Drive
                  </a>
                </div>
                <div className="border border-gray-200 rounded p-2 text-center">
                  <div className="text-[10px] text-gray-500 mb-1">Reference</div>
                  {referenceScreenshotUrl ? (
                    <a
                      href={referenceScreenshotUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Open in Drive
                    </a>
                  ) : (
                    <span className="text-xs text-gray-400">Not uploaded</span>
                  )}
                </div>
              </div>
              {participant.versionAiExtractedText && (
                <p className="text-xs text-gray-600">
                  AI read: <span className="font-mono">{participant.versionAiExtractedText}</span>
                  {participant.versionVerifiedByAi && (
                    <span className="text-green-600 ml-1">(auto-verified)</span>
                  )}
                </p>
              )}
              {/* Quick-action buttons — set form directly and save */}
              <div className="mt-2 flex gap-1">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, versionVerified: "verified" })}
                  className={`text-xs px-2 py-1 rounded border ${
                    form.versionVerified === "verified"
                      ? "bg-green-100 border-green-300 text-green-800"
                      : "border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  Verify
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, versionVerified: "mismatch" })}
                  className={`text-xs px-2 py-1 rounded border ${
                    form.versionVerified === "mismatch"
                      ? "bg-red-100 border-red-300 text-red-800"
                      : "border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  Mark mismatch
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Version verified
            </label>
            <select
              value={form.versionVerified}
              onChange={(e) =>
                setForm({ ...form, versionVerified: e.target.value as any })
              }
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <option value="pending">pending</option>
              <option value="verified">verified</option>
              <option value="mismatch">mismatch</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Reported version (typed)
            </label>
            <input
              type="text"
              value={form.reportedVersion}
              onChange={(e) => setForm({ ...form, reportedVersion: e.target.value })}
              className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
              placeholder="5.1.7-beta"
            />
          </div>
        </div>
        <div className="p-4 border-t border-gray-200 flex items-center gap-2 sticky bottom-0 bg-white">
          <button
            type="button"
            onClick={deleteOne}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-700 border border-red-300 rounded-md hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 size={14} />
            Delete
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ReadField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-700 mb-0.5">{label}</div>
      <div className="text-sm text-gray-900">{children}</div>
    </div>
  );
}

/**
 * CST manual-override panel.
 *
 * Every pilot has a subset of participants who won't do the self-serve flow
 * — CST confirms with them over Viber that they're actually installed and
 * on the target build, then marks them done from here. That's what these
 * buttons are for: bypass the portal, jump the participant to any stage.
 *
 * The buttons flip the underlying booleans (not currentStage directly),
 * because updateParticipant() re-derives currentStage from those booleans.
 * Flipping betaRegistered=true also sets invitationAcceptedDeclared=true so
 * we don't stay stuck on the CLICKED_NOT_REGISTERED contradiction.
 *
 * Revert path: if a user turns out to have lied on Screen F (auto-verified
 * via versionConfirmedByUser), CST taps "Revert to pending" and the
 * participant is nudged back to re-confirm. reportedVersion is intentionally
 * left untouched so the audit shows what was originally claimed.
 */
function CstStageOverride({
  accountId,
  participant,
  onSaved,
}: {
  accountId: string;
  participant: Participant;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const apply = async (
    updates: Record<string, any>,
    label: string,
  ) => {
    if (busy) return;
    if (!window.confirm(`${label}?\n\nThis writes to ${participant.fullName}'s record and is auditable in the change log.`)) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/pilot-tracker/participants`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: participant.id, updates }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      showToast(
        json.stageChanged ? `Stage advanced to ${json.newStage}.` : "Saved.",
        "success",
      );
      onSaved();
    } catch (e: any) {
      showToast(`Override failed: ${e.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const revertVerification = () =>
    apply(
      {
        // Undo auto-verification. Keep reportedVersion for audit; if the
        // user had also uploaded a screenshot, they can re-verify manually.
        versionConfirmedByUser: false,
        versionVerified: "pending",
      },
      "Revert version verification to pending",
    );

  const buttons: Array<{
    label: string;
    show: boolean;
    updates: Record<string, any>;
    dangerous?: boolean;
  }> = [
    {
      label: "1. Mark email captured",
      show: !participant.emailConfirmedIsPlaystore || !participant.playstoreEmail,
      updates: { emailConfirmedIsPlaystore: true },
    },
    {
      label: "2. Mark beta registered",
      show: !participant.betaRegistered,
      updates: { betaRegistered: true },
    },
    {
      label: "3. Mark invitation accepted",
      show: participant.betaRegistered && !participant.invitationAcceptedDeclared,
      updates: { invitationAcceptedDeclared: true, invitationLinkFailed: false },
    },
    {
      label: "4. Mark app updated",
      show: !participant.appUpdatedDeclared,
      updates: { appUpdatedDeclared: true },
    },
    {
      label: "5. Confirm mobile & work email",
      show:
        participant.appUpdatedDeclared &&
        (!participant.mobileConfirmed ||
          (Boolean(participant.workEmail) && !participant.workEmailConfirmed)),
      updates: {
        mobileConfirmed: true,
        // Only flip work-email confirm true when we actually have a
        // workEmail on file — otherwise the field is meaningless.
        ...(participant.workEmail ? { workEmailConfirmed: true } : {}),
      },
    },
    {
      label: "6. Confirm on target version (auto-verify)",
      show: participant.appUpdatedDeclared && participant.versionVerified !== "verified",
      updates: {
        mobileConfirmed: true,
        ...(participant.workEmail ? { workEmailConfirmed: true } : {}),
        versionConfirmedByUser: true,
      },
    },
    {
      // Stage 7 — the only way out of Stage 6 is clearing the portal-driven
      // corrections CST still owes downstream. Both resolve flags are safe
      // to set even when only one correction exists: the state machine
      // treats a resolved-but-never-corrected field as a no-op, and
      // updateParticipant() skips fields whose value didn't change.
      label: "7. Mark blockers resolved (complete)",
      show: participant.versionVerified === "verified" && participant.currentStage < 7,
      updates: {
        contactCorrectionResolved: true,
        emailCorrectionResolved: true,
      },
    },
    {
      label: "Mark complete (all stages)",
      show: participant.versionVerified !== "verified",
      updates: {
        emailConfirmedIsPlaystore: true,
        betaRegistered: true,
        invitationAcceptedDeclared: true,
        invitationLinkFailed: false,
        appUpdatedDeclared: true,
        mobileConfirmed: true,
        ...(participant.workEmail ? { workEmailConfirmed: true } : {}),
        versionConfirmedByUser: true,
        // Land directly at Stage 7, not 6. Without these, a participant
        // who ever corrected their mobile/email via the portal gets stuck
        // at "Version verified" even though CST just declared them done.
        contactCorrectionResolved: true,
        emailCorrectionResolved: true,
      },
    },
  ];
  const visible = buttons.filter((b) => b.show);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-start gap-2 mb-2">
        <div className="text-xs font-semibold text-amber-900">CST override</div>
        <div className="text-[10px] text-amber-700 leading-tight">
          Skip the portal — advance this participant manually when you've
          already confirmed with them (Viber/call).
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="text-xs text-amber-800">
          {participant.currentStage >= 7
            ? "This participant is fully complete. Nothing to advance."
            : "Nothing left to advance from here — remaining work is on the blocker banners below."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-1.5">
          {visible.map((b) => (
            <button
              key={b.label}
              type="button"
              disabled={busy}
              onClick={() => apply(b.updates, b.label)}
              className="w-full text-left text-xs px-2.5 py-1.5 rounded border border-amber-300 bg-white text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              {b.label}
            </button>
          ))}
        </div>
      )}

      {participant.versionVerified === "verified" && (
        <div className="mt-2 pt-2 border-t border-amber-200">
          <button
            type="button"
            disabled={busy}
            onClick={revertVerification}
            className="w-full text-left text-xs px-2.5 py-1.5 rounded border border-red-300 bg-white text-red-800 hover:bg-red-50 disabled:opacity-50"
          >
            Revert version verification (user lied / needs re-check)
          </button>
          {participant.versionConfirmedByUser && !participant.versionScreenshotDriveId && (
            <p className="mt-1 text-[10px] text-amber-700 leading-tight">
              Verified via one-tap confirmation (no screenshot). Use revert if
              you find out they're not actually on the target build.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

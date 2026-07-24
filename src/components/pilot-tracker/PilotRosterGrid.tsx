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
import { Search, X, AlertTriangle, CheckCircle2, Clock, Download, UserCheck, Trash2 } from "lucide-react";
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
}

interface Payload {
  participants: Participant[];
  total: number;
  stageCounts: number[];
  flagCounts: Record<string, number>;
  blockedByStage?: {
    s1: number;    // email corrected by user
    s2: number;    // CLICKED_NOT_REGISTERED + INVITE_NOT_RECEIVED
    s3: number;    // stuck at stage 3 (no activity 3+ days)
    s4: number;    // mobile/work email corrected by user
    s5: number;    // VERSION_MISMATCH
  };
}

// Which synthetic flag each stage's red pill maps to when tapped. Keep in
// sync with the API's flag parameter handling.
const STAGE_BLOCK_FILTER: Record<number, string | null> = {
  0: null,
  1: "EMAIL_CORRECTED_BY_USER",
  2: "CLICKED_NOT_REGISTERED",  // covers the larger of the two Step-2 flags
  3: "STUCK_STAGE3",
  4: "CONTACT_CORRECTED_BY_USER",
  5: "VERSION_MISMATCH",
  6: null,
};

const STAGE_LABELS = [
  "Imported",
  "Email captured",
  "Beta registered",
  "Invitation accepted",
  "App updated",
  "Screenshot uploaded",
  "Version verified",
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

  const refresh = useCallback(async () => {
    setLoading(true);
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
      showToast(`Load failed: ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [accountId, stageFilter, flagFilter, search, showToast]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshTrigger]);

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
        <div className="grid grid-cols-7 gap-2 mb-3">
          {STAGE_LABELS.map((label, i) => {
            // Card is stage-filter primary. The bottom row is a secondary
            // click target that jumps to the matching flag filter — we
            // rely on stopPropagation so the outer stage-filter isn't
            // toggled at the same time. Stage cards without a mapped
            // block filter (0, 6) still render the "0 blocked" line for
            // visual consistency, but the row isn't clickable.
            const blocked =
              i === 1 ? data.blockedByStage?.s1 ?? 0
              : i === 2 ? data.blockedByStage?.s2 ?? 0
              : i === 3 ? data.blockedByStage?.s3 ?? 0
              : i === 4 ? data.blockedByStage?.s4 ?? 0
              : i === 5 ? data.blockedByStage?.s5 ?? 0
              : 0;
            const blockFilter = STAGE_BLOCK_FILTER[i];
            const blockedActive = blockFilter != null && flagFilter === blockFilter;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setStageFilter(stageFilter === String(i) ? "" : String(i))}
                className={`text-left rounded-md border p-2 hover:bg-gray-50 transition ${
                  stageFilter === String(i)
                    ? "border-blue-500 bg-blue-50 ring-1 ring-blue-300"
                    : "border-gray-200"
                }`}
              >
                <div className="text-lg font-semibold text-gray-900">
                  {data.stageCounts[i] || 0}
                </div>
                <div className="text-xs text-gray-500 leading-tight mt-0.5">
                  {i}. {label}
                </div>
                {blockFilter ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (blocked === 0) return;
                      setFlagFilter(blockedActive ? "" : blockFilter);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.stopPropagation();
                      if (blocked === 0) return;
                      setFlagFilter(blockedActive ? "" : blockFilter);
                    }}
                    className={`inline-block mt-1.5 text-[10px] leading-none rounded-full px-1.5 py-0.5 border ${
                      blocked > 0
                        ? blockedActive
                          ? "bg-red-600 border-red-600 text-white cursor-pointer"
                          : "bg-red-50 border-red-200 text-red-700 hover:bg-red-100 cursor-pointer"
                        : "bg-gray-50 border-gray-200 text-gray-400 cursor-default"
                    }`}
                  >
                    {blocked} blocked
                  </span>
                ) : (
                  <span className="inline-block mt-1.5 text-[10px] leading-none rounded-full px-1.5 py-0.5 border bg-gray-50 border-gray-200 text-gray-400">
                    0 blocked
                  </span>
                )}
              </button>
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
          <button
            type="button"
            onClick={markSelectedRegistered}
            disabled={bulkBusy}
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
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
                  <FlagBadge flag={p.issueFlag} />
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
  const isComplete = stage === 6;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded ${
        isComplete
          ? "bg-green-100 text-green-800"
          : stage >= 3
          ? "bg-blue-100 text-blue-800"
          : "bg-gray-100 text-gray-700"
      }`}
    >
      {isComplete && <CheckCircle2 size={12} />}
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
  const [form, setForm] = useState({
    betaRegistered: participant.betaRegistered,
    versionVerified: participant.versionVerified as "pending" | "verified" | "mismatch",
    workEmail: participant.workEmail || "",
    playstoreEmail: participant.playstoreEmail || "",
    reportedVersion: participant.reportedVersion || "",
  });

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
              <span>
                <span className="text-amber-700 font-medium">
                  {participant.mobileNumberCorrected}
                </span>
                <span className="text-gray-400 text-xs ml-2">
                  (original: {participant.mobileNumber})
                </span>
              </span>
            ) : (
              participant.mobileNumber
            )}
          </ReadField>

          <hr className="border-gray-100" />

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Work email <span className="text-gray-400 font-normal">(admin sign-in / OTP target)</span>
            </label>
            <input
              type="email"
              value={form.workEmail}
              onChange={(e) => setForm({ ...form, workEmail: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              placeholder="user@company.com"
            />
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
            <input
              type="email"
              value={form.playstoreEmail}
              onChange={(e) => setForm({ ...form, playstoreEmail: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              placeholder="user@gmail.com"
            />
            {participant.emailConfirmedIsPlaystore && (
              <span className="text-xs text-green-600 mt-0.5 inline-block">
                ✓ Participant acknowledged this is their Play Store email
              </span>
            )}
          </div>

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
      label: "5. Confirm on target version (auto-verify)",
      show: participant.appUpdatedDeclared && participant.versionVerified !== "verified",
      updates: {
        mobileConfirmed: true,
        versionConfirmedByUser: true,
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
        versionConfirmedByUser: true,
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
          This participant is fully complete. Nothing to advance.
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

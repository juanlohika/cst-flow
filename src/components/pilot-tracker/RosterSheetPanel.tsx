"use client";

/**
 * Pilot Tracker → Roster Sheet panel.
 *
 * Drives the collection window: provision the Sheet, share it with the
 * client's admins, then Lock to adopt everything in one pass.
 *
 * The panel is deliberately explicit about which mode the window is in.
 * "Is this sheet still open for edits?" is the question that decides
 * whether the roster in front of you is current, and a wrong guess sends
 * dev a stale registration list.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Lock,
  RefreshCw,
  Table2,
  Unlock,
  UserPlus,
} from "lucide-react";
import { useToast } from "@/components/ui/ToastContext";

interface SheetState {
  sheetId: string | null;
  sheetUrl: string | null;
  state: "collecting" | "locked";
  lockedAt: string | null;
  syncedAt: string | null;
}

interface FieldChange {
  field: string;
  from: string;
  to: string;
}
interface PreviewRow {
  rowNumber: number;
  employeeId: string;
  fullName: string;
  action: "update" | "create" | "unchanged" | "conflict" | "error";
  changes: FieldChange[];
  skipped: Array<{ field: string; reason: string }>;
  message?: string;
  possibleTypoOf?: string;
}
interface Preview {
  rows: PreviewRow[];
  counts: Record<string, number>;
  newRegistrationEmails: number;
}

export function RosterSheetPanel({
  accountId,
  onChanged,
}: {
  accountId: string;
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const [state, setState] = useState<SheetState | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [allowCreate, setAllowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/accounts/${accountId}/pilot-tracker/roster-sheet`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (res.ok) setState(json);
    } catch {
      /* non-fatal — the panel just shows its empty state */
    }
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  const call = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}/pilot-tracker/roster-sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      return json;
    } finally {
      setBusy(false);
    }
  };

  const provision = async () => {
    try {
      const j = await call("provision");
      showToast(j.created ? "Roster Sheet created in Drive." : "Roster Sheet ready.", "success");
      load();
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const refresh = async () => {
    try {
      const j = await call("refresh");
      showToast(`Sheet refreshed — ${j.rows} row(s).`, "success");
      load();
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const runPreview = async () => {
    try {
      const j = await call("preview");
      setPreview(j);
      setAllowCreate(false);
      if (
        j.counts.update === 0 &&
        j.counts.create === 0 &&
        j.counts.error === 0 &&
        j.counts.conflict === 0
      ) {
        showToast("Nothing to adopt — the sheet matches the system.", "info");
      }
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const confirmLock = async () => {
    try {
      const j = await call("lock", { allowCreate });
      const bits = [`${j.updated} updated`];
      if (j.created) bits.push(`${j.created} created`);
      if (j.skipped) bits.push(`${j.skipped} skipped`);
      if (j.failed) bits.push(`${j.failed} failed`);
      showToast(`Sheet locked. ${bits.join(", ")}.`, j.failed ? "info" : "success");
      setPreview(null);
      load();
      onChanged();
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const reopen = async () => {
    if (
      !confirm(
        "Reopen the sheet for admin edits?\n\nThe system columns stay protected. Lock again when they're done to adopt the changes.",
      )
    ) {
      return;
    }
    try {
      await call("reopen");
      showToast("Sheet reopened for edits.", "success");
      load();
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  // ── Not provisioned yet ────────────────────────────────────────────
  if (!state?.sheetId) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-start gap-3">
          <Table2 size={18} className="text-gray-400 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold text-gray-900">Roster Sheet</h4>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              Creates a Google Sheet in this pilot&apos;s Drive folder that you can
              share with the client&apos;s admins so they fill in their people&apos;s
              Play Store emails and tags. Nothing they type reaches the system
              until you lock the sheet — so dev gets one registration list, not
              one message per person.
            </p>
            <button
              type="button"
              onClick={provision}
              disabled={busy}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <Table2 size={12} />
              {busy ? "Creating…" : "Create Roster Sheet"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const locked = state.state === "locked";

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="p-4 flex items-start gap-3 flex-wrap">
        <Table2 size={18} className="text-gray-400 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold text-gray-900">Roster Sheet</h4>
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
                locked
                  ? "bg-gray-100 text-gray-700 border-gray-300"
                  : "bg-amber-50 text-amber-800 border-amber-300"
              }`}
            >
              {locked ? <Lock size={10} /> : <Unlock size={10} />}
              {locked ? "Locked" : "Open for admin edits"}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            {locked
              ? "Admins can read but not edit. Reopen to collect another round of changes."
              : "Admins can edit the unshaded columns. Nothing reaches the system until you lock."}
            {state.syncedAt && (
              <> · Last synced {new Date(state.syncedAt).toLocaleString()}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <a
            href={state.sheetUrl || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1 border border-gray-300 rounded-md text-xs text-gray-700 hover:bg-gray-50"
          >
            <ExternalLink size={12} />
            Open Sheet
          </a>
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1 border border-gray-300 rounded-md text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            title="Push the latest system data into the Sheet"
          >
            <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
            Refresh
          </button>
          {locked ? (
            <button
              type="button"
              onClick={reopen}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 py-1 border border-amber-300 bg-amber-50 text-amber-900 rounded-md text-xs font-medium hover:bg-amber-100 disabled:opacity-50"
            >
              <Unlock size={12} />
              Reopen for edits
            </button>
          ) : (
            <button
              type="button"
              onClick={runPreview}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 text-white rounded-md text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <Lock size={12} />
              Lock &amp; adopt…
            </button>
          )}
        </div>
      </div>

      {preview && (
        <PreviewModal
          preview={preview}
          allowCreate={allowCreate}
          setAllowCreate={setAllowCreate}
          busy={busy}
          onCancel={() => setPreview(null)}
          onConfirm={confirmLock}
        />
      )}
    </div>
  );
}

/**
 * Adopt preview.
 *
 * Creates are counted and confirmed SEPARATELY from updates. The risk with
 * sheet-driven creation isn't creation itself — it's a fat-fingered
 * employee ID silently becoming a second, half-populated person while the
 * row it was meant to update goes untouched. Splitting the confirmation
 * means new people are always a deliberate choice.
 */
function PreviewModal({
  preview,
  allowCreate,
  setAllowCreate,
  busy,
  onCancel,
  onConfirm,
}: {
  preview: Preview;
  allowCreate: boolean;
  setAllowCreate: (v: boolean) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const c = preview.counts;
  const creates = preview.rows.filter((r) => r.action === "create");
  const updates = preview.rows.filter((r) => r.action === "update");
  const conflicts = preview.rows.filter((r) => r.action === "conflict");
  const errors = preview.rows.filter((r) => r.action === "error");
  const typos = creates.filter((r) => r.possibleTypoOf);

  return (
    <div className="fixed inset-0 bg-black/40 z-[110] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900">
            Lock &amp; adopt roster Sheet
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Review what will change. Nothing is written until you confirm.
          </p>
        </div>

        <div className="p-4 overflow-y-auto space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Stat label="Updates" value={c.update || 0} tone="blue" />
            <Stat label="New people" value={c.create || 0} tone="amber" />
            <Stat label="Unchanged" value={c.unchanged || 0} tone="gray" />
            <Stat label="Conflicts" value={c.conflict || 0} tone="rose" />
            <Stat label="Errors" value={c.error || 0} tone="red" />
          </div>

          {preview.newRegistrationEmails > 0 && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900 flex items-start gap-2">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              <span>
                <strong>{preview.newRegistrationEmails}</strong> participant(s) will
                gain a Play Store email. Dev gets{" "}
                <strong>one</strong> Telegram message listing them — not one per
                person.
              </span>
            </div>
          )}

          {errors.length > 0 && (
            <Section title={`Errors — will be skipped (${errors.length})`} tone="red">
              {errors.map((r) => (
                <li key={r.rowNumber} className="py-1">
                  <span className="font-mono text-[11px]">Row {r.rowNumber}</span>{" "}
                  {r.employeeId && <strong>{r.employeeId}</strong>} — {r.message}
                </li>
              ))}
            </Section>
          )}

          {typos.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div>
                  <strong>Possible typos.</strong> These IDs closely match existing
                  people — creating them would make duplicates:
                  <ul className="mt-1 space-y-0.5">
                    {typos.map((r) => (
                      <li key={r.rowNumber}>
                        Row {r.rowNumber}: <strong>{r.employeeId}</strong> — did you
                        mean <strong>{r.possibleTypoOf}</strong>?
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {creates.length > 0 && (
            <Section title={`New participants (${creates.length})`} tone="amber">
              {creates.map((r) => (
                <li key={r.rowNumber} className="py-1">
                  <strong>{r.employeeId}</strong> — {r.fullName}
                  {r.possibleTypoOf && (
                    <span className="text-amber-700"> (possible typo)</span>
                  )}
                </li>
              ))}
            </Section>
          )}

          {conflicts.length > 0 && (
            <Section
              title={`Kept participant's own value (${conflicts.length})`}
              tone="rose"
            >
              {conflicts.map((r) => (
                <li key={r.rowNumber} className="py-1">
                  <strong>{r.employeeId}</strong> — {r.fullName}
                  <ul className="ml-4 text-[11px] text-gray-600">
                    {r.skipped.map((s, i) => (
                      <li key={i}>
                        {s.field}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </Section>
          )}

          {updates.length > 0 && (
            <Section title={`Updates (${updates.length})`} tone="blue">
              {updates.slice(0, 100).map((r) => (
                <li key={r.rowNumber} className="py-1">
                  <strong>{r.employeeId}</strong> — {r.fullName}
                  <ul className="ml-4 text-[11px] text-gray-600">
                    {r.changes.map((ch, i) => (
                      <li key={i}>
                        {ch.field}: <span className="text-gray-400">{ch.from || "(blank)"}</span>{" "}
                        → <span className="text-gray-900">{ch.to}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              {updates.length > 100 && (
                <li className="py-1 text-gray-500">
                  …and {updates.length - 100} more.
                </li>
              )}
            </Section>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 space-y-3">
          {creates.length > 0 && (
            <label className="flex items-start gap-2 text-xs text-gray-800">
              <input
                type="checkbox"
                checked={allowCreate}
                onChange={(e) => setAllowCreate(e.target.checked)}
                className="mt-0.5"
              />
              <span className="inline-flex items-center gap-1">
                <UserPlus size={12} className="text-amber-600" />
                Also create the <strong>{creates.length}</strong> new participant(s)
                listed above. Leave unticked to apply updates only.
              </span>
            </label>
          )}
          <div className="flex items-center gap-2">
            <p className="text-[11px] text-gray-500 flex-1">
              Locking protects the admin columns. You can reopen any time.
            </p>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <Lock size={13} />
              {busy ? "Adopting…" : "Adopt & lock"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "blue" | "amber" | "gray" | "rose" | "red";
}) {
  const tones: Record<string, string> = {
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    gray: "border-gray-200 bg-gray-50 text-gray-700",
    rose: "border-rose-200 bg-rose-50 text-rose-900",
    red: "border-red-200 bg-red-50 text-red-900",
  };
  return (
    <div className={`rounded-md border p-2 ${tones[tone]}`}>
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="text-[10px] mt-1">{label}</div>
    </div>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "blue" | "amber" | "rose" | "red";
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    blue: "text-blue-900",
    amber: "text-amber-900",
    rose: "text-rose-900",
    red: "text-red-900",
  };
  return (
    <div>
      <h4 className={`text-xs font-semibold mb-1 ${tones[tone]}`}>{title}</h4>
      <ul className="text-xs text-gray-800 divide-y divide-gray-100 border border-gray-200 rounded-md px-3 max-h-52 overflow-y-auto">
        {children}
      </ul>
    </div>
  );
}

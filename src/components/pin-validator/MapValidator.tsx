"use client";

/**
 * MapValidator — Leaflet + CARTO tiles map + sidebar list + decision flow.
 *
 * Ported from the legacy validator.html (Apps Script web app), kept the
 * same UX shape: status filter chips, stats row, scrollable list with
 * per-row approve/flag, marker popups, bulk selection bar, flag-reason
 * modal. The external validator URL (/pin-validator/[projectId]) mounts
 * this with canWrite=true; the AccountHub monitoring view mounts it
 * with canWrite=false so internal users see the same map but can't
 * accidentally save decisions.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";

interface Pin {
  row: number;
  location: string;
  lng: number;
  lat: number;
  address: string;
  mapLink: string;
  status: "Pending" | "Approved" | "Flagged" | string;
  note: string;
  validator: string;
  timestamp: string;
}

interface Props {
  projectId: string;
  /** Endpoint base — defaults to the external API. AccountHub can pass an
   * internal proxy URL if we add one (not needed today). */
  apiBase?: string;
  /** Show "logged in as X" chip at the top. */
  validatorLabel?: string;
}

type Filter = "All" | "Pending" | "Approved" | "Flagged";

export function MapValidator({ projectId, apiBase, validatorLabel }: Props) {
  const base = apiBase || `/api/pin-validator/${projectId}/pins`;
  const [pins, setPins] = useState<Pin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [filter, setFilter] = useState<Filter>("All");
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [flagOpen, setFlagOpen] = useState<{ rows: number[] } | null>(null);
  const [flagNote, setFlagNote] = useState("");

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<any>(null);
  const markers = useRef<Map<number, any>>(new Map());
  const leafletRef = useRef<any>(null);

  // ─── Load pins ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(base, { cache: "no-store" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (cancelled) return;
        setPins(data.pins || []);
        setCanWrite(Boolean(data.canWrite));
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load pins");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [base]);

  // ─── Initialize Leaflet ───────────────────────────────────────
  useEffect(() => {
    if (loading || !mapRef.current || pins.length === 0) return;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      // Side-effect: inject Leaflet CSS once.
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }
      if (cancelled) return;
      leafletRef.current = L;
      if (!mapInstance.current && mapRef.current) {
        const m = L.map(mapRef.current);
        L.tileLayer(
          "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
          { attribution: "© OpenStreetMap © CARTO", maxZoom: 19 },
        ).addTo(m);
        mapInstance.current = m;
      }
      refreshMarkers();
      const bounds = pins.filter((p) => p.lat && p.lng).map((p) => [p.lat, p.lng]) as [number, number][];
      if (bounds.length > 0 && mapInstance.current) {
        mapInstance.current.fitBounds(bounds, { padding: [40, 40] });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, pins.length === 0]);

  // Update markers whenever a pin's status flips.
  useEffect(() => {
    if (!mapInstance.current) return;
    refreshMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins]);

  function refreshMarkers() {
    const L = leafletRef.current;
    if (!L || !mapInstance.current) return;
    markers.current.forEach((m) => mapInstance.current.removeLayer(m));
    markers.current.clear();
    for (const p of pins) {
      if (!p.lat || !p.lng) continue;
      const m = L.marker([p.lat, p.lng], { icon: makeIcon(L, p.status) }).addTo(mapInstance.current);
      m.bindPopup(renderPopup(p));
      m.on("click", () => {
        const el = document.querySelector(`[data-row="${p.row}"]`);
        if (el) el.scrollIntoView({ block: "nearest" });
      });
      markers.current.set(p.row, m);
    }
  }

  // ─── Filter + stats ──────────────────────────────────────────
  const visible = useMemo(() => {
    if (filter === "All") return pins;
    return pins.filter((p) => p.status === filter);
  }, [pins, filter]);

  const stats = useMemo(() => {
    const total = pins.length;
    const approved = pins.filter((p) => p.status === "Approved").length;
    const flagged = pins.filter((p) => p.status === "Flagged").length;
    const pending = total - approved - flagged;
    const decidedPct = total > 0 ? Math.round(((approved + flagged) / total) * 100) : 0;
    return { total, approved, flagged, pending, decidedPct };
  }, [pins]);

  // ─── Decisions ────────────────────────────────────────────────
  async function saveOne(row: number, decision: "Approved" | "Flagged", note: string) {
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rowNumber: row, decision, note }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    setPins((prev) =>
      prev.map((p) =>
        p.row === row ? { ...p, status: decision, note: note || p.note } : p,
      ),
    );
  }

  async function saveBulk(rows: number[], decision: "Approved" | "Flagged", note: string) {
    if (rows.length === 0) return;
    const decisions = rows.map((r) => ({ rowNumber: r, decision, note }));
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decisions }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    setPins((prev) =>
      prev.map((p) => (rows.includes(p.row) ? { ...p, status: decision, note: note || p.note } : p)),
    );
    setChecked(new Set());
  }

  const onApproveOne = async (row: number) => {
    try {
      await saveOne(row, "Approved", "");
    } catch (e: any) {
      alert(`Save failed: ${e?.message || String(e)}`);
    }
  };
  const onOpenFlag = (rows: number[]) => {
    setFlagNote("");
    setFlagOpen({ rows });
  };
  const onSubmitFlag = async () => {
    const note = flagNote.trim();
    if (!note) {
      alert("Please enter a reason.");
      return;
    }
    if (!flagOpen) return;
    try {
      if (flagOpen.rows.length === 1) {
        await saveOne(flagOpen.rows[0], "Flagged", note);
      } else {
        await saveBulk(flagOpen.rows, "Flagged", note);
      }
      setFlagOpen(null);
    } catch (e: any) {
      alert(`Save failed: ${e?.message || String(e)}`);
    }
  };
  const onBulkApprove = async () => {
    try {
      await saveBulk(Array.from(checked), "Approved", "");
    } catch (e: any) {
      alert(`Save failed: ${e?.message || String(e)}`);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Loading pins…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-600">
        {error}
      </div>
    );
  }
  if (pins.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
        <div className="h-10 w-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
          <MapPin className="w-5 h-5" />
        </div>
        <div>No pins yet. Geocode the Sheet to populate this map.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5 font-semibold text-slate-900">
          <MapPin className="w-3.5 h-3.5 text-blue-600" />
          Pin Validator
        </span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
          {stats.pending} Pending
        </span>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
          {stats.approved} Approved
        </span>
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800">
          {stats.flagged} Flagged
        </span>
        <div className="ml-auto flex gap-1">
          {(["All", "Pending", "Flagged", "Approved"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setChecked(new Set());
              }}
              className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                filter === f
                  ? "border border-blue-200 bg-blue-50 text-blue-700"
                  : "border border-slate-200 bg-white text-slate-500"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        {validatorLabel && (
          <span className="ml-2 text-[11px] text-slate-400">🔐 {validatorLabel}</span>
        )}
      </div>
      {/* Progress bar */}
      <div className="h-[3px] bg-slate-200">
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{ width: `${stats.decidedPct}%` }}
        />
      </div>
      {/* Bulk bar */}
      {canWrite && checked.size > 0 && (
        <div className="flex items-center gap-2 border-b border-blue-200 bg-blue-50 px-3 py-2">
          <span className="text-xs font-medium text-blue-700">{checked.size} selected</span>
          <button
            onClick={onBulkApprove}
            className="rounded-md bg-emerald-100 px-3 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-200"
          >
            ✓ Approve all
          </button>
          <button
            onClick={() => onOpenFlag(Array.from(checked))}
            className="rounded-md bg-red-100 px-3 py-1 text-[11px] font-medium text-red-800 hover:bg-red-200"
          >
            ⚑ Flag all
          </button>
          <button
            onClick={() => setChecked(new Set())}
            className="ml-auto rounded-md border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-500"
          >
            ✕ Clear
          </button>
        </div>
      )}
      {/* Main */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-[300px] flex-col border-r border-slate-200 bg-white">
          <div className="grid grid-cols-4 border-b border-slate-200 text-center">
            <Stat label="Total" value={stats.total} />
            <Stat label="Approved" value={stats.approved} tone="emerald" />
            <Stat label="Pending" value={stats.pending} tone="amber" />
            <Stat label="Flagged" value={stats.flagged} tone="red" />
          </div>
          {canWrite && (
            <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={
                    visible.length > 0 && visible.every((p) => checked.has(p.row))
                  }
                  onChange={(e) => {
                    if (e.target.checked) {
                      setChecked(new Set(visible.map((p) => p.row)));
                    } else {
                      setChecked(new Set());
                    }
                  }}
                />
                Select all
              </label>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {visible.map((p) => (
              <div
                key={p.row}
                data-row={p.row}
                className={`flex items-center gap-2 border-b border-slate-100 px-3 py-2 ${
                  checked.has(p.row) ? "bg-emerald-50" : ""
                }`}
              >
                {canWrite && (
                  <input
                    type="checkbox"
                    checked={checked.has(p.row)}
                    onChange={(e) => {
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(p.row);
                        else next.delete(p.row);
                        return next;
                      });
                    }}
                    className="h-3.5 w-3.5"
                  />
                )}
                <button
                  className="flex-1 min-w-0 text-left"
                  onClick={() => {
                    if (!mapInstance.current) return;
                    mapInstance.current.flyTo([p.lat, p.lng], 16, { duration: 0.5 });
                    markers.current.get(p.row)?.openPopup();
                  }}
                >
                  <div className="truncate text-xs font-medium text-slate-900">
                    {p.location}
                  </div>
                  <div className="truncate text-[10px] text-slate-400">
                    {p.address || "—"}
                  </div>
                </button>
                <div
                  className={`h-2 w-2 rounded-full ${
                    p.status === "Approved"
                      ? "bg-emerald-500"
                      : p.status === "Flagged"
                      ? "bg-red-500"
                      : "bg-amber-500"
                  }`}
                />
                {canWrite && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => onApproveOne(p.row)}
                      className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 hover:bg-emerald-200"
                      title="Approve"
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => onOpenFlag([p.row])}
                      className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 hover:bg-red-200"
                      title="Flag"
                    >
                      ⚑
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>
        {/* Map */}
        <div className="relative flex-1">
          <div ref={mapRef} className="absolute inset-0" />
        </div>
      </div>
      {/* Flag modal */}
      {flagOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-900">⚑ Flag reason</h3>
            <p className="mt-1 text-xs text-slate-500">
              {flagOpen.rows.length === 1
                ? "Reason for flagging this pin."
                : `Reason for flagging ${flagOpen.rows.length} pins.`}
            </p>
            <textarea
              autoFocus
              value={flagNote}
              onChange={(e) => setFlagNote(e.target.value)}
              placeholder="e.g. Wrong location, pin is off by 2 blocks…"
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              rows={3}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setFlagOpen(null)}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={onSubmitFlag}
                className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600"
              >
                Submit flag
              </button>
            </div>
          </div>
        </div>
      )}
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
  tone?: "emerald" | "amber" | "red";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "amber"
      ? "text-amber-600"
      : tone === "red"
      ? "text-red-600"
      : "text-slate-900";
  return (
    <div className="border-r border-slate-200 px-2 py-2 last:border-r-0">
      <div className={`text-sm font-semibold ${toneClass}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-slate-400">
        {label}
      </div>
    </div>
  );
}

function makeIcon(L: any, status: string): any {
  const color =
    status === "Approved" ? "#10B981" : status === "Flagged" ? "#EF4444" : "#F59E0B";
  // Lucide MapPin path — kept in sync with lucide-react's MapPin component
  // (https://lucide.dev/icons/map-pin). Inline-SVG lets us color it per
  // status while staying visually consistent with the rest of CST OS.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.25))">
    <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>
    <circle cx="12" cy="10" r="3" fill="white" stroke="${color}" stroke-width="2"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 26],
    popupAnchor: [0, -26],
  });
}

function renderPopup(p: Pin): string {
  const escape = (s: string) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const badge =
    p.status === "Approved"
      ? "bg-emerald-100 text-emerald-800"
      : p.status === "Flagged"
      ? "bg-red-100 text-red-800"
      : "bg-amber-100 text-amber-800";
  return `<div class="popup-inner" style="padding:12px;font-family:-apple-system,sans-serif;max-width:220px">
    <span class="popup-badge ${badge}" style="display:inline-block;padding:1px 7px;border-radius:20px;font-size:10px;margin-bottom:6px">${escape(p.status)}</span>
    <div style="font-size:12px;font-weight:600;color:#111;margin-bottom:2px">${escape(p.location)}</div>
    <div style="font-size:10px;color:#6b7280;margin-bottom:6px">${escape(p.address || "—")}</div>
    <div style="font-size:10px;color:#9ca3af">Lat ${p.lat} Lng ${p.lng} · Row ${p.row}</div>
  </div>`;
}

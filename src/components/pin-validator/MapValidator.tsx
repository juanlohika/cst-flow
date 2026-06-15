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
  // Row currently selected (by clicking a marker OR a sidebar row).
  // Drives the sidebar highlight + auto-scroll.
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  // Pagination — 20 pins per page in the sidebar list.
  const [page, setPage] = useState(0);
  // Adjust mode — when the user clicks "Adjust location" on a popup,
  // we make the marker draggable and show save/cancel controls. The
  // pending lat/lng is what we'd save if they confirm.
  const [adjusting, setAdjusting] = useState<{
    row: number;
    originalLat: number;
    originalLng: number;
    newLat: number;
    newLng: number;
  } | null>(null);

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
      // Custom popup styles — Leaflet's defaults are too big/opaque and
      // hide nearby pins when the user is zoomed out. We want a compact,
      // semi-transparent card with a status accent stripe.
      if (!document.getElementById("pin-validator-popup-css")) {
        const style = document.createElement("style");
        style.id = "pin-validator-popup-css";
        style.textContent = `
          .pin-popup .leaflet-popup-content-wrapper {
            background: rgba(255,255,255,0.92);
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
            border-radius: 8px;
            box-shadow: 0 4px 14px rgba(0,0,0,0.08);
            padding: 0;
          }
          .pin-popup .leaflet-popup-content {
            margin: 0;
            width: 190px !important;
            line-height: 1.35;
          }
          .pin-popup .leaflet-popup-tip {
            background: rgba(255,255,255,0.92);
            box-shadow: 0 2px 6px rgba(0,0,0,0.08);
          }
          .pin-popup .leaflet-popup-close-button {
            color: #94a3b8;
            font-size: 16px;
            padding: 2px 4px 0 0;
          }
          .pin-popup-inner {
            padding: 8px 10px;
            font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
          }
          .pin-popup-status {
            font-size: 9.5px;
            font-weight: 700;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            color: #475569;
            margin-bottom: 2px;
          }
          .pin-popup-name {
            font-size: 12px;
            font-weight: 600;
            color: #0f172a;
            margin-bottom: 2px;
            line-height: 1.3;
          }
          .pin-popup-addr {
            font-size: 10.5px;
            color: #64748b;
            margin-bottom: 4px;
            line-height: 1.3;
          }
          .pin-popup-meta {
            font-size: 9.5px;
            color: #94a3b8;
          }
          .pin-popup-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-top: 8px;
          }
          .pin-popup-btn {
            display: inline-block;
            font-size: 10.5px;
            font-weight: 500;
            padding: 4px 8px;
            border-radius: 5px;
            border: 1px solid #e2e8f0;
            background: rgba(255,255,255,0.85);
            color: #475569;
            cursor: pointer;
            font-family: inherit;
            line-height: 1.2;
          }
          .pin-popup-btn:hover { background: #f8fafc; }
          .pin-popup-btn--approve {
            background: #d1fae5;
            border-color: #a7f3d0;
            color: #065f46;
          }
          .pin-popup-btn--approve:hover { background: #a7f3d0; }
          .pin-popup-btn--flag {
            background: #fee2e2;
            border-color: #fecaca;
            color: #991b1b;
          }
          .pin-popup-btn--flag:hover { background: #fecaca; }
          .pin-popup-btn--primary {
            background: #2563eb;
            border-color: #2563eb;
            color: #ffffff;
          }
          .pin-popup-btn--primary:hover { background: #1d4ed8; }
          .pin-popup-hint {
            font-size: 10px;
            color: #64748b;
            margin-top: 6px;
            line-height: 1.35;
          }
        `;
        document.head.appendChild(style);
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

  // ─── Filter + stats ──────────────────────────────────────────
  // Filter pins by the current chip selection. Drives BOTH the sidebar list
  // and the map markers — the filter is a viewport, not a list-only filter.
  const visible = useMemo(() => {
    if (filter === "All") return pins;
    return pins.filter((p) => p.status === filter);
  }, [pins, filter]);

  // Pagination derived from the filtered set.
  const PAGE_SIZE = 20;
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const pageRows = visible.slice(pageStart, pageEnd);

  // Reset to first page whenever the filtered set shrinks or the filter changes.
  useEffect(() => {
    setPage(0);
  }, [filter]);

  // Update markers whenever the visible set changes (a status flip OR a
  // filter change). Picking 'Approved' should make only approved markers
  // appear on the map.
  // Also refreshed when canWrite or adjusting changes, since the popup
  // contents depend on both (action buttons + adjust state).
  useEffect(() => {
    if (!mapInstance.current) return;
    refreshMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, canWrite, adjusting]);

  function refreshMarkers() {
    const L = leafletRef.current;
    if (!L || !mapInstance.current) return;
    markers.current.forEach((m) => mapInstance.current.removeLayer(m));
    markers.current.clear();
    for (const p of visible) {
      if (!p.lat || !p.lng) continue;
      const isAdjusting = adjusting?.row === p.row;
      const m = L.marker([p.lat, p.lng], {
        icon: makeIcon(L, p.status, isAdjusting),
        draggable: isAdjusting,
      }).addTo(mapInstance.current);
      m.bindPopup(renderPopup(p, { canWrite, adjusting: isAdjusting }), {
        className: "pin-popup",
        maxWidth: 220,
        autoPan: true,
      });
      m.on("click", () => {
        setSelectedRow(p.row);
        // Scroll the sidebar row into view + flip pagination to its page.
        const idx = visible.findIndex((x) => x.row === p.row);
        if (idx >= 0) setPage(Math.floor(idx / PAGE_SIZE));
      });
      // Wire popup action buttons after the popup opens (we can only query
      // DOM nodes that exist post-render).
      m.on("popupopen", (ev: any) => {
        const node = ev.popup.getElement() as HTMLElement | null;
        if (!node) return;
        node.querySelectorAll("[data-pin-action]").forEach((btn) => {
          const action = (btn as HTMLElement).dataset.pinAction;
          (btn as HTMLElement).onclick = (e) => {
            e.preventDefault();
            handlePopupAction(p, action || "");
          };
        });
      });
      if (isAdjusting) {
        m.on("dragend", (ev: any) => {
          const { lat, lng } = ev.target.getLatLng();
          setAdjusting((prev) =>
            prev && prev.row === p.row
              ? { ...prev, newLat: lat, newLng: lng }
              : prev,
          );
        });
      }
      markers.current.set(p.row, m);
    }
    // If a row is selected, keep its popup open after the refresh.
    if (selectedRow != null) {
      const m = markers.current.get(selectedRow);
      if (m) m.openPopup();
    }
  }

  function handlePopupAction(p: Pin, action: string) {
    if (action === "approve") {
      void onApproveOne(p.row);
    } else if (action === "flag") {
      onOpenFlag([p.row]);
    } else if (action === "adjust") {
      setAdjusting({
        row: p.row,
        originalLat: p.lat,
        originalLng: p.lng,
        newLat: p.lat,
        newLng: p.lng,
      });
      setSelectedRow(p.row);
    } else if (action === "save-adjust") {
      void onSaveAdjust();
    } else if (action === "cancel-adjust") {
      setAdjusting(null);
    }
  }

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

  async function onSaveAdjust() {
    if (!adjusting) return;
    const payload = {
      kind: "adjust",
      rowNumber: adjusting.row,
      newLat: adjusting.newLat,
      newLng: adjusting.newLng,
      originalLat: adjusting.originalLat,
      originalLng: adjusting.originalLng,
      note: "",
    };
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Optimistically update local pin: new lat/lng + Approved status +
      // address replaced (matches Option (b) server behavior).
      setPins((prev) =>
        prev.map((p) =>
          p.row === adjusting.row
            ? {
                ...p,
                lat: Number(adjusting.newLat.toFixed(6)),
                lng: Number(adjusting.newLng.toFixed(6)),
                status: "Approved",
                address: "Manually adjusted",
              }
            : p,
        ),
      );
      setAdjusting(null);
    } catch (e: any) {
      alert(`Save failed: ${e?.message || String(e)}`);
    }
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
                    pageRows.length > 0 && pageRows.every((p) => checked.has(p.row))
                  }
                  onChange={(e) => {
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) {
                        pageRows.forEach((p) => next.add(p.row));
                      } else {
                        pageRows.forEach((p) => next.delete(p.row));
                      }
                      return next;
                    });
                  }}
                />
                Select page
              </label>
              <span className="ml-auto normal-case tracking-normal text-[10px] font-normal text-slate-400">
                {visible.length === 0
                  ? "0"
                  : `${pageStart + 1}–${Math.min(pageEnd, visible.length)} of ${visible.length}`}
              </span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {pageRows.map((p) => {
              const isSelected = selectedRow === p.row;
              return (
                <div
                  key={p.row}
                  data-row={p.row}
                  className={`flex items-center gap-2 border-b border-slate-100 px-3 py-2 transition-colors ${
                    isSelected
                      ? "bg-blue-50 border-l-2 border-l-blue-500"
                      : checked.has(p.row)
                      ? "bg-emerald-50"
                      : ""
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
                      setSelectedRow(p.row);
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
              );
            })}
          </div>
          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500">
              <button
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded border border-slate-200 bg-white px-2 py-0.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                ← Prev
              </button>
              <span>
                Page {safePage + 1} of {pageCount}
              </span>
              <button
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                className="rounded border border-slate-200 bg-white px-2 py-0.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          )}
        </aside>
        {/* Map */}
        <div className="relative flex-1">
          <div ref={mapRef} className="absolute inset-0" />
        </div>
      </div>
      {/* Flag modal — Leaflet popups/controls use z-index 700+, so the
          modal needs to sit above them. z-[9999] keeps it on top of
          anything else the app might layer over the map. */}
      {flagOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
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

function makeIcon(L: any, status: string, adjusting = false): any {
  const color =
    status === "Approved" ? "#10B981" : status === "Flagged" ? "#EF4444" : "#F59E0B";
  // Adjust mode: bigger size + blue stroke to signal draggable.
  const size = adjusting ? 36 : 28;
  const stroke = adjusting ? "#2563EB" : "white";
  const strokeW = adjusting ? 3 : 2;
  const shadow = adjusting
    ? "filter:drop-shadow(0 0 6px rgba(37,99,235,0.6))"
    : "filter:drop-shadow(0 1px 2px rgba(0,0,0,0.25))";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" stroke="${stroke}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round" style="${shadow}">
    <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>
    <circle cx="12" cy="10" r="3" fill="white" stroke="${color}" stroke-width="2"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size - 2],
    popupAnchor: [0, -(size - 2)],
  });
}

function renderPopup(
  p: Pin,
  opts: { canWrite: boolean; adjusting: boolean },
): string {
  const escape = (s: string) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Status accent stripe — slim color cue without a fully colored pill that
  // demands attention. Keeps the popup readable when zoomed-out and
  // overlapping other markers.
  const accent =
    p.status === "Approved" ? "#10B981" : p.status === "Flagged" ? "#EF4444" : "#F59E0B";

  // Action row varies by mode:
  //   - adjust mode: Save / Cancel
  //   - normal canWrite: Approve / Flag / Adjust
  //   - read-only: nothing
  let actions = "";
  if (opts.adjusting) {
    actions = `<div class="pin-popup-actions">
      <button data-pin-action="save-adjust" class="pin-popup-btn pin-popup-btn--primary">Save location</button>
      <button data-pin-action="cancel-adjust" class="pin-popup-btn">Cancel</button>
    </div>
    <div class="pin-popup-hint">Drag the pin on the map, then click <b>Save location</b>.</div>`;
  } else if (opts.canWrite) {
    actions = `<div class="pin-popup-actions">
      <button data-pin-action="approve" class="pin-popup-btn pin-popup-btn--approve" title="Approve">✓ Approve</button>
      <button data-pin-action="flag" class="pin-popup-btn pin-popup-btn--flag" title="Flag">⚑ Flag</button>
      <button data-pin-action="adjust" class="pin-popup-btn" title="Move pin to a corrected spot">Adjust location</button>
    </div>`;
  }

  return `<div class="pin-popup-inner" style="border-left:3px solid ${accent}">
    <div class="pin-popup-status">${escape(p.status)}</div>
    <div class="pin-popup-name">${escape(p.location)}</div>
    <div class="pin-popup-addr">${escape(p.address || "—")}</div>
    <div class="pin-popup-meta">Lat ${p.lat.toFixed(5)} · Lng ${p.lng.toFixed(5)}</div>
    ${actions}
  </div>`;
}

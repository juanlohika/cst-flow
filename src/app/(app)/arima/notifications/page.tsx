"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Bell, BellOff, Loader2, CheckCircle2, AlertTriangle, Send,
  Smartphone, Mail, Trash2,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface Preferences {
  webPushEnabled: boolean;
  emailEnabled: boolean;
  notifyOnRequest: boolean;
  notifyOnTelegram: boolean;
  notifyOnMention: boolean;
  quietStart: string | null;
  quietEnd: string | null;
  emailCadence: string;
}

interface Sub {
  id: string;
  endpoint: string;
  userAgent: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

// Convert a base64-url string to Uint8Array (required by PushManager.subscribe)
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Convert ArrayBuffer (browser keys) to base64-url so the server can store them
function bufToBase64(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default function NotificationsPage() {
  return (
    <AuthGuard>
      <Content />
    </AuthGuard>
  );
}

function Content() {
  const { data: session } = useSession();
  useBreadcrumbs([
    { label: "AI Intelligence" },
    { label: "ARIMA", href: "/arima" },
    { label: "Notifications" },
  ]);

  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
  }, []);

  const fetchPrefs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications/preferences");
      if (res.ok) {
        const data = await res.json();
        setPrefs(data.preferences);
        setSubs(data.subscriptions || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrefs();
  }, [fetchPrefs]);

  const showFlash = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const updatePref = async (patch: Partial<Preferences>) => {
    setPrefs(prev => prev ? { ...prev, ...patch } : prev);
    try {
      await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch {}
  };

  const subscribeBrowser = async () => {
    if (permission === "unsupported") {
      showFlash("error", "Push notifications aren't supported in this browser.");
      return;
    }
    setSubscribing(true);
    try {
      // Ask for OS-level permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        showFlash("error", "Permission denied. Allow notifications for this site to enable push.");
        return;
      }

      // Register the service worker (idempotent)
      const reg = await navigator.serviceWorker.register("/arima-sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;

      // Get our server's VAPID public key
      const vapidRes = await fetch("/api/notifications/vapid-public-key");
      const { publicKey } = await vapidRes.json();
      if (!publicKey) throw new Error("Could not fetch VAPID public key.");

      // Subscribe via the browser's PushManager
      let subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      // Register with our server
      const subJson = subscription.toJSON();
      await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          userAgent: navigator.userAgent,
        }),
      });

      showFlash("success", "Push notifications enabled on this device.");
      fetchPrefs();
    } catch (err: any) {
      showFlash("error", `Subscribe failed: ${err.message || err}`);
    } finally {
      setSubscribing(false);
    }
  };

  const unsubscribeBrowser = async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const subscription = await reg?.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await fetch("/api/notifications/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
        showFlash("success", "Push notifications disabled for this device.");
        fetchPrefs();
      }
    } catch (err: any) {
      showFlash("error", `Unsubscribe failed: ${err.message || err}`);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/notifications/test", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.result?.pushSent > 0) {
        showFlash("success", `Test sent. Check your device for the notification!`);
      } else if (data.result?.skipped > 0) {
        showFlash("error", "Test skipped — check that web push is enabled and you're outside quiet hours.");
      } else {
        showFlash("error", "Test sent but no push went out. You may need to subscribe a device first.");
      }
    } catch (err: any) {
      showFlash("error", err.message || "Test failed");
    } finally {
      setTesting(false);
    }
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString();
  };

  if (loading || !prefs) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-5">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center shadow-lg shadow-rose-500/30">
          <Bell className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-black text-slate-800 tracking-tight">Notifications</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Decide how ARIMA pings you about new requests and activity
          </p>
        </div>
      </header>

      {message && (
        <div className={`p-3 rounded-2xl border text-[12px] font-bold flex items-start gap-2 ${
          message.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700"
        }`}>
          {message.type === "success" ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
          {message.text}
        </div>
      )}

      {/* WEB PUSH */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-rose-500" />
          <h2 className="text-[11px] font-black text-slate-800 uppercase tracking-widest flex-1">
            Browser push (this device)
          </h2>
          <Toggle
            value={prefs.webPushEnabled}
            onChange={v => updatePref({ webPushEnabled: v })}
          />
        </div>
        <div className="p-5 space-y-3">
          {permission === "unsupported" && (
            <p className="text-[11px] text-slate-500">
              ⚠️ This browser doesn't support push notifications.
            </p>
          )}

          {permission === "denied" && (
            <p className="text-[11px] text-amber-700">
              ⚠️ You've blocked notifications for this site. Allow them in your browser settings, then come back and click "Enable" again.
            </p>
          )}

          {permission !== "unsupported" && subs.length === 0 && (
            <div className="space-y-2">
              <p className="text-[12px] text-slate-600">
                You haven't enabled push on this device yet. Click below to subscribe.
              </p>
              <button
                onClick={subscribeBrowser}
                disabled={subscribing}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-br from-rose-400 to-pink-500 text-white text-[11px] font-black uppercase tracking-widest shadow-md shadow-rose-500/30 hover:scale-[1.02] transition-transform disabled:opacity-50"
              >
                {subscribing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bell className="w-3 h-3" />}
                Enable push on this device
              </button>
            </div>
          )}

          {subs.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Active subscriptions ({subs.length})
              </p>
              <div className="space-y-1">
                {subs.map(s => (
                  <div key={s.id} className="flex items-center gap-3 p-2 bg-slate-50 rounded-xl">
                    <Smartphone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-slate-700 truncate" title={s.userAgent || ""}>
                        {s.userAgent ? simplifyUserAgent(s.userAgent) : "Browser"}
                      </p>
                      <p className="text-[9px] font-semibold text-slate-400">
                        Added {formatTime(s.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={sendTest}
                  disabled={testing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-widest hover:border-rose-300 hover:text-rose-700 transition-colors disabled:opacity-50"
                >
                  {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  Send test
                </button>
                <button
                  onClick={unsubscribeBrowser}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-rose-500 text-[10px] font-black uppercase tracking-widest hover:bg-rose-50 transition-colors"
                >
                  <BellOff className="w-3 h-3" />
                  Disable on this device
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* EMAIL */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <Mail className="w-4 h-4 text-blue-500" />
          <h2 className="text-[11px] font-black text-slate-800 uppercase tracking-widest flex-1">
            Email
          </h2>
          <Toggle
            value={prefs.emailEnabled}
            onChange={v => updatePref({ emailEnabled: v })}
          />
        </div>
        <div className="p-5 space-y-3">
          <p className="text-[11px] text-slate-500">
            Sent to <span className="font-bold text-slate-700">{session?.user?.email}</span>
          </p>
          <div>
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
              Cadence
            </label>
            <select
              value={prefs.emailCadence}
              onChange={e => updatePref({ emailCadence: e.target.value })}
              disabled={!prefs.emailEnabled}
              className="w-full text-[11px] font-bold text-slate-700 bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none disabled:opacity-50"
            >
              <option value="instant">Instant (every event)</option>
              <option value="hourly">Hourly digest</option>
              <option value="daily">Daily digest</option>
              <option value="off">Off (only urgent)</option>
            </select>
            <p className="text-[10px] text-slate-400 mt-1">
              (Phase 6 only supports instant. Hourly / daily digests come next.)
            </p>
          </div>
        </div>
      </section>

      {/* TRIGGERS */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-[11px] font-black text-slate-800 uppercase tracking-widest">
            Notify me when…
          </h2>
        </div>
        <div className="p-5 space-y-3">
          <ToggleRow
            label="A new request is captured for a client I manage"
            value={prefs.notifyOnRequest}
            onChange={v => updatePref({ notifyOnRequest: v })}
          />
          <ToggleRow
            label="A new message arrives in a Telegram group I manage"
            description="(Off by default — Telegram groups can be chatty)"
            value={prefs.notifyOnTelegram}
            onChange={v => updatePref({ notifyOnTelegram: v })}
          />
          <ToggleRow
            label="I'm @mentioned somewhere"
            value={prefs.notifyOnMention}
            onChange={v => updatePref({ notifyOnMention: v })}
          />
        </div>
      </section>

      {/* QUIET HOURS */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-[11px] font-black text-slate-800 uppercase tracking-widest">
            Quiet hours
          </h2>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-[11px] text-slate-500">
            No push notifications during this window. Email is still sent based on cadence.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                Start
              </label>
              <input
                type="time"
                value={prefs.quietStart || ""}
                onChange={e => updatePref({ quietStart: e.target.value || null })}
                className="w-full text-[11px] font-bold text-slate-700 bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none"
              />
            </div>
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                End
              </label>
              <input
                type="time"
                value={prefs.quietEnd || ""}
                onChange={e => updatePref({ quietEnd: e.target.value || null })}
                className="w-full text-[11px] font-bold text-slate-700 bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none"
              />
            </div>
          </div>
          {(prefs.quietStart || prefs.quietEnd) && (
            <button
              onClick={() => updatePref({ quietStart: null, quietEnd: null })}
              className="text-[10px] font-black text-slate-400 hover:text-rose-500 uppercase tracking-widest"
            >
              Clear quiet hours
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${value ? "bg-rose-500" : "bg-slate-200"}`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-md transition-transform ${value ? "translate-x-[18px]" : "translate-x-0.5"}`}
      />
    </button>
  );
}

function ToggleRow({ label, description, value, onChange }: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-bold text-slate-700">{label}</p>
        {description && <p className="text-[10px] text-slate-400 mt-0.5">{description}</p>}
      </div>
      <Toggle value={value} onChange={onChange} />
    </div>
  );
}

function simplifyUserAgent(ua: string): string {
  if (/iPhone|iPad/.test(ua)) return /Chrome/.test(ua) ? "Chrome on iOS" : "Safari on iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS/.test(ua)) return /Chrome/.test(ua) ? "Chrome on macOS" : "Safari on macOS";
  if (/Windows/.test(ua)) return /Edg/.test(ua) ? "Edge on Windows" : "Chrome on Windows";
  if (/Linux/.test(ua)) return "Linux browser";
  return "Browser";
}

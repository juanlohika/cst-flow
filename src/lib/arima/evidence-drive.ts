/**
 * Requirement-evidence filing for Arima.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two problems solved at once.
 *
 * 1. STORAGE. Telegram photos were being base64'd into `ArimaMessage.attachments`
 *    and kept forever. An 8 MB photo becomes ~10.7 MB of base64 text inside a
 *    SQLite row; at Turso's 9 GB that is roughly 840 photos. Drive has the space,
 *    the database does not. So bytes go to Drive and the row keeps a link —
 *    the same split `CourtesyCallEvidence` already gets right.
 *
 * 2. DISCIPLINE. Evidence has to land somewhere predictable, named so it can be
 *    found months later. The convention below mirrors the CE reports exporter
 *    (`~/tarkie-export/src/lib.js`), which earned its rules the hard way.
 *
 * FOLDER CONVENTION
 * -----------------
 *     <parent>/
 *       <Client Name>/                        ← client-scoped rooms
 *         2026-10-08 — Share of Display cap/
 *           screenshots/
 *           recordings/
 *           PROMPT.md
 *       _Internal/
 *         MOI/                                ← internal + rm-team rooms
 *           2026-10-08 — MTD auto-compute/
 *
 * The leading underscore sorts internal work above the client folders so it is
 * not lost alphabetically among them.
 *
 * THE DATE RULE
 * -------------
 * Dates are LOCAL time, never `toISOString()`. The CE exporter carries this
 * comment and it is worth repeating: toISOString() shifts to UTC, and in PH
 * (UTC+8) that silently rolls the date back a day for anything running before
 * 8 AM. A folder created at 7 AM Manila would otherwise be named for yesterday.
 */

import { Readable } from "stream";
import { db } from "@/db";
import { globalSettings } from "@/db/schema";

const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Override for where evidence is filed. Normally unset — see the default below. */
export const EVIDENCE_PARENT_KEY = "GOOGLE_DRIVE_ARIMA_EVIDENCE_FOLDER_ID";

/**
 * The "CST - ARIMA" shared drive, which Arima already uses for BRDs, proposals,
 * pin validation and pilot folders. Requirement evidence belongs alongside
 * those rather than in a folder someone has to create and wire up by hand.
 *
 * A shared-drive root id works as a parent because every Drive call here passes
 * supportsAllDrives.
 */
export const ARIMA_SHARED_DRIVE_ID = "0ADCWg-vie1aUUk9PVA";

/**
 * Evidence is filed under this folder inside the drive, so it sits beside
 * "BRD" and "Tarkie v5 CST OS" instead of scattering dated folders at the root.
 * Created on first use.
 */
export const EVIDENCE_ROOT_FOLDER = "Requirements";

interface Cfg {
  serviceAccountJson: string;
  parentFolderId: string;
}

async function loadConfig(): Promise<Cfg | null> {
  let map = new Map<string, string>();
  try {
    const rows = await db.select().from(globalSettings);
    map = new Map(rows.map((r) => [r.key, r.value ?? ""]));
  } catch {
    /* fresh DB — fall back to env */
  }
  const serviceAccountJson =
    map.get("GOOGLE_SERVICE_ACCOUNT_JSON") || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
  // Arima already owns a shared drive ("CST - ARIMA") organised by function —
  // BRD, Proposals, Store Pins Validation, Tarkie v5 CST OS. Requirement
  // evidence is another of those, so it defaults into that drive and creates a
  // "Requirements" folder on first use. Nothing to configure; the override
  // exists only for a deployment that files somewhere else.
  const parentFolderId =
    map.get(EVIDENCE_PARENT_KEY) ||
    process.env.GOOGLE_DRIVE_ARIMA_EVIDENCE_FOLDER_ID ||
    ARIMA_SHARED_DRIVE_ID;
  if (!serviceAccountJson || !parentFolderId) return null;
  return { serviceAccountJson, parentFolderId };
}

export async function evidenceDriveConfigured(): Promise<boolean> {
  return (await loadConfig()) !== null;
}

async function driveClient(cfg: Cfg) {
  const { google } = await import("googleapis");
  const credentials = JSON.parse(cfg.serviceAccountJson);
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive",
    ],
  });
  await auth.authorize();
  return { drive: google.drive({ version: "v3", auth }), credentials };
}

/**
 * Drive tolerates most characters, but `/` creates ambiguity when a path is
 * pasted into chat and the rest read badly in a URL. Mirrors `safeName()` in
 * the CE exporter, including `&` → `and`.
 */
export function sanitize(name: string): string {
  return (name || "")
    .replace(/&/g, "and")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

/**
 * Local-time YYYY-MM-DD. Never use toISOString() — see the date rule above.
 */
export function localYmd(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A short, filename-safe slug of the request title. */
export function slugForRequest(title: string): string {
  const s = sanitize(title).replace(/[.]+$/, "");
  return s.length > 48 ? s.slice(0, 48).trim() : s || "Untitled request";
}

async function findOrCreateFolder(
  drive: any,
  name: string,
  parentId: string
): Promise<{ id: string; url: string; created: boolean }> {
  const q = [
    `'${parentId}' in parents`,
    `mimeType = '${FOLDER_MIME}'`,
    `name = '${name.replace(/'/g, "\\'")}'`,
    `trashed = false`,
  ].join(" and ");
  const existing = await drive.files.list({
    q,
    fields: "files(id, webViewLink)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 1,
  });
  const hit = existing.data.files?.[0];
  if (hit?.id) return { id: hit.id, url: hit.webViewLink!, created: false };

  const made = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  return { id: made.data.id!, url: made.data.webViewLink!, created: true };
}

export interface EvidenceScope {
  /** "client" files under the client name; "internal"/"rm-team" under _Internal. */
  scopeType: "client" | "internal" | "rm-team";
  /** Client/account name. Required for client scope. */
  accountName?: string | null;
  /** Account id — last 6 chars disambiguate two same-named accounts. */
  accountId?: string | null;
  /** Internal team label, e.g. "MOI". Defaults to "MOI" for internal rooms. */
  internalLabel?: string | null;
}

/** The folder a scope files into, e.g. "Landlite Corp — a1b2c3" or "_Internal/MOI". */
function scopeFolderPath(scope: EvidenceScope): string[] {
  if (scope.scopeType === "client") {
    const base = sanitize(scope.accountName || "Unknown account");
    const suffix = scope.accountId ? ` — ${scope.accountId.slice(-6)}` : "";
    return [`${base}${suffix}`];
  }
  return ["_Internal", sanitize(scope.internalLabel || "MOI")];
}

export interface RequirementFolder {
  folderId: string;
  folderUrl: string;
  screenshotsFolderId: string;
  recordingsFolderId: string;
  /** Human-readable path for pasting into chat, e.g. "Landlite — a1b2c3 / 2026-10-08 — …". */
  displayPath: string;
  created: boolean;
}

/**
 * Find-or-create the full folder tree for one requirement. Idempotent — calling
 * it twice for the same request returns the same folders, so a second screenshot
 * lands beside the first rather than in a duplicate folder.
 *
 * Folders are only created when something is about to be filed into them, so we
 * do not litter Drive with empty directories (same rule as the CE exporter).
 */
export async function ensureRequirementFolder(args: {
  scope: EvidenceScope;
  requestTitle: string;
  date?: Date;
}): Promise<RequirementFolder> {
  const cfg = await loadConfig();
  if (!cfg) {
    // The parent always resolves (it defaults to the CST - ARIMA drive), so
    // reaching here means the service account itself is missing.
    throw new Error(
      `Google service account is not configured. Add it in Admin → Google Integration, ` +
        `and make sure that account has access to the "CST - ARIMA" shared drive.`
    );
  }
  const { drive } = await driveClient(cfg);

  // Walk down the scope path, creating as needed. "Requirements" sits at the
  // top so evidence groups beside the drive's other functional folders rather
  // than scattering account folders across its root.
  let parentId = cfg.parentFolderId;
  const segments = [EVIDENCE_ROOT_FOLDER, ...scopeFolderPath(args.scope)];
  for (const seg of segments) {
    const f = await findOrCreateFolder(drive, seg, parentId);
    parentId = f.id;
  }

  const name = `${localYmd(args.date)} — ${slugForRequest(args.requestTitle)}`;
  const req = await findOrCreateFolder(drive, name, parentId);
  const shots = await findOrCreateFolder(drive, "screenshots", req.id);
  const recs = await findOrCreateFolder(drive, "recordings", req.id);

  return {
    folderId: req.id,
    folderUrl: req.url,
    screenshotsFolderId: shots.id,
    recordingsFolderId: recs.id,
    displayPath: [...segments, name].join(" / "),
    created: req.created,
  };
}

/** `2026-10-08 1430 - 02.png` — sortable, and says when it arrived. */
export function evidenceFileName(args: {
  date?: Date;
  index: number;
  mimeType: string;
  note?: string | null;
}): string {
  const d = args.date || new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ext =
    args.mimeType === "image/jpeg"
      ? "jpg"
      : args.mimeType === "image/webp"
        ? "webp"
        : args.mimeType === "image/gif"
          ? "gif"
          : args.mimeType === "application/pdf"
            ? "pdf"
            : args.mimeType?.startsWith("video/")
              ? (args.mimeType.split("/")[1] || "mp4")
              : "png";
  const stamp = `${localYmd(d)} ${p(d.getHours())}${p(d.getMinutes())}`;
  const note = args.note ? ` - ${sanitize(args.note).slice(0, 40)}` : "";
  return `${stamp} - ${p(args.index)}${note}.${ext}`;
}

export async function uploadEvidenceFile(args: {
  folderId: string;
  buffer: Buffer;
  filename: string;
  mimeType: string;
}): Promise<{ fileId: string; webViewLink: string }> {
  const cfg = await loadConfig();
  if (!cfg) throw new Error("Arima evidence Drive is not configured.");
  const { drive } = await driveClient(cfg);
  const created = await drive.files.create({
    requestBody: { name: args.filename, parents: [args.folderId], mimeType: args.mimeType },
    media: { mimeType: args.mimeType, body: Readable.from(args.buffer) },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  return { fileId: created.data.id!, webViewLink: created.data.webViewLink! };
}

/** Write or replace PROMPT.md inside a requirement folder. */
export async function writePromptFile(args: {
  folderId: string;
  content: string;
}): Promise<{ fileId: string; webViewLink: string }> {
  const cfg = await loadConfig();
  if (!cfg) throw new Error("Arima evidence Drive is not configured.");
  const { drive } = await driveClient(cfg);

  const existing = await drive.files.list({
    q: `'${args.folderId}' in parents and name = 'PROMPT.md' and trashed = false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 1,
  });
  const hit = existing.data.files?.[0];
  const media = { mimeType: "text/markdown", body: Readable.from(Buffer.from(args.content, "utf8")) };

  if (hit?.id) {
    const updated = await drive.files.update({
      fileId: hit.id,
      media,
      fields: "id, webViewLink",
      supportsAllDrives: true,
    });
    return { fileId: updated.data.id!, webViewLink: updated.data.webViewLink! };
  }
  const created = await drive.files.create({
    requestBody: { name: "PROMPT.md", parents: [args.folderId], mimeType: "text/markdown" },
    media,
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  return { fileId: created.data.id!, webViewLink: created.data.webViewLink! };
}

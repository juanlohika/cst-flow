/**
 * Drive filing for courtesy-call evidence (the RM's invitation screenshot).
 *
 * Deliberately mirrors src/lib/pilot/drive.ts rather than inventing a fourth
 * Drive pattern: same GlobalSetting-or-env config lookup, same find-or-create
 * folder, same buffer upload. Only the config key and the naming differ.
 *
 * Folders are created LAZILY on first upload for an account, so there is no
 * separate "create the folder" action to remember or keep in sync.
 *
 * Only the resulting Drive LINK is ever stored in our database — never the
 * image bytes.
 */
import { Readable } from "stream";
import { db } from "@/db";
import { globalSettings } from "@/db/schema";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export const EVIDENCE_PARENT_KEY = "GOOGLE_DRIVE_COURTESY_PARENT_FOLDER_ID";

type Cfg = { serviceAccountJson: string; parentFolderId: string };

export async function loadCourtesyDriveConfig(): Promise<Cfg | null> {
  let map = new Map<string, string>();
  try {
    const rows = await db.select().from(globalSettings);
    map = new Map(rows.map(r => [r.key, r.value ?? ""]));
  } catch { /* fresh DB — fall back to env below */ }

  const serviceAccountJson =
    map.get("GOOGLE_SERVICE_ACCOUNT_JSON") ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    "";
  // Falls back to the pilot parent so evidence still files somewhere sane
  // before a dedicated courtesy folder is configured.
  const parentFolderId =
    map.get(EVIDENCE_PARENT_KEY) ||
    process.env.GOOGLE_DRIVE_COURTESY_PARENT_FOLDER_ID ||
    map.get("GOOGLE_DRIVE_PILOT_PARENT_FOLDER_ID") ||
    process.env.GOOGLE_DRIVE_PILOT_PARENT_FOLDER_ID ||
    "";

  if (!serviceAccountJson || !parentFolderId) return null;
  return { serviceAccountJson, parentFolderId };
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

function sanitize(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 90);
}

/**
 * Find-or-create the per-account evidence folder. Called on every upload, so a
 * missing folder is never an error state the user has to resolve.
 */
export async function ensureAccountEvidenceFolder(args: {
  accountName: string;
  accountId: string;
}): Promise<{ folderId: string; folderUrl: string; created: boolean }> {
  const cfg = await loadCourtesyDriveConfig();
  if (!cfg) {
    throw new Error(
      `Courtesy-call Drive is not configured. Set ${EVIDENCE_PARENT_KEY} in GlobalSetting ` +
      `(Admin → Settings) to the Drive folder Arima should file evidence into, and share ` +
      `that folder with the service account.`,
    );
  }
  const { drive } = await driveClient(cfg);

  // Account id suffix keeps two same-named accounts apart.
  const folderName = `${sanitize(args.accountName)} — ${args.accountId.slice(-6)}`;
  const q = [
    `'${cfg.parentFolderId}' in parents`,
    `mimeType = '${FOLDER_MIME}'`,
    `name = '${folderName.replace(/'/g, "\\'")}'`,
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
  if (hit?.id) return { folderId: hit.id, folderUrl: hit.webViewLink!, created: false };

  const created = await drive.files.create({
    requestBody: { name: folderName, mimeType: FOLDER_MIME, parents: [cfg.parentFolderId] },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  return { folderId: created.data.id!, folderUrl: created.data.webViewLink!, created: true };
}

/** `2026-08-11 Invitation - Landlite.png` — sortable, and says what it is. */
export function evidenceFileName(args: {
  date: string;            // YYYY-MM-DD
  kind: string;            // invitation | mom | other
  accountName: string;
  mimeType: string;
}) {
  const ext = args.mimeType === "image/jpeg" ? "jpg"
    : args.mimeType === "image/webp" ? "webp"
    : args.mimeType === "application/pdf" ? "pdf"
    : "png";
  const label = args.kind === "invitation" ? "Invitation"
    : args.kind === "mom" ? "MOM" : "Evidence";
  return `${args.date} ${label} - ${sanitize(args.accountName)}.${ext}`;
}

export async function uploadEvidence(args: {
  folderId: string;
  buffer: Buffer;
  filename: string;
  mimeType: string;
}): Promise<{ fileId: string; webViewLink: string }> {
  const cfg = await loadCourtesyDriveConfig();
  if (!cfg) throw new Error("Courtesy-call Drive is not configured.");
  const { drive } = await driveClient(cfg);

  const created = await drive.files.create({
    requestBody: { name: args.filename, parents: [args.folderId], mimeType: args.mimeType },
    media: { mimeType: args.mimeType, body: Readable.from(args.buffer) },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  return { fileId: created.data.id!, webViewLink: created.data.webViewLink! };
}

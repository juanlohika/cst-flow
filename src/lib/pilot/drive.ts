/**
 * Pilot Tracker — Google Drive integration.
 *
 * Two responsibilities:
 *   1. On project activation, create a per-project subfolder under the
 *      pilot parent (GlobalSetting.GOOGLE_DRIVE_PILOT_PARENT_FOLDER_ID)
 *      so participant screenshots have a stable home.
 *   2. Upload files (reference screenshots, participant version screenshots)
 *      to that subfolder and return {fileId, webViewLink} for storage.
 *
 * The parent folder must be shared with the service account (Editor) —
 * see loadPilotDriveConfig() error message for the exact fix instructions.
 *
 * Follows the pattern in src/lib/drive-export-helpers.ts and
 * src/lib/training-video/drive.ts; the auth + client factory are shared.
 */
import { Readable } from "stream";
import { db } from "@/db";
import { globalSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getDriveClient, verifyDriveFolderAccess } from "@/lib/drive-export-helpers";

interface PilotDriveConfig {
  serviceAccountJson: string;
  parentFolderId: string;
}

/**
 * Reads the service-account JSON + the pilot parent folder ID from the
 * database (falling back to env vars for local dev). Returns null if
 * either is missing — callers surface a "not configured" error at the
 * API layer rather than crashing.
 */
export async function loadPilotDriveConfig(): Promise<PilotDriveConfig | null> {
  try {
    const rows = await db.select().from(globalSettings);
    const map = new Map(rows.map((r: any) => [r.key, r.value]));
    const serviceAccountJson =
      map.get("GOOGLE_SERVICE_ACCOUNT_JSON") ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      "";
    const parentFolderId =
      map.get("GOOGLE_DRIVE_PILOT_PARENT_FOLDER_ID") ||
      process.env.GOOGLE_DRIVE_PILOT_PARENT_FOLDER_ID ||
      "";
    if (!serviceAccountJson || !parentFolderId) return null;
    return { serviceAccountJson, parentFolderId };
  } catch {
    return null;
  }
}

/**
 * Create (or return existing) a per-project subfolder under the pilot
 * parent folder. Idempotent: if a folder with the same name already
 * exists under the parent, we return that instead of creating a duplicate.
 *
 * The name is a stable slug derived from the pilot project name so
 * humans browsing Drive can find "Sepco CE V5 Pilot" without needing the
 * project ID.
 */
export async function ensurePilotProjectFolder(
  projectName: string,
  projectId: string,
): Promise<{ folderId: string; folderUrl: string }> {
  const cfg = await loadPilotDriveConfig();
  if (!cfg) {
    throw new Error(
      "Pilot Drive not configured. Set GOOGLE_DRIVE_PILOT_PARENT_FOLDER_ID in GlobalSetting.",
    );
  }
  const { drive, credentials } = await getDriveClient({
    serviceAccountJson: cfg.serviceAccountJson,
    driveFolderId: cfg.parentFolderId,
  });
  await verifyDriveFolderAccess(drive, cfg.parentFolderId, credentials.client_email);

  const folderName = `${sanitizeFolderName(projectName)} — ${projectId.slice(0, 8)}`;

  // Look for an existing folder with this exact name under the parent.
  // supportsAllDrives + includeItemsFromAllDrives handle Shared Drive folders.
  const q = [
    `'${cfg.parentFolderId}' in parents`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    `name = '${folderName.replace(/'/g, "\\'")}'`,
    `trashed = false`,
  ].join(" and ");
  const existing = await drive.files.list({
    q,
    fields: "files(id, webViewLink)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (existing.data.files && existing.data.files.length > 0) {
    const f = existing.data.files[0];
    return { folderId: f.id!, folderUrl: f.webViewLink! };
  }

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [cfg.parentFolderId],
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  return {
    folderId: created.data.id!,
    folderUrl: created.data.webViewLink!,
  };
}

/**
 * Upload a raw image buffer to the given Drive folder. Returns the file's
 * Drive ID + `webViewLink` (open in Drive) + `webContentLink` (direct-ish).
 *
 * `filename` should include the extension. Common mime types accepted:
 *   image/png, image/jpeg, image/webp.
 */
export async function uploadScreenshotToDrive(args: {
  folderId: string;
  buffer: Buffer;
  filename: string;
  mimeType: string;
}): Promise<{ fileId: string; webViewLink: string; webContentLink: string }> {
  const cfg = await loadPilotDriveConfig();
  if (!cfg) {
    throw new Error("Pilot Drive not configured.");
  }
  const { drive } = await getDriveClient({
    serviceAccountJson: cfg.serviceAccountJson,
    driveFolderId: cfg.parentFolderId,
  });

  // Convert Buffer to a Readable stream — googleapis wants it as media.body.
  const stream = Readable.from(args.buffer);
  const created = await drive.files.create({
    requestBody: {
      name: args.filename,
      parents: [args.folderId],
      mimeType: args.mimeType,
    },
    media: {
      mimeType: args.mimeType,
      body: stream,
    },
    fields: "id, webViewLink, webContentLink",
    supportsAllDrives: true,
  });
  return {
    fileId: created.data.id!,
    webViewLink: created.data.webViewLink!,
    webContentLink: created.data.webContentLink!,
  };
}

/**
 * Delete a file by Drive ID. Used when a participant re-uploads a
 * screenshot and we want to garbage-collect the stale one so the folder
 * doesn't accumulate cruft. Best-effort — swallows errors silently
 * because the DB reference has already been overwritten by the caller.
 */
export async function deleteDriveFile(fileId: string): Promise<void> {
  try {
    const cfg = await loadPilotDriveConfig();
    if (!cfg) return;
    const { drive } = await getDriveClient({
      serviceAccountJson: cfg.serviceAccountJson,
      driveFolderId: cfg.parentFolderId,
    });
    await drive.files.delete({ fileId, supportsAllDrives: true });
  } catch (e) {
    console.warn("[pilot/drive] deleteDriveFile failed:", e);
  }
}

/**
 * Strip characters Drive doesn't allow in folder names + collapse spaces.
 * Not comprehensive — Drive is fairly permissive — but avoids the common
 * failure modes (slashes, control chars).
 */
function sanitizeFolderName(name: string): string {
  return name
    .replace(/[\/\\<>:"|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

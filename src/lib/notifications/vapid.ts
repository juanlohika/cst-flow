import webpush from "web-push";
import { db } from "@/db";
import { globalSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * VAPID keys are the cryptographic identity of THIS server when sending push
 * notifications via the Web Push protocol. Browsers use them to verify that
 * the push came from our server.
 *
 * - Generated once and persisted to globalSettings.
 * - The public key is shared with the browser (for subscribe).
 * - The private key stays server-side only.
 */

const VAPID_PUBLIC_KEY = "vapidPublicKey";
const VAPID_PRIVATE_KEY = "vapidPrivateKey";
const VAPID_SUBJECT_KEY = "vapidSubject";

async function readSetting(key: string): Promise<string | null> {
  try {
    const rows = await db
      .select({ value: globalSettings.value })
      .from(globalSettings)
      .where(eq(globalSettings.key, key))
      .limit(1);
    return rows[0]?.value || null;
  } catch {
    return null;
  }
}

async function writeSetting(key: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(globalSettings)
    .values({
      id: `gs_${key}`,
      key,
      value,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: globalSettings.key,
      set: { value, updatedAt: now },
    });
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * Returns the VAPID keys, generating them on first use.
 * The subject defaults to `mailto:no-reply@cstflow.app` but can be overridden via env.
 */
export async function getOrCreateVapidKeys(): Promise<VapidConfig> {
  let publicKey = await readSetting(VAPID_PUBLIC_KEY);
  let privateKey = await readSetting(VAPID_PRIVATE_KEY);
  let subject = await readSetting(VAPID_SUBJECT_KEY);

  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    await writeSetting(VAPID_PUBLIC_KEY, publicKey);
    await writeSetting(VAPID_PRIVATE_KEY, privateKey);
  }

  if (!subject) {
    subject = process.env.VAPID_SUBJECT || "mailto:no-reply@cstflow.app";
    await writeSetting(VAPID_SUBJECT_KEY, subject);
  }

  return { publicKey, privateKey, subject };
}

/** Configure web-push with the persistent VAPID keys. Safe to call repeatedly. */
export async function configureWebPush(): Promise<VapidConfig> {
  const config = await getOrCreateVapidKeys();
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return config;
}

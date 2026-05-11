import { db } from "@/db";
import { globalSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const TG_TOKEN_KEY = "telegramBotToken";
const TG_SECRET_KEY = "telegramWebhookSecret";
const TG_BOT_USERNAME_KEY = "telegramBotUsername";

export interface TelegramConfig {
  botToken: string;
  webhookSecret: string;
  botUsername: string;
}

async function readSetting(key: string): Promise<string | null> {
  try {
    const rows = await db
      .select({ value: globalSettings.value })
      .from(globalSettings)
      .where(eq(globalSettings.key, key))
      .limit(1);
    return rows[0]?.value || null;
  } catch (e) {
    console.warn(`[telegram/config] readSetting ${key} failed:`, e);
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

export async function getTelegramConfig(): Promise<TelegramConfig> {
  const [token, secret, username] = await Promise.all([
    readSetting(TG_TOKEN_KEY),
    readSetting(TG_SECRET_KEY),
    readSetting(TG_BOT_USERNAME_KEY),
  ]);
  return {
    botToken: token || "",
    webhookSecret: secret || "",
    botUsername: username || "",
  };
}

export async function setTelegramBotToken(token: string): Promise<void> {
  await writeSetting(TG_TOKEN_KEY, token);
  // Always rotate the webhook secret when the token changes
  const newSecret = crypto.randomBytes(24).toString("hex");
  await writeSetting(TG_SECRET_KEY, newSecret);
}

export async function setTelegramBotUsername(username: string): Promise<void> {
  await writeSetting(TG_BOT_USERNAME_KEY, username);
}

export async function ensureWebhookSecret(): Promise<string> {
  const existing = await readSetting(TG_SECRET_KEY);
  if (existing) return existing;
  const fresh = crypto.randomBytes(24).toString("hex");
  await writeSetting(TG_SECRET_KEY, fresh);
  return fresh;
}

export async function clearTelegramConfig(): Promise<void> {
  await db.delete(globalSettings).where(eq(globalSettings.key, TG_TOKEN_KEY));
  await db.delete(globalSettings).where(eq(globalSettings.key, TG_SECRET_KEY));
  await db.delete(globalSettings).where(eq(globalSettings.key, TG_BOT_USERNAME_KEY));
}

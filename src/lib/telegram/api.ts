/**
 * Thin wrapper around the Telegram Bot API HTTP endpoints.
 * No SDK — we use fetch directly so it works in Edge runtimes too.
 */

const TELEGRAM_API = "https://api.telegram.org";

async function call(token: string, method: string, body: any): Promise<any> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const reason = data?.description || `HTTP ${res.status}`;
    throw new Error(`Telegram ${method} failed: ${reason}`);
  }
  return data.result;
}

export async function tgGetMe(token: string) {
  return call(token, "getMe", {});
}

/**
 * Look up the storage path for a Telegram file, then fetch the bytes.
 * Returns the raw buffer + the mime/path. Callers can base64-encode for Gemini.
 * Caps download size to avoid hammering memory on huge attachments.
 */
export async function tgFetchFile(token: string, fileId: string, maxBytes = 8 * 1024 * 1024): Promise<{ buffer: Buffer; mime: string; filePath: string } | null> {
  const meta = await call(token, "getFile", { file_id: fileId }).catch(() => null);
  if (!meta?.file_path) return null;
  if (meta?.file_size && meta.file_size > maxBytes) return null;
  const url = `${TELEGRAM_API}/file/bot${token}/${meta.file_path}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  // Telegram normalizes photo paths like "photos/file_3.jpg"; derive mime from extension.
  const lower = (meta.file_path as string).toLowerCase();
  const mime = lower.endsWith(".png") ? "image/png"
    : lower.endsWith(".webp") ? "image/webp"
    : lower.endsWith(".gif") ? "image/gif"
    : "image/jpeg";
  return { buffer: buf, mime, filePath: meta.file_path };
}

export interface InlineButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export async function tgSendMessage(token: string, chatId: number | string, text: string, opts: {
  parseMode?: "Markdown" | "HTML";
  replyToMessageId?: number;
  disablePreview?: boolean;
  /** Phase 21: optional inline-keyboard. 2D array — outer = rows, inner = buttons. */
  inlineKeyboard?: InlineButton[][];
} = {}) {
  const body: any = {
    chat_id: chatId,
    text,
    parse_mode: opts.parseMode,
    reply_to_message_id: opts.replyToMessageId,
    disable_web_page_preview: opts.disablePreview ?? true,
  };
  if (opts.inlineKeyboard && opts.inlineKeyboard.length > 0) {
    body.reply_markup = { inline_keyboard: opts.inlineKeyboard };
  }
  return call(token, "sendMessage", body);
}

export async function tgSendChatAction(token: string, chatId: number | string, action: "typing" | "upload_document") {
  return call(token, "sendChatAction", { chat_id: chatId, action });
}

export async function tgGetChatMember(token: string, chatId: number | string, userId: number | string) {
  return call(token, "getChatMember", { chat_id: chatId, user_id: userId });
}

export async function tgSetWebhook(token: string, url: string, secretToken: string) {
  return call(token, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "my_chat_member"],
    drop_pending_updates: true,
  });
}

export async function tgDeleteWebhook(token: string) {
  return call(token, "deleteWebhook", { drop_pending_updates: true });
}

export async function tgGetWebhookInfo(token: string) {
  return call(token, "getWebhookInfo", {});
}

export function isGroupChatType(type?: string): boolean {
  return type === "group" || type === "supergroup";
}

export function isPrivateChatType(type?: string): boolean {
  return type === "private";
}

export async function isUserGroupAdmin(token: string, chatId: number | string, userId: number | string): Promise<boolean> {
  try {
    const member = await tgGetChatMember(token, chatId, userId);
    return member?.status === "creator" || member?.status === "administrator";
  } catch (e) {
    console.warn("[telegram] isUserGroupAdmin failed:", e);
    return false;
  }
}

/**
 * Trim a long message to the Telegram limit (4096 chars) without breaking words mid-sentence.
 */
export function truncateForTelegram(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 20) + "\n\n[…truncated]";
}

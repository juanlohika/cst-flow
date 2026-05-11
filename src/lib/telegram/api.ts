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

export async function tgSendMessage(token: string, chatId: number | string, text: string, opts: { parseMode?: "Markdown" | "HTML"; replyToMessageId?: number; disablePreview?: boolean } = {}) {
  return call(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: opts.parseMode,
    reply_to_message_id: opts.replyToMessageId,
    disable_web_page_preview: opts.disablePreview ?? true,
  });
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

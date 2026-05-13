/**
 * In-process pub/sub for portal SSE listeners.
 *
 * Each portal page mounts an EventSource on /api/portal/chat/stream. The server
 * registers a per-connection subscriber that holds the conversationId it cares
 * about. When the chat route (or the Telegram bridge) inserts a new message,
 * it calls broadcastToConversation() to nudge every listener of that thread
 * with a `{ type: "refresh" }` event — the client then refetches.
 *
 * This is single-process, which is fine on Firebase App Hosting (each instance
 * owns its set of connections). When a Telegram message is bridged from a
 * different instance, the client picks it up on the next poll-fallback refresh
 * (a 30s heartbeat keeps the connection warm and acts as a worst-case backstop).
 */

type Subscriber = {
  conversationId: string;
  clientProfileId: string;
  send: (event: string, data: unknown) => void;
};

const subscribers = new Set<Subscriber>();

export function subscribe(sub: Subscriber): () => void {
  subscribers.add(sub);
  return () => subscribers.delete(sub);
}

export function broadcastToConversation(conversationId: string, payload: unknown): void {
  Array.from(subscribers).forEach(sub => {
    if (sub.conversationId !== conversationId) return;
    try { sub.send("message", payload); } catch {}
  });
}

/**
 * Broadcast to every portal listener whose conversation belongs to the same
 * client account. Used when a Telegram-side message lands in a bound group —
 * portal viewers for that client should refresh and see the new message.
 */
export function broadcastToClient(clientProfileId: string, payload: unknown): void {
  Array.from(subscribers).forEach(sub => {
    if (sub.clientProfileId !== clientProfileId) return;
    try { sub.send("message", payload); } catch {}
  });
}

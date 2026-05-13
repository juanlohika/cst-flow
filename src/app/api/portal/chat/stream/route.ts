import { db } from "@/db";
import { arimaConversations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getPortalSession } from "@/lib/portal/auth";
import { subscribe } from "@/lib/portal/stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/portal/chat/stream
 * Server-Sent Events: pushes `{ type: "refresh" }` whenever a new message lands
 * in this portal contact's conversation. The client re-fetches the message list.
 */
export async function GET() {
  const portal = await getPortalSession();
  if (!portal) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Resolve the portal conversation up front so we can scope subscribers tightly.
  const existing = await db
    .select({ id: arimaConversations.id })
    .from(arimaConversations)
    .where(and(
      eq(arimaConversations.channel, "portal"),
      eq(arimaConversations.title, `portal:${portal.contactId}`)
    ))
    .limit(1);

  const conversationId = existing[0]?.id || null;
  if (!conversationId) {
    return new Response("No conversation yet", { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      send("hello", { conversationId });

      const unsubscribe = subscribe({ conversationId, clientProfileId: portal.clientProfileId, send });

      // 25s heartbeat — keeps the connection warm and is a backstop for cases
      // where a Telegram-side message was inserted on a different server instance.
      const ping = setInterval(() => send("ping", { t: Date.now() }), 25000);

      const close = () => {
        clearInterval(ping);
        unsubscribe();
        try { controller.close(); } catch {}
      };

      // Best-effort cleanup if the underlying request aborts
      (globalThis as any).addEventListener?.("close", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

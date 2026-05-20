import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { proposals, clientProfiles, users as usersTable } from "@/db/schema";
import { eq, desc, like } from "drizzle-orm";
import { ensureAccessSchema, canAccessClient, listAccessibleClientIds } from "@/lib/access/accounts";
import { runChatTurn, type ChatMessage, type ImageAttachment } from "@/lib/proposal/build-content";
import type { ProposalContent } from "@/lib/proposal/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/proposal-maker/chat
 *
 * One conversational turn. Body:
 *   {
 *     proposalId?: string,        // null/undefined = start a new conversation
 *     message: string,
 *     attachments?: Array<{ mimeType: string, data: string, name?: string }>,
 *   }
 *
 * Behavior:
 *   - If proposalId is missing, we don't yet know which account this is for.
 *     ARIMA will either infer it from the message ("draft for MX...") via
 *     inferredClientName, or ask the user to specify. Once we have an account
 *     id, we create the Proposal row.
 *   - If proposalId exists, we load its history + current content and append.
 *   - If the AI returned an inferredClientName, we look up the user's
 *     accessible accounts and try to match. On match, we create the proposal
 *     row and re-run the turn so the AI sees account context.
 *   - On every turn we persist {messages, sourceInputs} so the conversation
 *     can be resumed from /proposal-maker/<id>.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();
    const isAdmin = (session.user as any).role === "admin";
    const userId = session.user.id;

    const body = await req.json().catch(() => ({}));
    const message = String(body?.message || "").trim();
    const attachments: ImageAttachment[] = Array.isArray(body?.attachments) ? body.attachments.map((a: any) => ({
      mimeType: String(a?.mimeType || "image/png"),
      data: String(a?.data || ""),
      name: a?.name ? String(a.name) : undefined,
    })).filter(a => a.data) : [];
    const proposalId = body?.proposalId ? String(body.proposalId) : null;

    if (!message && attachments.length === 0) {
      return NextResponse.json({ error: "message or attachments required" }, { status: 400 });
    }

    // Preparer name for the AI's MOI signatory default
    const preparerRows = await db.select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    const preparedByName = preparerRows[0]?.name || preparerRows[0]?.email || "Tarkie team";

    // Load existing proposal if any
    let proposal: any = null;
    let history: ChatMessage[] = [];
    let currentContent: ProposalContent | null = null;
    let account: { id: string; companyName: string } | null = null;

    if (proposalId) {
      const rows = await db.select().from(proposals).where(eq(proposals.id, proposalId)).limit(1);
      proposal = rows[0];
      if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
      const allowed = await canAccessClient({ userId, isAdmin }, proposal.clientProfileId);
      if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

      try { history = JSON.parse(proposal.messages || "[]"); } catch {}
      try { currentContent = proposal.sourceInputs ? JSON.parse(proposal.sourceInputs) : null; } catch {}
      const acctRows = await db.select({ id: clientProfiles.id, companyName: clientProfiles.companyName })
        .from(clientProfiles).where(eq(clientProfiles.id, proposal.clientProfileId)).limit(1);
      if (acctRows[0]) account = { id: acctRows[0].id, companyName: acctRows[0].companyName };
    }

    // First chat turn
    const turn = await runChatTurn({
      history,
      userMessage: message,
      attachments,
      currentContent,
      account,
      preparedByName,
    });
    if (!turn.ok) return NextResponse.json({ error: turn.error, rawAi: (turn as any).rawAi }, { status: 500 });

    let { reply, updatedContent, inferredClientName } = turn.result;

    // If we don't have an account yet but the AI inferred a name, try to find a matching one.
    if (!account && inferredClientName) {
      const match = await findAccessibleAccountByName(userId, isAdmin, inferredClientName);
      if (match) {
        account = match;
        // Re-run with account context so the AI can produce a proper draft this turn.
        const retry = await runChatTurn({
          history,
          userMessage: message,
          attachments,
          currentContent,
          account,
          preparedByName,
        });
        if (retry.ok) {
          reply = retry.result.reply;
          updatedContent = retry.result.updatedContent;
        }
      } else {
        // AI guessed an account name we can't find. Override the AI reply
        // with a clarifying message instead of returning the AI's hallucinated text.
        reply = `I tried to find an account matching "${inferredClientName}" but couldn't. Which account is this for? You can paste the company name as it appears in CST OS.`;
      }
    }

    // Build the new message history
    const userTurnMsg: ChatMessage = {
      role: "user",
      content: message,
      attachmentNames: attachments.length > 0 ? attachments.map(a => a.name || "image").filter(Boolean) as string[] : undefined,
    };
    const assistantTurnMsg: ChatMessage = { role: "assistant", content: reply };
    const newHistory = [...history, userTurnMsg, assistantTurnMsg];

    // Persist — create the row if needed
    if (!proposal && account) {
      // Compute next version number for this account
      const prior = await db.select({ versionNumber: proposals.versionNumber })
        .from(proposals)
        .where(eq(proposals.clientProfileId, account.id))
        .orderBy(desc(proposals.versionNumber))
        .limit(1);
      const versionNumber = (prior[0]?.versionNumber || 0) + 1;

      const newId = `prop_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      const title = updatedContent?.title || "Proposal Draft";
      await db.insert(proposals).values({
        id: newId,
        clientProfileId: account.id,
        title,
        versionNumber,
        sourceInputs: updatedContent ? JSON.stringify(updatedContent) : null,
        messages: JSON.stringify(newHistory),
        status: "draft",
        generatedBy: userId,
      });
      proposal = { id: newId, clientProfileId: account.id, title, versionNumber };
    } else if (proposal) {
      // Update existing row
      const updates: any = { messages: JSON.stringify(newHistory) };
      if (updatedContent) {
        updates.sourceInputs = JSON.stringify(updatedContent);
        if (updatedContent.title && updatedContent.title !== proposal.title) {
          updates.title = updatedContent.title;
        }
      }
      await db.update(proposals).set(updates).where(eq(proposals.id, proposal.id));
    }
    // (If no account and no proposal, we don't persist — the conversation is
    //  ephemeral until ARIMA pins down the account. Next turn the user might
    //  name it.)

    return NextResponse.json({
      proposalId: proposal?.id || null,
      reply,
      updatedContent: updatedContent || currentContent || null,
      accountResolved: !!account,
      accountName: account?.companyName || null,
    });
  } catch (error: any) {
    console.error("[proposal-maker/chat POST]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}

/**
 * Look up a client profile by partial company name match, restricted to the
 * user's accessible accounts.
 */
async function findAccessibleAccountByName(userId: string, isAdmin: boolean, name: string): Promise<{ id: string; companyName: string } | null> {
  const cleaned = name.trim();
  if (!cleaned) return null;

  // Get accessible IDs (admins: null = all; non-admin: array)
  const accessibleIds = await listAccessibleClientIds({ userId, isAdmin });

  // Try exact match first, then partial.
  const rows = await db.select({ id: clientProfiles.id, companyName: clientProfiles.companyName })
    .from(clientProfiles)
    .where(like(clientProfiles.companyName, `%${cleaned}%`));
  const candidates = rows.filter(r => accessibleIds === null || accessibleIds.includes(r.id));

  // Prefer exact match
  const exact = candidates.find(c => c.companyName.toLowerCase() === cleaned.toLowerCase());
  if (exact) return { id: exact.id, companyName: exact.companyName };
  if (candidates.length === 1) return { id: candidates[0].id, companyName: candidates[0].companyName };
  // Multiple matches → don't auto-pick (ambiguous)
  return null;
}

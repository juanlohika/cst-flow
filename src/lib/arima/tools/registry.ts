/**
 * Tool registry: the canonical list of tools ARIMA can call.
 *
 * Each tool has:
 *   - name: function name the AI will see
 *   - category: read | write | external (affects default autonomy)
 *   - description: shown to the AI to help it decide when to call
 *   - inputSchema: JSON schema for the params the AI must supply
 *   - defaultEnabled: ship enabled? (read tools yes; write tools depend; external no)
 *   - defaultAutonomy: auto | approval | disabled
 *   - handler: the function that actually runs
 *
 * The DB row controls `enabled` + `autonomy` at runtime (admin can override).
 * The handler always lives in code (security: AI can't add new tools).
 */

import { db } from "@/db";
import { arimaTools, arimaToolInvocations } from "@/db/schema";
import { eq } from "drizzle-orm";

export type ToolCategory = "read" | "write" | "external";
export type ToolAutonomy = "auto" | "approval" | "disabled";

export interface ToolContext {
  /** Conversation the tool was called from */
  conversationId: string;
  /** CST OS user id OR ClientContact id (for portal calls) */
  userId: string;
  /** Client account this conversation is scoped to (null if unscoped) */
  clientProfileId: string | null;
  /** "web" | "telegram" | "portal" */
  channel: string;
}

export interface ToolResult {
  ok: boolean;
  data?: any;
  error?: string;
  /** Pretty short summary for the AI to read back to the user */
  summary?: string;
}

export interface ToolDefinition {
  name: string;
  category: ToolCategory;
  description: string;
  inputSchema: any;                       // JSON Schema
  defaultEnabled: boolean;
  defaultAutonomy: ToolAutonomy;
  handler: (input: any, ctx: ToolContext) => Promise<ToolResult>;
}

// ─── Registry ─────────────────────────────────────────────────────────────

const _registry = new Map<string, ToolDefinition>();

export function registerTool(def: ToolDefinition): void {
  _registry.set(def.name, def);
}

export function getRegisteredTool(name: string): ToolDefinition | undefined {
  return _registry.get(name);
}

export function listRegisteredTools(): ToolDefinition[] {
  return Array.from(_registry.values());
}

// ─── DB seeding ──────────────────────────────────────────────────────────

/**
 * Upsert every registered tool into the DB so admins can manage it via the UI.
 * Existing rows keep their `enabled` and `autonomy` settings (admin choices win).
 * Only `description` and `inputSchema` are refreshed from code on each call —
 * because those describe the actual function in code.
 */
export async function seedToolRegistry(): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  const now = new Date().toISOString();

  for (const t of listRegisteredTools()) {
    const existing = await db
      .select({ id: arimaTools.id })
      .from(arimaTools)
      .where(eq(arimaTools.name, t.name))
      .limit(1);

    if (existing[0]) {
      await db
        .update(arimaTools)
        .set({
          category: t.category,
          description: t.description,
          inputSchema: JSON.stringify(t.inputSchema),
          isBuiltIn: true,
          updatedAt: now,
        })
        .where(eq(arimaTools.id, existing[0].id));
      updated++;
    } else {
      await db.insert(arimaTools).values({
        id: `tool_${t.name}`,
        name: t.name,
        category: t.category,
        description: t.description,
        inputSchema: JSON.stringify(t.inputSchema),
        enabled: t.defaultEnabled,
        autonomy: t.defaultAutonomy,
        isBuiltIn: true,
        createdAt: now,
        updatedAt: now,
      });
      created++;
    }
  }

  return { created, updated };
}

// ─── Tool resolution + execution ────────────────────────────────────────

/**
 * Returns the active set of tools for the AI, filtered by the DB's enabled flag.
 * If autonomy is "approval", the tool is still presented to the AI but execution
 * will be queued — caller decides how to handle the proposed call.
 */
export async function getActiveTools(): Promise<Array<{
  def: ToolDefinition;
  enabled: boolean;
  autonomy: ToolAutonomy;
}>> {
  const rows = await db.select().from(arimaTools);
  const byName = new Map<string, { enabled: boolean; autonomy: ToolAutonomy }>();
  for (const r of rows) {
    byName.set(r.name, { enabled: r.enabled, autonomy: r.autonomy as ToolAutonomy });
  }
  return listRegisteredTools().map(def => {
    const row = byName.get(def.name);
    return {
      def,
      enabled: row?.enabled ?? def.defaultEnabled,
      autonomy: row?.autonomy ?? def.defaultAutonomy,
    };
  }).filter(t => t.enabled);
}

/**
 * Execute a tool by name. Logs every invocation (success or failure) to
 * ArimaToolInvocation. If the tool's autonomy is "approval", the call is
 * queued (status="pending", approvalNeeded=true) and NOT actually run.
 */
export async function executeTool(args: {
  name: string;
  input: any;
  context: ToolContext;
}): Promise<ToolResult & { invocationId: string; queuedForApproval?: boolean }> {
  const invocationId = `tinv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  const startTime = Date.now();

  // Look up the live config + the registered handler
  const rows = await db
    .select({ enabled: arimaTools.enabled, autonomy: arimaTools.autonomy })
    .from(arimaTools)
    .where(eq(arimaTools.name, args.name))
    .limit(1);

  const live = rows[0];
  const def = getRegisteredTool(args.name);

  // Tool isn't registered in code → reject
  if (!def) {
    await logInvocation({
      id: invocationId, toolName: args.name, ctx: args.context, input: args.input,
      status: "failed", errorMessage: "Tool not registered in code", createdAt: now,
    });
    return { ok: false, error: "Unknown tool: " + args.name, invocationId };
  }

  // Tool exists in code but disabled in DB
  const enabled = live?.enabled ?? def.defaultEnabled;
  const autonomy = (live?.autonomy ?? def.defaultAutonomy) as ToolAutonomy;
  if (!enabled || autonomy === "disabled") {
    await logInvocation({
      id: invocationId, toolName: args.name, ctx: args.context, input: args.input,
      status: "denied", errorMessage: "Tool disabled by admin", createdAt: now,
    });
    return { ok: false, error: "This tool is currently disabled by an admin.", invocationId };
  }

  // Approval-required tool → queue and return.
  // IMPORTANT: ok:false so the AI doesn't claim the action was completed.
  // We give it a clear, actionable description so it tells the user the truth.
  if (autonomy === "approval") {
    await logInvocation({
      id: invocationId, toolName: args.name, ctx: args.context, input: args.input,
      status: "pending", approvalNeeded: true, createdAt: now,
    });
    return {
      ok: false,
      data: { queued: true, awaitingApproval: true },
      error: "This action requires a human admin to approve before it runs. Tell the user you've logged the request and a teammate will confirm shortly. Do NOT say the action was completed.",
      summary: "Queued for human approval — not executed yet.",
      invocationId,
      queuedForApproval: true,
    };
  }

  // Auto-execute
  try {
    const result = await def.handler(args.input, args.context);
    const duration = Date.now() - startTime;
    await logInvocation({
      id: invocationId, toolName: args.name, ctx: args.context, input: args.input,
      output: result.data, status: result.ok ? "executed" : "failed",
      errorMessage: result.error || null, durationMs: duration, createdAt: now, executedAt: new Date().toISOString(),
    });
    return { ...result, invocationId };
  } catch (e: any) {
    const duration = Date.now() - startTime;
    await logInvocation({
      id: invocationId, toolName: args.name, ctx: args.context, input: args.input,
      status: "failed", errorMessage: e?.message || "Tool threw an error", durationMs: duration, createdAt: now,
    });
    return { ok: false, error: e?.message || "Tool execution failed", invocationId };
  }
}

async function logInvocation(args: {
  id: string;
  toolName: string;
  ctx: ToolContext;
  input?: any;
  output?: any;
  status: string;
  approvalNeeded?: boolean;
  errorMessage?: string | null;
  durationMs?: number;
  createdAt: string;
  executedAt?: string;
}): Promise<void> {
  try {
    await db.insert(arimaToolInvocations).values({
      id: args.id,
      toolName: args.toolName,
      conversationId: args.ctx.conversationId || null,
      userId: args.ctx.userId || null,
      clientProfileId: args.ctx.clientProfileId || null,
      input: args.input ? JSON.stringify(args.input) : null,
      output: args.output ? JSON.stringify(args.output) : null,
      status: args.status,
      approvalNeeded: args.approvalNeeded ?? false,
      errorMessage: args.errorMessage || null,
      durationMs: args.durationMs || null,
      createdAt: args.createdAt,
      executedAt: args.executedAt || null,
    });
  } catch (e) {
    console.warn("[arima/tools] failed to log invocation:", e);
  }
}

/**
 * Convert the active tool list into Gemini's function-calling format.
 * Gemini expects: { functionDeclarations: [{ name, description, parameters }] }
 */
export async function buildGeminiTools(): Promise<any[] | undefined> {
  const tools = await getActiveTools();
  if (tools.length === 0) return undefined;
  return [{
    functionDeclarations: tools.map(t => ({
      name: t.def.name,
      description: t.def.description,
      parameters: t.def.inputSchema,
    })),
  }];
}

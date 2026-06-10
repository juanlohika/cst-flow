import { db } from "@/db";
import {
  clientProfiles as clientProfilesTable,
  accountMemberships as membershipsTable,
} from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import crypto from "crypto";

/**
 * Idempotent self-healing: makes sure the AccountMembership table and the
 * new ClientProfile columns (clientCode, accessToken) exist in the live DB.
 * Safe to call on every request — SQLite ignores re-adds of existing columns.
 *
 * This is the safety net so the access-control routes don't 500 when a fresh
 * deploy lands before the admin runs /api/auth/config.
 */
// In-memory flag so we only attempt the schema work once per process (per
// serverless instance). Each invocation does no-op ALTERs if columns exist.
let _schemaEnsuredAt = 0;

/**
 * Phase E.9 — SQLite can't ALTER a column to remove NOT NULL. To relax
 * nullability we rebuild the table: create the new shape, copy data, drop
 * the old, rename. This helper does that idempotently — if the named column
 * already accepts NULL, it's a no-op.
 */
async function rebuildIfNotNull(
  tableName: string,
  columnName: string,
  createNewTableSql: any,
  copyDataSql: any,
  postSetupSqls: any[] = [],
): Promise<void> {
  try {
    const probe = await db.run(sql.raw(`PRAGMA table_info(${tableName})`)) as any;
    const cols = Array.isArray(probe?.rows) ? probe.rows : (Array.isArray(probe) ? probe : []);
    const col = cols.find((c: any) => (c.name ?? c[1]) === columnName);
    const isNotNull = col && (col.notnull ?? col[3]) === 1;
    if (!isNotNull) return;
    await db.run(createNewTableSql);
    await db.run(copyDataSql);
    await db.run(sql.raw(`DROP TABLE ${tableName}`));
    await db.run(sql.raw(`ALTER TABLE ${tableName}_new RENAME TO ${tableName}`));
    for (const s of postSetupSqls) {
      try { await db.run(s); } catch {}
    }
    console.log(`[ensureAccessSchema] ${tableName} rebuilt — ${columnName} now nullable`);
  } catch (e) {
    console.warn(`[ensureAccessSchema] ${tableName} nullable rebuild failed:`, e);
  }
}

export async function ensureAccessSchema(): Promise<void> {
  // Re-attempt at most every 60s in case a previous attempt failed and we want to retry
  if (Date.now() - _schemaEnsuredAt < 60_000) return;
  try {
    // Create AccountMembership table if missing
    await db.run(sql`CREATE TABLE IF NOT EXISTS AccountMembership (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      clientProfileId TEXT NOT NULL,
      role TEXT DEFAULT 'member' NOT NULL,
      grantedBy TEXT,
      grantedAt TEXT DEFAULT (datetime('now')) NOT NULL,
      UNIQUE(userId, clientProfileId)
    )`);

    // Add clientCode + accessToken to ClientProfile if missing.
    // ALTER ... ADD COLUMN throws if the column already exists, so each is wrapped.
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN clientCode TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN accessToken TEXT`); } catch {}
    // Phase 12: typed internal-role + primary flag on AccountMembership
    try { await db.run(sql`ALTER TABLE AccountMembership ADD COLUMN internalRole TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE AccountMembership ADD COLUMN isPrimary INTEGER DEFAULT 0 NOT NULL`); } catch {}
    // Phase 13: sender attribution + attachments + mentions on every message
    try { await db.run(sql`ALTER TABLE ArimaMessage ADD COLUMN senderType TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaMessage ADD COLUMN senderUserId TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaMessage ADD COLUMN senderName TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaMessage ADD COLUMN senderChannel TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaMessage ADD COLUMN mentions TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaMessage ADD COLUMN attachments TEXT`); } catch {}
    // Phase 20: agentMode on bindings — which agent leads this room (arima or eliana)
    try { await db.run(sql`ALTER TABLE ArimaChannelBinding ADD COLUMN agentMode TEXT DEFAULT 'arima' NOT NULL`); } catch {}
    // Phase 22: Eliana BRD documents — full polished BRD as markdown + Google Doc link
    try { await db.run(sql`ALTER TABLE ArimaRequest ADD COLUMN brdDocument TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaRequest ADD COLUMN brdGeneratedAt TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaRequest ADD COLUMN brdGoogleDocId TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaRequest ADD COLUMN brdGoogleDocUrl TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaRequest ADD COLUMN brdGoogleDocSyncedAt TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaRequest ADD COLUMN brdStatus TEXT DEFAULT 'captured' NOT NULL`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaRequest ADD COLUMN brdError TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaRequest ADD COLUMN brdExportLog TEXT`); } catch {}
    // Phase 22.3: dual Word/PDF Drive output
    try { await db.run(sql`ALTER TABLE ArimaRequest ADD COLUMN brdDocxFileId TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaRequest ADD COLUMN brdDocxUrl TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaRequest ADD COLUMN brdPdfFileId TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaRequest ADD COLUMN brdPdfUrl TEXT`); } catch {}

    // Phase A: account bulk-import audit table
    await db.run(sql`CREATE TABLE IF NOT EXISTS AccountUploadBatch (
      id TEXT PRIMARY KEY,
      uploadedBy TEXT NOT NULL,
      uploadedAt TEXT NOT NULL DEFAULT (datetime('now')),
      filename TEXT,
      totalRows INTEGER NOT NULL DEFAULT 0,
      appliedRows INTEGER NOT NULL DEFAULT 0,
      rejectedRows INTEGER NOT NULL DEFAULT 0,
      validationReport TEXT,
      status TEXT NOT NULL DEFAULT 'validated'
    )`);

    // Phase E: ClientProfile CRM fields (idempotent ALTERs)
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN clientShortName TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN clientLongName TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN groupName TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN tier TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN groupTier TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN frequencyOverride TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN pmEmail TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN baEmail TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN rmEmail TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN assignedOnMonth TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN lastCourtesyCall TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN lastF2FVisit TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN f2fFrequencyOverride TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN goLiveDate TEXT`); } catch {}

    // Phase E.7: user-level Account Health module access flag
    try { await db.run(sql`ALTER TABLE User ADD COLUMN canAccessAccountHealth INTEGER DEFAULT 0 NOT NULL`); } catch {}

    // Phase E.8: multiple labeled bind keys per account
    await db.run(sql`CREATE TABLE IF NOT EXISTS ClientBindKey (
      id TEXT PRIMARY KEY,
      clientProfileId TEXT NOT NULL,
      label TEXT NOT NULL,
      accessToken TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      createdBy TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      revokedAt TEXT,
      FOREIGN KEY (clientProfileId) REFERENCES ClientProfile(id) ON DELETE CASCADE
    )`);
    try { await db.run(sql`CREATE INDEX IF NOT EXISTS ClientBindKey_clientProfile_idx ON ClientBindKey(clientProfileId)`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaChannelBinding ADD COLUMN bindKeyId TEXT`); } catch {}

    // Backfill: every existing account with an accessToken gets a "Primary" key
    // mirroring that token. Active bindings get pinned to that key. Idempotent —
    // we skip accounts that already have at least one key.
    try {
      const profiles = await db.run(sql`
        SELECT cp.id, cp.accessToken
          FROM ClientProfile cp
          LEFT JOIN ClientBindKey k ON k.clientProfileId = cp.id
         WHERE cp.accessToken IS NOT NULL
           AND k.id IS NULL
      `) as any;
      const rows = Array.isArray(profiles?.rows) ? profiles.rows : (Array.isArray(profiles) ? profiles : []);
      for (const r of rows) {
        const id = String(r.id ?? r[0] ?? "");
        const token = String(r.accessToken ?? r[1] ?? "");
        if (!id || !token) continue;
        const keyId = `bk_${id}_primary`;
        await db.run(sql`
          INSERT OR IGNORE INTO ClientBindKey (id, clientProfileId, label, accessToken, status, createdAt)
          VALUES (${keyId}, ${id}, 'Primary', ${token}, 'active', datetime('now'))
        `);
        // Pin existing active bindings on that token to this key.
        await db.run(sql`
          UPDATE ArimaChannelBinding
             SET bindKeyId = ${keyId}
           WHERE clientProfileId = ${id}
             AND bindKeyId IS NULL
             AND status = 'active'
        `);
      }
    } catch (e) {
      console.warn("[ensureAccessSchema] ClientBindKey backfill failed:", e);
    }

    // Phase E.9: scopeType + scopeRef on both ClientBindKey and ArimaChannelBinding.
    // Team-room rows store scopeType='rm-team' + scopeRef=userId (no clientProfileId).
    try { await db.run(sql`ALTER TABLE ClientBindKey ADD COLUMN scopeType TEXT NOT NULL DEFAULT 'client'`); } catch {}
    try { await db.run(sql`ALTER TABLE ClientBindKey ADD COLUMN scopeRef TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaChannelBinding ADD COLUMN scopeType TEXT NOT NULL DEFAULT 'client'`); } catch {}
    try { await db.run(sql`ALTER TABLE ArimaChannelBinding ADD COLUMN scopeRef TEXT`); } catch {}
    // Backfill scopeRef for the existing client rows so the column is queryable
    // uniformly going forward.
    try {
      await db.run(sql`UPDATE ClientBindKey SET scopeRef = clientProfileId WHERE scopeRef IS NULL AND clientProfileId IS NOT NULL`);
      await db.run(sql`UPDATE ArimaChannelBinding SET scopeRef = clientProfileId WHERE scopeRef IS NULL AND clientProfileId IS NOT NULL`);
    } catch (e) {
      console.warn("[ensureAccessSchema] scopeRef backfill failed:", e);
    }

    // Phase E.9 — Drop the NOT NULL constraint on ClientBindKey.clientProfileId
    // AND ArimaChannelBinding.clientProfileId so team-room rows (which have no
    // single account) can be inserted. SQLite can't ALTER an existing column's
    // nullability, so we rebuild each table. Idempotent — only rebuilds when
    // the column is still NOT NULL.
    await rebuildIfNotNull("ClientBindKey", "clientProfileId", sql`CREATE TABLE ClientBindKey_new (
      id TEXT PRIMARY KEY,
      clientProfileId TEXT,
      label TEXT NOT NULL,
      accessToken TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      createdBy TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      revokedAt TEXT,
      scopeType TEXT NOT NULL DEFAULT 'client',
      scopeRef TEXT,
      FOREIGN KEY (clientProfileId) REFERENCES ClientProfile(id) ON DELETE CASCADE
    )`, sql`INSERT INTO ClientBindKey_new
      (id, clientProfileId, label, accessToken, status, createdBy, createdAt, revokedAt, scopeType, scopeRef)
      SELECT id, clientProfileId, label, accessToken, status, createdBy, createdAt, revokedAt, scopeType, scopeRef
        FROM ClientBindKey`,
      [sql`CREATE INDEX IF NOT EXISTS ClientBindKey_clientProfile_idx ON ClientBindKey(clientProfileId)`],
    );

    await rebuildIfNotNull("ArimaChannelBinding", "clientProfileId", sql`CREATE TABLE ArimaChannelBinding_new (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      chatId TEXT NOT NULL,
      chatTitle TEXT,
      clientProfileId TEXT,
      bindKeyId TEXT,
      scopeType TEXT NOT NULL DEFAULT 'client',
      scopeRef TEXT,
      boundByUserId TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      agentMode TEXT NOT NULL DEFAULT 'arima',
      boundAt TEXT NOT NULL DEFAULT (datetime('now')),
      revokedAt TEXT
    )`, sql`INSERT INTO ArimaChannelBinding_new
      (id, channel, chatId, chatTitle, clientProfileId, bindKeyId, scopeType, scopeRef, boundByUserId, status, agentMode, boundAt, revokedAt)
      SELECT id, channel, chatId, chatTitle, clientProfileId, bindKeyId, scopeType, scopeRef, boundByUserId, status, agentMode, boundAt, revokedAt
        FROM ArimaChannelBinding`,
      [sql`CREATE UNIQUE INDEX IF NOT EXISTS ArimaChannelBinding_unique ON ArimaChannelBinding(channel, chatId)`],
    );

    // Phase F.2 (B7): Proposal Maker — HTML-rendered, PDF exported on demand
    // Single-row admin settings + proposals log.
    await db.run(sql`CREATE TABLE IF NOT EXISTS ProposalSettings (
      id TEXT PRIMARY KEY,
      proposalsRootFolderId TEXT NOT NULL,
      templateDriveFileId TEXT,
      templateDriveFileName TEXT,
      updatedBy TEXT,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    try { await db.run(sql`ALTER TABLE ProposalSettings ADD COLUMN templateDriveFileId TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ProposalSettings ADD COLUMN templateDriveFileName TEXT`); } catch {}
    await db.run(sql`CREATE TABLE IF NOT EXISTS Proposal (
      id TEXT PRIMARY KEY,
      clientProfileId TEXT NOT NULL,
      title TEXT NOT NULL,
      versionNumber INTEGER NOT NULL DEFAULT 1,
      sourceInputs TEXT,
      messages TEXT,
      attachmentRefs TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      pdfDriveFileId TEXT,
      pdfDriveUrl TEXT,
      exportedAt TEXT,
      exportedBy TEXT,
      generatedBy TEXT NOT NULL,
      generatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      errorMessage TEXT,
      FOREIGN KEY (clientProfileId) REFERENCES ClientProfile(id) ON DELETE CASCADE
    )`);
    try { await db.run(sql`ALTER TABLE Proposal ADD COLUMN messages TEXT`); } catch {}
    try { await db.run(sql`CREATE INDEX IF NOT EXISTS Proposal_clientProfile_idx ON Proposal(clientProfileId)`); } catch {}
    try { await db.run(sql`CREATE INDEX IF NOT EXISTS Proposal_generatedAt_idx ON Proposal(generatedAt)`); } catch {}
    // If a ProposalTemplate row exists from earlier scaffolding, migrate its
    // proposalsRootFolderId over to ProposalSettings so admins don't re-paste it.
    try {
      await db.run(sql`
        INSERT OR IGNORE INTO ProposalSettings (id, proposalsRootFolderId, updatedBy, updatedAt)
        SELECT 'default', proposalsRootFolderId, updatedBy, updatedAt
          FROM ProposalTemplate
         WHERE id = 'default' AND proposalsRootFolderId IS NOT NULL
      `);
    } catch {}

    // Phase F.1: seed the Proposal Maker app row so it appears under AI Intelligence.
    // Only insert if missing — admin can deactivate via the apps admin if they want.
    try {
      await db.run(sql`INSERT OR IGNORE INTO App (id, name, slug, description, icon, href, isActive, isBuiltIn, sortOrder, createdAt, updatedAt)
        VALUES ('app_proposal_maker', 'Proposal Maker', 'proposal-maker', 'Generate client-facing proposals from a Word template. Auto-files to per-account Drive folders.', 'Sparkles', '/proposal-maker', 1, 1, 50, datetime('now'), datetime('now'))`);
    } catch (e) {
      console.warn("[ensureAccessSchema] Proposal Maker app seed failed:", e);
    }

    // Phase G.1: Training Video Generator — script + voiceover + captions
    await db.run(sql`CREATE TABLE IF NOT EXISTS TrainingVideoSettings (
      id TEXT PRIMARY KEY,
      trainingRootFolderId TEXT NOT NULL,
      defaultVoice TEXT NOT NULL DEFAULT 'Charon',
      defaultTtsModel TEXT NOT NULL DEFAULT 'gemini-2.5-flash-preview-tts',
      defaultLanguage TEXT NOT NULL DEFAULT 'en-US',
      defaultAspectRatio TEXT NOT NULL DEFAULT '9:16',
      updatedBy TEXT,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS TrainingVideo (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      sourceType TEXT NOT NULL DEFAULT 'pptx',
      sourceDriveFileId TEXT,
      sourceDriveFileName TEXT,
      videoFolderId TEXT,
      voice TEXT NOT NULL DEFAULT 'Charon',
      ttsModel TEXT NOT NULL DEFAULT 'gemini-2.5-flash-preview-tts',
      language TEXT NOT NULL DEFAULT 'en-US',
      stylePrompt TEXT,
      aspectRatio TEXT NOT NULL DEFAULT '9:16',
      userPrompt TEXT,
      scenes TEXT,
      messages TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      errorMessage TEXT,
      generatedBy TEXT NOT NULL,
      generatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    // Phase G.2 — render-state columns (idempotent ALTERs)
    try { await db.run(sql`ALTER TABLE TrainingVideo ADD COLUMN renderJobId TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE TrainingVideo ADD COLUMN renderStatus TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE TrainingVideo ADD COLUMN renderError TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE TrainingVideo ADD COLUMN renderStartedAt TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE TrainingVideo ADD COLUMN finalMp4DriveFileId TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE TrainingVideo ADD COLUMN finalMp4DriveUrl TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE TrainingVideo ADD COLUMN finalMp4RenderedAt TEXT`); } catch {}
    // Phase G.3 — TTS progress tracking
    try { await db.run(sql`ALTER TABLE TrainingVideo ADD COLUMN ttsProgress TEXT`); } catch {}
    try { await db.run(sql`CREATE INDEX IF NOT EXISTS TrainingVideo_generatedAt_idx ON TrainingVideo(generatedAt)`); } catch {}
    try { await db.run(sql`CREATE INDEX IF NOT EXISTS TrainingVideo_status_idx ON TrainingVideo(status)`); } catch {}

    // Seed the Training Video Generator app under AI Intelligence.
    try {
      await db.run(sql`INSERT OR IGNORE INTO App (id, name, slug, description, icon, href, isActive, isBuiltIn, sortOrder, createdAt, updatedAt)
        VALUES ('app_training_videos', 'Training Videos', 'training-videos', 'Turn a PowerPoint into a narrated training video — AI script + Charon voiceover + timed captions, ready for manual assembly.', 'MonitorPlay', '/training-videos', 1, 1, 55, datetime('now'), datetime('now'))`);
    } catch (e) {
      console.warn("[ensureAccessSchema] Training Videos app seed failed:", e);
    }

    // Phase E.3: master modules list
    await db.run(sql`CREATE TABLE IF NOT EXISTS AccountModule (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      description TEXT,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    // Seed defaults if the table is empty
    try {
      const existing = await db.run(sql`SELECT COUNT(*) as c FROM AccountModule`);
      const count = (existing as any)?.rows?.[0]?.c ?? 0;
      if (Number(count) === 0) {
        const defaults = [
          { slug: "attendance", label: "Attendance" },
          { slug: "itinerary", label: "Itinerary" },
          { slug: "expense", label: "Expense" },
          { slug: "inventory", label: "Inventory" },
          { slug: "digital-forms", label: "Digital Forms" },
          { slug: "eta", label: "ETA" },
          { slug: "hr", label: "HR" },
          { slug: "hris", label: "HRIS" },
          { slug: "sales", label: "Sales" },
          { slug: "trade-check-form", label: "Trade Check Form" },
        ];
        for (let i = 0; i < defaults.length; i++) {
          const m = defaults[i];
          try {
            await db.run(sql`INSERT INTO AccountModule (id, slug, label, sortOrder) VALUES (${`mod_${m.slug}`}, ${m.slug}, ${m.label}, ${i})`);
          } catch { /* unique conflict — ignore */ }
        }
      }
    } catch (e) {
      console.warn("[ensureAccessSchema] failed to seed AccountModule defaults:", e);
    }

    // Phase E: courtesy call history
    await db.run(sql`CREATE TABLE IF NOT EXISTS CourtesyCallHistory (
      id TEXT PRIMARY KEY,
      clientProfileId TEXT NOT NULL,
      callDate TEXT NOT NULL,
      loggedByUserId TEXT NOT NULL,
      notes TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (clientProfileId) REFERENCES ClientProfile(id) ON DELETE CASCADE
    )`);
    try { await db.run(sql`CREATE INDEX IF NOT EXISTS idx_CourtesyCallHistory_client ON CourtesyCallHistory(clientProfileId, callDate DESC)`); } catch {}

    // Phase E.5: F2F visit history
    await db.run(sql`CREATE TABLE IF NOT EXISTS F2FVisitHistory (
      id TEXT PRIMARY KEY,
      clientProfileId TEXT NOT NULL,
      visitDate TEXT NOT NULL,
      loggedByUserId TEXT NOT NULL,
      location TEXT,
      notes TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (clientProfileId) REFERENCES ClientProfile(id) ON DELETE CASCADE
    )`);
    try { await db.run(sql`CREATE INDEX IF NOT EXISTS idx_F2FVisitHistory_client ON F2FVisitHistory(clientProfileId, visitDate DESC)`); } catch {}

    // Phase E.6: Super Admin context (single bound GC, allowlist, audit log)
    await db.run(sql`CREATE TABLE IF NOT EXISTS SuperAdminContext (
      id TEXT PRIMARY KEY,
      telegramChatId TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      expiresAt TEXT NOT NULL,
      createdBy TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      revokedBy TEXT,
      revokedAt TEXT,
      notes TEXT,
      bindToken TEXT UNIQUE,
      boundAt TEXT
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS SuperAdminUser (
      id TEXT PRIMARY KEY,
      cstUserId TEXT NOT NULL UNIQUE,
      telegramUserId TEXT,
      allowDmAccess INTEGER NOT NULL DEFAULT 0,
      addedBy TEXT NOT NULL,
      addedAt TEXT NOT NULL DEFAULT (datetime('now')),
      notes TEXT
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS SuperAdminAccessLog (
      id TEXT PRIMARY KEY,
      contextId TEXT,
      telegramChatId TEXT,
      telegramUserId TEXT,
      cstUserId TEXT,
      toolName TEXT,
      question TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      responseSummary TEXT,
      responseBytes INTEGER,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    try { await db.run(sql`CREATE INDEX IF NOT EXISTS idx_SuperAdminAccessLog_created ON SuperAdminAccessLog(createdAt DESC)`); } catch {}

    // Phase B: Account Health Assessment
    await db.run(sql`CREATE TABLE IF NOT EXISTS AccountAssessment (
      id TEXT PRIMARY KEY,
      clientProfileId TEXT NOT NULL,
      submittedByUserId TEXT NOT NULL,
      campaignId TEXT,
      status TEXT NOT NULL DEFAULT 'submitted',
      satisfaction INTEGER,
      ebaDecisionMaker INTEGER,
      ebaDecisionMakerNote TEXT,
      ebaAdmin INTEGER,
      ebaAdminNote TEXT,
      contactChangeRecent INTEGER NOT NULL DEFAULT 0,
      contactChangeNote TEXT,
      isTarkieSsot INTEGER,
      thirdPartySsot TEXT,
      v5Readiness INTEGER,
      requestedModules TEXT,
      responsesJson TEXT,
      aiSummary TEXT,
      aiRisks TEXT,
      aiOpportunities TEXT,
      notableRequests TEXT,
      aiRollupStatus TEXT NOT NULL DEFAULT 'pending',
      aiRollupError TEXT,
      aiRollupAt TEXT,
      submittedAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (clientProfileId) REFERENCES ClientProfile(id) ON DELETE CASCADE
    )`);
    try { await db.run(sql`CREATE INDEX IF NOT EXISTS idx_AccountAssessment_client ON AccountAssessment(clientProfileId, submittedAt DESC)`); } catch {}
    try { await db.run(sql`CREATE INDEX IF NOT EXISTS idx_AccountAssessment_campaign ON AccountAssessment(campaignId)`); } catch {}

    // Phase C: Assessment Campaigns
    await db.run(sql`CREATE TABLE IF NOT EXISTS AssessmentCampaign (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      ownerUserId TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      targetScope TEXT,
      opensAt TEXT,
      closesAt TEXT,
      publishedAt TEXT,
      closedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS AssessmentCampaignTarget (
      id TEXT PRIMARY KEY,
      campaignId TEXT NOT NULL,
      rmUserId TEXT NOT NULL,
      clientProfileId TEXT NOT NULL,
      emailSentAt TEXT,
      emailError TEXT,
      submittedAssessmentId TEXT,
      submittedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (campaignId) REFERENCES AssessmentCampaign(id) ON DELETE CASCADE
    )`);
    try { await db.run(sql`CREATE INDEX IF NOT EXISTS idx_AssessmentCampaignTarget_rm ON AssessmentCampaignTarget(rmUserId, submittedAt)`); } catch {}
    try { await db.run(sql`CREATE INDEX IF NOT EXISTS idx_AssessmentCampaignTarget_campaign ON AssessmentCampaignTarget(campaignId)`); } catch {}

    // Create ArimaRequest table if missing
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaRequest (
      id TEXT PRIMARY KEY,
      conversationId TEXT,
      sourceMessageId TEXT,
      userId TEXT NOT NULL,
      clientProfileId TEXT,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT DEFAULT 'other' NOT NULL,
      priority TEXT DEFAULT 'medium' NOT NULL,
      status TEXT DEFAULT 'new' NOT NULL,
      assignedTo TEXT,
      dueDate TEXT,
      resolution TEXT,
      resolvedAt TEXT,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);

    // Phase 16: per-binding contact access list
    await db.run(sql`CREATE TABLE IF NOT EXISTS BindingContactAccess (
      id TEXT PRIMARY KEY,
      bindingId TEXT NOT NULL,
      contactId TEXT NOT NULL,
      addedAt TEXT DEFAULT (datetime('now')) NOT NULL,
      addedByUserId TEXT,
      UNIQUE(bindingId, contactId)
    )`);

    // Phase 20: shared Knowledge Repository — every agent reads from here.
    await db.run(sql`CREATE TABLE IF NOT EXISTS KnowledgeDocument (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      sourceMime TEXT,
      sourceBytes INTEGER,
      version INTEGER DEFAULT 1 NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      audience TEXT DEFAULT 'all' NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now')) NOT NULL,
      createdByUserId TEXT
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS KnowledgeDocumentVersion (
      id TEXT PRIMARY KEY,
      documentId TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      changeNote TEXT,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      createdByUserId TEXT
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS KnowledgeFeedEntry (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT DEFAULT 'general' NOT NULL,
      audience TEXT DEFAULT 'all' NOT NULL,
      publishedAt TEXT DEFAULT (datetime('now')) NOT NULL,
      expiresAt TEXT,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      createdByUserId TEXT
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS KnowledgeModule (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT,
      description TEXT NOT NULL,
      whoItsFor TEXT,
      keyFeatures TEXT,
      priceNote TEXT,
      status TEXT DEFAULT 'active' NOT NULL,
      audience TEXT DEFAULT 'all' NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS KnowledgeAgentAccess (
      id TEXT PRIMARY KEY,
      agentId TEXT NOT NULL,
      category TEXT NOT NULL,
      enabled INTEGER DEFAULT 1 NOT NULL,
      UNIQUE(agentId, category)
    )`);

    // ARIMA channel bindings + Telegram linking
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaChannelBinding (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      chatId TEXT NOT NULL,
      chatTitle TEXT,
      clientProfileId TEXT NOT NULL,
      boundByUserId TEXT,
      status TEXT DEFAULT 'active' NOT NULL,
      boundAt TEXT DEFAULT (datetime('now')) NOT NULL,
      revokedAt TEXT,
      UNIQUE(channel, chatId)
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS TelegramAccountLink (
      id TEXT PRIMARY KEY,
      telegramUserId TEXT NOT NULL UNIQUE,
      telegramUsername TEXT,
      telegramName TEXT,
      cstUserId TEXT NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      linkedAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS TelegramLinkCode (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      cstUserId TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      usedAt TEXT,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);

    // Notification tables
    await db.run(sql`CREATE TABLE IF NOT EXISTS NotificationSubscription (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      authSecret TEXT NOT NULL,
      userAgent TEXT,
      status TEXT DEFAULT 'active' NOT NULL,
      lastUsedAt TEXT,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS NotificationPreference (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL UNIQUE,
      webPushEnabled INTEGER DEFAULT 1 NOT NULL,
      emailEnabled INTEGER DEFAULT 1 NOT NULL,
      notifyOnRequest INTEGER DEFAULT 1 NOT NULL,
      notifyOnTelegram INTEGER DEFAULT 0 NOT NULL,
      notifyOnMention INTEGER DEFAULT 1 NOT NULL,
      quietStart TEXT,
      quietEnd TEXT,
      emailCadence TEXT DEFAULT 'instant' NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS NotificationLog (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      type TEXT NOT NULL,
      channel TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      payload TEXT,
      status TEXT DEFAULT 'pending' NOT NULL,
      errorMessage TEXT,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      sentAt TEXT
    )`);

    // Portal (external subscriber) tables
    await db.run(sql`CREATE TABLE IF NOT EXISTS ClientContact (
      id TEXT PRIMARY KEY,
      clientProfileId TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT,
      phone TEXT,
      status TEXT DEFAULT 'invited' NOT NULL,
      invitedAt TEXT,
      activatedAt TEXT,
      lastSeenAt TEXT,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS SubscriberMagicLink (
      id TEXT PRIMARY KEY,
      contactId TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expiresAt TEXT NOT NULL,
      usedAt TEXT,
      sentToEmail TEXT NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      createdByUserId TEXT
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS SubscriberSession (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL UNIQUE,
      contactId TEXT NOT NULL,
      userAgent TEXT,
      ipAddress TEXT,
      expiresAt TEXT NOT NULL,
      lastUsedAt TEXT,
      status TEXT DEFAULT 'active' NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);

    // ARIMA tools registry
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaTool (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT DEFAULT 'read' NOT NULL,
      description TEXT NOT NULL,
      inputSchema TEXT NOT NULL,
      enabled INTEGER DEFAULT 1 NOT NULL,
      autonomy TEXT DEFAULT 'auto' NOT NULL,
      isBuiltIn INTEGER DEFAULT 1 NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaToolInvocation (
      id TEXT PRIMARY KEY,
      toolName TEXT NOT NULL,
      conversationId TEXT,
      userId TEXT,
      clientProfileId TEXT,
      input TEXT,
      output TEXT,
      status TEXT DEFAULT 'pending' NOT NULL,
      approvalNeeded INTEGER DEFAULT 0 NOT NULL,
      approvedByUserId TEXT,
      approvedAt TEXT,
      errorMessage TEXT,
      durationMs INTEGER,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      executedAt TEXT
    )`);

    // Check-in scheduler tables
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaCheckInSchedule (
      id TEXT PRIMARY KEY,
      clientProfileId TEXT NOT NULL UNIQUE,
      cadence TEXT DEFAULT 'monthly' NOT NULL,
      customIntervalDays INTEGER,
      preferredChannel TEXT DEFAULT 'auto' NOT NULL,
      nextDueAt TEXT NOT NULL,
      lastSentAt TEXT,
      lastResponseAt TEXT,
      consecutiveNoResponse INTEGER DEFAULT 0 NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaCheckIn (
      id TEXT PRIMARY KEY,
      scheduleId TEXT,
      clientProfileId TEXT NOT NULL,
      contactId TEXT,
      channel TEXT NOT NULL,
      messageContent TEXT,
      conversationId TEXT,
      status TEXT DEFAULT 'scheduled' NOT NULL,
      scheduledAt TEXT DEFAULT (datetime('now')) NOT NULL,
      sentAt TEXT,
      respondedAt TEXT,
      escalatedAt TEXT,
      errorMessage TEXT,
      triggeredByUserId TEXT,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaScheduleRule (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cadence TEXT DEFAULT 'monthly' NOT NULL,
      customIntervalDays INTEGER,
      matchEngagementStatus TEXT,
      priority INTEGER DEFAULT 0 NOT NULL,
      enabled INTEGER DEFAULT 1 NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);

    // Guardrails table
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaGuardrail (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      pattern TEXT NOT NULL,
      description TEXT,
      enabled INTEGER DEFAULT 1 NOT NULL,
      isBuiltIn INTEGER DEFAULT 0 NOT NULL,
      priority INTEGER DEFAULT 0 NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);

    // Phase 21: Coordinator + on-demand DM
    await db.run(sql`CREATE TABLE IF NOT EXISTS BotDmConsent (
      id TEXT PRIMARY KEY,
      telegramUserId TEXT NOT NULL UNIQUE,
      telegramUsername TEXT,
      telegramName TEXT,
      grantedAt TEXT DEFAULT (datetime('now')) NOT NULL,
      grantedVia TEXT DEFAULT 'button' NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaRunLog (
      id TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL,
      agentMode TEXT DEFAULT 'arima' NOT NULL,
      senderName TEXT,
      senderChannel TEXT,
      clientProfileId TEXT,
      userMessage TEXT NOT NULL,
      systemPrompt TEXT,
      modelCalled INTEGER DEFAULT 1 NOT NULL,
      skipReason TEXT,
      rawModelOutput TEXT,
      finalReply TEXT,
      functionCalls TEXT,
      toolResults TEXT,
      brdEmitted INTEGER DEFAULT 0 NOT NULL,
      requestEmitted INTEGER DEFAULT 0 NOT NULL,
      capturedRequestId TEXT,
      provider TEXT,
      durationMs INTEGER,
      toolIterations INTEGER DEFAULT 0 NOT NULL,
      errorMessage TEXT,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS CoordinatorRelay (
      id TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL,
      sourceTelegramChatId TEXT,
      targetTelegramUserId TEXT,
      targetTelegramUsername TEXT,
      targetDisplayName TEXT NOT NULL,
      requestedByUserId TEXT NOT NULL,
      requestedByName TEXT,
      agentMode TEXT DEFAULT 'arima' NOT NULL,
      topic TEXT,
      pendingMessage TEXT,
      status TEXT DEFAULT 'awaiting-consent' NOT NULL,
      consentToken TEXT UNIQUE,
      sentMessageId TEXT,
      replyMessageId TEXT,
      replyText TEXT,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      consentedAt TEXT,
      sentAt TEXT,
      repliedAt TEXT,
      relayedBackAt TEXT,
      expiresAt TEXT
    )`);

    _schemaEnsuredAt = Date.now();
  } catch (e) {
    console.warn("[access] ensureAccessSchema warning:", e);
  }
}

/**
 * Central access-control helpers for client accounts.
 *
 * Rules:
 *   - Admins (session.user.role === "admin") see every account.
 *   - Non-admin users see only accounts where a row exists in AccountMembership
 *     with their userId.
 *   - Every list query and every single-account lookup MUST go through these
 *     helpers so we don't accidentally leak data across clients.
 */

export interface AccessActor {
  userId: string;
  isAdmin: boolean;
}

/**
 * Resolve which clientProfile IDs the actor is allowed to see.
 * Admins → `null` (meaning "no restriction").
 * Non-admins → array of allowed IDs (may be empty).
 */
export async function listAccessibleClientIds(actor: AccessActor): Promise<string[] | null> {
  // ALWAYS attempt the schema heal first — even for admins, so downstream
  // SELECTs against ClientProfile don't 500 because of a missing column.
  await ensureAccessSchema();
  if (actor.isAdmin) return null;
  try {
    const rows = await db
      .select({ clientProfileId: membershipsTable.clientProfileId })
      .from(membershipsTable)
      .where(eq(membershipsTable.userId, actor.userId));
    return rows.map(r => r.clientProfileId);
  } catch (e) {
    // If the table doesn't exist yet (very fresh deploy), deny everything for non-admins
    console.warn("[access] listAccessibleClientIds failed; denying non-admin:", e);
    return [];
  }
}

/**
 * Returns true if the actor can access the given clientProfileId.
 * Admins always pass. Non-admins must have an AccountMembership row.
 */
export async function canAccessClient(actor: AccessActor, clientProfileId: string): Promise<boolean> {
  await ensureAccessSchema();
  if (actor.isAdmin) return true;
  try {
    const rows = await db
      .select({ id: membershipsTable.id })
      .from(membershipsTable)
      .where(
        and(
          eq(membershipsTable.userId, actor.userId),
          eq(membershipsTable.clientProfileId, clientProfileId)
        )
      )
      .limit(1);
    return rows.length > 0;
  } catch (e) {
    console.warn("[access] canAccessClient failed; denying:", e);
    return false;
  }
}

/**
 * Apply membership filter to a Drizzle SELECT against ClientProfile.
 * Returns the appropriate WHERE clause to AND with other conditions.
 */
export function buildClientAccessWhere(actor: AccessActor, allowedIds: string[] | null) {
  if (allowedIds === null) return undefined; // admin → no filter
  if (allowedIds.length === 0) return sql`1 = 0`; // no access → empty result
  return inArray(clientProfilesTable.id, allowedIds);
}

// ─── Client code + access token generation ──────────────────────────────

function shortHash(seed: string, length = 4): string {
  const hash = crypto.createHash("sha256").update(seed).digest("hex").toUpperCase();
  // Strip vowels and similar-looking chars to avoid offensive accidents and confusion
  const cleaned = hash.replace(/[AEIOU01]/g, "");
  return cleaned.slice(0, length);
}

function companyPrefix(companyName: string): string {
  const cleaned = companyName.toUpperCase().replace(/[^A-Z]/g, "");
  if (cleaned.length >= 4) return cleaned.slice(0, 4);
  if (cleaned.length > 0) return cleaned.padEnd(4, "X");
  return "ACCT";
}

/**
 * Human-readable, short, mostly-unique client code.
 * Format: PREFIX-XXXX (e.g. MOPT-A3F2, TARK-9K4P)
 */
export function generateClientCode(companyName: string, idSeed?: string): string {
  const prefix = companyPrefix(companyName);
  const seed = `${prefix}-${idSeed || crypto.randomBytes(8).toString("hex")}-${Date.now()}`;
  return `${prefix}-${shortHash(seed, 4)}`;
}

/**
 * Random 64-char hex secret for channel binding (Telegram chats, magic links, etc.)
 */
export function generateAccessToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Make sure the given client profile has a clientCode AND an accessToken.
 * Generates and persists them if missing. Returns the (possibly updated) values.
 *
 * Safe to call repeatedly — only writes when fields are blank.
 */
export async function ensureClientCodeAndToken(clientProfileId: string): Promise<{ clientCode: string; accessToken: string }> {
  const rows = await db
    .select({
      id: clientProfilesTable.id,
      companyName: clientProfilesTable.companyName,
      clientCode: clientProfilesTable.clientCode,
      accessToken: clientProfilesTable.accessToken,
    })
    .from(clientProfilesTable)
    .where(eq(clientProfilesTable.id, clientProfileId))
    .limit(1);

  const row = rows[0];
  if (!row) throw new Error("Client profile not found");

  let clientCode = row.clientCode || "";
  let accessToken = row.accessToken || "";
  const updates: Record<string, string> = {};

  if (!clientCode) {
    clientCode = await uniqueClientCode(row.companyName);
    updates.clientCode = clientCode;
  }
  if (!accessToken) {
    accessToken = generateAccessToken();
    updates.accessToken = accessToken;
  }

  if (Object.keys(updates).length > 0) {
    await db
      .update(clientProfilesTable)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(eq(clientProfilesTable.id, clientProfileId));
  }

  return { clientCode, accessToken };
}

/**
 * Generate a clientCode that doesn't collide with any existing one.
 * Retries up to 5 times before giving up (uniqueness is enforced by the UNIQUE
 * constraint anyway, but pre-checking avoids noisy errors).
 */
export async function uniqueClientCode(companyName: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateClientCode(companyName, `${attempt}-${Math.random()}`);
    const collision = await db
      .select({ id: clientProfilesTable.id })
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.clientCode, candidate))
      .limit(1);
    if (collision.length === 0) return candidate;
  }
  // Final fallback: add a random suffix
  return `${generateClientCode(companyName)}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}

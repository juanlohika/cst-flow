/**
 * CST FlowDesk — Drizzle ORM Schema
 * 
 * 1:1 translation of prisma/schema.prisma into Drizzle sqliteTable definitions.
 * No structural changes — same table names, same column names, same types.
 * This ensures zero-migration compatibility with the existing Turso database.
 */

import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ─── Helper: default cuid-like ID ────────────────────────────────
// Turso/SQLite doesn't have cuid(), so we use a random hex string.
// Existing rows already have cuid values — this only applies to new inserts.
const cuid = () => sql`(lower(hex(randomblob(12))))`;
const now = () => sql`(datetime('now'))`;

// ─── NextAuth Models ─────────────────────────────────────────────

export const users = sqliteTable("User", {
  id:            text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name:          text("name"),
  email:         text("email").unique(),
  emailVerified: text("emailVerified"),
  image:         text("image"),
  role:          text("role").default("user").notNull(),
  isSuperAdmin:  integer("isSuperAdmin", { mode: "boolean" }).default(false).notNull(),
  status:        text("status").default("pending").notNull(),

  // App Permissions
  canAccessArchitect: integer("canAccessArchitect", { mode: "boolean" }).default(false).notNull(),
  canAccessBRD:       integer("canAccessBRD", { mode: "boolean" }).default(false).notNull(),
  canAccessTimeline:  integer("canAccessTimeline", { mode: "boolean" }).default(false).notNull(),
  canAccessTasks:     integer("canAccessTasks", { mode: "boolean" }).default(true).notNull(),
  canAccessCalendar:  integer("canAccessCalendar", { mode: "boolean" }).default(true).notNull(),
  canAccessMeetings:  integer("canAccessMeetings", { mode: "boolean" }).default(false).notNull(),
  canAccessAccounts:  integer("canAccessAccounts", { mode: "boolean" }).default(false).notNull(),
  canAccessSolutions: integer("canAccessSolutions", { mode: "boolean" }).default(false).notNull(),
  canAccessAccountHealth: integer("canAccessAccountHealth", { mode: "boolean" }).default(false).notNull(),

  // Functional role
  profileRole: text("profileRole"),

  // Organizational Hierarchy (Future-proofing)
  supervisorId:  text("supervisorId"),

  // Invite tracking
  inviteToken: text("inviteToken").unique(),
  invitedBy:   text("invitedBy"),
  invitedAt:   text("invitedAt"),

  // Presentation Builder
  canAccessPresentations: integer("canAccessPresentations", { mode: "boolean" }).default(false).notNull(),
});

export const accounts = sqliteTable("Account", {
  id:                text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:            text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  type:              text("type").notNull(),
  provider:          text("provider").notNull(),
  providerAccountId: text("providerAccountId").notNull(),
  refresh_token:     text("refresh_token"),
  access_token:      text("access_token"),
  expires_at:        integer("expires_at"),
  token_type:        text("token_type"),
  scope:             text("scope"),
  id_token:          text("id_token"),
  session_state:     text("session_state"),
}, (table) => ({
  providerAccountIdx: uniqueIndex("Account_provider_providerAccountId_key").on(table.provider, table.providerAccountId),
}));

export const sessions = sqliteTable("Session", {
  id:           text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionToken: text("sessionToken").notNull().unique(),
  userId:       text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires:      text("expires").notNull(),
});

export const verificationTokens = sqliteTable("VerificationToken", {
  identifier: text("identifier").notNull(),
  token:      text("token").notNull().unique(),
  expires:    text("expires").notNull(),
}, (table) => ({
  identifierTokenIdx: uniqueIndex("VerificationToken_identifier_token_key").on(table.identifier, table.token),
}));

// ─── Application Models ──────────────────────────────────────────

export const savedWorks = sqliteTable("SavedWork", {
  id:              text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:          text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  appType:         text("appType").notNull(),
  title:           text("title").notNull(),
  data:            text("data").notNull(),
  clientProfileId: text("clientProfileId").references(() => clientProfiles.id),
  flowCategory:    text("flowCategory"),
  status:          text("status").default("open").notNull(),
  createdAt:       text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:       text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// ─── Project Management ──────────────────────────────────────────

export const projects = sqliteTable("Project", {
  id:               text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:           text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name:             text("name").notNull(),
  companyName:      text("companyName").notNull(),
  clientProfileId:  text("clientProfileId").references(() => clientProfiles.id),
  externalContact:  text("externalContact"),
  internalInCharge: text("internalInCharge"),
  assignedIds:      text("assignedIds"), // Stores comma-separated or JSON array of user IDs
  startDate:        text("startDate").notNull(),
  status:           text("status").default("active").notNull(),
  templateId:       text("templateId").references(() => timelineTemplates.id),
  defaultPaddingDays: integer("defaultPaddingDays").default(3).notNull(),
  shareToken:       text("shareToken").unique().$defaultFn(() => crypto.randomUUID()),
  archived:         integer("archived", { mode: "boolean" }).default(false).notNull(),
  createdBy:        text("createdBy"),
  createdAt:        text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:        text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

export const projectStakeholders = sqliteTable("ProjectStakeholder", {
  id:               text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId:        text("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  fullName:         text("fullName").notNull(),
  email:            text("email"),
  role:             text("role"), // e.g. "CEO", "IT Head"
  hasPortalAccess:  integer("hasPortalAccess", { mode: "boolean" }).default(false).notNull(),
  createdAt:        text("createdAt").default(sql`(datetime('now'))`).notNull(),
});

// ─── Timeline Templates ─────────────────────────────────────────

export const timelineTemplates = sqliteTable("TimelineTemplate", {
  id:          text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name:        text("name").notNull().unique(),
  description: text("description"),
  restDays:    text("restDays").default("Saturday,Sunday").notNull(),
  type:        text("type").default("project"),
  createdAt:   text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:   text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

export const templateTasks = sqliteTable("TemplateTask", {
  id:              text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  templateId:      text("templateId").notNull().references(() => timelineTemplates.id, { onDelete: "cascade" }),
  taskCode:        text("taskCode").notNull(),
  subject:         text("subject").notNull(),
  defaultDuration: real("defaultDuration").default(8).notNull(),
  sortOrder:       integer("sortOrder").notNull(),
});

// ─── Timeline Items ──────────────────────────────────────────────

export const timelineItems = sqliteTable("TimelineItem", {
  id:            text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId:     text("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
  clientProfileId: text("clientProfileId"),
  taskCode:      text("taskCode").notNull(),
  subject:       text("subject").notNull(),
  plannedStart:  text("plannedStart").notNull(),
  plannedEnd:    text("plannedEnd").notNull(),
  actualStart:   text("actualStart"),
  actualEnd:     text("actualEnd"),
  durationHours: real("durationHours").default(8).notNull(),
  owner:         text("owner"),
  assignedTo:    text("assignedTo"),
  description:   text("description"),
  status:        text("status").default("pending").notNull(),
  sortOrder:     integer("sortOrder").default(0).notNull(),
  paddingDays:   integer("paddingDays"), // Override per task
  externalPlannedEnd: text("externalPlannedEnd"), // Calculated: plannedEnd + paddingDays (skipping weekends)
  archived:      integer("archived", { mode: "boolean" }).default(false).notNull(),

  // Hierarchy
  parentId: text("parentId"),

  // Recurring
  recurringFrequency:  text("recurringFrequency"),
  recurringUntil:      text("recurringUntil"),
  isRecurringTemplate: integer("isRecurringTemplate", { mode: "boolean" }).default(false).notNull(),
  recurringParentId:   text("recurringParentId"),

  // Kanban
  kanbanLaneId: text("kanbanLaneId"),

  createdAt: text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt: text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

export const taskAssignments = sqliteTable("TaskAssignment", {
  id:             text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  timelineItemId: text("timelineItemId").notNull().references(() => timelineItems.id, { onDelete: "cascade" }),
  userId:         text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (table) => ({
  uniqueAssignment: uniqueIndex("TaskAssignment_timelineItemId_userId_key").on(table.timelineItemId, table.userId),
}));

export const userCapacities = sqliteTable("UserCapacity", {
  id:         text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  owner:      text("owner").notNull().unique(),
  dailyHours: real("dailyHours").default(8).notNull(),
  restDays:   text("restDays").default("Saturday,Sunday").notNull(),
  createdAt:  text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:  text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

export const taskHistory = sqliteTable("TaskHistory", {
  id:             text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  timelineItemId: text("timelineItemId").notNull().references(() => timelineItems.id, { onDelete: "cascade" }),
  type:           text("type").notNull(),
  oldValue:       text("oldValue"),
  newValue:       text("newValue"),
  comment:        text("comment"),
  changedBy:      text("changedBy").notNull(),
  createdAt:      text("createdAt").default(sql`(datetime('now'))`).notNull(),
});

// ─── Daily Tasks ─────────────────────────────────────────────────

export const dailyTasks = sqliteTable("DailyTask", {
  id:             text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:         text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title:          text("title").notNull(),
  description:    text("description"),
  date:           text("date").notNull(),
  startTime:      text("startTime"),
  endTime:        text("endTime"),
  allottedHours:  real("allottedHours").default(1).notNull(),
  actualHours:    real("actualHours"),
  status:         text("status").default("todo").notNull(),
  timelineItemId: text("timelineItemId").references(() => timelineItems.id),
  isMaintenance:  integer("isMaintenance", { mode: "boolean" }).default(false).notNull(),
  createdAt:      text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:      text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// ─── Maintenance Templates ───────────────────────────────────────

export const maintenanceTemplates = sqliteTable("MaintenanceTemplate", {
  id:          text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name:        text("name").notNull(),
  description: text("description"),
  frequency:   text("frequency").notNull(),
  duration:    real("duration").default(1).notNull(),
  createdAt:   text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:   text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// ─── Meeting Prep ────────────────────────────────────────────────

export const clientProfiles = sqliteTable("ClientProfile", {
  id:                    text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:                text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyName:           text("companyName").notNull(),
  industry:              text("industry").notNull(),
  companySize:           text("companySize"),
  modulesAvailed:        text("modulesAvailed").notNull(),
  engagementStatus:      text("engagementStatus").default("confirmed").notNull(),
  primaryContact:        text("primaryContact"),
  primaryContactEmail:   text("primaryContactEmail"),
  specialConsiderations: text("specialConsiderations"),
  intelligenceContent:   text("intelligenceContent"), // Markdown intelligence file
  clientCode:            text("clientCode").unique(),  // Human-readable: e.g. MOPT-A3F2
  accessToken:           text("accessToken").unique(), // Secret: 64-char hex, used for channel binding
  // Phase E: account-level CRM metadata
  clientShortName:       text("clientShortName"),       // Free-form short label (defaults to companyName in UI)
  clientLongName:        text("clientLongName"),        // Official business name (longer than companyName)
  groupName:             text("groupName"),             // Soft grouping — accounts sharing the same groupName are treated as siblings
  tier:                  text("tier"),                  // VIP | 1 | 2 | 3 | 4 | 5 — individual account tier
  groupTier:             text("groupTier"),             // VIP | 1 | 2 | 3 | 4 | 5 — tier of the parent group
  frequencyOverride:     text("frequencyOverride"),     // Override the tier-derived courtesy-call cadence (label like 'monthly', 'every-2-months', 'quarterly', 'yearly')
  pmEmail:               text("pmEmail"),               // Project Manager (metadata only — doesn't grant access)
  baEmail:               text("baEmail"),               // Business Analyst
  rmEmail:               text("rmEmail"),               // Relationship Manager
  assignedOnMonth:       text("assignedOnMonth"),       // YYYY-MM when current RM was assigned
  lastCourtesyCall:      text("lastCourtesyCall"),      // YYYY-MM-DD of the most recent courtesy call (any channel)
  lastF2FVisit:          text("lastF2FVisit"),          // YYYY-MM-DD of the most recent in-person visit (separate target from CC)
  f2fFrequencyOverride:  text("f2fFrequencyOverride"),  // Override the default once-per-year F2F target (label like 'monthly', 'every-6-months', 'yearly')
  // Phase E.7: lifecycle stage tracking
  // engagementStatus now uses the canonical set:
  //   exploration | pending | new-client-implementation | hypercare | maintenance
  // (Legacy values 'confirmed' / 'exploratory' are normalized at read time.)
  goLiveDate:            text("goLiveDate"),            // YYYY-MM-DD when the account went live (drives the 90-day hypercare window)
  createdAt:             text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:             text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// Phase E.3: Master list of Tarkie modules that accounts can avail.
// Replaces the hardcoded MODULE_OPTIONS array. Admin-managed via
// /admin/account-modules. Used as the dropdown source for ClientProfile's
// modulesAvailed (JSON array of moduleSlugs).
export const accountModules = sqliteTable("AccountModule", {
  id:           text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  slug:         text("slug").notNull().unique(),         // stable identifier (e.g. "attendance")
  label:        text("label").notNull(),                  // display label (e.g. "Attendance")
  description:  text("description"),                      // optional admin notes
  sortOrder:    integer("sortOrder").default(0).notNull(),
  isActive:     integer("isActive", { mode: "boolean" }).default(true).notNull(),
  createdAt:    text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:    text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// Phase E: courtesy-call history. Append-only log of every call logged for an
// account. The clientProfiles.lastCourtesyCall column is the cached latest
// date for fast queries; this table is the source of truth for the history.
export const courtesyCallHistory = sqliteTable("CourtesyCallHistory", {
  id:                text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  clientProfileId:   text("clientProfileId").notNull().references(() => clientProfiles.id, { onDelete: "cascade" }),
  callDate:          text("callDate").notNull(),         // YYYY-MM-DD
  loggedByUserId:    text("loggedByUserId").notNull(),   // who recorded this
  notes:             text("notes"),                      // optional one-liner
  createdAt:         text("createdAt").default(sql`(datetime('now'))`).notNull(),
});

// Phase E.5: F2F visit history. Mirrors CourtesyCallHistory but for the
// once-a-year in-person target. Tracked separately because the cadence
// and significance are different from a CC (which can be over Zoom).
export const f2fVisitHistory = sqliteTable("F2FVisitHistory", {
  id:                text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  clientProfileId:   text("clientProfileId").notNull().references(() => clientProfiles.id, { onDelete: "cascade" }),
  visitDate:         text("visitDate").notNull(),        // YYYY-MM-DD
  loggedByUserId:    text("loggedByUserId").notNull(),
  location:          text("location"),                   // optional: where the meeting took place
  notes:             text("notes"),
  createdAt:         text("createdAt").default(sql`(datetime('now'))`).notNull(),
});

// Phase E.6: Super Admin Context. A single org-wide binding to a Telegram
// group chat where portfolio-wide CRM data may be discussed. Time-bound
// (soft expiration with rolling /extend), allowlist-gated, fully audited.
//
// The Super Admin context is the ONLY place where the cross-account
// portfolio_* tools become callable. Outside this context (DMs, other GCs,
// web), those tools are filtered out of ARIMA's tool list entirely.
export const superAdminContext = sqliteTable("SuperAdminContext", {
  id:                text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  telegramChatId:    text("telegramChatId").notNull().unique(),
  status:            text("status").default("active").notNull(), // active | revoked | expired
  expiresAt:         text("expiresAt").notNull(),
  createdBy:         text("createdBy").notNull(),
  createdAt:         text("createdAt").default(sql`(datetime('now'))`).notNull(),
  revokedBy:         text("revokedBy"),
  revokedAt:         text("revokedAt"),
  notes:             text("notes"),
  // Token used by the /sabind command in Telegram to claim the GC
  bindToken:         text("bindToken").unique(),
  boundAt:           text("boundAt"),
});

// Allowlist of CST OS users who may participate in the Super Admin GC.
// They must have a linked Telegram account (telegramAccountLinks row) for
// their messages in the SA GC to be recognized.
export const superAdminUsers = sqliteTable("SuperAdminUser", {
  id:                text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  cstUserId:         text("cstUserId").notNull().unique(),
  telegramUserId:    text("telegramUserId"),            // cached at bind time for fast lookup
  // Per-user opt-in: when true, ARIMA will also engage with portfolio
  // tools in this user's PRIVATE DM with the bot. Off by default for safety.
  allowDmAccess:     integer("allowDmAccess", { mode: "boolean" }).default(false).notNull(),
  addedBy:           text("addedBy").notNull(),
  addedAt:           text("addedAt").default(sql`(datetime('now'))`).notNull(),
  notes:             text("notes"),
});

// Append-only audit log of every Super Admin tool call (success or refusal).
// Stores the question + the data returned for full forensic value.
export const superAdminAccessLog = sqliteTable("SuperAdminAccessLog", {
  id:                text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  contextId:         text("contextId"),                 // FK to SuperAdminContext (nullable for refusals before bind)
  telegramChatId:    text("telegramChatId"),
  telegramUserId:    text("telegramUserId"),
  cstUserId:         text("cstUserId"),
  toolName:          text("toolName"),
  question:          text("question"),                  // The user's prompt that triggered the tool call
  status:            text("status").notNull(),          // 'allowed' | 'refused-not-in-context' | 'refused-not-allowlisted' | 'refused-expired' | 'refused-dm-not-allowed'
  reason:            text("reason"),
  responseSummary:   text("responseSummary"),           // Short string the AI saw back (not the full data dump)
  responseBytes:     integer("responseBytes"),          // Byte size of the returned data
  createdAt:         text("createdAt").default(sql`(datetime('now'))`).notNull(),
});

// AccountMembership: which CST OS users can access which client accounts
// Membership is required for non-admin users to see/use a client in any app.
// Admins bypass this check (they see everything).
export const accountMemberships = sqliteTable("AccountMembership", {
  id:              text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:          text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientProfileId: text("clientProfileId").notNull().references(() => clientProfiles.id, { onDelete: "cascade" }),
  role:            text("role").default("member").notNull(), // member | lead | viewer (kept for legacy access control)
  // Phase 12: typed internal contact role + primary-owner flag for routing
  internalRole:    text("internalRole"),                       // PM | BA | RM | Developer | Other (null = legacy)
  isPrimary:       integer("isPrimary", { mode: "boolean" }).default(false).notNull(),
  grantedBy:       text("grantedBy"),  // userId of admin who granted access
  grantedAt:       text("grantedAt").default(sql`(datetime('now'))`).notNull(),
}, (table) => ({
  uniqueMembership: { columns: [table.userId, table.clientProfileId], name: "AccountMembership_unique" },
}));

// Phase B: Account Health Assessment — CRM-style snapshot of each account's
// state. One row per assessment (full history kept). The latest row per
// account is the "current health" view; older rows are the trend.
//
// Structured columns hold the typed answers (scores, booleans, simple text).
// Long-text answers from RM are kept in `responsesJson` for full Q&A archive.
// AI-derived fields (summary/risks/opportunities/notable requests) are rolled
// up after submit via Gemini and written back to this same row.
export const accountAssessments = sqliteTable("AccountAssessment", {
  id:                      text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  clientProfileId:         text("clientProfileId").notNull().references(() => clientProfiles.id, { onDelete: "cascade" }),
  submittedByUserId:       text("submittedByUserId").notNull(),   // CST user who filled this in
  campaignId:              text("campaignId"),                    // null = ad-hoc; FK to AssessmentCampaign (Phase C)
  status:                  text("status").default("submitted").notNull(), // draft | submitted

  // Section B — Account Health
  satisfaction:            integer("satisfaction"),               // 1-5
  // Section C — Relationship Strength (EBA)
  ebaDecisionMaker:        integer("ebaDecisionMaker"),           // 1-5
  ebaDecisionMakerNote:    text("ebaDecisionMakerNote"),
  ebaAdmin:                integer("ebaAdmin"),                   // 1-5
  ebaAdminNote:            text("ebaAdminNote"),
  contactChangeRecent:     integer("contactChangeRecent", { mode: "boolean" }).default(false).notNull(),
  contactChangeNote:       text("contactChangeNote"),
  // Section D — System of Record
  isTarkieSsot:            integer("isTarkieSsot", { mode: "boolean" }),
  thirdPartySsot:          text("thirdPartySsot"),                // null if Tarkie is SSOT
  // Section E — Demand Signals & V5 Outlook
  v5Readiness:             integer("v5Readiness"),                // 1-5
  requestedModules:        text("requestedModules"),              // JSON array of module names

  // Full Q&A archive: { questionId: { value: any, label: string, ... } }
  responsesJson:           text("responsesJson"),

  // AI rollup (populated by accountAssessmentRollup worker)
  aiSummary:               text("aiSummary"),                     // 3-4 sentence exec summary
  aiRisks:                 text("aiRisks"),                       // JSON array of bullets
  aiOpportunities:         text("aiOpportunities"),               // JSON array of bullets
  notableRequests:         text("notableRequests"),               // JSON array of bullets
  aiRollupStatus:          text("aiRollupStatus").default("pending").notNull(), // pending | ok | failed
  aiRollupError:           text("aiRollupError"),
  aiRollupAt:              text("aiRollupAt"),

  submittedAt:             text("submittedAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:               text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// Phase C: campaign-driven Account Health assessment.
//
// AssessmentCampaign is an admin-initiated batch that asks every Primary RM
// to refresh the Health Assessment for the accounts they own (within the
// campaign's target scope). The campaign drives:
//   - which (RM, account) pairs need a fresh assessment
//   - email notifications when published
//   - per-campaign aggregate reports (Phase D)
//
// Targeting: at publish time, we compute the queue using
// accountMemberships.isPrimary=true ∩ targetScope filter. Assessments
// submitted while a campaign is active auto-bind to it via campaignId.
export const assessmentCampaigns = sqliteTable("AssessmentCampaign", {
  id:                text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title:             text("title").notNull(),
  description:       text("description"),
  ownerUserId:       text("ownerUserId").notNull(),       // admin who created it
  status:            text("status").default("draft").notNull(), // draft | published | closed | archived
  // JSON: { accountStatuses: string[], industries: string[], modulesAnyOf: string[], specificAccountIds: string[] }
  targetScope:       text("targetScope"),
  opensAt:           text("opensAt"),                     // when publish fires
  closesAt:          text("closesAt"),                    // optional deadline shown in queue + emails
  publishedAt:       text("publishedAt"),
  closedAt:          text("closedAt"),
  createdAt:         text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:         text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// One row per (campaign, rmUser, account) — the "this account needs assessing
// in this campaign" record. Created at publish time. Tracks whether the email
// notification was sent and whether the RM has submitted yet.
export const assessmentCampaignTargets = sqliteTable("AssessmentCampaignTarget", {
  id:                text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  campaignId:        text("campaignId").notNull().references(() => assessmentCampaigns.id, { onDelete: "cascade" }),
  rmUserId:          text("rmUserId").notNull(),          // Primary RM at publish time
  clientProfileId:   text("clientProfileId").notNull(),
  emailSentAt:       text("emailSentAt"),
  emailError:        text("emailError"),
  submittedAssessmentId: text("submittedAssessmentId"),   // FK to accountAssessments once submitted
  submittedAt:       text("submittedAt"),
  createdAt:         text("createdAt").default(sql`(datetime('now'))`).notNull(),
});

// Phase A: audit trail for bulk account/membership XLSX imports.
// One row per upload attempt. The validation_report holds row-by-row
// outcomes so admins can review past imports + diagnose failures.
export const accountUploadBatches = sqliteTable("AccountUploadBatch", {
  id:                text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  uploadedBy:        text("uploadedBy").notNull(),       // userId of the admin who uploaded
  uploadedAt:        text("uploadedAt").default(sql`(datetime('now'))`).notNull(),
  filename:          text("filename"),
  totalRows:         integer("totalRows").default(0).notNull(),
  appliedRows:       integer("appliedRows").default(0).notNull(),
  rejectedRows:      integer("rejectedRows").default(0).notNull(),
  validationReport:  text("validationReport"),           // JSON: [{sheet, row, status, message, ...}]
  status:            text("status").default("validated").notNull(), // validated | applied | cancelled | failed
});

export const meetingPrepSessions = sqliteTable("MeetingPrepSession", {
  id:                       text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:                   text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientProfileId:          text("clientProfileId").notNull().references(() => clientProfiles.id, { onDelete: "cascade" }),
  meetingType:              text("meetingType").notNull(),
  status:                   text("status").default("in-preparation").notNull(),
  agendaContent:            text("agendaContent"),
  questionnaireContent:     text("questionnaireContent"),
  discussionGuide:          text("discussionGuide"),
  preparationChecklist:     text("preparationChecklist"),
  anticipatedRequirements:  text("anticipatedRequirements"),
  createdAt:                text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:                text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// ─── Tarkie Meeting Hub ──────────────────────────────────────────

export const tarkieMeetings = sqliteTable("TarkieMeeting", {
  id:                   text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:               text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  meetingPrepSessionId: text("meetingPrepSessionId").unique(),
  clientProfileId:      text("clientProfileId"),
  title:                text("title").notNull(),
  meetingType:          text("meetingType").notNull(),
  companyName:          text("companyName"),
  scheduledAt:          text("scheduledAt").notNull(),
  durationMinutes:      integer("durationMinutes").default(60).notNull(),
  zoomLink:             text("zoomLink"),
  qrCode:               text("qrCode"),
  recordingEnabled:     integer("recordingEnabled", { mode: "boolean" }).default(true).notNull(),
  recordingLink:        text("recordingLink"),
  activeApps:           text("activeApps").default("[]").notNull(),
  customAgenda:         text("customAgenda"),
  projectId:            text("projectId"),
  createdBy:            text("createdBy"),
  facilitatorId:        text("facilitatorId"),
  status:               text("status").default("scheduled").notNull(),
  createdAt:            text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:            text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

export const meetingAssignments = sqliteTable("MeetingAssignment", {
  id:        text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  meetingId: text("meetingId").notNull().references(() => tarkieMeetings.id, { onDelete: "cascade" }),
  userId:    text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (table) => ({
  uniqueMeetingAssignment: uniqueIndex("MeetingAssignment_meetingId_userId_key").on(table.meetingId, table.userId),
}));

export const meetingAttendees = sqliteTable("MeetingAttendee", {
  id:               text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  meetingId:        text("meetingId").notNull().references(() => tarkieMeetings.id, { onDelete: "cascade" }),
  fullName:         text("fullName").notNull(),
  position:         text("position"),
  companyName:      text("companyName"),
  mobileNumber:     text("mobileNumber"),
  email:            text("email"),
  registrationType: text("registrationType").default("qr-scan").notNull(),
  attendanceStatus: text("attendanceStatus").default("expected").notNull(),
  consentGiven:     integer("consentGiven", { mode: "boolean" }).default(false).notNull(),
  createdAt:        text("createdAt").default(sql`(datetime('now'))`).notNull(),
});

// ─── Meeting Transcripts ─────────────────────────────────────────

export const meetingTranscripts = sqliteTable("MeetingTranscript", {
  id:               text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  meetingId:        text("meetingId").notNull().unique().references(() => tarkieMeetings.id, { onDelete: "cascade" }),
  rawTranscript:    text("rawTranscript").notNull(),
  minutesOfMeeting: text("minutesOfMeeting"),
  generatedBRD:     text("generatedBRD"),
  generatedTasks:   text("generatedTasks"),
  aiQuestions:      text("aiQuestions").default("[]").notNull(),
  primaryLanguage:  text("primaryLanguage").default("en").notNull(),
  hasCodeSwitching: integer("hasCodeSwitching", { mode: "boolean" }).default(false).notNull(),
  createdAt:        text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:        text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// ─── Skills (AI Knowledge Base) ──────────────────────────────────

export const skills = sqliteTable("Skill", {
  id:          text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name:        text("name").notNull(),
  description: text("description").default("").notNull(),
  category:    text("category").notNull(),
  subcategory: text("subcategory"),
  slug:        text("slug"),
  content:     text("content").notNull(),
  isActive:    integer("isActive", { mode: "boolean" }).default(true).notNull(),
  isSystem:    integer("isSystem", { mode: "boolean" }).default(false).notNull(),
  sortOrder:   integer("sortOrder").default(0).notNull(),
  createdAt:   text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:   text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// ─── App Registry ────────────────────────────────────────────────

export const apps = sqliteTable("App", {
  id:          text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name:        text("name").notNull(),
  slug:        text("slug").notNull().unique(),
  description: text("description"),
  icon:        text("icon"),
  href:        text("href").notNull(),
  isActive:    integer("isActive", { mode: "boolean" }).default(true).notNull(),
  isBuiltIn:   integer("isBuiltIn", { mode: "boolean" }).default(false).notNull(),
  sortOrder:   integer("sortOrder").default(0).notNull(),
  provider:    text("provider"),
  createdAt:   text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:   text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// ─── Kanban ──────────────────────────────────────────────────────

export const kanbanBoards = sqliteTable("KanbanBoard", {
  id:        text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("projectId").notNull().unique().references(() => projects.id, { onDelete: "cascade" }),
  name:      text("name").default("Kanban Board").notNull(),
  createdBy: text("createdBy").notNull(),
  createdAt: text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt: text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

export const kanbanLanes = sqliteTable("KanbanLane", {
  id:           text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  boardId:      text("boardId").notNull().references(() => kanbanBoards.id, { onDelete: "cascade" }),
  name:         text("name").notNull(),
  position:     integer("position").default(0).notNull(),
  mappedStatus: text("mappedStatus").default("pending").notNull(),
  color:        text("color"),
  createdAt:    text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:    text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// ─── Roles Masterfile ────────────────────────────────────────────

export const roles = sqliteTable("Role", {
  id:        text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name:      text("name").notNull(),
  createdAt: text("createdAt").default(sql`(datetime('now'))`).notNull(),
});

// ─── Global Settings ─────────────────────────────────────────────

export const globalSettings = sqliteTable("GlobalSetting", {
  id:        text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  key:       text("key").notNull().unique(),
  value:     text("value").notNull(),
  createdAt: text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt: text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// ─── Presentation Builder ────────────────────────────────────────

export const presentationTemplates = sqliteTable("PresentationTemplate", {
  id:             text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name:           text("name").notNull(),
  description:    text("description"),
  designSkillId:  text("designSkillId"),          // FK to Skill (category: presentation-design)
  slideDefinitions: text("slideDefinitions").notNull(), // JSON array of slide definitions
  version:        text("version").default("1.0").notNull(),
  isActive:       integer("isActive", { mode: "boolean" }).default(true).notNull(),
  createdBy:      text("createdBy"),
  createdAt:      text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:      text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

export const presentations = sqliteTable("Presentation", {
  id:                    text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  clientProfileId:       text("clientProfileId").references(() => clientProfiles.id),
  templateId:            text("templateId"),       // FK to PresentationTemplate
  designSkillId:         text("designSkillId"),    // FK to Skill (snapshot at creation)
  name:                  text("name").notNull(),
  presentationType:      text("presentationType").default("custom").notNull(),
  status:                text("status").default("draft").notNull(),
  intelligenceSnapshot:  text("intelligenceSnapshot"), // JSON snapshot of account intelligence
  designSnapshot:        text("designSnapshot"),       // JSON snapshot of design skill at creation
  createdBy:             text("createdBy").notNull(),
  exportedPdfUrl:        text("exportedPdfUrl"),
  createdAt:             text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:             text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

export const presentationSlides = sqliteTable("PresentationSlide", {
  id:               text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  presentationId:   text("presentationId").notNull().references(() => presentations.id, { onDelete: "cascade" }),
  order:            integer("order").default(0).notNull(),
  title:            text("title").notNull(),
  layout:           text("layout").default("content-light").notNull(),
  backgroundOverride: text("backgroundOverride"),
  createdAt:        text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:        text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

export const presentationBlocks = sqliteTable("PresentationBlock", {
  id:                  text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  slideId:             text("slideId").notNull().references(() => presentationSlides.id, { onDelete: "cascade" }),
  order:               integer("order").default(0).notNull(),
  blockType:           text("blockType").notNull(),  // text | bullet-list | table | phase-card | image | divider | sparkle-row | next-steps-table
  intelligenceMapping: text("intelligenceMapping"),  // Which intelligence.md field pre-fills this
  prompt:              text("prompt"),               // AI prompt
  content:             text("content"),              // JSON — actual block data
  isAiGenerated:       integer("isAiGenerated", { mode: "boolean" }).default(false).notNull(),
  isLocked:            integer("isLocked", { mode: "boolean" }).default(false).notNull(),
  generationHistory:   text("generationHistory"),    // JSON array, max 3 entries
  lastGeneratedAt:     text("lastGeneratedAt"),
  createdAt:           text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:           text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// ─── ARIMA (AI Relationship Manager) ─────────────────────────────

export const arimaConversations = sqliteTable("ArimaConversation", {
  id:              text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:          text("userId").notNull(),           // FK to User (the human owning this convo)
  clientProfileId: text("clientProfileId"),            // Optional FK to ClientProfile (the account context)
  channel:         text("channel").default("web").notNull(), // web | telegram | facebook | whatsapp | email (future)
  title:           text("title"),                      // Auto-generated from first user message
  summary:         text("summary"),                    // AI-generated rolling summary (filled when long)
  status:          text("status").default("active").notNull(), // active | archived | closed
  lastMessageAt:   text("lastMessageAt").default(sql`(datetime('now'))`).notNull(),
  messageCount:    integer("messageCount").default(0).notNull(),
  createdAt:       text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:       text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

export const arimaMessages = sqliteTable("ArimaMessage", {
  id:             text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversationId: text("conversationId").notNull().references(() => arimaConversations.id, { onDelete: "cascade" }),
  role:           text("role").notNull(),              // user | assistant | system
  content:        text("content").notNull(),
  provider:       text("provider"),                    // gemini | claude | groq | ollama (which AI replied)
  model:          text("model"),                       // gemini-2.5-flash etc.
  tokensIn:       integer("tokensIn"),
  tokensOut:      integer("tokensOut"),
  toolCalls:      text("toolCalls"),                   // JSON array of tool invocations (future)
  // Phase 13: real sender attribution for unified group chat
  senderType:     text("senderType"),                  // internal | external | arima | system
  senderUserId:   text("senderUserId"),                // CST OS user id | ClientContact id | null
  senderName:     text("senderName"),                  // denormalized display name
  senderChannel:  text("senderChannel"),               // telegram | portal | web
  mentions:       text("mentions"),                    // JSON: [{type:'internal'|'external'|'arima', id, name, telegramUsername?}]
  attachments:    text("attachments"),                 // JSON: [{type:'image', url, mime, width?, height?, source:'telegram'|'portal'}]
  createdAt:      text("createdAt").default(sql`(datetime('now'))`).notNull(),
});

// ─── Knowledge Repository (Phase 20) ──────────────────────────────────
// Shared knowledge that any AI agent (ARIMA, Eliana, future) can pull from
// at runtime. NOT skill prompts (those are HOW an agent behaves) — this is
// WHAT every agent should know about the world: product catalog, playbooks,
// pricing, FAQs, recent updates.

// KnowledgeDocument: long-form reference material (playbook, pricing sheet,
// module catalog, technical specs). Versioned — uploading a new version
// archives the old one. Active document is what agents see.
export const knowledgeDocuments = sqliteTable("KnowledgeDocument", {
  id:           text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  slug:         text("slug").notNull().unique(),            // e.g. "tarkie-playbook"
  title:        text("title").notNull(),
  category:     text("category").notNull(),                 // playbook | module-catalog | pricing | faq | tech-spec | other
  content:      text("content").notNull(),                  // Markdown (PDF gets extracted to markdown on upload)
  sourceMime:   text("sourceMime"),                         // application/pdf | text/markdown | text/plain
  sourceBytes:  integer("sourceBytes"),                     // size of the original upload
  version:      integer("version").default(1).notNull(),
  status:       text("status").default("active").notNull(), // active | archived
  audience:     text("audience").default("all").notNull(),  // all | internal | external (controls which agents see it)
  createdAt:    text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:    text("updatedAt").default(sql`(datetime('now'))`).notNull(),
  createdByUserId: text("createdByUserId"),
});

// KnowledgeDocumentVersion: history of every document, kept for rollback +
// audit trail. Inserted every time a doc is updated.
export const knowledgeDocumentVersions = sqliteTable("KnowledgeDocumentVersion", {
  id:           text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  documentId:   text("documentId").notNull(),
  version:      integer("version").notNull(),
  title:        text("title").notNull(),
  content:      text("content").notNull(),
  changeNote:   text("changeNote"),                         // one-liner: "Updated Q3 pricing", etc.
  createdAt:    text("createdAt").default(sql`(datetime('now'))`).notNull(),
  createdByUserId: text("createdByUserId"),
});

// KnowledgeFeedEntry: short timestamped notes that agents reference for
// "what's new" responses. Auto-expiring optional.
export const knowledgeFeedEntries = sqliteTable("KnowledgeFeedEntry", {
  id:           text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title:        text("title").notNull(),
  body:         text("body").notNull(),                     // Markdown
  category:     text("category").default("general").notNull(), // feature | pricing | integration | bugfix | general
  audience:     text("audience").default("all").notNull(),  // all | internal | external
  publishedAt:  text("publishedAt").default(sql`(datetime('now'))`).notNull(),
  expiresAt:    text("expiresAt"),                          // null = never expires
  createdAt:    text("createdAt").default(sql`(datetime('now'))`).notNull(),
  createdByUserId: text("createdByUserId"),
});

// KnowledgeModule: structured catalog entry for each Tarkie module. Eliana
// uses this to suggest existing solutions instead of jumping to "we'll build
// a custom integration."
export const knowledgeModules = sqliteTable("KnowledgeModule", {
  id:           text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  slug:         text("slug").notNull().unique(),            // e.g. "attendance"
  name:         text("name").notNull(),                     // "Attendance"
  category:     text("category"),                           // workforce | sales | operations | reporting | etc.
  description:  text("description").notNull(),              // 1-2 sentence summary
  whoItsFor:    text("whoItsFor"),                          // target user / use case
  keyFeatures:  text("keyFeatures"),                        // bullet list (markdown)
  priceNote:    text("priceNote"),                          // free-form, e.g. "Included in Pro" or "Add-on"
  status:       text("status").default("active").notNull(), // active | beta | sunset
  audience:     text("audience").default("all").notNull(),
  createdAt:    text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:    text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// KnowledgeAgentAccess: per-agent toggle for which knowledge categories
// each agent sees in its context. Default: all agents see everything tagged
// audience='all'; only internal agents see audience='internal'.
export const knowledgeAgentAccess = sqliteTable("KnowledgeAgentAccess", {
  id:           text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId:      text("agentId").notNull(),                  // arima | eliana | etc.
  category:     text("category").notNull(),                 // playbook | module-catalog | pricing | feed | etc.
  enabled:      integer("enabled", { mode: "boolean" }).default(true).notNull(),
}, (table) => ({
  uniqueAgentCategory: { columns: [table.agentId, table.category], name: "KnowledgeAgentAccess_unique" },
}));

// BindingContactAccess: which ClientContact rows are routed to which binding
// (Telegram group). Many-to-many — a contact may belong to multiple bindings
// within the same account, and a binding may include multiple contacts. For
// Phase 16 the UI restricts contacts to one binding at a time, but the data
// model allows multiple for future flexibility.
export const bindingContactAccess = sqliteTable("BindingContactAccess", {
  id:        text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  bindingId: text("bindingId").notNull(),
  contactId: text("contactId").notNull(),
  addedAt:   text("addedAt").default(sql`(datetime('now'))`).notNull(),
  addedByUserId: text("addedByUserId"),
}, (table) => ({
  uniqueBindingContact: { columns: [table.bindingId, table.contactId], name: "BindingContactAccess_unique" },
}));

// ArimaChannelBinding: maps an external channel chat (Telegram group, etc.) to ONE client account.
// A bound chat can never see data for any other client. Binding is admin-only.
export const arimaChannelBindings = sqliteTable("ArimaChannelBinding", {
  id:              text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  channel:         text("channel").notNull(),               // telegram | facebook | whatsapp (future)
  chatId:          text("chatId").notNull(),                // Telegram chat ID as string (can be negative for groups)
  chatTitle:       text("chatTitle"),                       // cached group title for display
  // Phase E.9: clientProfileId is now nullable. Team-room (rm-team) bindings
  // do NOT have a single client — they're scoped to all of an RM's accounts
  // via memberships at runtime. Existing client bindings keep their value.
  clientProfileId: text("clientProfileId"),
  bindKeyId:       text("bindKeyId"),                       // Phase E.8 — which ClientBindKey this binding was created from. Null for pre-keys legacy bindings.
  // Phase E.9 — scope discriminator. "client" (default, legacy) | "rm-team".
  // Future-proof for "tier", "group", "portfolio".
  scopeType:       text("scopeType").default("client").notNull(),
  // Foreign-id for the scope. For "client" rooms this mirrors clientProfileId.
  // For "rm-team" rooms this is the userId of the RM whose accounts are in scope.
  scopeRef:        text("scopeRef"),
  boundByUserId:   text("boundByUserId"),                   // CST OS user who ran /bind
  status:          text("status").default("active").notNull(), // active | revoked
  agentMode:       text("agentMode").default("arima").notNull(), // arima (RM) | eliana (BA) — which agent leads this room
  boundAt:         text("boundAt").default(sql`(datetime('now'))`).notNull(),
  revokedAt:       text("revokedAt"),
}, (table) => ({
  uniqueBinding: { columns: [table.channel, table.chatId], name: "ArimaChannelBinding_unique" },
}));

// Phase E.8 — Multiple labeled bind keys per account.
// Each row is a (client × purpose) secret. A GC binds against one specific key,
// and contact access is granted per binding so contacts invited via one key
// don't leak into a GC bound by a different key. Legacy code that used
// clientProfiles.accessToken keeps working — that token becomes the "Primary"
// key on first migration.
// Phase E.9 — Same shape now also holds team-room keys (scopeType="rm-team",
// scopeRef=userId). clientProfileId is null for those rows.
export const clientBindKeys = sqliteTable("ClientBindKey", {
  id:              text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  clientProfileId: text("clientProfileId").references(() => clientProfiles.id, { onDelete: "cascade" }),
  scopeType:       text("scopeType").default("client").notNull(), // "client" | "rm-team"
  scopeRef:        text("scopeRef"),                              // clientProfileId (client) | userId (rm-team)
  label:           text("label").notNull(),                 // e.g. "Primary", "Internal RM Room", "Jillian's Team Room"
  accessToken:     text("accessToken").notNull().unique(),  // 64-char random hex, used in /bind <token> and deep links
  status:          text("status").default("active").notNull(), // active | revoked
  createdBy:       text("createdBy"),                       // CST OS userId who created the key
  createdAt:       text("createdAt").default(sql`(datetime('now'))`).notNull(),
  revokedAt:       text("revokedAt"),
});

// ─── Phase F — Proposal Maker ─────────────────────────────────────
// Single-row admin settings — points to the Drive folder where generated
// PDFs are filed + the Drive template document. The template (.docx with
// coarse placeholders like {{client_company_name}} and {{body_content}})
// is the source of branding/styling; we fill it via docxtemplater at
// export time and convert to PDF via Drive.
export const proposalSettings = sqliteTable("ProposalSettings", {
  id:                    text("id").primaryKey(),               // always "default"
  proposalsRootFolderId: text("proposalsRootFolderId").notNull(), // top-level Drive folder, per-account subfolders nest under it
  templateDriveFileId:   text("templateDriveFileId"),            // Drive file id of the .docx template (with placeholders)
  templateDriveFileName: text("templateDriveFileName"),
  updatedBy:             text("updatedBy"),
  updatedAt:             text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// Each proposal — the JSON is the source of truth (what's shown on the
// preview page + rendered to PDF). The Drive PDF is generated on-demand
// when the team is ready to send to the client.
export const proposals = sqliteTable("Proposal", {
  id:              text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  clientProfileId: text("clientProfileId").notNull().references(() => clientProfiles.id, { onDelete: "cascade" }),
  title:           text("title").notNull(),                 // human-readable title
  versionNumber:   integer("versionNumber").default(1).notNull(),
  // sourceInputs is the AI-generated structured JSON — sections, cost lines,
  // timeline phases, signatories, etc. The HTML preview + the PDF both render
  // from this single source of truth. May be null in early conversation when
  // ARIMA is still asking clarifying questions.
  sourceInputs:    text("sourceInputs"),                    // JSON of ProposalContent
  // Conversation history between the user and ARIMA. JSON array of
  // {role: "user"|"assistant", content, attachmentNames?}.
  messages:        text("messages"),                        // JSON
  // Optional Telegram image refs that informed the AI (Phase F.3).
  attachmentRefs:  text("attachmentRefs"),                  // JSON
  status:          text("status").default("draft").notNull(), // draft | exported | sent | superseded
  // PDF is only populated AFTER export. Drafts have no Drive file.
  pdfDriveFileId:  text("pdfDriveFileId"),
  pdfDriveUrl:     text("pdfDriveUrl"),
  exportedAt:      text("exportedAt"),
  exportedBy:      text("exportedBy"),
  generatedBy:     text("generatedBy").notNull(),
  generatedAt:     text("generatedAt").default(sql`(datetime('now'))`).notNull(),
  errorMessage:    text("errorMessage"),
});

// ─── Phase G — Training Video Generator ───────────────────────────
// Single-row admin settings (Drive root for training videos + defaults).
export const trainingVideoSettings = sqliteTable("TrainingVideoSettings", {
  id:                    text("id").primaryKey(),               // always "default"
  trainingRootFolderId:  text("trainingRootFolderId").notNull(), // Drive folder where per-video subfolders live
  defaultVoice:          text("defaultVoice").default("Charon").notNull(),
  defaultTtsModel:       text("defaultTtsModel").default("gemini-2.5-flash-preview-tts").notNull(),
  defaultLanguage:       text("defaultLanguage").default("en-US").notNull(),
  defaultAspectRatio:    text("defaultAspectRatio").default("9:16").notNull(), // 9:16 | 16:9
  updatedBy:             text("updatedBy"),
  updatedAt:             text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// One row per generated training video. Scenes + captions stored as JSON
// to keep the schema simple; we'll split if scale demands it later.
export const trainingVideos = sqliteTable("TrainingVideo", {
  id:              text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title:           text("title").notNull(),
  // "pptx" for v1; "screen_recording" reserved for Phase G.3
  sourceType:      text("sourceType").default("pptx").notNull(),
  // Drive id of the uploaded source file (PPTX or MP4)
  sourceDriveFileId:   text("sourceDriveFileId"),
  sourceDriveFileName: text("sourceDriveFileName"),
  // Drive subfolder for this video (raw/audio/output)
  videoFolderId:   text("videoFolderId"),
  // Voice config — defaults to settings.defaultVoice at creation
  voice:           text("voice").default("Charon").notNull(),
  ttsModel:        text("ttsModel").default("gemini-2.5-flash-preview-tts").notNull(),
  language:        text("language").default("en-US").notNull(),
  stylePrompt:     text("stylePrompt"),
  aspectRatio:     text("aspectRatio").default("9:16").notNull(),
  // Free-form prompt steering the script gen (audience, tone, etc.)
  userPrompt:      text("userPrompt"),
  // The structured output: scenes JSON. Shape in src/lib/training-video/types.ts.
  scenes:          text("scenes"),                              // JSON array of TrainingScene
  // Conversation history with ARIMA (chat-driven refinements)
  messages:        text("messages"),                            // JSON
  status:          text("status").default("draft").notNull(),   // draft | generating | ready | error
  errorMessage:    text("errorMessage"),
  generatedBy:     text("generatedBy").notNull(),
  generatedAt:     text("generatedAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:       text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// TelegramAccountLink: maps a Telegram user ID to a CST OS user ID.
// Required before an admin can run sensitive commands (/bind, /unbind) in any group.
export const telegramAccountLinks = sqliteTable("TelegramAccountLink", {
  id:               text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  telegramUserId:   text("telegramUserId").notNull().unique(),
  telegramUsername: text("telegramUsername"),                // cached for display
  telegramName:     text("telegramName"),                    // cached first+last name
  cstUserId:        text("cstUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  status:           text("status").default("active").notNull(), // active | revoked
  linkedAt:         text("linkedAt").default(sql`(datetime('now'))`).notNull(),
});

// TelegramLinkCode: one-time codes a CST OS user generates from the admin UI to link their Telegram account.
// They DM the bot with /link <code> to complete the link.
export const telegramLinkCodes = sqliteTable("TelegramLinkCode", {
  id:        text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  code:      text("code").notNull().unique(),               // e.g. LK-7K2P-A3F2
  cstUserId: text("cstUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expiresAt").notNull(),                   // ISO; codes expire in 30 min
  usedAt:    text("usedAt"),                                // null until consumed
  createdAt: text("createdAt").default(sql`(datetime('now'))`).notNull(),
});

// NotificationSubscription: browser-side Web Push subscription registered by each user/device.
// One row per browser the user has subscribed on (each device has a unique endpoint).
export const notificationSubscriptions = sqliteTable("NotificationSubscription", {
  id:        text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:    text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint:  text("endpoint").notNull().unique(),  // The unique URL the browser provided
  p256dh:    text("p256dh").notNull(),              // Public key for the user agent
  authSecret: text("authSecret").notNull(),         // Auth secret for encryption
  userAgent: text("userAgent"),                     // For display in the admin UI
  status:    text("status").default("active").notNull(), // active | failed | revoked
  lastUsedAt: text("lastUsedAt"),
  createdAt: text("createdAt").default(sql`(datetime('now'))`).notNull(),
});

// NotificationPreference: per-user opt-in/out settings for notifications.
// One row per user (lazy-created on first read).
export const notificationPreferences = sqliteTable("NotificationPreference", {
  id:                text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:            text("userId").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  webPushEnabled:    integer("webPushEnabled", { mode: "boolean" }).default(true).notNull(),
  emailEnabled:      integer("emailEnabled", { mode: "boolean" }).default(true).notNull(),
  // Which events trigger a notification
  notifyOnRequest:   integer("notifyOnRequest", { mode: "boolean" }).default(true).notNull(),
  notifyOnTelegram:  integer("notifyOnTelegram", { mode: "boolean" }).default(false).notNull(),
  notifyOnMention:   integer("notifyOnMention", { mode: "boolean" }).default(true).notNull(),
  // Quiet hours (no push during this window; 24h format, e.g. "22:00"-"07:00")
  quietStart:        text("quietStart"),
  quietEnd:          text("quietEnd"),
  // Email digest cadence: "instant" | "hourly" | "daily" | "off"
  emailCadence:      text("emailCadence").default("instant").notNull(),
  updatedAt:         text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// ArimaGuardrail: structured safety rule that gets injected into every ARIMA
// system prompt. Admins manage these via /admin/arima-guardrails.
//
// Types:
//   forbidden_topic     → if user mentions, refuse + escalate
//   forbidden_phrase    → never say (for ARIMA's own output)
//   escalation_trigger  → keyword triggers notify_internal_team + flagging
//   off_hours_message   → custom auto-reply outside business hours
//   rate_limit          → per-user message cap (config in value JSON)
//   required_disclosure → mandatory text (e.g. "I'm an AI") in certain situations
//
// pattern: string the AI sees in the prompt OR runtime checks against user input
// (depending on type — see /lib/arima/guardrails.ts for execution semantics)
export const arimaGuardrails = sqliteTable("ArimaGuardrail", {
  id:          text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  type:        text("type").notNull(), // forbidden_topic | forbidden_phrase | escalation_trigger | off_hours_message | rate_limit | required_disclosure
  label:       text("label").notNull(),                // short admin-facing name
  pattern:     text("pattern").notNull(),              // keyword/phrase OR JSON config
  description: text("description"),                    // why this exists, for the audit trail
  enabled:     integer("enabled", { mode: "boolean" }).default(true).notNull(),
  isBuiltIn:   integer("isBuiltIn", { mode: "boolean" }).default(false).notNull(),
  priority:    integer("priority").default(0).notNull(),
  createdAt:   text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:   text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// ArimaCheckInSchedule: per-client check-in cadence. One row per client.
// Lazily created on first cadence resolution (using the matching ScheduleRule's defaults).
export const arimaCheckInSchedules = sqliteTable("ArimaCheckInSchedule", {
  id:                     text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  clientProfileId:        text("clientProfileId").notNull().unique().references(() => clientProfiles.id, { onDelete: "cascade" }),
  cadence:                text("cadence").default("monthly").notNull(), // weekly | biweekly | monthly | quarterly | custom
  customIntervalDays:     integer("customIntervalDays"),
  preferredChannel:       text("preferredChannel").default("auto").notNull(), // auto | portal | telegram | email
  nextDueAt:              text("nextDueAt").notNull(),
  lastSentAt:             text("lastSentAt"),
  lastResponseAt:         text("lastResponseAt"),
  consecutiveNoResponse:  integer("consecutiveNoResponse").default(0).notNull(),
  status:                 text("status").default("active").notNull(), // active | paused | stopped
  createdAt:              text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:              text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// ArimaCheckIn: one row per check-in sent.
export const arimaCheckIns = sqliteTable("ArimaCheckIn", {
  id:              text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  scheduleId:      text("scheduleId").references(() => arimaCheckInSchedules.id, { onDelete: "set null" }),
  clientProfileId: text("clientProfileId").notNull(),
  contactId:       text("contactId"),                          // ClientContact targeted (portal/email)
  channel:         text("channel").notNull(),                  // portal | telegram | email | internal
  messageContent:  text("messageContent"),                     // what ARIMA wrote
  conversationId:  text("conversationId"),                     // ArimaConversation linked
  status:          text("status").default("scheduled").notNull(), // scheduled | sent | responded | no_response | failed | escalated
  scheduledAt:     text("scheduledAt").default(sql`(datetime('now'))`).notNull(),
  sentAt:          text("sentAt"),
  respondedAt:     text("respondedAt"),
  escalatedAt:     text("escalatedAt"),
  errorMessage:    text("errorMessage"),
  triggeredByUserId: text("triggeredByUserId"),                // when manually fired
  createdAt:       text("createdAt").default(sql`(datetime('now'))`).notNull(),
});

// ArimaScheduleRule: cadence templates that auto-apply to matching clients.
export const arimaScheduleRules = sqliteTable("ArimaScheduleRule", {
  id:                    text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name:                  text("name").notNull(),
  cadence:               text("cadence").default("monthly").notNull(),
  customIntervalDays:    integer("customIntervalDays"),
  matchEngagementStatus: text("matchEngagementStatus"),         // "confirmed" | "pilot" | "exploratory" | null (any)
  priority:              integer("priority").default(0).notNull(), // higher wins when multiple match
  enabled:               integer("enabled", { mode: "boolean" }).default(true).notNull(),
  createdAt:             text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:             text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// ArimaTool: registered callable function ARIMA can invoke during a conversation.
// Tools are seeded from code (built-ins) but their enabled flag + autonomy can be
// edited by admins via the /admin/arima-tools UI.
export const arimaTools = sqliteTable("ArimaTool", {
  id:           text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name:         text("name").notNull().unique(),       // function name passed to the AI provider
  category:     text("category").default("read").notNull(), // read | write | external
  description:  text("description").notNull(),          // shown to the AI to decide when to call
  inputSchema:  text("inputSchema").notNull(),          // JSON schema for the params
  enabled:      integer("enabled", { mode: "boolean" }).default(true).notNull(),
  autonomy:     text("autonomy").default("auto").notNull(), // auto | approval | disabled
  isBuiltIn:    integer("isBuiltIn", { mode: "boolean" }).default(true).notNull(),
  createdAt:    text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:    text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// ArimaToolInvocation: log of every tool call ARIMA made (or attempted to make).
// Used for the admin invocations list, the approval queue, and analytics.
export const arimaToolInvocations = sqliteTable("ArimaToolInvocation", {
  id:              text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  toolName:        text("toolName").notNull(),
  conversationId:  text("conversationId"),
  userId:          text("userId"),                       // CST OS user OR ClientContact id (for portal)
  clientProfileId: text("clientProfileId"),
  input:           text("input"),                        // JSON input from the AI
  output:          text("output"),                       // JSON result or error
  status:          text("status").default("pending").notNull(), // pending | approved | executed | denied | failed
  approvalNeeded:  integer("approvalNeeded", { mode: "boolean" }).default(false).notNull(),
  approvedByUserId: text("approvedByUserId"),
  approvedAt:      text("approvedAt"),
  errorMessage:    text("errorMessage"),
  durationMs:      integer("durationMs"),
  createdAt:       text("createdAt").default(sql`(datetime('now'))`).notNull(),
  executedAt:      text("executedAt"),
});

// ClientContact: external people on the client side (e.g. their CEO, project lead, etc.)
// who can be invited to chat with ARIMA via the magic-link portal.
export const clientContacts = sqliteTable("ClientContact", {
  id:              text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  clientProfileId: text("clientProfileId").notNull().references(() => clientProfiles.id, { onDelete: "cascade" }),
  name:            text("name").notNull(),
  email:           text("email").notNull(),
  role:            text("role"),                       // e.g. "CFO", "Operations Lead"
  phone:           text("phone"),
  status:          text("status").default("invited").notNull(), // invited | active | revoked
  invitedAt:       text("invitedAt"),
  activatedAt:     text("activatedAt"),                 // first time they used the magic link
  lastSeenAt:      text("lastSeenAt"),
  createdAt:       text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:       text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// SubscriberMagicLink: one-time tokens emailed to client contacts.
// On first click → activates the contact and starts a SubscriberSession.
export const subscriberMagicLinks = sqliteTable("SubscriberMagicLink", {
  id:         text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  contactId:  text("contactId").notNull().references(() => clientContacts.id, { onDelete: "cascade" }),
  token:      text("token").notNull().unique(),         // 64-char hex, signed externally
  expiresAt:  text("expiresAt").notNull(),               // ISO, 7 days from creation
  usedAt:     text("usedAt"),                            // null until first use; can be re-used during the 30-day session period? No — single-use.
  sentToEmail: text("sentToEmail").notNull(),
  createdAt:  text("createdAt").default(sql`(datetime('now'))`).notNull(),
  createdByUserId: text("createdByUserId"),              // which CST OS admin issued this
});

// SubscriberSession: active portal sessions for external users.
// One row per (contactId × device). Authentication = sessionId in HTTP-only cookie.
export const subscriberSessions = sqliteTable("SubscriberSession", {
  id:         text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId:  text("sessionId").notNull().unique(),     // 64-char hex; stored in cookie
  contactId:  text("contactId").notNull().references(() => clientContacts.id, { onDelete: "cascade" }),
  userAgent:  text("userAgent"),
  ipAddress:  text("ipAddress"),
  expiresAt:  text("expiresAt").notNull(),               // ISO, 30 days from creation
  lastUsedAt: text("lastUsedAt"),
  status:     text("status").default("active").notNull(), // active | revoked
  createdAt:  text("createdAt").default(sql`(datetime('now'))`).notNull(),
});

// NotificationLog: every dispatched notification, for analytics + debug + email-digest batching.
export const notificationLogs = sqliteTable("NotificationLog", {
  id:        text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:    text("userId").notNull(),
  type:      text("type").notNull(),               // request_captured | telegram_message | mention
  channel:   text("channel").notNull(),            // web_push | email
  title:     text("title").notNull(),
  body:      text("body"),
  link:      text("link"),                         // optional URL to open
  payload:   text("payload"),                       // JSON details
  status:    text("status").default("pending").notNull(), // pending | sent | failed
  errorMessage: text("errorMessage"),
  createdAt: text("createdAt").default(sql`(datetime('now'))`).notNull(),
  sentAt:    text("sentAt"),
});

// ARIMA Requests: structured asks captured from conversations.
// When ARIMA detects the user is making a real request (feature, bug, question, etc.)
// it emits a [REQUEST]…[/REQUEST] tag in its reply; the generate route parses it and inserts a row here.
export const arimaRequests = sqliteTable("ArimaRequest", {
  id:              text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversationId:  text("conversationId").references(() => arimaConversations.id, { onDelete: "set null" }),
  sourceMessageId: text("sourceMessageId").references(() => arimaMessages.id, { onDelete: "set null" }),
  userId:          text("userId").notNull(),           // who was chatting when ARIMA captured this
  clientProfileId: text("clientProfileId"),            // optional — the client this is about
  title:           text("title").notNull(),
  description:     text("description"),
  category:        text("category").default("other").notNull(), // feature | bug | question | config | meeting | other
  priority:        text("priority").default("medium").notNull(), // low | medium | high | urgent
  status:          text("status").default("new").notNull(),     // new | in-progress | done | archived
  assignedTo:      text("assignedTo"),                  // userId of CST team member
  dueDate:         text("dueDate"),
  resolution:      text("resolution"),                  // notes when marked done
  resolvedAt:      text("resolvedAt"),
  // Phase 22: Eliana BRD outputs — full polished Tarkie-structured BRD document
  // (markdown blob), Google Doc id + url after export, generation status.
  brdDocument:     text("brdDocument"),                  // Markdown blob of the full BRD (populated for category='brd' rows)
  brdGeneratedAt:  text("brdGeneratedAt"),
  brdGoogleDocId:  text("brdGoogleDocId"),
  brdGoogleDocUrl: text("brdGoogleDocUrl"),
  brdGoogleDocSyncedAt: text("brdGoogleDocSyncedAt"),
  // Phase 22.3: dual Word/PDF export (replaces the broken Google-Docs HTML
  // upload approach). The Word file is the editable internal copy; the PDF
  // is the read-only version Eliana/ARIMA can share with clients.
  brdDocxFileId:   text("brdDocxFileId"),    // Drive fileId of the .docx
  brdDocxUrl:      text("brdDocxUrl"),       // Drive webViewLink (opens in Docs viewer)
  brdPdfFileId:    text("brdPdfFileId"),     // Drive fileId of the .pdf
  brdPdfUrl:       text("brdPdfUrl"),        // Drive webViewLink for the PDF
  brdStatus:       text("brdStatus").default("captured").notNull(), // captured | generating | document-ready | exported | regenerating | error
  brdError:        text("brdError"),
  brdExportLog:    text("brdExportLog"),                // JSON diagnostic of last export attempt (block count by kind, per-block insert outcome)
  createdAt:       text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:       text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

// ─── Phase 21: Coordinator + on-demand DM ─────────────────────────────
//
// Telegram bots cannot DM a user who has never initiated a chat with the bot
// — anti-spam rule. We track who's consented via BotDmConsent (one row per
// Telegram user who tapped /start). The permission-grant flow inserts a row
// the first time a user taps the consent button.
export const botDmConsent = sqliteTable("BotDmConsent", {
  id:              text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  telegramUserId:  text("telegramUserId").notNull().unique(),
  telegramUsername: text("telegramUsername"),
  telegramName:    text("telegramName"),
  grantedAt:       text("grantedAt").default(sql`(datetime('now'))`).notNull(),
  grantedVia:      text("grantedVia").default("button").notNull(), // button | link_command | bind_command | auto_first_dm
  status:          text("status").default("active").notNull(),     // active | revoked
});

// CoordinatorRelay: tracks an active "agent-coordinated DM" — the agent was
// asked in a GC to PM someone; we recorded the request here so when the
// target eventually replies in DM, we can post the response back to the
// originating GC. Also used for the permission-grant flow (status='awaiting-consent').
export const coordinatorRelays = sqliteTable("CoordinatorRelay", {
  id:                    text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversationId:        text("conversationId").notNull(),                 // originating ARIMA conversation (the GC)
  sourceTelegramChatId:  text("sourceTelegramChatId"),                     // for posting the response back
  targetTelegramUserId:  text("targetTelegramUserId"),                     // null if pending consent (haven't resolved them yet)
  targetTelegramUsername: text("targetTelegramUsername"),
  targetDisplayName:     text("targetDisplayName").notNull(),
  requestedByUserId:     text("requestedByUserId").notNull(),              // CST OS user who asked the agent to PM
  requestedByName:       text("requestedByName"),
  agentMode:             text("agentMode").default("arima").notNull(),     // arima | eliana
  topic:                 text("topic"),                                    // short string describing what the DM is about
  pendingMessage:        text("pendingMessage"),                           // the DM body that's queued, sent on consent
  status:                text("status").default("awaiting-consent").notNull(), // awaiting-consent | sent | awaiting-reply | replied | timed-out | cancelled
  consentToken:          text("consentToken").unique(),                    // signed token in the deep-link
  sentMessageId:         text("sentMessageId"),                            // Telegram message_id of the DM we sent
  replyMessageId:        text("replyMessageId"),                           // Telegram message_id of target's reply
  replyText:             text("replyText"),                                // captured reply body for the relay-back
  createdAt:             text("createdAt").default(sql`(datetime('now'))`).notNull(),
  consentedAt:           text("consentedAt"),
  sentAt:                text("sentAt"),
  repliedAt:             text("repliedAt"),
  relayedBackAt:         text("relayedBackAt"),
  expiresAt:             text("expiresAt"),                                // consent links auto-expire (7 days)
});

// ─── Phase 21.1: Diagnostic / debug log for runArima ──────────────────
//
// Captures the raw IO per agent turn so admins can see exactly what the
// model was told, what it produced before scrubbing, what function calls
// it attempted, and what we sent back to the user. Without this we're
// patching symptoms blind.
//
// Cleaned up via a 30-day TTL (cron job — Phase 22). For now rows persist
// indefinitely; cheap enough.
export const arimaRunLogs = sqliteTable("ArimaRunLog", {
  id:                text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversationId:    text("conversationId").notNull(),
  agentMode:         text("agentMode").default("arima").notNull(),
  senderName:        text("senderName"),
  senderChannel:     text("senderChannel"),
  clientProfileId:   text("clientProfileId"),
  /** What the user actually typed (before any scrubbing). */
  userMessage:       text("userMessage").notNull(),
  /** Full system prompt the model received (truncated to 64KB). */
  systemPrompt:      text("systemPrompt"),
  /** Whether the runtime decided to call the model at all. */
  modelCalled:       integer("modelCalled", { mode: "boolean" }).default(true).notNull(),
  skipReason:        text("skipReason"),
  /** Raw text response from the model, BEFORE scrubbing / phantom-guard. */
  rawModelOutput:    text("rawModelOutput"),
  /** Final reply we sent to the user (after self-prefix strip, scrubber, phantom-guard). */
  finalReply:        text("finalReply"),
  /** JSON array of function calls the model emitted (with name + args). */
  functionCalls:     text("functionCalls"),
  /** JSON array of tool execution outcomes (success/failure + summaries). */
  toolResults:       text("toolResults"),
  /** Whether a [BRD] block was parsed out of the reply. */
  brdEmitted:        integer("brdEmitted", { mode: "boolean" }).default(false).notNull(),
  /** Whether a [REQUEST] block was parsed out of the reply. */
  requestEmitted:    integer("requestEmitted", { mode: "boolean" }).default(false).notNull(),
  /** Captured-request id if one was stored in arimaRequests. */
  capturedRequestId: text("capturedRequestId"),
  /** Model provider label (gemini, claude, etc.). */
  provider:          text("provider"),
  /** How long the model call took. */
  durationMs:        integer("durationMs"),
  /** Number of tool-loop iterations consumed. */
  toolIterations:    integer("toolIterations").default(0).notNull(),
  errorMessage:      text("errorMessage"),
  createdAt:         text("createdAt").default(sql`(datetime('now'))`).notNull(),
});

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
  createdAt:             text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:             text("updatedAt").default(sql`(datetime('now'))`).notNull(),
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
  createdAt:      text("createdAt").default(sql`(datetime('now'))`).notNull(),
});

// ArimaChannelBinding: maps an external channel chat (Telegram group, etc.) to ONE client account.
// A bound chat can never see data for any other client. Binding is admin-only.
export const arimaChannelBindings = sqliteTable("ArimaChannelBinding", {
  id:              text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  channel:         text("channel").notNull(),               // telegram | facebook | whatsapp (future)
  chatId:          text("chatId").notNull(),                // Telegram chat ID as string (can be negative for groups)
  chatTitle:       text("chatTitle"),                       // cached group title for display
  clientProfileId: text("clientProfileId").notNull(),       // the bound client account
  boundByUserId:   text("boundByUserId"),                   // CST OS user who ran /bind
  status:          text("status").default("active").notNull(), // active | revoked
  boundAt:         text("boundAt").default(sql`(datetime('now'))`).notNull(),
  revokedAt:       text("revokedAt"),
}, (table) => ({
  uniqueBinding: { columns: [table.channel, table.chatId], name: "ArimaChannelBinding_unique" },
}));

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
  createdAt:       text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:       text("updatedAt").default(sql`(datetime('now'))`).notNull(),
});

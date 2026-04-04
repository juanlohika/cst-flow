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
  createdBy:        text("createdBy"),
  createdAt:        text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:        text("updatedAt").default(sql`(datetime('now'))`).notNull(),
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
  createdAt:             text("createdAt").default(sql`(datetime('now'))`).notNull(),
  updatedAt:             text("updatedAt").default(sql`(datetime('now'))`).notNull(),
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

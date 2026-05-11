import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  apps as appsTable,
  users as usersTable,
  clientProfiles as clientProfilesTable,
  accountMemberships as membershipsTable,
} from "@/db/schema";
import { sql, eq, isNull, or } from "drizzle-orm";
import { uniqueClientCode, generateAccessToken } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/config
 * "MASTER MIGRATOR": Repairs and bootstraps the Turso database.
 * MIGRATED TO DRIZZLE
 */
export async function GET() {
  const migrations: string[] = [];
  let dbStatus = false;

  try {
    // 1. PHYSICAL SCHEMA REPAIR: Create tables if missing
    const bootstrapQueries = [
      `CREATE TABLE IF NOT EXISTS User (id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, emailVerified TEXT, image TEXT, role TEXT DEFAULT 'user' NOT NULL, isSuperAdmin INTEGER DEFAULT 0 NOT NULL, status TEXT DEFAULT 'pending' NOT NULL, canAccessArchitect INTEGER DEFAULT 0 NOT NULL, canAccessBRD INTEGER DEFAULT 0 NOT NULL, canAccessTimeline INTEGER DEFAULT 0 NOT NULL, canAccessTasks INTEGER DEFAULT 1 NOT NULL, canAccessCalendar INTEGER DEFAULT 1 NOT NULL, canAccessMeetings INTEGER DEFAULT 0 NOT NULL, canAccessAccounts INTEGER DEFAULT 0 NOT NULL, canAccessSolutions INTEGER DEFAULT 0 NOT NULL, profileRole TEXT, inviteToken TEXT UNIQUE, invitedBy TEXT, invitedAt TEXT)`,
      `CREATE TABLE IF NOT EXISTS Account (id TEXT PRIMARY KEY, userId TEXT NOT NULL, type TEXT NOT NULL, provider TEXT NOT NULL, providerAccountId TEXT NOT NULL, refresh_token TEXT, access_token TEXT, expires_at INTEGER, token_type TEXT, scope TEXT, id_token TEXT, session_state TEXT, UNIQUE(provider, providerAccountId), FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS Session (id TEXT PRIMARY KEY, sessionToken TEXT UNIQUE NOT NULL, userId TEXT NOT NULL, expires TEXT NOT NULL, FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS VerificationToken (identifier TEXT NOT NULL, token TEXT UNIQUE NOT NULL, expires TEXT NOT NULL, PRIMARY KEY (identifier, token))`,
      `CREATE TABLE IF NOT EXISTS App (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT, icon TEXT, href TEXT NOT NULL, isActive INTEGER DEFAULT 1 NOT NULL, isBuiltIn INTEGER DEFAULT 0 NOT NULL, sortOrder INTEGER DEFAULT 0 NOT NULL, provider TEXT, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS GlobalSetting (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, value TEXT NOT NULL, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS ClientProfile (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE, companyName TEXT NOT NULL, industry TEXT NOT NULL, companySize TEXT, modulesAvailed TEXT NOT NULL, engagementStatus TEXT DEFAULT 'confirmed' NOT NULL, primaryContact TEXT, primaryContactEmail TEXT, specialConsiderations TEXT, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS SavedWork (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE, appType TEXT NOT NULL, title TEXT NOT NULL, data TEXT NOT NULL, clientProfileId TEXT REFERENCES ClientProfile(id), flowCategory TEXT, status TEXT DEFAULT 'open' NOT NULL, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS Project (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE, name TEXT NOT NULL, companyName TEXT NOT NULL, clientProfileId TEXT REFERENCES ClientProfile(id), externalContact TEXT, internalInCharge TEXT, startDate TEXT NOT NULL, status TEXT DEFAULT 'active' NOT NULL, templateId TEXT, createdBy TEXT, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS TimelineTemplate (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT, restDays TEXT DEFAULT 'Saturday,Sunday' NOT NULL, type TEXT DEFAULT 'project', createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS TemplateTask (id TEXT PRIMARY KEY, templateId TEXT NOT NULL REFERENCES TimelineTemplate(id) ON DELETE CASCADE, taskCode TEXT NOT NULL, subject TEXT NOT NULL, defaultDuration REAL DEFAULT 8 NOT NULL, sortOrder INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS TimelineItem (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES Project(id) ON DELETE CASCADE, clientProfileId TEXT, taskCode TEXT NOT NULL, subject TEXT NOT NULL, plannedStart TEXT NOT NULL, plannedEnd TEXT NOT NULL, actualStart TEXT, actualEnd TEXT, durationHours REAL DEFAULT 8 NOT NULL, owner TEXT, assignedTo TEXT, description TEXT, status TEXT DEFAULT 'pending' NOT NULL, sortOrder INTEGER DEFAULT 0 NOT NULL, archived INTEGER DEFAULT 0 NOT NULL, parentId TEXT REFERENCES TimelineItem(id), recurringFrequency TEXT, recurringUntil TEXT, isRecurringTemplate INTEGER DEFAULT 0 NOT NULL, recurringParentId TEXT REFERENCES TimelineItem(id), kanbanLaneId TEXT, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS TaskAssignment (id TEXT PRIMARY KEY, timelineItemId TEXT NOT NULL REFERENCES TimelineItem(id) ON DELETE CASCADE, userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE, UNIQUE(timelineItemId, userId))`,
      `CREATE TABLE IF NOT EXISTS Skill (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '' NOT NULL, category TEXT NOT NULL, subcategory TEXT, slug TEXT, content TEXT NOT NULL, isActive INTEGER DEFAULT 1 NOT NULL, isSystem INTEGER DEFAULT 0 NOT NULL, sortOrder INTEGER DEFAULT 0 NOT NULL, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS Role (id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS KanbanBoard (id TEXT PRIMARY KEY, projectId TEXT UNIQUE NOT NULL REFERENCES Project(id) ON DELETE CASCADE, name TEXT DEFAULT 'Kanban Board' NOT NULL, createdBy TEXT NOT NULL, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS KanbanLane (id TEXT PRIMARY KEY, boardId TEXT NOT NULL REFERENCES KanbanBoard(id) ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER DEFAULT 0 NOT NULL, mappedStatus TEXT DEFAULT 'pending' NOT NULL, color TEXT, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS MeetingPrepSession (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE, clientProfileId TEXT NOT NULL REFERENCES ClientProfile(id) ON DELETE CASCADE, meetingType TEXT NOT NULL, status TEXT DEFAULT 'in-preparation' NOT NULL, agendaContent TEXT, questionnaireContent TEXT, discussionGuide TEXT, preparationChecklist TEXT, anticipatedRequirements TEXT, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS TarkieMeeting (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE, meetingPrepSessionId TEXT UNIQUE REFERENCES MeetingPrepSession(id), clientProfileId TEXT REFERENCES ClientProfile(id), title TEXT NOT NULL, meetingType TEXT NOT NULL, companyName TEXT, scheduledAt TEXT NOT NULL, durationMinutes INTEGER DEFAULT 60 NOT NULL, zoomLink TEXT, qrCode TEXT, recordingEnabled INTEGER DEFAULT 1 NOT NULL, recordingLink TEXT, activeApps TEXT DEFAULT '[]' NOT NULL, customAgenda TEXT, projectId TEXT REFERENCES Project(id), createdBy TEXT, facilitatorId TEXT, status TEXT DEFAULT 'scheduled' NOT NULL, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS MeetingAssignment (id TEXT PRIMARY KEY, meetingId TEXT NOT NULL REFERENCES TarkieMeeting(id) ON DELETE CASCADE, userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE, UNIQUE(meetingId, userId))`,
      `CREATE TABLE IF NOT EXISTS MeetingAttendee (id TEXT PRIMARY KEY, meetingId TEXT NOT NULL REFERENCES TarkieMeeting(id) ON DELETE CASCADE, fullName TEXT NOT NULL, position TEXT, companyName TEXT, mobileNumber TEXT, email TEXT, registrationType TEXT DEFAULT 'qr-scan' NOT NULL, attendanceStatus TEXT DEFAULT 'expected' NOT NULL, consentGiven INTEGER DEFAULT 0 NOT NULL, createdAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS MeetingTranscript (id TEXT PRIMARY KEY, meetingId TEXT UNIQUE NOT NULL REFERENCES TarkieMeeting(id) ON DELETE CASCADE, rawTranscript TEXT NOT NULL, minutesOfMeeting TEXT, generatedBRD TEXT, generatedTasks TEXT, aiQuestions TEXT DEFAULT '[]' NOT NULL, primaryLanguage TEXT DEFAULT 'en' NOT NULL, hasCodeSwitching INTEGER DEFAULT 0 NOT NULL, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS DailyTask (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, date TEXT NOT NULL, startTime TEXT, endTime TEXT, allottedHours REAL DEFAULT 1 NOT NULL, actualHours REAL, status TEXT DEFAULT 'todo' NOT NULL, timelineItemId TEXT REFERENCES TimelineItem(id), isMaintenance INTEGER DEFAULT 0 NOT NULL, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS MaintenanceTemplate (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, frequency TEXT NOT NULL, duration REAL DEFAULT 1 NOT NULL, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS ArimaConversation (id TEXT PRIMARY KEY, userId TEXT NOT NULL, clientProfileId TEXT, channel TEXT DEFAULT 'web' NOT NULL, title TEXT, summary TEXT, status TEXT DEFAULT 'active' NOT NULL, lastMessageAt TEXT DEFAULT (datetime('now')) NOT NULL, messageCount INTEGER DEFAULT 0 NOT NULL, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS ArimaMessage (id TEXT PRIMARY KEY, conversationId TEXT NOT NULL REFERENCES ArimaConversation(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, provider TEXT, model TEXT, tokensIn INTEGER, tokensOut INTEGER, toolCalls TEXT, createdAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS AccountMembership (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE, clientProfileId TEXT NOT NULL REFERENCES ClientProfile(id) ON DELETE CASCADE, role TEXT DEFAULT 'member' NOT NULL, grantedBy TEXT, grantedAt TEXT DEFAULT (datetime('now')) NOT NULL, UNIQUE(userId, clientProfileId))`,
      `CREATE TABLE IF NOT EXISTS ArimaRequest (id TEXT PRIMARY KEY, conversationId TEXT REFERENCES ArimaConversation(id) ON DELETE SET NULL, sourceMessageId TEXT REFERENCES ArimaMessage(id) ON DELETE SET NULL, userId TEXT NOT NULL, clientProfileId TEXT, title TEXT NOT NULL, description TEXT, category TEXT DEFAULT 'other' NOT NULL, priority TEXT DEFAULT 'medium' NOT NULL, status TEXT DEFAULT 'new' NOT NULL, assignedTo TEXT, dueDate TEXT, resolution TEXT, resolvedAt TEXT, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS ArimaChannelBinding (id TEXT PRIMARY KEY, channel TEXT NOT NULL, chatId TEXT NOT NULL, chatTitle TEXT, clientProfileId TEXT NOT NULL, boundByUserId TEXT, status TEXT DEFAULT 'active' NOT NULL, boundAt TEXT DEFAULT (datetime('now')) NOT NULL, revokedAt TEXT, UNIQUE(channel, chatId))`,
      `CREATE TABLE IF NOT EXISTS TelegramAccountLink (id TEXT PRIMARY KEY, telegramUserId TEXT NOT NULL UNIQUE, telegramUsername TEXT, telegramName TEXT, cstUserId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE, status TEXT DEFAULT 'active' NOT NULL, linkedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS TelegramLinkCode (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, cstUserId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE, expiresAt TEXT NOT NULL, usedAt TEXT, createdAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS NotificationSubscription (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, authSecret TEXT NOT NULL, userAgent TEXT, status TEXT DEFAULT 'active' NOT NULL, lastUsedAt TEXT, createdAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS NotificationPreference (id TEXT PRIMARY KEY, userId TEXT NOT NULL UNIQUE REFERENCES User(id) ON DELETE CASCADE, webPushEnabled INTEGER DEFAULT 1 NOT NULL, emailEnabled INTEGER DEFAULT 1 NOT NULL, notifyOnRequest INTEGER DEFAULT 1 NOT NULL, notifyOnTelegram INTEGER DEFAULT 0 NOT NULL, notifyOnMention INTEGER DEFAULT 1 NOT NULL, quietStart TEXT, quietEnd TEXT, emailCadence TEXT DEFAULT 'instant' NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS NotificationLog (id TEXT PRIMARY KEY, userId TEXT NOT NULL, type TEXT NOT NULL, channel TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT, payload TEXT, status TEXT DEFAULT 'pending' NOT NULL, errorMessage TEXT, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, sentAt TEXT)`,
      `CREATE TABLE IF NOT EXISTS ClientContact (id TEXT PRIMARY KEY, clientProfileId TEXT NOT NULL REFERENCES ClientProfile(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT NOT NULL, role TEXT, phone TEXT, status TEXT DEFAULT 'invited' NOT NULL, invitedAt TEXT, activatedAt TEXT, lastSeenAt TEXT, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, updatedAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS SubscriberMagicLink (id TEXT PRIMARY KEY, contactId TEXT NOT NULL REFERENCES ClientContact(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE, expiresAt TEXT NOT NULL, usedAt TEXT, sentToEmail TEXT NOT NULL, createdAt TEXT DEFAULT (datetime('now')) NOT NULL, createdByUserId TEXT)`,
      `CREATE TABLE IF NOT EXISTS SubscriberSession (id TEXT PRIMARY KEY, sessionId TEXT NOT NULL UNIQUE, contactId TEXT NOT NULL REFERENCES ClientContact(id) ON DELETE CASCADE, userAgent TEXT, ipAddress TEXT, expiresAt TEXT NOT NULL, lastUsedAt TEXT, status TEXT DEFAULT 'active' NOT NULL, createdAt TEXT DEFAULT (datetime('now')) NOT NULL)`,
    ];

    for (const q of bootstrapQueries) {
      try { await db.run(sql.raw(q)); } catch (e) {
        console.warn(`Bootstrap warn on query: ${q.substring(0, 50)}...`, e);
      }
    }
    migrations.push("Physical tables verified.");

    // 2. INCREMENTAL REPAIR: Add missing columns without data loss
    const repairs = [
      { table: "User", column: "status", type: "TEXT DEFAULT 'active'" },
      { table: "User", column: "isSuperAdmin", type: "INTEGER DEFAULT 0" },
      { table: "User", column: "supervisorId", type: "TEXT" },
      { table: "App", column: "provider", type: "TEXT" },
      { table: "App", column: "isActive", type: "INTEGER DEFAULT 1" },
      { table: "Project", column: "externalContact", type: "TEXT" },
      { table: "Project", column: "internalInCharge", type: "TEXT" },
      { table: "Project", column: "templateId", type: "TEXT" },
      { table: "Project", column: "clientProfileId", type: "TEXT" },
      { table: "TimelineTemplate", column: "type", type: "TEXT DEFAULT 'project'" },
      { table: "TimelineTemplate", column: "restDays", type: "TEXT DEFAULT 'Saturday,Sunday'" },
      { table: "TimelineTemplate", column: "createdAt", type: "TEXT DEFAULT (datetime('now'))" },
      { table: "TimelineTemplate", column: "updatedAt", type: "TEXT DEFAULT (datetime('now'))" },
      { table: "TemplateTask", column: "defaultDuration", type: "REAL DEFAULT 8" },
      { table: "TemplateTask", column: "sortOrder", type: "INTEGER DEFAULT 0" },
      { table: "TimelineItem", column: "durationHours", type: "REAL DEFAULT 8" },
      { table: "TimelineItem", column: "archived", type: "INTEGER DEFAULT 0" },
      { table: "TimelineItem", column: "kanbanLaneId", type: "TEXT" },
      { table: "TimelineItem", column: "recurringParentId", type: "TEXT" },
      { table: "Skill", column: "isSystem", type: "INTEGER DEFAULT 0" },
      { table: "Skill", column: "sortOrder", type: "INTEGER DEFAULT 0" },
      { table: "Role", column: "createdAt", type: "TEXT DEFAULT (datetime('now'))" },
      { table: "ClientProfile", column: "clientCode", type: "TEXT" },
      { table: "ClientProfile", column: "accessToken", type: "TEXT" },
    ];

    for (const r of repairs) {
      try {
        await db.run(sql.raw(`ALTER TABLE ${r.table} ADD COLUMN ${r.column} ${r.type}`));
        migrations.push(`Repair: Created ${r.table}.${r.column}`);
      } catch (e) { /* Column already exists, safe to ignore */ }
    }

    // 3. SEEDING: Registry Cleanup (Remove redundant 'Daily Tasks') and Admin Bootstrap
    // Excluding 'Daily Tasks' (slug: tasks) because it's already in the main navigation
    const appsToSeed = [
      { name: "Architect", slug: "architect", description: "Map and automate operational flows.", icon: "Workflow", href: "/architect", sortOrder: 0 },
      { name: "BRD Maker", slug: "brd", description: "Generate PRD / BRD documents via AI.", icon: "ClipboardList", href: "/brd", sortOrder: 1 },
      { name: "Timeline Maker", slug: "timeline", description: "Project scheduling and Gantt visualization.", icon: "Clock", href: "/timeline", sortOrder: 2 },
      { name: "Mockup Builder", slug: "mockup", description: "Build and preview UI prototypes.", icon: "Paintbrush", href: "/mockup", sortOrder: 3 },
      { name: "Meetings Hub", slug: "meetings", description: "Centralized meeting and transcription management.", icon: "Users", href: "/meetings", sortOrder: 5 },
    ];

    for (const app of appsToSeed) {
      await db.insert(appsTable)
        .values({
          id: `app_${app.slug}`,
          name: app.name,
          slug: app.slug,
          description: app.description,
          icon: app.icon,
          href: app.href,
          isActive: true,
          isBuiltIn: true,
          sortOrder: app.sortOrder
        })
        .onConflictDoUpdate({
          target: appsTable.slug,
          set: { name: app.name, description: app.description, icon: app.icon, href: app.href, sortOrder: app.sortOrder, updatedAt: new Date().toISOString() }
        });
    }
    migrations.push("App registry updated (Redundant 'Daily Tasks' removed).");

    const admins = [
      { email: "tarkielester@gmail.com", name: "Tarkie Admin", id: "admin-root" },
      { email: "lester.alarcon@mobileoptima.com", name: "Lester Alarcon", id: "user_lester_master" },
    ];

    for (const admin of admins) {
      await db.insert(usersTable)
        .values({
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role: 'admin',
          status: 'active',
          isSuperAdmin: true,
          canAccessArchitect: true,
          canAccessBRD: true,
          canAccessTimeline: true,
          canAccessTasks: true,
          canAccessMeetings: true,
          canAccessAccounts: true,
          canAccessSolutions: true
        })
        .onConflictDoUpdate({
          target: usersTable.email,
          set: { role: 'admin', status: 'active', isSuperAdmin: true }
        });
    }
    migrations.push("Admin accounts bootstrapped.");

    // 4. BACKFILL: ensure every existing ClientProfile has clientCode + accessToken
    //    AND that its creator has an AccountMembership (lead role).
    try {
      const profilesNeedingBackfill = await db
        .select({
          id: clientProfilesTable.id,
          userId: clientProfilesTable.userId,
          companyName: clientProfilesTable.companyName,
          clientCode: clientProfilesTable.clientCode,
          accessToken: clientProfilesTable.accessToken,
        })
        .from(clientProfilesTable);

      let codeFills = 0;
      let memberFills = 0;
      for (const p of profilesNeedingBackfill) {
        const updates: Record<string, string> = {};
        if (!p.clientCode) {
          updates.clientCode = await uniqueClientCode(p.companyName);
          codeFills++;
        }
        if (!p.accessToken) {
          updates.accessToken = generateAccessToken();
        }
        if (Object.keys(updates).length > 0) {
          await db
            .update(clientProfilesTable)
            .set({ ...updates, updatedAt: new Date().toISOString() })
            .where(eq(clientProfilesTable.id, p.id));
        }
        // Ensure creator has a membership
        if (p.userId) {
          try {
            const existing = await db
              .select({ id: membershipsTable.id })
              .from(membershipsTable)
              .where(
                sql`${membershipsTable.userId} = ${p.userId} AND ${membershipsTable.clientProfileId} = ${p.id}`
              )
              .limit(1);
            if (existing.length === 0) {
              await db.insert(membershipsTable).values({
                id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
                userId: p.userId,
                clientProfileId: p.id,
                role: "lead",
                grantedBy: p.userId,
                grantedAt: new Date().toISOString(),
              });
              memberFills++;
            }
          } catch (memErr) {
            // ignore individual failures so the migrator keeps moving
          }
        }
      }
      if (codeFills > 0) migrations.push(`Backfilled clientCode for ${codeFills} accounts.`);
      if (memberFills > 0) migrations.push(`Auto-granted creator memberships for ${memberFills} accounts.`);
    } catch (backfillErr: any) {
      console.warn("[migrator] backfill warn:", backfillErr?.message);
    }

    dbStatus = true;

  } catch (err: any) {
    console.error("Master Migrator Fatal:", err);
    return NextResponse.json({ ok: false, error: err.message, stack: err.stack }, { status: 500 });
  }

  return NextResponse.json({
    hasGoogleId: !!process.env.AUTH_GOOGLE_ID,
    hasGoogleSecret: !!process.env.AUTH_GOOGLE_SECRET,
    hasAuthSecret: !!process.env.AUTH_SECRET,
    hasAuthUrl: !!process.env.AUTH_URL,
    hasTrustHost: !!process.env.AUTH_TRUST_HOST,
    hasDatabase: dbStatus,
    migrations: migrations,
    timestamp: new Date().toISOString(),
  });
}

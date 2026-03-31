import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  // BOOTSTRAP: Automatically create missing tables in production via raw SQL
  try {
    // Universal Big-Bang Bootstrapper for SQLite
    const tables = [
      `CREATE TABLE IF NOT EXISTS User (id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, emailVerified DATETIME, image TEXT, role TEXT DEFAULT 'user', isSuperAdmin BOOLEAN DEFAULT 0, status TEXT DEFAULT 'pending', canAccessArchitect BOOLEAN DEFAULT 0, canAccessBRD BOOLEAN DEFAULT 0, canAccessTimeline BOOLEAN DEFAULT 0, canAccessTasks BOOLEAN DEFAULT 1, canAccessCalendar BOOLEAN DEFAULT 1, canAccessMeetings BOOLEAN DEFAULT 0, canAccessAccounts BOOLEAN DEFAULT 0, canAccessSolutions BOOLEAN DEFAULT 0, profileRole TEXT, inviteToken TEXT UNIQUE, invitedBy TEXT, invitedAt DATETIME)`,
      `CREATE TABLE IF NOT EXISTS Account (id TEXT PRIMARY KEY, userId TEXT NOT NULL, type TEXT NOT NULL, provider TEXT NOT NULL, providerAccountId TEXT NOT NULL, refresh_token TEXT, access_token TEXT, expires_at INTEGER, token_type TEXT, scope TEXT, id_token TEXT, session_state TEXT, UNIQUE(provider, providerAccountId), FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS Session (id TEXT PRIMARY KEY, sessionToken TEXT UNIQUE NOT NULL, userId TEXT NOT NULL, expires DATETIME NOT NULL, FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS VerificationToken (identifier TEXT NOT NULL, token TEXT UNIQUE NOT NULL, expires DATETIME NOT NULL, PRIMARY KEY (identifier, token))`,
      `CREATE TABLE IF NOT EXISTS App (id TEXT PRIMARY KEY, name TEXT, slug TEXT UNIQUE, description TEXT, icon TEXT, href TEXT, isActive BOOLEAN DEFAULT 1, isBuiltIn BOOLEAN DEFAULT 0, sortOrder INTEGER DEFAULT 0, provider TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS GlobalSetting (id TEXT PRIMARY KEY, [key] TEXT UNIQUE, value TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS ClientProfile (id TEXT PRIMARY KEY, userId TEXT NOT NULL, companyName TEXT NOT NULL, industry TEXT NOT NULL, companySize TEXT, modulesAvailed TEXT NOT NULL, engagementStatus TEXT DEFAULT 'confirmed', primaryContact TEXT, primaryContactEmail TEXT, specialConsiderations TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS SavedWork (id TEXT PRIMARY KEY, userId TEXT NOT NULL, appType TEXT NOT NULL, title TEXT NOT NULL, data TEXT NOT NULL, clientProfileId TEXT, flowCategory TEXT, status TEXT DEFAULT 'open', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE, FOREIGN KEY (clientProfileId) REFERENCES ClientProfile(id))`,
      `CREATE TABLE IF NOT EXISTS Project (id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, companyName TEXT NOT NULL, clientProfileId TEXT, externalContact TEXT, internalInCharge TEXT, startDate DATETIME NOT NULL, status TEXT DEFAULT 'active', templateId TEXT, createdBy TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE, FOREIGN KEY (clientProfileId) REFERENCES ClientProfile(id))`,
      `CREATE TABLE IF NOT EXISTS TimelineTemplate (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT, restDays TEXT DEFAULT 'Saturday,Sunday', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS TemplateTask (id TEXT PRIMARY KEY, templateId TEXT NOT NULL, taskCode TEXT NOT NULL, subject TEXT NOT NULL, defaultDuration REAL DEFAULT 8, sortOrder INTEGER NOT NULL, FOREIGN KEY (templateId) REFERENCES TimelineTemplate(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS TimelineItem (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, clientProfileId TEXT, taskCode TEXT NOT NULL, subject TEXT NOT NULL, plannedStart DATETIME NOT NULL, plannedEnd DATETIME NOT NULL, actualStart DATETIME, actualEnd DATETIME, durationHours REAL DEFAULT 8, owner TEXT, assignedTo TEXT, description TEXT, status TEXT DEFAULT 'pending', sortOrder INTEGER DEFAULT 0, archived BOOLEAN DEFAULT 0, parentId TEXT, recurringFrequency TEXT, recurringUntil TEXT, isRecurringTemplate BOOLEAN DEFAULT 0, recurringParentId TEXT, kanbanLaneId TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE, FOREIGN KEY (parentId) REFERENCES TimelineItem(id), FOREIGN KEY (recurringParentId) REFERENCES TimelineItem(id))`,
      `CREATE TABLE IF NOT EXISTS TaskAssignment (id TEXT PRIMARY KEY, timelineItemId TEXT NOT NULL, userId TEXT NOT NULL, UNIQUE(timelineItemId, userId), FOREIGN KEY (timelineItemId) REFERENCES TimelineItem(id) ON DELETE CASCADE, FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS Skill (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', category TEXT NOT NULL, subcategory TEXT, slug TEXT, content TEXT NOT NULL, isActive BOOLEAN DEFAULT 1, isSystem BOOLEAN DEFAULT 0, sortOrder INTEGER DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS Roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS Role (id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS KanbanBoard (id TEXT PRIMARY KEY, projectId TEXT UNIQUE NOT NULL, name TEXT DEFAULT 'Kanban Board', createdBy TEXT NOT NULL, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS KanbanLane (id TEXT PRIMARY KEY, boardId TEXT NOT NULL, name TEXT NOT NULL, position INTEGER DEFAULT 0, mappedStatus TEXT DEFAULT 'pending', color TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (boardId) REFERENCES KanbanBoard(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS MeetingPrepSession (id TEXT PRIMARY KEY, userId TEXT NOT NULL, clientProfileId TEXT NOT NULL, meetingType TEXT NOT NULL, status TEXT DEFAULT 'in-preparation', agendaContent TEXT, questionnaireContent TEXT, discussionGuide TEXT, preparationChecklist TEXT, anticipatedRequirements TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE, FOREIGN KEY (clientProfileId) REFERENCES ClientProfile(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS TarkieMeeting (id TEXT PRIMARY KEY, userId TEXT NOT NULL, meetingPrepSessionId TEXT UNIQUE, clientProfileId TEXT, title TEXT NOT NULL, meetingType TEXT NOT NULL, companyName TEXT, scheduledAt DATETIME NOT NULL, durationMinutes INTEGER DEFAULT 60, zoomLink TEXT, qrCode TEXT, recordingEnabled BOOLEAN DEFAULT 1, recordingLink TEXT, activeApps TEXT DEFAULT '[]', customAgenda TEXT, projectId TEXT, createdBy TEXT, facilitatorId TEXT, status TEXT DEFAULT 'scheduled', createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE, FOREIGN KEY (meetingPrepSessionId) REFERENCES MeetingPrepSession(id), FOREIGN KEY (clientProfileId) REFERENCES ClientProfile(id), FOREIGN KEY (projectId) REFERENCES Project(id))`,
      `CREATE TABLE IF NOT EXISTS MeetingAttendee (id TEXT PRIMARY KEY, meetingId TEXT NOT NULL, fullName TEXT NOT NULL, position TEXT, companyName TEXT, mobileNumber TEXT, email TEXT, registrationType TEXT DEFAULT 'qr-scan', attendanceStatus TEXT DEFAULT 'expected', consentGiven BOOLEAN DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (meetingId) REFERENCES TarkieMeeting(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS MeetingTranscript (id TEXT PRIMARY KEY, meetingId TEXT UNIQUE NOT NULL, rawTranscript TEXT NOT NULL, minutesOfMeeting TEXT, generatedBRD TEXT, generatedTasks TEXT, aiQuestions TEXT DEFAULT '[]', primaryLanguage TEXT DEFAULT 'en', hasCodeSwitching BOOLEAN DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (meetingId) REFERENCES TarkieMeeting(id) ON DELETE CASCADE)`,
    ];

    for (const sql of tables) {
      try {
        await prisma.$executeRawUnsafe(sql);
      } catch (err) {
        console.warn(`Bootstrap warn on SQL: ${sql.substring(0, 50)}...`, err);
      }
    }
  } catch (e) {
    console.error("Bootstrap Error:", e);
  }

    // 2. COLUMN MIGRATION: Ensure User table and others reach parity with schema
    const migrations = [
      `ALTER TABLE User ADD COLUMN status TEXT DEFAULT "approved"`,
      `ALTER TABLE User ADD COLUMN isSuperAdmin INTEGER DEFAULT 0`,
      `ALTER TABLE User ADD COLUMN canAccessArchitect INTEGER DEFAULT 0`,
      `ALTER TABLE User ADD COLUMN canAccessBRD INTEGER DEFAULT 0`,
      `ALTER TABLE User ADD COLUMN canAccessTimeline INTEGER DEFAULT 0`,
      `ALTER TABLE User ADD COLUMN canAccessTasks INTEGER DEFAULT 1`,
      `ALTER TABLE User ADD COLUMN canAccessCalendar INTEGER DEFAULT 1`,
      `ALTER TABLE User ADD COLUMN canAccessMeetings INTEGER DEFAULT 0`,
      `ALTER TABLE User ADD COLUMN canAccessAccounts INTEGER DEFAULT 0`,
      `ALTER TABLE User ADD COLUMN canAccessSolutions INTEGER DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS SavedWork (id TEXT PRIMARY KEY, userId TEXT, appType TEXT, title TEXT, data TEXT, clientProfileId TEXT, flowCategory TEXT, status TEXT, createdAt TEXT, updatedAt TEXT)`,
      `CREATE TABLE IF NOT EXISTS GlobalSetting (id TEXT PRIMARY KEY, [key] TEXT UNIQUE, value TEXT)`,
      `CREATE TABLE IF NOT EXISTS Role (id TEXT PRIMARY KEY, name TEXT UNIQUE, createdAt TEXT)`,
      `CREATE TABLE IF NOT EXISTS UserAccount (id TEXT PRIMARY KEY, userId TEXT, name TEXT, role TEXT, createdAt TEXT, updatedAt TEXT)`
    ];

    for (const sql of migrations) {
      try {
        await prisma.$executeRawUnsafe(sql);
      } catch (e) {
        // Safe skip if table/column exists
      }
    }

    // 3. SEEDING: Ensure the App registry is populated (Overhauled)
    try {
      const apps = [
        { name: "Architect", slug: "architect", description: "Map and automate operational flows.", icon: "Workflow", href: "/architect", isActive: 1, sortOrder: 0 },
        { name: "BRD Maker", slug: "brd", description: "Generate PRD / BRD documents via AI.", icon: "ClipboardList", href: "/brd", isActive: 1, sortOrder: 1 },
        { name: "Roadmap", slug: "timeline", description: "Project scheduling and Gantt visualization.", icon: "Clock", href: "/timeline", isActive: 1, sortOrder: 2 },
        { name: "Mockup Builder", slug: "mockup", description: "Build and preview UI prototypes.", icon: "Paintbrush", href: "/mockup", isActive: 1, sortOrder: 3 },
        { name: "Daily Tasks", slug: "tasks", description: "Daily task tracking and reporting.", icon: "Zap", href: "/tasks", isActive: 1, sortOrder: 4 },
        { name: "Meetings Hub", slug: "meetings", description: "Centralized meeting and transcription management.", icon: "Users", href: "/meetings", isActive: 1, sortOrder: 5 },
      ];
      for (const app of apps) {
        await prisma.app.upsert({
          where: { slug: app.slug },
          update: { ...app, isBuiltIn: true },
          create: { ...app, isBuiltIn: true },
        });
      }

      const ADMIN_EMAILS = ["lester.alarcon@mobileoptima.com", "admin@cst.com"];
      for (const email of ADMIN_EMAILS) {
        await prisma.user.upsert({
          where: { email },
          update: { role: "admin", status: "approved" },
          create: { 
            id: email === "admin@cst.com" ? "admin-master" : `user_${Date.now()}`,
            email, 
            name: email === "admin@cst.com" ? "CST Admin" : "Lester Alarcon", 
            role: "admin",
            status: "approved"
          },
        });
      }
    } catch (e) {
      console.warn("Seeding failed (non-critical):", e);
    }

  let dbStatus = false;
  try {
    await prisma.user.count();
    dbStatus = true;
  } catch (e) {
    dbStatus = false;
  }

  // SECURE: We only return whether the variable IS PRESENT (true/false)
  return NextResponse.json({
    hasGoogleId: !!process.env.AUTH_GOOGLE_ID,
    hasGoogleSecret: !!process.env.AUTH_GOOGLE_SECRET,
    hasAuthSecret: !!process.env.AUTH_SECRET,
    hasAuthUrl: !!process.env.AUTH_URL,
    hasTrustHost: !!process.env.AUTH_TRUST_HOST,
    hasDatabase: dbStatus,
    timestamp: new Date().toISOString(),
  });
}

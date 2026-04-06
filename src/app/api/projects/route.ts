import { NextResponse } from "next/server";
import { db } from "@/db";
import { users as usersTable, projects as projectsTable, timelineItems as timelineItemsTable, timelineTemplates as timelineTemplatesTable } from "@/db/schema";
import { auth } from "@/auth";
import { eq, desc, or, like, inArray } from "drizzle-orm";
import { calculateClientEndDate } from "@/lib/utils/business-days";
import { ensureUserInDb } from "@/lib/utils/auth-sync";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/projects
 * MIGRATED TO DRIZZLE
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ENSURE: Synchronize user with DB to prevent FK failure
    await ensureUserInDb(session);

    const { name, startDate, templateId, clientProfileId, events, assignedIds } = await req.json();

    if (!name || !events || !Array.isArray(events)) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const projectId = `proj_${Date.now()}`;
    const nowStr = new Date().toISOString();

    /**
     * SAFE DATE HELPER: 
     * Prevents .toISOString() crashes on invalid AI dates.
     */
    const safeIsoDate = (dStr: any, fallback: string = nowStr) => {
        if (!dStr) return fallback;
        const d = new Date(dStr);
        return isNaN(d.getTime()) ? fallback : d.toISOString();
    };

    const sanitizedStartDate = safeIsoDate(startDate);

    // Drizzle Transaction to ensure both project and its items are created
    const project = await db.transaction(async (tx) => {
      // 1. Create the project
      await tx.insert(projectsTable).values({
        id: projectId,
        userId: userId,
        name: name,
        companyName: name,
        clientProfileId: clientProfileId || null,
        startDate: sanitizedStartDate,
        templateId: templateId || null,
        assignedIds: assignedIds ? (Array.isArray(assignedIds) ? assignedIds.join(",") : assignedIds) : null,
        internalInCharge: userId,
        createdBy: userId,
        defaultPaddingDays: 3, 
        shareToken: crypto.randomBytes(16).toString("hex"),
        status: "active",
        createdAt: nowStr,
        updatedAt: nowStr,
      });

      // 2. Create the timeline items and their assignments
      if (events.length > 0) {
        const teamIds = Array.isArray(assignedIds) ? assignedIds : (assignedIds ? assignedIds.split(",") : []);

        for (let i = 0; i < events.length; i++) {
          const event = events[i];
          const itemId = `ti_${projectId}_${i}_${Math.random().toString(36).substring(7)}`;
          const subject = (event.subject || "").toUpperCase();

          // INTELLIGENT ASSIGNMENT LOGIC
          let finalOwner = "INTERNAL TEAM";
          let assignToClient = false;
          let assignToTeam = true;

          if (subject.includes("KICK-OFF") || subject.includes("KICK OFF")) {
            finalOwner = "TEAM + CLIENT";
            assignToClient = true;
          } else if (subject.includes("MASTER DATA") || subject.includes("MASTERDATA")) {
            finalOwner = "TEAM + CLIENT";
            assignToClient = true;
          } else if (subject.includes("CONTRACT SIGN-OFF") || subject.includes("SIGN OFF")) {
            finalOwner = "CLIENT";
            assignToClient = true;
            assignToTeam = false;
          } else if (subject.includes("USER ACCEPTANCE") || subject.includes("UAT")) {
            finalOwner = "TEAM + CLIENT";
            assignToClient = true;
          } else if (subject.includes("TRAINING")) {
            finalOwner = "TEAM + CLIENT";
            assignToClient = true;
          } else if (subject.includes("GO LIVE") || subject.includes("GO-LIVE")) {
            finalOwner = "TEAM + CLIENT";
            assignToClient = true;
          } else if (subject.includes("FEEDBACK")) {
            finalOwner = "TEAM + CLIENT";
            assignToClient = true;
          }

          await tx.insert(timelineItemsTable).values({
            id: itemId,
            projectId: projectId,
            clientProfileId: clientProfileId || null,
            taskCode: event.taskCode || `T-${String(i + 1).padStart(2, '0')}`,
            subject: event.subject || "Untitled Task",
            plannedStart: safeIsoDate(event.startDate, sanitizedStartDate),
            plannedEnd: safeIsoDate(event.endDate, sanitizedStartDate),
            externalPlannedEnd: event.externalPlannedEnd || calculateClientEndDate(event.endDate, 3),
            durationHours: event.durationHours || 8,
            owner: finalOwner,
            description: event.description || null,
            status: "pending",
            sortOrder: i + 1,
            paddingDays: event.paddingDays || 0,
            createdAt: nowStr,
            updatedAt: nowStr,
          });

          // Create explicit assignments for the team
          if (assignToTeam && teamIds.length > 0) {
            const assignmentValues = teamIds.map((tid: string) => ({
              id: `ta_${itemId}_${tid.substring(0, 4)}`,
              timelineItemId: itemId,
              userId: tid,
            }));
            
            try {
              const { taskAssignments } = require("@/db/schema");
              await tx.insert(taskAssignments).values(assignmentValues);
            } catch (err) {
              console.warn("Assignment join failed (schema sync?):", err);
            }
          }
        }
      }

      // Return the project summary
      const rows = await tx.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
      return rows[0];
    });

    return NextResponse.json(project);
  } catch (error: any) {
    console.error("[api/projects] CRITICAL SAVE ERROR:", error);
    
    // UNMASK: Tell the user exactly what rule they are breaking
    const diagnostic = {
        error: "Atomic Save Failed",
        message: error.message || "Unknown Failure",
        code: error.code || "N/A",
        hint: (error.message || "").includes("FOREIGN KEY") ? "User account synchronization issue." : 
              (error.message || "").includes("NOT NULL") ? "A mandatory field (Subject/Code) was empty." :
              "General Database Constraint."
    };
    
    return NextResponse.json(diagnostic, { status: 500 });
  }
}

/**
 * GET /api/projects
 * MIGRATED TO DRIZZLE
 */
export async function GET(req: Request) {
  let session: any = null;
  try {
    session = await auth();
    const userId = session?.user?.id;
    const userRole = session?.user?.role;
    
    const { searchParams } = new URL(req.url);
    const shareToken = searchParams.get('shareToken');
    const projectId = searchParams.get('id');

    // PUBLIC ACCESS VIA SHARE TOKEN
    if (shareToken) {
        const publicProject = await db.select().from(projectsTable).where(eq(projectsTable.shareToken, shareToken)).limit(1);
        if (publicProject.length === 0) return NextResponse.json({ error: "Invalid share token" }, { status: 404 });
        return NextResponse.json({ project: publicProject[0], isPublic: true });
    }

    if (!userId) {
      console.warn("[api/projects] Unauthorized access attempt.");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const filter = searchParams.get('filter');
    // EXPLICIT LOGIC: Admins see all. Owners see their own. Assigned users see assigned.
    const isAdmin = (userRole?.toLowerCase() === "admin");
    const version = "v3-safemode";

    console.log(`[api/projects] Fetching (Version: ${version}). UserID: ${userId} | Role: ${userRole} | IsAdmin: ${isAdmin}`);

    /**
     * ORG CHART LOGIC (SUPERVISOR OVERSIGHT)
     */
    let subordinateIds: string[] = [];
    if (!isAdmin) {
        try {
            const subordinates = await db.select({ id: usersTable.id })
                .from(usersTable)
                .where(eq(usersTable.supervisorId, userId));
            subordinateIds = subordinates.map(s => s.id);
            if (subordinateIds.length > 0) {
                console.log(`[api/projects] Supervisor detected. Monitoring subordinates: ${subordinateIds.length}`);
            }
        } catch (orgErr) {
            console.error("[api/projects] Org chart fetch failed:", orgErr);
        }
    }

    let data: any[] = [];
    
    try {
        // 1. PRIMARY ATTEMPT: Rich data with Template Joins
        let baseQuery = db.select({
            id: projectsTable.id,
            userId: projectsTable.userId,
            name: projectsTable.name,
            companyName: projectsTable.companyName,
            clientProfileId: projectsTable.clientProfileId,
            startDate: projectsTable.startDate,
            status: projectsTable.status,
            templateId: projectsTable.templateId,
            assignedIds: projectsTable.assignedIds,
            internalInCharge: projectsTable.internalInCharge,
            createdBy: projectsTable.createdBy,
            createdAt: projectsTable.createdAt,
            updatedAt: projectsTable.updatedAt,
            templateType: timelineTemplatesTable.type,
            templateName: timelineTemplatesTable.name
        })
        .from(projectsTable)
        .leftJoin(
            timelineTemplatesTable, 
            eq(projectsTable.templateId, timelineTemplatesTable.id)
        );

        // ARCHIVING FILTER
        const showArchived = searchParams.get('showArchived') === 'true';
        const archiveFilter = eq(projectsTable.archived, showArchived);

        if (isAdmin) {
             // Admin Bypass: See all (but still filtered by archive status)
             data = await baseQuery.where(archiveFilter).orderBy(desc(projectsTable.updatedAt));
        } else if (filter === 'mine') {
             data = await baseQuery.where(and(eq(projectsTable.userId, userId), archiveFilter)).orderBy(desc(projectsTable.updatedAt));
        } else {
             // COLLABORATIVE FILTER: Owner OR Assigned OR Subordinate
             const filters = [
                eq(projectsTable.userId, userId),
                like(projectsTable.assignedIds, `%${userId}%`)
             ];
             
             if (subordinateIds.length > 0) {
                filters.push(inArray(projectsTable.userId, subordinateIds));
             }

             data = await baseQuery.where(and(or(...filters), archiveFilter)).orderBy(desc(projectsTable.updatedAt));
        }
    } catch (dbError: any) {
        console.warn("[api/projects] JOIN ERROR - Falling back to simple query:", dbError.message);
        
        // 2. FALLBACK ATTEMPT: Simple projects list (NO JOINS) - Guaranteed to work if DB is up
        let simpleQuery = db.select().from(projectsTable);
        
        if (filter === 'mine') {
            data = await simpleQuery.where(eq(projectsTable.userId, userId)).orderBy(desc(projectsTable.updatedAt));
        } else if (isAdmin) {
            data = await simpleQuery.orderBy(desc(projectsTable.updatedAt));
        } else {
            data = await simpleQuery.where(or(eq(projectsTable.userId, userId), like(projectsTable.assignedIds, `%${userId}%`))).orderBy(desc(projectsTable.updatedAt));
        }
    }

    return NextResponse.json({ projects: data, _v: version, isAdmin });
  } catch (error: any) {
    console.error("[api/projects] CRITICAL ERROR:", error);
    return NextResponse.json({ 
        error: "Failed to fetch projects",
        detail: error.message || "Internal Database Error",
        userRole: session?.user?.role || "unknown",
        _v: "v3-safemode"
    }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { db } from "@/db";
import { skills as skillsTable, presentationTemplates } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

// Read the design skill content from the docs file at build time is not possible,
// so we inline it here as the seed data.
const DESIGN_SKILL_CONTENT = `# Tarkie Slide Builder — Design System
### Knowledge File for AI-Powered Slide Generation
**Source:** Extracted from Tarkie Kick-Off Deck (Accutech Steel & Service Inc.)
**Version:** 1.0

## Color Palette
| Token | Hex | Usage |
|---|---|---|
| --color-primary | #2162F9 | Main brand blue |
| --color-primary-dark | #2C448A | Dark navy — footer, table headers |
| --color-accent-green | #43EB7C | Highlights, markers, dashes |
| --color-white | #FFFFFF | Text on dark, light backgrounds |
| --color-black | #000000 | Text on white, table borders |
| --color-surface-blue | #DCEAF7 | Table row alternates |

## Typography
- Display: Quicksand Bold — hero titles on dark slides
- Heading: DM Sans Bold — slide titles on light slides  
- Body: Inter Regular — body text, bullets, tables
- Caption: Arial MT Pro — footer, copyright

## Slide Layouts
- full-bleed-dark: Full blue (#2162F9) background, centered content
- content-light: White background, top title, content below
- content-dark: Dark navy (#2C448A) background
- two-column: Split layout
- table-full: Title top, full-width table

## Component Specs
- Tables: Dark header (#2C448A), green accent border, alternating rows (#DCEAF7)
- Bullets: Green (#43EB7C) markers, Inter Regular body
- Phase Cards: Green banner, white body with green left border
- SPARKLE rows: Blue letter cell, navy label, white description

## Footer: Every slide has dark navy footer with white Tarkie logo and copyright
## Confidential tag: Top-right on every slide`;

const KICKOFF_TEMPLATE_SLIDES = JSON.stringify([
  { order: 1, title: "Cover", layout: "full-bleed-dark", blocks: [
    { blockType: "text", intelligenceMapping: "company_name", defaultContent: JSON.stringify({ heading: "Kick-Off Meeting", subtitle: "Aligning on next steps, timelines, and success metrics", tagline: "Your One-Stop Automation Partner" }) }
  ]},
  { order: 2, title: "Agenda", layout: "content-light", blocks: [
    { blockType: "bullet-list", defaultContent: JSON.stringify({ items: ["Project Team Introduction", "Pain Points Discussion", "SPARKLE Framework Overview", "Current Process Review", "Recommended Process Flow", "Implementation Phases", "Prerequisites & Timeline", "Next Steps"] }) }
  ]},
  { order: 3, title: "Client Project Team", layout: "content-light", blocks: [
    { blockType: "table", intelligenceMapping: "contacts", defaultContent: JSON.stringify({ columns: ["ROLE", "NAME", "CONTACT DETAILS"], rows: [] }), defaultPrompt: "Generate the client project team table from intelligence contacts" }
  ]},
  { order: 4, title: "Tarkie Project Team", layout: "content-light", blocks: [
    { blockType: "table", defaultContent: JSON.stringify({ columns: ["ROLE", "NAME", "CONTACT DETAILS"], rows: [["Project Manager", "", ""], ["Implementation Lead", "", ""], ["Support Engineer", "", ""]] }) }
  ]},
  { order: 5, title: "Pain Points — Section Divider", layout: "full-bleed-dark", blocks: [
    { blockType: "text", defaultContent: JSON.stringify({ heading: "PAIN POINTS", decorativeDashes: true }) }
  ]},
  { order: 6, title: "Pain Points", layout: "content-light", blocks: [
    { blockType: "bullet-list", intelligenceMapping: "pain_points", defaultPrompt: "List the key pain points identified for this client's field workforce operations", defaultContent: JSON.stringify({ items: [] }) }
  ]},
  { order: 7, title: "SPARKLE Framework — Section Divider", layout: "full-bleed-dark", blocks: [
    { blockType: "text", defaultContent: JSON.stringify({ heading: "SPARKLE FRAMEWORK", decorativeDashes: true }) }
  ]},
  { order: 8, title: "SPARKLE Framework", layout: "content-dark", blocks: [
    { blockType: "sparkle-row", defaultContent: JSON.stringify({ rows: [
      { letter: "S", label: "Single Source of Truth", description: "One platform for all field operations data" },
      { letter: "P", label: "Proof of Delivery", description: "GPS-tagged photo evidence for every task" },
      { letter: "A", label: "Attendance & Time", description: "Biometric + GPS verification for field workforce" },
      { letter: "R", label: "Real-time Visibility", description: "Live dashboard tracking of all field activities" },
      { letter: "K", label: "Key Performance Indicators", description: "Automated KPI tracking and reporting" },
      { letter: "L", label: "Location Intelligence", description: "Route optimization and geofencing" },
      { letter: "E", label: "Expense Management", description: "Digital expense claims with receipt capture" }
    ]})}
  ]},
  { order: 9, title: "Current Process — Section Divider", layout: "full-bleed-dark", blocks: [
    { blockType: "text", defaultContent: JSON.stringify({ heading: "CURRENT PROCESS", decorativeDashes: true }) }
  ]},
  { order: 10, title: "Current Process Flow", layout: "content-light", blocks: [
    { blockType: "text", defaultPrompt: "Describe the client's current manual field operations process based on the intelligence file", defaultContent: JSON.stringify({ body: "" }) }
  ]},
  { order: 11, title: "Recommended Process — Section Divider", layout: "full-bleed-dark", blocks: [
    { blockType: "text", defaultContent: JSON.stringify({ heading: "RECOMMENDED PROCESS", decorativeDashes: true }) }
  ]},
  { order: 12, title: "Recommended Process with Tarkie", layout: "content-light", blocks: [
    { blockType: "text", defaultPrompt: "Describe the recommended field operations process using Tarkie modules agreed for this account", defaultContent: JSON.stringify({ body: "" }) }
  ]},
  { order: 13, title: "Field App — Section Divider", layout: "full-bleed-dark", blocks: [
    { blockType: "text", defaultContent: JSON.stringify({ heading: "TARKIE FIELD APP", decorativeDashes: true }) }
  ]},
  { order: 14, title: "Field App Overview", layout: "two-column", blocks: [
    { blockType: "bullet-list", defaultContent: JSON.stringify({ items: ["GPS-based attendance", "Task management with photo proof", "Expense claim submission", "Real-time location tracking", "Digital forms and checklists"] }) },
    { blockType: "image", defaultContent: JSON.stringify({ alt: "Tarkie Field App Screenshot", src: "" }) }
  ]},
  { order: 15, title: "Modules — Section Divider", layout: "full-bleed-dark", blocks: [
    { blockType: "text", defaultContent: JSON.stringify({ heading: "MODULES", decorativeDashes: true }) }
  ]},
  { order: 16, title: "Agreed Modules", layout: "content-light", blocks: [
    { blockType: "phase-card", intelligenceMapping: "agreed_modules", defaultPrompt: "List the Tarkie modules agreed for implementation", defaultContent: JSON.stringify({ phases: [] }) }
  ]},
  { order: 17, title: "Implementation — Section Divider", layout: "full-bleed-dark", blocks: [
    { blockType: "text", defaultContent: JSON.stringify({ heading: "IMPLEMENTATION PHASES", decorativeDashes: true }) }
  ]},
  { order: 18, title: "Phase 1 — Setup & Configuration", layout: "content-light", blocks: [
    { blockType: "phase-card", intelligenceMapping: "implementation_phases", defaultContent: JSON.stringify({ phases: [{ label: "PHASE 1", title: "Setup & Configuration", items: ["Account creation", "Master data upload", "Module configuration", "User provisioning"] }] }) }
  ]},
  { order: 19, title: "Phase 2 — Training & Rollout", layout: "content-light", blocks: [
    { blockType: "phase-card", defaultContent: JSON.stringify({ phases: [{ label: "PHASE 2", title: "Training & User Onboarding", items: ["Admin training", "End-user training", "Pilot group testing", "Full rollout"] }] }) }
  ]},
  { order: 20, title: "Phase 3 — Monitoring & Support", layout: "content-light", blocks: [
    { blockType: "phase-card", defaultContent: JSON.stringify({ phases: [{ label: "PHASE 3", title: "Monitoring & Continuous Support", items: ["Usage monitoring", "Issue resolution", "Feature optimization", "Quarterly business review"] }] }) }
  ]},
  { order: 21, title: "Fit-Gap Analysis", layout: "table-full", blocks: [
    { blockType: "table", defaultPrompt: "Generate a fit-gap analysis table for the agreed modules vs client requirements", defaultContent: JSON.stringify({ columns: ["REQUIREMENT", "TARKIE CAPABILITY", "FIT/GAP", "NOTES"], rows: [] }) }
  ]},
  { order: 22, title: "Prerequisites", layout: "table-full", blocks: [
    { blockType: "table", defaultContent: JSON.stringify({ columns: ["PREREQUISITE", "OWNER", "TARGET DATE", "STATUS"], rows: [["Master data template submission", "Client", "", "Pending"], ["Device procurement (Android)", "Client", "", "Pending"], ["Admin account setup", "Tarkie", "", "Pending"]] }) }
  ]},
  { order: 23, title: "Timeline", layout: "content-light", blocks: [
    { blockType: "text", defaultContent: JSON.stringify({ body: "Implementation timeline will be presented using the Timeline Maker tool." }) }
  ]},
  { order: 24, title: "Next Steps — Section Divider", layout: "full-bleed-dark", blocks: [
    { blockType: "text", defaultContent: JSON.stringify({ heading: "NEXT STEPS", decorativeDashes: true }) }
  ]},
  { order: 25, title: "Next Steps", layout: "table-full", blocks: [
    { blockType: "table", intelligenceMapping: "next_steps", defaultContent: JSON.stringify({ columns: ["ACTION ITEM", "OWNER", "DUE DATE", "STATUS"], rows: [] }), defaultPrompt: "Generate next steps action items for post kick-off meeting" }
  ]},
  { order: 26, title: "Thank You", layout: "full-bleed-dark", blocks: [
    { blockType: "text", defaultContent: JSON.stringify({ heading: "THANK YOU!", subtitle: "Looking forward to a successful partnership", tagline: "Tarkie — Your One-Stop Automation Partner" }) }
  ]}
]);

export async function POST() {
  try {
    // 1. Create tables via raw SQL (Turso migration)
    const migrations = [
      `CREATE TABLE IF NOT EXISTS "PresentationTemplate" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "designSkillId" TEXT,
        "slideDefinitions" TEXT NOT NULL,
        "version" TEXT DEFAULT '1.0' NOT NULL,
        "isActive" INTEGER DEFAULT 1 NOT NULL,
        "createdBy" TEXT,
        "createdAt" TEXT DEFAULT (datetime('now')) NOT NULL,
        "updatedAt" TEXT DEFAULT (datetime('now')) NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS "Presentation" (
        "id" TEXT PRIMARY KEY,
        "clientProfileId" TEXT REFERENCES "ClientProfile"("id"),
        "templateId" TEXT,
        "designSkillId" TEXT,
        "name" TEXT NOT NULL,
        "presentationType" TEXT DEFAULT 'custom' NOT NULL,
        "status" TEXT DEFAULT 'draft' NOT NULL,
        "intelligenceSnapshot" TEXT,
        "designSnapshot" TEXT,
        "createdBy" TEXT NOT NULL,
        "exportedPdfUrl" TEXT,
        "createdAt" TEXT DEFAULT (datetime('now')) NOT NULL,
        "updatedAt" TEXT DEFAULT (datetime('now')) NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS "PresentationSlide" (
        "id" TEXT PRIMARY KEY,
        "presentationId" TEXT NOT NULL REFERENCES "Presentation"("id") ON DELETE CASCADE,
        "order" INTEGER DEFAULT 0 NOT NULL,
        "title" TEXT NOT NULL,
        "layout" TEXT DEFAULT 'content-light' NOT NULL,
        "backgroundOverride" TEXT,
        "createdAt" TEXT DEFAULT (datetime('now')) NOT NULL,
        "updatedAt" TEXT DEFAULT (datetime('now')) NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS "PresentationBlock" (
        "id" TEXT PRIMARY KEY,
        "slideId" TEXT NOT NULL REFERENCES "PresentationSlide"("id") ON DELETE CASCADE,
        "order" INTEGER DEFAULT 0 NOT NULL,
        "blockType" TEXT NOT NULL,
        "intelligenceMapping" TEXT,
        "prompt" TEXT,
        "content" TEXT,
        "isAiGenerated" INTEGER DEFAULT 0 NOT NULL,
        "isLocked" INTEGER DEFAULT 0 NOT NULL,
        "generationHistory" TEXT,
        "lastGeneratedAt" TEXT,
        "createdAt" TEXT DEFAULT (datetime('now')) NOT NULL,
        "updatedAt" TEXT DEFAULT (datetime('now')) NOT NULL
      )`
    ];

    // Add columns to existing tables (safe with IF NOT EXISTS pattern via TRY)
    const alterations = [
      `ALTER TABLE "User" ADD COLUMN "canAccessPresentations" INTEGER DEFAULT 0 NOT NULL`,
      `ALTER TABLE "ClientProfile" ADD COLUMN "intelligenceContent" TEXT`,
    ];

    for (const stmt of migrations) {
      try {
        await db.run(sql.raw(stmt));
      } catch (e: any) {
        // Table might already exist
        console.log("Migration note:", e.message?.substring(0, 80));
      }
    }

    for (const alter of alterations) {
      try {
        await db.run(sql.raw(alter));
      } catch (e: any) {
        console.log("Alteration note:", e.message?.substring(0, 80));
      }
    }

    // 2. Seed design skill (upsert pattern)
    const existingSkill = await db.select().from(skillsTable)
      .where(eq(skillsTable.slug, "tarkie-standard-presentation")).limit(1);
    
    let designSkillId: string;
    if (existingSkill.length === 0) {
      const skillId = `sk_pres_${Date.now().toString(36)}`;
      await db.insert(skillsTable).values({
        id: skillId,
        name: "Tarkie Standard Presentation Design",
        description: "Design skill for the standard Tarkie presentation deck - colors, fonts, layouts extracted from the Accutech Kick-Off deck",
        category: "presentation-design",
        subcategory: "standard",
        slug: "tarkie-standard-presentation",
        content: DESIGN_SKILL_CONTENT,
        isActive: true,
        isSystem: true,
        sortOrder: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      designSkillId = skillId;
    } else {
      designSkillId = existingSkill[0].id;
    }

    // 3. Seed Kick-Off template (upsert pattern)
    const existingTemplate = await db.select().from(presentationTemplates)
      .where(eq(presentationTemplates.name, "Kick-Off Meeting")).limit(1);

    if (existingTemplate.length === 0) {
      const templateId = `tpl_kickoff_${Date.now().toString(36)}`;
      await db.insert(presentationTemplates).values({
        id: templateId,
        name: "Kick-Off Meeting",
        description: "Standard kick-off deck for new client onboarding — 26 slides covering team intro, pain points, SPARKLE framework, implementation phases, and next steps",
        designSkillId,
        slideDefinitions: KICKOFF_TEMPLATE_SLIDES,
        version: "1.0",
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({ 
      success: true, 
      message: "Presentation Builder tables created, design skill seeded, Kick-Off template seeded",
      designSkillId
    });
  } catch (err: any) {
    console.error("Seed error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

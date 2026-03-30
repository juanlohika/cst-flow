import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

/**
 * POST /api/skills/seed
 *
 * One-time endpoint that populates the Skill table with:
 * 1. All existing skills/*.md content (reverse-documented into DB)
 * 2. AI behavior descriptions for every app in the system
 *
 * Idempotent — uses upsert on (category, subcategory, slug).
 * Only callable by authenticated users.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const created: string[] = [];

    // ─── Phase 5.5: Seed Roles ───────────────────────────────────────────
    for (const roleName of STANDARD_ROLES) {
      const existingRole = await prisma.role.findFirst({ where: { name: roleName } });
      if (!existingRole) {
        await prisma.role.create({
          data: {
            id: `role-${roleName.toLowerCase().replace(/\s+/g, "-")}`,
            name: roleName,
          },
        });
        created.push(`role created: ${roleName}`);
      }
    }

    for (const skill of INITIAL_SKILLS) {
      // Upsert by name — if it already exists, update content but don't overwrite user edits to name/description
      const existing = await prisma.skill.findFirst({
        where: { category: skill.category, slug: skill.slug ?? undefined },
      });

      if (existing) {
        await prisma.skill.update({
          where: { id: existing.id },
          data: { content: skill.content, isSystem: true, updatedAt: new Date() },
        });
        created.push(`updated: ${skill.name}`);
      } else {
        await prisma.skill.create({ data: { ...skill, isSystem: true } });
        created.push(`created: ${skill.name}`);
      }
    }

    return NextResponse.json({ success: true, results: created });
  } catch (err: any) {
    console.error("Skill seed error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── Standard Roles for Task Management ────────────────────────────────────
const STANDARD_ROLES = [
  "Project Manager",
  "Business Analyst",
  "Developer",
  "Quality Assurance",
  "Client",
  "Stakeholder",
  "Facilitator"
];

// ─── Skill definitions ─────────────────────────────────────────────────────

const INITIAL_SKILLS = [
  // ── Meeting Prep — Industry Skills ──────────────────────────────────────
  {
    name: "Retail Industry Guide",
    description: "Discovery questions, pain points, and expected workflows for retail client engagements.",
    category: "meeting-prep",
    subcategory: "industry",
    slug: "retail",
    content: `# Retail Industry Knowledge Base

## Industry Context
The retail industry requires process optimization in inventory management, point-of-sale systems, customer relationship management, and supply chain operations. Tarkie implementations typically focus on:
- Automating inventory tracking and management
- Streamlining POS and payment processing
- Enhancing customer data collection and segmentation
- Optimizing supply chain and vendor management
- Implementing data analytics for sales performance

## Key Pain Points
- Manual inventory counts and tracking (non-real-time visibility)
- Fragmented customer data across multiple systems
- Inefficient checkout processes and payment reconciliation
- Lack of data-driven merchandising decisions
- Supply chain delays and stockouts

## Typical Discovery Questions
1. **Current Inventory Management:**
   - How do you currently track inventory? (Manual, spreadsheet, basic POS)
   - What's your current counting frequency? (Daily, weekly, monthly)
   - Do you have visibility into stock levels in real-time?
   - How many locations/stores do you operate?

2. **Customer Data:**
   - Are you capturing customer information at checkout?
   - How do you segment customers for marketing?
   - Do you track purchase history per customer?
   - Any loyalty program in place?

3. **Payment Processing:**
   - What payment methods do you accept?
   - How many transactions per day?
   - Any issues with payment reconciliation?

4. **Reporting & Analytics:**
   - What metrics matter most to you? (Sales, margins, inventory turns)
   - How frequently do you need reports?
   - Who are the key stakeholders for reports?

5. **Integration Needs:**
   - Do you have existing ERP or accounting software?
   - Do you need to sync sales data to accounting?`
  },
  {
    name: "Kickoff Meeting Guide",
    description: "Structure and key objectives for initial project kickoff meetings.",
    category: "meeting-prep",
    subcategory: "meeting-type",
    slug: "kickoff",
    content: `# Kickoff Meeting Guide

## Objectives
- Introduce the project team and stakeholders
- Align on project vision and goals
- Define project scope (high-level)
- Establish communication protocols and meeting cadence
- Review project timeline and key milestones

## Agenda
1. **Introductions:** Team roles and responsibilities
2. **Project Vision:** Why are we doing this?
3. **Success Criteria:** What does a successful project look like?
4. **Project Scope:** High-level overview of what's in and out
5. **Timeline:** Upcoming milestones and deadlines
6. **Communication:** Tools, cadence, and contact points
7. **Next Steps:** Immediate action items

## Key Questions
- What are the top 3 goals for this implementation?
- Who are the primary users of the system?
- Are there any known constraints or deadlines (e.g., peak season)?
- How would you describe the success of this project in 6 months?`
  },
  {
    name: "Requirements Deep-Dive Guide",
    description: "Focused questions for detailed requirements gathering workshops.",
    category: "meeting-prep",
    subcategory: "meeting-type",
    slug: "requirements-deep-dive",
    content: `# Requirements Deep-Dive Guide

## Objectives
- Gather detailed functional requirements for specific modules
- Map out as-is vs to-be business processes
- Identify technical constraints and integration points
- Document edge cases and specialized workflows

## Agenda
1. **Process Review:** Step-by-step walkthrough of current workflow
2. **Pain Point Analysis:** Identifying bottlenecks and manual steps
3. **To-Be Mapping:** How the new system will solve pain points
4. **Data Requirements:** Fields, validations, and logic
5. **Integration Points:** How data flows between systems
6. **Reporting Needs:** Specific data points required for analysis

## Key Questions
- Walk me through the life of a [Transaction/Inventory Item/Customer Record]
- What happens if [Edge Case A] occurs?
- Are there any manual approvals required in this step?
- What data is currently missing that you wish you had?`
  },
  // ── Meeting-App Level Skills ───────────────────────────────────────────
  {
    name: "Standard Minutes of Meeting",
    description: "Extracts title, attendees, takeaways, and action steps from transcripts using professional formatting.",
    category: "meeting-app",
    slug: "minutes-template",
    content: `You are a professional scribe. Your task is to generate Minutes of Meeting from a transcript.

## Format Requirements
- **Meeting Title**: [Extracted or provided title]
- **Date & Time**: [Extracted or provided time]
- **Attendees**: [List of attendees from attendance records or transcript]
- **Key Takeaways**:
  - List only explicitly stated agreements or major realizations.
- **Action Next Steps**:
  - List only tasks that were explicitly assigned or agreed upon.

## Strict Rules
- **Rule 1**: DO NOT HALLUCINATE. Only include what was explicitly stated in the transcript or facilitator notes.
- **Rule 2**: If something is nonsensical or sounds like misheard terminology, DO NOT guess. Instead, add a clarifying question in the 'Insights' or 'Clarifications' section.
- **Rule 3**: Convert mixed Tagalog/English (Taglish) into professional English.`
  },
  {
    name: "BRD Section Generator",
    description: "Extracts functional and non-functional requirements from a discovery session transcript.",
    category: "brd",
    slug: "brd-generator",
    content: `You are a Senior Business Analyst. Your task is to extract Business Requirements from a discovery transcript.

## Focus Areas
- **Business Process**: The high-level workflow described.
- **Functional Requirements**: Specific features or capabilities requested.
- **User Roles**: Who will be using the features.
- **Data Requirements**: Key entities and attributes mentioned.
- **Constraints**: Technical or business limitations mentioned.

## Style Guidelines
- Use "The system shall..." or "The user will be able to..." phrasing.
- Be specific and measurable.
- Group requirements by functional area.`
  }
];

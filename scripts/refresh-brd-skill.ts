/**
 * REFRESH BRD SKILL SCRIPT
 * 
 * Overwrites the active BRD skill in the remote Turso DB with the user's new framework.
 */
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import * as path from "path";
import { skills } from "../src/db/schema";
import { eq, and } from "drizzle-orm";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const NEW_BRD_SKILL_CONTENT = `
# Tarkie BRD Maker — AI Skill

## Purpose
This skill turns the AI into an expert **Senior Business Analyst** that guides users through structured requirement elicitation and produces a complete, standardized BRD aligned to the **Tarkie three-platform ecosystem**.

### Platform Reference
| Platform | Primary Users | Core Purpose |
|---|---|---|
| **Tarkie Field App** | Field Users | Capture data, execute tasks, enforce rules. |
| **Tarkie Dashboard** | Admins, Ops | Configure behavior, monitor entries, reports. |
| **Tarkie Manager App** | Managers | Mobile access to team data, approvals, reviews. |

---

## Standard BRD Output Format
1. Project Overview (1.1 Name, 1.2 Background, 1.3 Objective, 1.4 In Scope, 1.5 Out of Scope)
2. Process Flow (Role, Process Step, Frequency, Output Table)
3. Current vs. Future State (Table 3.1 & 3.2)
4. Functional Requirements (4.1 Field, 4.2 Dashboard, 4.3 Manager)
5. User Stories by Role (Objectives)
6. User Stories (UX Standpoint)
7. Acceptance Criteria (Given/When/Then)
8. Functional Constraints

---

## Elicitation Steps (MANDATORY)
Follow these in sequence. Do NOT generate the BRD until Step 1-3 are complete.

### Step 1 — Project Overview
Ask:
- "What is the project or feature name?"
- "What is the background? Current behavior vs. client need?"
- "What is the main objective?"
- "What is explicitly in scope and out of scope?"

### Step 2 — Process Flow
Ask:
- "Walk me through the process from start to finish. Who does what?"
- "What triggers this? Output at each step?"
- "Conditional branches or approvals?"

### Step 3 — Current vs. Future State
Ask:
- "How does the system behave today? Gaps/Pain points?"
- "What should it look like after? Measurable outcome?"

---

## Generation Rules
- Use H1 for the Title.
- Include a Revision History table (Revision | Date | Description | Status).
- Map every FR to at least one AC.
- If a platform (e.g. Manager App) is not mentioned, ASK: "Is the Manager App intentionally excluded?"
`.trim();

async function main() {
  const url = process.env.DATABASE_URL;
  const authToken = process.env.DATABASE_AUTH_TOKEN;

  if (!url) throw new Error("DATABASE_URL is missing");

  console.log("⚡ Connecting to Turso...");
  const client = createClient({ url, authToken });
  const db = drizzle(client);

  console.log("🔍 Checking for existing BRD skill...");
  
  const existing = await db.select().from(skills)
    .where(and(eq(skills.category, "brd"), eq(skills.isActive, true)))
    .limit(1);

  if (existing.length > 0) {
    console.log("📝 Updating existing skill:", existing[0].name);
    await db.update(skills)
      .set({ 
        content: NEW_BRD_SKILL_CONTENT,
        description: "Official Tarkie-Standard BRD Elicitation & Drafting Framework.",
        updatedAt: new Date().toISOString()
      })
      .where(eq(skills.id, existing[0].id));
  } else {
    console.log("🆕 Creating new BRD skill...");
    await db.insert(skills).values({
      name: "Tarkie BRD Maker",
      category: "brd",
      content: NEW_BRD_SKILL_CONTENT,
      description: "Official Tarkie-Standard BRD Elicitation & Drafting Framework.",
      isActive: true,
      isSystem: true
    });
  }

  console.log("✅ SUCCESS: BRD SKILL REFRESHED.");
  process.exit(0);
}

main().catch(err => {
  console.error("error:", err);
  process.exit(1);
});

# Presentation Builder — Technical Documentation
### Product: Team OS Module | Tarkie / MobileOptima
**Version:** 3.3  
**Date:** April 2026  
**Prepared by:** Development Team  
**Supersedes:** v2.0 (Kick-Off App only)  
**Changelog v3.1:** Added Section 15 — Editing & Content Lifecycle  
**Changelog v3.2:** Added Section 15.8 — Two-Way Intelligence Sync; updated lifecycle flow and summary  
**Changelog v3.3:** Resolved all open questions — Section 16 converted from questions to confirmed decisions

---

## 1. Executive Summary

The **Presentation Builder** is a full Team OS module — not a standalone kick-off tool. It is a general-purpose, AI-powered, block-based slide builder that lives inside Team OS alongside the existing suite of apps: Flowchart Maker, BRD Maker, Timeline Maker, and Mockup Builder.

Like those apps, every presentation created in the Presentation Builder is **saved to the Account Repository** — the central profile for each client account in the system. This means a kick-off deck, a project update deck, a proposal deck — all live on the account, alongside its flowcharts, BRDs, timelines, and mockups.

The three pillars that distinguish v3 from v2:

**1. Account Repository Integration** — Presentations are one of many artifact types saved per account. The builder reads from and writes to the account's repository, just like every other Team OS app.

**2. Account Intelligence File** — Each account can have a `[account].md` file maintained by the acquisition and project team. This is a living markdown document capturing everything known about the client — industry, pain points, key contacts, sale notes, learnings. The Presentation Builder reads this file to auto-generate context-aware, pre-filled slides without the user typing a single prompt.

**3. Template System** — The builder ships with standardized presentation templates (starting with Kick-Off Meeting). Templates are managed in the Admin Console, linked to a `design.md` skills file that governs all visual output. Any presentation can also be saved as a new template for future reuse.

---

## 2. The Bigger Picture: Presentation Builder in Team OS

### 2.1 Team OS App Ecosystem

```
┌─────────────────────────────────────────────────────────────────┐
│                        TEAM OS                                   │
│                                                                  │
│   ┌────────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐   │
│   │ Flowchart  │  │   BRD    │  │ Timeline │  │  Mockup    │   │
│   │   Maker    │  │  Maker   │  │  Maker   │  │  Builder   │   │
│   └─────┬──────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘   │
│         │              │             │               │           │
│         └──────────────┴─────────────┴───────────────┘           │
│                              │                                    │
│                              ▼                                    │
│                  ┌───────────────────────┐                        │
│                  │   ACCOUNT REPOSITORY   │                       │
│                  │                       │                        │
│                  │  /flowcharts          │                        │
│                  │  /brds                │                        │
│                  │  /timelines           │                        │
│                  │  /mockups             │                        │
│                  │  /presentations  ◄────┼── NEW                  │
│                  │  /intelligence.md◄────┼── NEW                  │
│                  └───────────────────────┘                        │
│                                                                   │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │              PRESENTATION BUILDER  (NEW)                  │   │
│   │                                                          │   │
│   │  Reads: account data, intelligence.md, templates        │   │
│   │  Writes: /presentations in Account Repository            │   │
│   │  Embeds: Flowchart Maker, Timeline Maker (existing)      │   │
│   └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │                   ADMIN CONSOLE                           │   │
│   │  Templates  |  design.md Skills  |  Block Prompts        │   │
│   └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 What "Saved to Account" Means

Every Team OS app saves its outputs to a structured repository on the account. The Presentation Builder follows the same pattern:

| App | Saves to Account As |
|---|---|
| Flowchart Maker | `/flowcharts/{id}` — diagram data + SVG |
| BRD Maker | `/brds/{id}` — business requirement document |
| Timeline Maker | `/timelines/{id}` — timeline data |
| Mockup Builder | `/mockups/{id}` — mockup frames |
| **Presentation Builder** | **`/presentations/{id}`** — slides + blocks + PDF export |

An account's repository page shows all artifacts across all apps in one view — the client's full project history at a glance.

---

## 3. Account Intelligence File

### 3.1 What It Is

Each account can have an `intelligence.md` file — a living markdown document maintained collaboratively by the acquisition team, project managers, and anyone who has interacted with the client. It captures everything the system needs to know about the account to generate high-quality, pre-filled content.

This is the **context layer** that makes the AI generation truly intelligent. Instead of writing prompts from scratch, the Presentation Builder reads `intelligence.md` and uses it as the foundation for every AI call.

### 3.2 Structure of `intelligence.md`

```markdown
# [Account Name] — Intelligence File
Last updated: [date] by [user]

## Company Profile
- Industry: Steel fabrication and service
- Size: ~120 employees, 40+ field engineers
- Location: Taguig, Metro Manila
- Primary contact: Mr. Hanz Chan (Decision Maker)
- Stage: Implementation – Phase 1

## Key Contacts
| Name | Role | Contact |
|---|---|---|
| Mr. Hanz Chan | Decision Maker | hanzjordanchan@gmail.com |
| Ms. Sonia Briton | HR Officer | hraccutechsteel01@gmail.com |

## Pain Points (Identified by Acquisition Team)
- Lack of delivery tracking and on-site visibility
- No visibility of field engineers' breaks and active work time
- Manual expense logging — no digital trail
- Inaccurate timestamps for time-ins
- No overtime tracking for site engineers
- No photo proof attached to task completions

## Acquisition Notes
- Client came in via referral from [source]
- Main driver: HR compliance and field visibility
- Objections raised: cost, user adoption by field engineers
- Decision timeline: signed proposal Jan 20, 2026

## Tarkie Modules Agreed
- Phase 1: Attendance, Itinerary, Expense, Location, Photos

## Learnings / Meeting Notes
- [date] Kick-Off: Client confirmed pain points above. Mr. Chan is
  the champion. Sonia will handle data validation.
- Field engineers are on Android devices, varying specs.
- Biometrics (Sentry) already in place — Tarkie Attendance 
  complements, not replaces.

## Open Items
- [ ] Master data template to be submitted by Jan 27
- [ ] On-site process mapping TBD
```

### 3.3 How the Presentation Builder Uses It

When a user creates a new presentation for an account, the builder:

1. Reads the account's `intelligence.md`
2. Parses key sections: profile, contacts, pain points, modules, notes
3. Injects this as context into every AI block generation call
4. Pre-fills known fields: company name, logo, contact tables, pain points list
5. Generates a "ready to review" first draft — the user edits, not types

The result: opening a Kick-Off template for an account with a populated `intelligence.md` produces a **near-complete, context-accurate deck in under 60 seconds.**

### 3.4 Maintaining `intelligence.md`

- Editable directly from the Account profile page in Team OS
- Any team member with account access can add notes
- Versioned — each save creates a snapshot (last 10 versions retained)
- Can be updated during or after any meeting from any Team OS app
- Future: AI can suggest updates to `intelligence.md` based on meeting notes or new presentations created

---

## 4. Template System

### 4.1 What Templates Are

A **Presentation Template** is a pre-defined deck structure: an ordered list of slides, each with pre-defined blocks, default prompts, and placeholder content. Templates standardize how Tarkie presents information to clients across all accounts.

Templates are managed in the **Admin Console** — internal Tarkie team only.

### 4.2 Available Templates (Starting Set)

| Template | Purpose | Slides |
|---|---|---|
| **Kick-Off Meeting** | First formal meeting post-contract | 26 slides (based on Accutech deck) |
| **Project Update** | Mid-project status presentation | TBD |
| **Proposal** | Pre-sale solution presentation | TBD |
| **Training Overview** | App onboarding for client team | TBD |
| **QBR (Quarterly Review)** | Quarterly business review | TBD |

New templates can be added anytime in the Admin Console — no code required.

### 4.3 How a Template Creates a Deck

```
User selects account → clicks "New Presentation"
              │
              ▼
        Choose Template
     ┌──────────────────┐
     │ • Kick-Off       │
     │ • Project Update │
     │ • Proposal       │
     │ • Blank          │
     └──────────────────┘
              │
              ▼
  Template loads + Account Intelligence injected
              │
              ▼
  Pre-filled draft deck created:
  - Company name, logo → auto-injected
  - Contact tables → populated from intelligence.md contacts
  - Pain points → populated from intelligence.md pain points
  - Modules → populated from agreed modules in intelligence.md
  - Prompts → default prompts per block, with account context baked in
              │
              ▼
  User reviews, edits, and presents
```

### 4.4 Template Definition Structure

Each template is stored in the Admin Console as a JSON definition:

```json
{
  "id": "kickoff-v1",
  "name": "Kick-Off Meeting",
  "description": "Standard kick-off deck for new client onboarding",
  "design_skill": "tarkie-standard",
  "version": "1.0",
  "slides": [
    {
      "order": 1,
      "title": "Cover",
      "layout": "full-bleed-dark",
      "blocks": [
        {
          "block_type": "text",
          "intelligence_mapping": "company_name",
          "default_content": "Kick-Off Meeting",
          "is_locked": false
        },
        {
          "block_type": "image",
          "intelligence_mapping": "company_logo",
          "is_locked": false
        }
      ]
    },
    {
      "order": 2,
      "title": "Agenda",
      "layout": "content-light",
      "blocks": [
        {
          "block_type": "bullet-list",
          "default_prompt": "Generate a standard kick-off meeting agenda for a field workforce automation implementation",
          "intelligence_mapping": null,
          "default_content": ["Project Team", "Pain Points", "SPARKLE Framework", "Current Process", "Implementation Phases", "Next Steps"]
        }
      ]
    },
    {
      "order": 3,
      "title": "Client Project Team",
      "layout": "content-light",
      "blocks": [
        {
          "block_type": "table",
          "intelligence_mapping": "contacts",
          "columns": ["ROLE", "NAME", "CONTACT DETAILS"]
        }
      ]
    }
  ]
}
```

The `intelligence_mapping` field tells the builder which section of `intelligence.md` to pull data from for pre-filling. When no mapping exists, the default prompt is used for AI generation.

---

## 5. Admin Console — Skills & Design Management

### 5.1 Design Skills

The Admin Console hosts **Design Skills** — the `design.md` files that govern all visual output. Each skill set defines the complete visual language for a presentation style.

```
Admin Console → Skills → Design Skills
├── tarkie-standard     ← default (extracted from Accutech deck)
├── tarkie-minimal      ← future: lighter variation
└── [custom]            ← future: client-specific branding
```

A design skill contains:
- Color palette (all hex values)
- Font stack (heading, body, display, caption)
- Font sizes (H1–H4, body, caption)
- Component specs (table styles, bullet styles, phase cards)
- Slide layout rules (margins, footer, confidential tag)
- PDF export spec

When a template is created, it is linked to a design skill. All AI generation calls and component renders for that template's presentations read from the linked skill.

**Updating a design skill automatically updates all future presentations using that template.** Existing presentations are unaffected (they snapshot the skill at creation time).

### 5.2 Block Prompts Library

The Admin Console also manages a **Block Prompts Library** — default AI prompt starters for each block type. These are the prompts loaded when a user opens a block's prompt field.

```
Admin Console → Skills → Block Prompts
├── bullet-list.pain-points
├── bullet-list.agenda
├── table.project-team
├── table.next-steps
├── phase-card.implementation
├── sparkle-row.framework
└── [custom prompts per template]
```

These prompts are editable by admins — they don't require code changes.

---

## 6. Core Concept: How the Builder Works (Updated)

```
ACCOUNT PROFILE
      │
      ├── intelligence.md  (company info, pain points, contacts, notes)
      ├── /flowcharts
      ├── /brds
      ├── /timelines
      ├── /mockups
      └── /presentations
              │
              ▼
      NEW PRESENTATION
      Select Template  ──► loads slide + block structure
              │
              ▼
      INTELLIGENCE INJECTION
      intelligence.md parsed → known fields pre-filled
              │
              ▼
      AI DRAFT GENERATION
      Remaining blocks → AI generates using:
        - account context from intelligence.md
        - design rules from linked design.md skill
        - default prompts from block prompts library
              │
              ▼
      BUILDER MODE (3-panel)
      Review → Edit → Reorder → Add/Remove blocks
              │
              ▼
      PRESENTATION MODE (full screen)
      Present live → Edit inline during meeting
              │
              ▼
      POST-MEETING UPDATE
      Update intelligence.md with new learnings
              │
              ▼
      EXPORT PDF
      Saved to account /presentations repo
      Shareable link → client approval
```

---

## 7. System Architecture (Updated)

```
┌──────────────────────────────────────────────────────────────────┐
│                         TEAM OS                                   │
│                                                                   │
│  ACCOUNT REPOSITORY                                               │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  account_id: 1042 — Accutech Steel & Service Inc.           │ │
│  │                                                             │ │
│  │  intelligence.md  flowcharts[]  brds[]  timelines[]         │ │
│  │  mockups[]        presentations[]                           │ │
│  └──────────────────────────────┬──────────────────────────────┘ │
│                                 │                                 │
│            ┌────────────────────┼──────────────────┐             │
│            ▼                    ▼                  ▼             │
│  ┌──────────────────┐  ┌────────────────┐  ┌─────────────────┐  │
│  │ Flowchart Maker  │  │  BRD / Timeline│  │ PRESENTATION    │  │
│  │ (existing)       │  │  (existing)    │  │ BUILDER (new)   │  │
│  └──────────────────┘  └────────────────┘  └────────┬────────┘  │
│                                                      │           │
│                         ┌────────────────────────────┤           │
│                         ▼                            ▼           │
│              ┌────────────────────┐    ┌───────────────────────┐ │
│              │   AI LAYER         │    │  EMBEDDED SUB-APPS    │ │
│              │                    │    │                       │ │
│              │  Anthropic API     │    │  Flowchart Maker      │ │
│              │  + design.md skill │    │  Timeline Maker       │ │
│              │  + intelligence.md │    │  (block embeds)       │ │
│              │  + block prompts   │    └───────────────────────┘ │
│              └────────────────────┘                              │
│                                                                   │
│  ADMIN CONSOLE                                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Templates  |  Design Skills (design.md)  |  Block Prompts  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## 8. Data Model (Updated)

### 8.1 Account Repository Schema

```
Account (existing)
├── id
├── name
├── logo_url
├── industry
├── [... existing fields ...]
│
├── intelligence_file         → AccountIntelligence (1:1)
│
└── repository
    ├── flowcharts[]          → FK to Flowchart (existing app)
    ├── brds[]                → FK to BRD (existing app)
    ├── timelines[]           → FK to Timeline (existing app)
    ├── mockups[]             → FK to Mockup (existing app)
    └── presentations[]       → FK to Presentation (new)

AccountIntelligence
├── id
├── account_id               → FK to Account
├── content                  (markdown text — the intelligence.md content)
├── parsed_data              (JSON — structured extract: contacts, pain_points, modules, etc.)
├── version                  (integer, increments on each save)
├── updated_by               → FK to User
└── updated_at
```

### 8.2 Presentation & Deck Schema

```
Presentation
├── id
├── account_id               → FK to Account
├── template_id              → FK to PresentationTemplate (null if blank)
├── design_skill_id          → FK to DesignSkill (snapshotted at creation)
├── name                     (e.g., "Kick-Off Meeting — Jan 2026")
├── presentation_type        (kickoff | project-update | proposal | training | custom)
├── status                   (draft | in_meeting | pending_approval | approved | archived)
├── intelligence_snapshot    (JSON — copy of parsed intelligence.md at creation time)
├── created_by               → FK to User
├── created_at / updated_at
├── exported_pdf_url         (populated after first export)
└── slides[]                 → ordered list of Slide

Slide
├── id
├── presentation_id
├── order
├── title                    (internal label)
├── layout                   (full-bleed-dark | content-light | content-dark |
│                             two-column | table-full | flowchart | timeline)
├── background_override      (optional hex)
└── blocks[]                 → ordered list of Block

Block
├── id
├── slide_id
├── order
├── block_type               (text | bullet-list | table | phase-card |
│                             flowchart-reactflow | flowchart-mermaid |
│                             timeline | image | divider | sparkle-row |
│                             fit-gap-table | next-steps-table | custom)
├── intelligence_mapping     (string — which intelligence.md field pre-fills this block)
├── prompt                   (string — AI prompt, may be auto-generated from template)
├── prompt_context           (JSON — injected context: account intelligence + design rules)
├── content                  (JSON — actual block data)
├── is_ai_generated          (bool)
├── is_locked                (bool)
└── last_generated_at

PresentationTemplate
├── id
├── name                     (e.g., "Kick-Off Meeting")
├── description
├── design_skill_id          → FK to DesignSkill
├── version
├── is_active
├── created_by               → FK to User (admin only)
└── slide_definitions[]      → ordered template slide configs (JSON)

DesignSkill
├── id
├── name                     (e.g., "tarkie-standard")
├── description
├── design_md_content        (raw markdown — the design.md file content)
├── brand_config_json        (parsed JSON — runtime version of design.md)
├── version
└── is_active
```

---

## 9. AI Generation Layer (Updated)

### 9.1 Generation Pipeline

Every AI block generation call now has three context sources stacked together:

```
1. DESIGN SKILL (visual rules)
   └─ colors, fonts, sizes, table styles from design.md

2. ACCOUNT INTELLIGENCE (content context)
   └─ company profile, industry, pain points, contacts,
      agreed modules, acquisition notes from intelligence.md

3. USER PROMPT (intent)
   └─ the specific instruction for this block
      (default from template, or user-written)

All three → combined system prompt → Anthropic API → structured JSON → rendered block
```

### 9.2 System Prompt Template

```
You are a content generator for Tarkie's Presentation Builder.

=== DESIGN RULES (from design skill: {skill_name}) ===
{design_md_content}

Output must comply with all design rules above.
Return content only in the block JSON schema provided.
No markdown, no preamble. Highlight key terms per the design rules.
Max 6 bullets per list. Max 8 rows per table.
Tone: professional, concise, tech-forward.

=== ACCOUNT INTELLIGENCE ===
Company: {company_name}
Industry: {industry}
Key Contacts: {contacts}
Pain Points: {pain_points}
Agreed Modules: {agreed_modules}
Acquisition Notes: {acquisition_notes}
Additional Context: {other_intelligence}

=== BLOCK TYPE ===
{block_type}

=== OUTPUT SCHEMA ===
{block_json_schema}

=== USER PROMPT ===
{user_prompt}
```

### 9.3 Intelligence Pre-Fill vs. AI Generation

Not every block needs an AI call. The system distinguishes between:

| Source | When Used | Example |
|---|---|---|
| **Intelligence pre-fill** | Block has `intelligence_mapping` + data exists in `intelligence.md` | Contact table → filled from contacts section |
| **AI generation** | Block has a prompt; intelligence provides context | Pain points bullet list → AI generates from known pain points + account context |
| **Manual entry** | No prompt, no mapping; user types directly | Custom text block, section title |
| **Sub-app embed** | Block type is flowchart or timeline | React Flow / Timeline Maker loaded with existing account data |

---

## 10. Account Repository UI

### 10.1 Account Profile Page — Repository Tab

The account profile in Team OS gains a unified **Repository** tab showing all saved artifacts:

```
┌─────────────────────────────────────────────────────────┐
│  Accutech Steel & Service Inc.                          │
│  ──────────────────────────────                         │
│  [Profile]  [Repository]  [Intelligence]  [Activity]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  PRESENTATIONS                          [+ New]         │
│  ┌──────────────────┐ ┌───────────────────┐             │
│  │ Kick-Off Meeting │ │ Project Update    │             │
│  │ Jan 20, 2026     │ │ Mar 5, 2026       │             │
│  │ ● Approved       │ │ ○ Draft           │             │
│  └──────────────────┘ └───────────────────┘             │
│                                                         │
│  FLOWCHARTS                             [+ New]         │
│  ┌──────────────────┐                                   │
│  │ Current Process  │                                   │
│  │ Jan 18, 2026     │                                   │
│  └──────────────────┘                                   │
│                                                         │
│  TIMELINES                              [+ New]         │
│  ┌──────────────────┐                                   │
│  │ Implementation   │                                   │
│  │ Jan 20, 2026     │                                   │
│  └──────────────────┘                                   │
│                                                         │
│  BRDs / MOCKUPS                         [+ New]         │
│  [empty]                                                │
└─────────────────────────────────────────────────────────┘
```

### 10.2 Intelligence Tab

```
┌─────────────────────────────────────────────────────────┐
│  [Profile]  [Repository]  [Intelligence]  [Activity]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  intelligence.md                    [Edit]  [History]  │
│  Last updated: Apr 5, 2026 by Casey Francisco           │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ # Accutech Steel — Intelligence File            │   │
│  │                                                 │   │
│  │ ## Company Profile                              │   │
│  │ Industry: Steel fabrication...                  │   │
│  │                                                 │   │
│  │ ## Pain Points                                  │   │
│  │ - Lack of delivery tracking...                  │   │
│  │ ...                                             │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [Use in New Presentation ↗]                            │
└─────────────────────────────────────────────────────────┘
```

---

## 11. Builder UI (Updated)

### 11.1 New Presentation Flow

```
From Account Repository → [+ New Presentation]
          │
          ▼
  ┌──────────────────────────────────┐
  │  Choose a template               │
  │                                  │
  │  ● Kick-Off Meeting              │
  │  ○ Project Update                │
  │  ○ Proposal                      │
  │  ○ Training Overview             │
  │  ○ Blank (no template)           │
  │                                  │
  │  Intelligence file detected ✓    │
  │  "Will pre-fill from             │
  │   Accutech intelligence.md"      │
  │                                  │
  │  [Create Presentation]           │
  └──────────────────────────────────┘
          │
          ▼
  Builder opens with pre-filled draft
```

### 11.2 Builder Mode — 3-Panel Layout

```
┌───────────────────────────────────────────────────────────────┐
│  Accutech Steel — Kick-Off Meeting        [Present] [Export]  │
├─────────────┬─────────────────────────────┬───────────────────┤
│             │                             │                   │
│  SLIDES     │   CANVAS                    │  BLOCK CONFIG     │
│             │                             │                   │
│  [Cover]    │  ┌─────────────────────┐   │  Block: table     │
│  [Agenda]   │  │  Client Project     │   │                   │
│  [Team] ◄──►│  │  Team               │   │  Intelligence     │
│  [Pain Pts] │  │  ┌────┬────┬──────┐ │   │  source: contacts │
│  [SPARKLE]  │  │  │Role│Name│Email │ │   │  ✓ Pre-filled     │
│  [Phases]   │  │  ├────┼────┼──────┤ │   │                   │
│  [Timeline] │  │  │ DM │Hanz│hanz@ │ │   │  AI Prompt        │
│  [Next]     │  │  │ HR │Soni│hr@.. │ │   │  ┌─────────────┐  │
│             │  │  └────┴────┴──────┘ │   │  │ "Generate   │  │
│  [+ Slide]  │  │  [+ Add Row]        │   │  │  team table"│  │
│             │  └─────────────────────┘   │  └─────────────┘  │
│             │                             │  [Regenerate]     │
│             │                             │                   │
│             │                             │  Layout: light    │
│             │                             │  Lock block: [ ]  │
└─────────────┴─────────────────────────────┴───────────────────┘
```

---

## 12. Design Skills in Admin Console

### 12.1 Managing Design Skills

```
Admin Console → Presentation Builder → Design Skills

┌──────────────────────────────────────────────────┐
│  Design Skills                      [+ New Skill] │
├──────────────────────────────────────────────────┤
│                                                  │
│  tarkie-standard  v1.0  ● Active                 │
│  Extracted from: Accutech Kick-Off Deck          │
│  Used by: Kick-Off Meeting template              │
│  [Edit]  [Preview]  [Duplicate]                  │
│                                                  │
│  tarkie-minimal   v1.0  ○ Draft                  │
│  [Edit]  [Preview]  [Duplicate]                  │
└──────────────────────────────────────────────────┘
```

### 12.2 Editing a Design Skill

The skill editor is a split-pane markdown editor:
- Left: `design.md` content (editable)
- Right: Live preview of a sample slide applying the current skill

Saving a design skill triggers the `parse-design-md` script which regenerates `brand-config.json` for that skill. All new presentations using that skill will pick up the update.

---

## 13. Tech Stack

### 13.1 Frontend

| Layer | Technology | Reason |
|---|---|---|
| Framework | React (existing Team OS) | Consistency; component-per-block-type |
| State | Zustand | Per-presentation state, undo/redo |
| Block Editing | TipTap | Inline rich text |
| Drag-and-Drop | dnd-kit | Slide reorder, block reorder |
| Markdown | `react-markdown` + `remark` | Render + parse `intelligence.md` |
| Styling | Tailwind + CSS vars from brand-config.json | All design tokens dynamic |
| Flowchart embed | React Flow (existing) | Block component wrapper |
| Timeline embed | Timeline Maker (existing) | Block component wrapper |
| Presentation Mode | Custom fullscreen CSS | 16:9, no external dependency |

### 13.2 Backend

| Layer | Technology | Reason |
|---|---|---|
| API | Existing Team OS API | Auth, accounts, repo pattern |
| AI | Anthropic API `claude-sonnet-4-20250514` | Block generation + intelligence parsing |
| Database | PostgreSQL (existing) | All new tables follow existing patterns |
| File Storage | S3 / existing | PDFs, logos, exported assets |
| PDF Export | Puppeteer (Node.js) | Highest fidelity rendering |
| Markdown parse | `gray-matter` + custom parser | intelligence.md structured extraction |

### 13.3 Admin Console Additions

| Feature | Implementation |
|---|---|
| Template editor | JSON form builder (existing admin pattern) |
| Design skill editor | CodeMirror markdown editor + live preview |
| Block prompts library | Simple CRUD list — key/value pairs |

---

## 14. Development Plan (Claude Code)

### Phase 1 — Account Intelligence + Repository (Days 1–3)
- [ ] `AccountIntelligence` model + API endpoints (CRUD)
- [ ] `intelligence.md` editor on Account profile page (Intelligence tab)
- [ ] Markdown parser: extracts structured data (contacts, pain points, modules, notes)
- [ ] Repository tab on Account profile (list all app artifacts including presentations placeholder)
- [ ] `Presentation` model + API endpoints (CRUD, scoped to account)

### Phase 2 — Admin Console: Templates + Design Skills (Days 4–5)
- [ ] `DesignSkill` model + Admin Console editor (markdown editor + live preview)
- [ ] `parse-design-md` script → generates `brand-config.json` per skill
- [ ] `PresentationTemplate` model + JSON definition editor in Admin Console
- [ ] Block Prompts library CRUD in Admin Console
- [ ] Seed: `tarkie-standard` design skill (from existing `design.md`)
- [ ] Seed: `Kick-Off Meeting` template (26 slides from Accutech deck)

### Phase 3 — Core Builder (Days 6–9)
- [ ] New Presentation flow: template picker + intelligence injection
- [ ] 3-panel builder layout (slides panel, canvas, block config)
- [ ] Block types: `text`, `bullet-list`, `table`, `divider`, `image`
- [ ] All basic blocks editable inline, drag-to-reorder
- [ ] Intelligence pre-fill: blocks with `intelligence_mapping` auto-populated
- [ ] Block config panel: prompt field, intelligence source indicator, lock toggle

### Phase 4 — AI Generation (Days 10–12)
- [ ] Anthropic API integration: design skill + intelligence + prompt → structured JSON
- [ ] Per-block Generate / Regenerate buttons
- [ ] Generation history (last 3 per block)
- [ ] Remaining block types: `phase-card`, `sparkle-row`, `fit-gap-table`, `next-steps-table`
- [ ] Pre-built prompts loaded from Admin Console block prompts library

### Phase 5 — Presentation Mode + PDF Export (Days 13–15)
- [ ] Fullscreen Presentation Mode (branded, 16:9, footer + CONFIDENTIAL on every slide)
- [ ] Inline edit still active in Presentation Mode
- [ ] Puppeteer PDF export endpoint
- [ ] PDF stored to account `/presentations` repo, download link returned
- [ ] Presentation status workflow: draft → in_meeting → pending_approval → approved

### Phase 6 — Sub-App Integrations (Days 16–18)
- [ ] `flowchart-reactflow` block (embeds existing Flowchart Maker)
- [ ] `flowchart-mermaid` block (AI dictation → Mermaid diagram)
- [ ] `timeline` block (embeds existing Timeline Maker)
- [ ] All three export correctly into PDF via Puppeteer

### Phase 7 — Polish + Save as Template (Days 19–21)
- [ ] Save any presentation as a new template (Admin Console)
- [ ] Client logo upload per presentation
- [ ] Shareable PDF approval link (signed URL)
- [ ] Post-meeting: prompt to update `intelligence.md` with new notes
- [ ] Account Repository tab: all presentations listed, status badges, PDF link

**Total estimated: ~21 working days with Claude Code**  
*(Up from 16 days — 5 additional days for Account Intelligence + Admin Console infrastructure, which pays dividends across all future Team OS apps)*

---

## 15. File & Folder Structure (Updated)

```
/presentation-builder
│
├── /knowledge                        ← seeded from Admin Console
│   ├── skills/
│   │   └── tarkie-standard/
│   │       ├── design.md             ← source of truth
│   │       └── brand-config.json     ← auto-generated
│   ├── templates/
│   │   └── kickoff-v1.json           ← slide + block definitions
│   └── block-prompts/
│       └── prompts.json              ← default prompts per block type
│
├── /components
│   ├── /blocks                       ← one component per block type
│   │   ├── TextBlock.jsx
│   │   ├── BulletListBlock.jsx
│   │   ├── TableBlock.jsx
│   │   ├── PhaseCardBlock.jsx
│   │   ├── SparkleRowBlock.jsx
│   │   ├── FitGapTableBlock.jsx
│   │   ├── NextStepsTableBlock.jsx
│   │   ├── FlowchartReactFlowBlock.jsx
│   │   ├── FlowchartMermaidBlock.jsx
│   │   ├── TimelineBlock.jsx
│   │   ├── ImageBlock.jsx
│   │   └── DividerBlock.jsx
│   │
│   ├── /slide
│   │   ├── SlideCanvas.jsx
│   │   ├── SlidePanel.jsx
│   │   └── SlideFooter.jsx
│   │
│   ├── /builder
│   │   ├── BuilderLayout.jsx
│   │   ├── BlockPicker.jsx
│   │   ├── BlockConfig.jsx
│   │   ├── IntelligenceBadge.jsx     ← shows "pre-filled from intelligence.md"
│   │   └── TopBar.jsx
│   │
│   ├── /presentation
│   │   └── PresentationMode.jsx
│   │
│   └── /account
│       ├── IntelligenceEditor.jsx    ← intelligence.md edit view
│       └── RepositoryTab.jsx         ← unified artifact list on account
│
├── /api
│   ├── presentations.js
│   ├── slides.js
│   ├── blocks.js
│   ├── intelligence.js               ← CRUD + parse endpoints
│   ├── ai-generate.js                ← Anthropic API handler
│   └── export-pdf.js
│
├── /admin
│   ├── design-skills.js
│   ├── templates.js
│   └── block-prompts.js
│
└── /scripts
    └── parse-design-md.js            ← design.md → brand-config.json
```

---

## 15. Editing & Content Lifecycle

A core guarantee of the Presentation Builder: **nothing generated from a template is ever locked.** Every slide, every block, every piece of AI-generated content is fully editable at any point — before, during, and after the meeting. This section formally defines all editing modes and the complete content lifecycle.

---

### 15.1 The Core Guarantee

```
Template generates presentation
          │
          ▼
All slides and blocks created with default content
          │
          ▼
NOTHING IS LOCKED BY DEFAULT
Every slide → editable
Every block → editable, re-promptable, replaceable
Every prompt → visible and rewritable
          │
          ▼
User is always in control
```

The only exception is blocks the user explicitly locks themselves (via the `Lock block` toggle in the Block Config panel) to prevent accidental edits during a live meeting.

---

### 15.2 Three Block Editing Modes

Every block supports all three modes simultaneously. They are not mutually exclusive.

#### Mode 1 — Inline Edit (Direct)
Click directly on any content within a block on the canvas and edit it. No AI, no prompts — just type. This is the fastest path for small corrections during the meeting.

- Works on: all text, all table cells, all bullet items, phase card content, SPARKLE row descriptions
- Powered by: TipTap inline editor
- Saves: automatically on blur (click away)
- Branding: preserved — font, color, and size remain unchanged when editing inline

```
[Rendered block on canvas]
         │
         ▼
Click on any text → cursor appears → type
         │
         ▼
Auto-saves on blur
```

#### Mode 2 — Re-Prompt & Regenerate (AI)
Every block has an editable prompt field in the Block Config right panel. Even if the block was generated by a template default prompt, the user can rewrite the prompt and click Regenerate. The block content is replaced with new AI output while branding is preserved.

- Works on: all AI-generatable block types (text, bullet-list, table, phase-card, sparkle-row, fit-gap-table, next-steps-table, flowchart-mermaid)
- The previous version is saved in generation history before replacing
- Generation history retains the last 3 versions per block — user can roll back

```
Block Config panel (right):

  Current prompt:
  ┌──────────────────────────────────────┐
  │ "List pain points for a steel        │
  │  company with field engineers"       │
  └──────────────────────────────────────┘
  [Edit Prompt ✎]   [Regenerate ↺]
  History: v3 (current) · v2 · v1

         │
         ▼
User rewrites prompt:
  "Focus only on attendance and
   overtime tracking pain points"
         │
         ▼
[Regenerate] → AI call (design skill + intelligence + new prompt)
         │
         ▼
Block content replaced → previous saved as v2 in history
         │
         ▼
[Undo to v2] available if needed
```

#### Mode 3 — Structural Edit (Add / Remove / Reorder)
For structured block types, users can modify the structure directly — add rows, remove rows, reorder items — without touching the prompt or triggering an AI call. This is the primary mode during live meetings when a client is in the room and confirming details.

| Block Type | Structural Actions |
|---|---|
| `bullet-list` | Add item `[+ Add]`, remove item `[×]`, drag to reorder |
| `table` | Add row `[+ Add Row]`, remove row `[×]`, edit any cell inline |
| `phase-card` | Add phase `[+ Add Phase]`, remove phase, add/remove modules per phase |
| `sparkle-row` | Add row, remove row, edit letter / label / description inline |
| `fit-gap-table` | Add row, remove row, dropdown for Assessment column |
| `next-steps-table` | Add row, remove row, date picker for Due Date column |
| `agenda (bullet-list)` | Add item, remove item, drag to reorder |

---

### 15.3 Slide-Level Editing

Beyond individual blocks, users can also edit at the slide level from the canvas and slides panel.

| Action | Where | How |
|---|---|---|
| Rename slide | Left slides panel | Click slide title → inline edit |
| Reorder slide | Left slides panel | Drag and drop |
| Duplicate slide | Left slides panel | Right-click → Duplicate |
| Delete slide | Left slides panel | Right-click → Delete |
| Change layout | Block Config panel (slide tab) | Dropdown: full-bleed-dark, content-light, content-dark, two-column, table-full |
| Change background | Block Config panel (slide tab) | Color picker — overrides layout default |
| Add a new block | Canvas | Click `[+ Add Block]` → Block Picker |
| Remove a block | Canvas | Hover block → click `[×]` top-right |
| Reorder blocks | Canvas | Drag blocks vertically within the slide |
| Lock/unlock block | Block Config panel | Toggle `Lock block` — prevents inline edits |

---

### 15.4 Slide-Level Prompt (Regenerate All Blocks)

In addition to per-block prompts, each slide has an optional **Slide Prompt** — a single high-level instruction that regenerates all AI-generatable blocks on that slide at once. This is the fastest way to pivot an entire slide's direction without editing each block individually.

```
Slide Config (right panel, slide tab):

  Slide Prompt:
  ┌──────────────────────────────────────────┐
  │ "Rewrite this entire slide focusing on   │
  │  attendance and overtime issues only —   │
  │  remove expense-related items"           │
  └──────────────────────────────────────────┘
  [Regenerate All Blocks on This Slide ↺]

         │
         ▼
Each AI-generatable block on the slide receives:
  - The slide-level prompt as override context
  - Its own block schema (so each block still renders correctly)
  - Design skill + account intelligence (unchanged)
         │
         ▼
All blocks regenerated simultaneously
Each block's previous version saved in its generation history
```

Non-AI blocks (images, dividers, manually-entered content) are unaffected by the slide-level prompt.

---

### 15.5 Full Content Lifecycle

```
TEMPLATE LOADED
All blocks created with:
  - intelligence pre-fill (where mapping exists)
  - default template prompts (where no mapping)
  - AI-generated content on first open
          │
          ▼
PRE-MEETING (Builder Mode)
  Review all slides
  Inline edit any content
  Re-prompt any block
  Add / remove / reorder slides and blocks
  Run slide-level regenerate for full pivots
  [Sync proposals queued silently if mapped blocks edited]
          │
          ▼
DURING MEETING (Presentation Mode — full screen)
  Present slide-by-slide
  [Edit] button → drops back to Builder on current slide
  Inline edit live as client confirms or corrects details
  Structural edits: add rows, confirm names, update dates
  Lock blocks once confirmed to prevent accidental edits
  [Sync proposals queued silently for each mapped block changed]
          │
          ▼
POST-MEETING (Builder Mode)
  Final review and cleanup
  Unlock any locked blocks if changes needed
  [Sync review surfaced: "X intelligence updates pending"]
  Review diff per section → accept, edit, or dismiss each
  Update status: draft → pending_approval
          │
          ▼
EXPORT
  [Bulk sync review before PDF generation]
  Accept all / review individually / skip
  PDF generated via Puppeteer
  All edits, inline changes, and regenerated content captured
  Branding, footer, CONFIDENTIAL tag applied automatically
  PDF saved to account /presentations repository
  Shareable approval link generated
          │
          ▼
APPROVED
  Status updated to: approved
  Deck archived (read-only)
  PDF permanently linked on account repository
  intelligence.md reflects all synced updates from this meeting
  Next presentation for this account starts with richer context
```

---

### 15.6 Editing in Presentation Mode

Presentation Mode is not view-only. The presenter can edit directly without exiting full screen.

| Action | How in Presentation Mode |
|---|---|
| Inline edit a block | Click directly on any text — cursor appears, TipTap activates |
| Add a table row | Click `[+ Add Row]` visible on table blocks |
| Exit to full Builder | Click `[Edit]` button (bottom bar) → returns to Builder on the current slide |
| Navigate slides | Arrow keys, on-screen `◀ ▶` buttons, or swipe |
| Lock a block | Block shows a small lock icon when hovered — click to lock |

The principle: **the presentation IS the meeting tool.** The presenter never needs to switch to a different view to update content. Whatever is shown on screen is always live and editable.

---

### 15.7 Block Generation History

Every block that has been AI-generated maintains a history of its last 3 generations. This allows rollback if a regenerated version is worse than the previous one.

```
Block: bullet-list — Pain Points

History (right panel):
  ● v3 — current  (Apr 9, 2026, 10:32am)
    prompt: "Focus on attendance and overtime only"
  ○ v2            (Apr 9, 2026, 10:28am)
    prompt: "List pain points for a steel company..."
  ○ v1 — original (Apr 9, 2026, 10:15am)
    prompt: [template default]

[Restore v2]   [Restore v1]
```

Data model addition to `Block`:
```
Block
├── ...existing fields...
└── generation_history  (JSON array, max 3 entries)
    Each entry:
    ├── version         (integer)
    ├── prompt          (string)
    ├── content         (JSON — the block data at that version)
    └── generated_at    (timestamp)
```

---

### 15.8 Two-Way Intelligence Sync

This is a critical behaviour that elevates `intelligence.md` from a static input file into a **living account knowledge base** — one that gets smarter with every interaction.

#### The Problem with One-Way Flow

In v3.0, intelligence was read-only input: it flowed into the presentation at creation time and stayed there. But the meeting is where the most valuable information is captured — clients confirm pain points, add new ones, update team compositions, agree on modules. If those updates only live in the presentation and never flow back to intelligence, the knowledge is siloed and the next presentation starts from stale data.

#### The Two-Way Model

```
intelligence.md
      │                          │
      │  READ (on creation)      │  WRITE BACK (on edit)
      ▼                          │
Presentation ────────────────────┘
(slides + blocks)

Changes in the presentation that map to intelligence fields
automatically propose updates back to intelligence.md
```

#### How It Works — Sync Triggers

Not every edit triggers a sync proposal. Only blocks with an `intelligence_mapping` field defined are eligible — these are the blocks that were originally pre-filled from a specific section of `intelligence.md`. When the user edits one of those blocks, the system recognises that the edit is semantically linked to the intelligence source.

| Block edited | intelligence_mapping | Proposes update to |
|---|---|---|
| Client Project Team table | `contacts` | `## Key Contacts` section |
| Pain Points bullet list | `pain_points` | `## Pain Points` section |
| Agreed Modules (phase card) | `agreed_modules` | `## Tarkie Modules Agreed` section |
| SPARKLE Framework rows | `sparkle_framework` | `## SPARKLE Framework` section |
| Next Steps table | `next_steps` | `## Open Items` section |
| Implementation phases | `implementation_phases` | `## Tarkie Modules Agreed` section |

Blocks without an `intelligence_mapping` (custom text blocks, section dividers, etc.) do not trigger sync proposals — they are presentation-specific content only.

#### The Sync Proposal UI

The system does **not** silently overwrite `intelligence.md`. Instead, it raises a **sync proposal** — a non-blocking notification the user can accept, edit, or dismiss.

```
[During or after meeting — block has been edited]

  ┌─────────────────────────────────────────────────────┐
  │  ✦ Intelligence Update Available                    │
  │                                                     │
  │  You updated "Pain Points" in this presentation.    │
  │  Sync these changes back to intelligence.md?        │
  │                                                     │
  │  CURRENT in intelligence.md:                        │
  │  • Lack of delivery tracking                        │
  │  • Manual expense logging                           │
  │  • Inaccurate timestamps                            │
  │                                                     │
  │  NEW from presentation:                             │
  │  • Lack of delivery tracking          (unchanged)   │
  │  • Manual expense logging             (unchanged)   │
  │  • Inaccurate timestamps              (unchanged)   │
  │  • No OT computation for field staff  (+ added)    │
  │  • Expense approval bottleneck        (+ added)    │
  │                                                     │
  │  [Sync to Intelligence]  [Edit Before Syncing]      │
  │  [Dismiss — keep separate]                          │
  └─────────────────────────────────────────────────────┘
```

The proposal shows a **diff view** — what was in intelligence before, what is new or changed in the presentation, clearly labelled. The user can:

- **Sync to Intelligence** — accepts all changes, `intelligence.md` updated immediately
- **Edit Before Syncing** — opens a mini-editor showing the proposed intelligence update, user can tweak before saving
- **Dismiss** — the presentation keeps its content but intelligence.md is unchanged; the sync proposal is dismissed for this block

#### When Sync Proposals Are Triggered

| Trigger | Behaviour |
|---|---|
| User edits a mapped block inline | Proposal queued — shown at end of session (not mid-edit) |
| User regenerates a mapped block | Proposal queued immediately after regeneration |
| User adds a row to a mapped table | Proposal queued |
| User removes a row from a mapped table | Proposal queued with deletion flagged clearly |
| User clicks `[Export PDF]` | All pending proposals surfaced before export — "you have 3 unsynced updates" |
| User closes/exits the presentation | All pending proposals surfaced — user can bulk accept, review individually, or dismiss all |

Proposals are **queued, not interrupting** — the user is never blocked mid-meeting by a sync dialog. They accumulate quietly and are presented at natural breakpoints (export, exit).

#### Bulk Sync at Export / Exit

The most important trigger is export — because export represents the "final" state of the meeting. Before the PDF is generated, the system surfaces all pending sync proposals in one review screen:

```
  ┌──────────────────────────────────────────────────────────┐
  │  Before exporting, review intelligence updates           │
  │                                                          │
  │  3 sections were updated during this presentation:       │
  │                                                          │
  │  ☑ Pain Points         — 2 items added                  │
  │  ☑ Key Contacts        — 1 contact updated (email)      │
  │  ☐ Next Steps          — 3 new action items             │
  │                                                          │
  │  [Sync Selected to Intelligence]  [Skip All]            │
  │  [Review Each Individually]                              │
  │                                                          │
  │  Then: [Export PDF]                                      │
  └──────────────────────────────────────────────────────────┘
```

The user can bulk-accept all, pick which ones to sync, or skip and export immediately. Either way, the export proceeds.

#### Data Model Additions

```
Block
├── ...existing fields...
├── intelligence_mapping     (string — already in model, now also drives sync)
└── sync_status              (none | pending | synced | dismissed)

IntelligenceSyncProposal     (new table)
├── id
├── presentation_id          → FK to Presentation
├── block_id                 → FK to Block
├── intelligence_section     (string — e.g., "pain_points", "contacts")
├── current_content          (JSON — what intelligence.md has now)
├── proposed_content         (JSON — what the block has after editing)
├── diff                     (JSON — computed diff: added, removed, changed)
├── status                   (pending | accepted | edited_and_accepted | dismissed)
├── created_at
└── resolved_at
```

#### What This Means in Practice

Across the lifecycle of an account, every presentation becomes a contribution to the intelligence file. The Kick-Off Meeting confirms and extends the pre-sales notes. A Project Update meeting might add new pain points discovered during implementation. A QBR might update the contacts list as the client's team changes. Over time, `intelligence.md` becomes a **comprehensive, always-current picture of the account** — maintained not through manual data entry but as a natural by-product of doing the work.

---

## 16. Resolved Decisions

These were open questions in earlier drafts. All are now resolved and should be treated as requirements.

### 16.1 Who Can Edit `intelligence.md`
**Decision: All users with access to the account.**
No role restriction at launch. Any team member assigned to the account can read and edit the intelligence file. Future versions may introduce role-based write permissions if needed, but for now openness is preferred — the acquisition team, project managers, and support staff should all be able to contribute notes.

### 16.2 Intelligence Parser — When to Run
**Decision: On save, automatically, non-blocking.**
Every time `intelligence.md` is saved (whether from the Intelligence tab or via a synced update from a presentation), the parser runs in the background to extract the structured data (`parsed_data` JSON on `AccountIntelligence`). This happens asynchronously — the user is never waiting for it. The parsed data is what the Presentation Builder reads when pre-filling blocks.

### 16.3 Client Deck Access — PDF or Live Link
**Decision: PDF only.**
Clients receive a PDF export link. A live shareable deck link is not in scope. The PDF is the formal deliverable for client review and approval.

### 16.4 Sub-App Artifact Reuse in Presentations
**Decision: Yes — account repository artifacts are selectable as blocks.**
When a user adds a `flowchart` or `timeline` block to a slide, they get two options:

```
Add Flowchart Block:
  ○ Create new (opens Flowchart Maker)
  ● Select from account repo
    ┌─────────────────────────────────┐
    │ Current Process  — Jan 18, 2026 │  ← saved flowchart
    │ Recommended Flow — Jan 20, 2026 │  ← saved flowchart
    └─────────────────────────────────┘
```

The same applies to timelines. Selecting an existing artifact embeds it as a read-only snapshot in the slide. The source artifact in the repo is not affected. This means a flowchart built in the Flowchart Maker can be directly presented inside a slide without rebuilding it.

Additionally, each sub-app (Flowchart Maker, Timeline Maker) should show a **"Use in Presentation"** option when viewing a saved artifact — a shortcut that opens the Presentation Builder with that artifact pre-selected as a block on a new slide.

### 16.5 Multi-User Real-Time Editing
**Decision: Single-user for now. Defer real-time collaboration.**
Only one user edits a presentation at a time. If real-time collaboration is straightforward to add (e.g., if the existing Team OS stack already supports it), it can be included — otherwise defer. The complexity of concurrent editing (conflict resolution, live cursors, block locking) is not worth the cost at this stage. Most kick-off meetings have one presenter who owns the deck.

### 16.6 Intelligence Updates After Deck Creation
**Decision: Two-way sync via proposals (as defined in Section 15.8).**
Changes made in the presentation flow back to `intelligence.md` via sync proposals — not automatically, but through the user-controlled review and accept flow. The deck does not auto-refresh from intelligence after creation (the snapshot taken at creation time is preserved). If a user wants to pull a fresh intelligence refresh into an existing deck, a manual **"Refresh from Intelligence"** option will be available per block (replaces block content with the latest intelligence data for that mapping, saves current content to history first).

### 16.7 Template Sharing Across the System
**Decision: Templates are available system-wide across all Team OS users.**
Templates created in the Admin Console are not org-restricted. All users of Team OS can use any active template when creating a new presentation. Template management (create, edit, activate, deactivate) remains Admin Console only.

### 16.8 Presentation Types
**Decision: The Presentation Builder is a general slide maker. Type is a metadata label, not a structural constraint.**
When a presentation is saved to the account repository, it is stored with a `presentation_type` label. This label is for organisation and filtering only — it does not change how the builder works. The type is set when choosing a template (each template has a default type) and can be changed manually.

Starting types:
- `kick-off` — Kick-Off Meeting (template available at launch)
- `project-update` — Project Update (template: future)
- `user-training` — User Training Deck (template: future)
- `admin-training` — Admin Training Deck (template: future)
- `proposal` — Proposal / Sales Deck (template: future)
- `custom` — No template, blank presentation

New types are added via the Admin Console when new templates are created — no code change required.

### 16.9 Dismissed Sync Proposals
**Decision: Dismissed means dismissed — proposals do not resurface.**
If a user dismisses a sync proposal, it is permanently closed for that block on that presentation. The user can still manually edit `intelligence.md` directly if they want to capture the information. This keeps the sync UI clean and non-naggy.

### 16.10 Sync Proposals Visible to Team
**Decision: Yes — visible to all account users in the Intelligence tab.**
When sync proposals are pending (queued but not yet reviewed), they are visible to all users with account access under the Intelligence tab as a notification:

```
Intelligence tab:

  intelligence.md              [Edit]  [History]
  Last updated: Apr 9, 2026

  ⚠ 3 pending updates from "Kick-Off Meeting — Apr 9"
  [Review Updates]
```

Any team member can review and accept or dismiss proposals — not just the presenter who created them. This supports scenarios where the project manager attends the meeting and a colleague later updates the intelligence file from the meeting notes.

---

## 17. Summary

The Presentation Builder in v3 is no longer just a kick-off tool — it is a **first-class Team OS citizen app** that follows the same account-centric pattern as every other app in the suite.

The four architectural decisions that make this version right:

**Account Intelligence File** — A single `intelligence.md` per account means the system already knows the client before the meeting starts. One well-maintained file generates better first drafts than any amount of manual prompting.

**Two-Way Intelligence Sync** — Every change made to a presentation during or after a meeting can flow back to `intelligence.md` via sync proposals. The intelligence file gets smarter with every meeting, without anyone manually maintaining it. Over time it becomes the most accurate, up-to-date picture of the account in the system.

**Admin Console Skills** — Design skills and templates managed outside of code means the Tarkie team can evolve presentations, update branding, and add new deck types without a developer. This is the operational leverage that makes the system self-sustaining.

**Repository Pattern** — Every presentation joins flowcharts, BRDs, timelines, and mockups on the account profile. The client's full project history lives in one place. Future features (cross-artifact AI synthesis, account health scoring, client reporting) all become possible because the data is already structured and co-located.

---

*End of Document — v3.3*  
*Supersedes v2.0. Next step: Claude Code session brief for Phase 1 (Account Intelligence + Repository).*

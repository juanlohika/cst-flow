# Tarkie Meeting Hub — Technical Specification Document

**Version:** 1.2 (Draft — Updated with Meeting Prep App + Bilingual Language Requirements)
**Date:** March 26, 2026
**Author:** Tarkie Client Success Team
**Status:** Brainstorming / Initial Specification

---

## 1. Executive Summary

The **Tarkie Meeting Hub** is an AI-powered meeting orchestration platform designed for the Tarkie Client Success team. Tarkie helps companies digitize and innovate their business processes through turnkey implementations. This platform centralizes the meeting lifecycle — from booking to post-meeting deliverables — with deep AI integration that generates real-time outputs during live meetings.

The Meeting Hub serves as the **central orchestrator** connecting five companion apps: Meeting Prep (preparation & agenda builder), Architect Flow (flowchart/diagram maker), BRD Maker, Task Manager, and Timeline Maker. The core premise is that **the meeting is the origin point** for all project artifacts, and AI should be a live co-facilitator, not just a post-processing tool.

Critically, the platform now includes a **pre-meeting intelligence layer** — the Meeting Prep App — which ensures facilitators enter every meeting armed with industry-specific questionnaires, structured agendas, and client context derived from acquisition team handoffs. This closes the full engagement lifecycle: from client onboarding → preparation → live meeting → deliverables.

---

## 2. Platform Context

### 2.1 What is Tarkie?

Tarkie is a turnkey solutions provider that helps clients digitize and innovate their business systems. The Client Success team is responsible for implementing these solutions.

### 2.2 Who Uses This Platform?

**Primary users:** Tarkie Business Analysts and Project Facilitators (internal team)
**Secondary users:** Client attendees (limited interaction — QR attendance, consent)

### 2.3 Problem Statement

Currently, meetings generate unstructured information that must be manually converted into flowcharts, BRDs, tasks, and timelines after the fact. This creates:

- Delays between discussion and documentation
- Loss of context and nuance from meetings
- Manual, repetitive work for business analysts
- Inconsistency in deliverable quality
- No single source of truth connecting meeting discussions to project artifacts
- Facilitators lack structured preparation — no standardized questionnaires per industry or engagement type
- Handoff from the acquisition team to client success is informal, leading to lost context about what the client actually availed

### 2.4 Vision

A single platform where a Tarkie facilitator receives a new client account, and the system immediately prepares them — generating industry-specific questionnaires, structured agendas, and a preparation checklist based on the client profile and modules availed. Then, when the facilitator walks into the meeting, by the time it ends, the system has already generated — live, in real time — the flowcharts discussed, the BRD drafted, the tasks assigned, the timeline sketched, and the minutes ready for review. AI doesn't replace the analyst; it amplifies them from preparation through execution.

---

## 3. System Architecture Overview

### 3.1 The Ecosystem

```
┌─────────────────────────────────────────────────────────┐
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │           MEETING PREP APP                           │ │
│  │  (Prelude / Phase 0 — Preparation & Agenda)          │ │
│  │                                                       │ │
│  │  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │ │
│  │  │ Client   │  │ Industry  │  │  Agenda &        │  │ │
│  │  │ Profile  │  │ Knowledge │  │  Questionnaire   │  │ │
│  │  │ & Handoff│  │ Base (MD) │  │  Generator       │  │ │
│  │  └──────────┘  └───────────┘  └──────────────────┘  │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                         │ feeds into                      │
│                         ▼                                 │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              TARKIE MEETING HUB                      │ │
│  │           (Central Orchestrator)                      │ │
│  │                                                       │ │
│  │  ┌─────────┐  ┌──────┐  ┌───────┐  ┌────────────┐  │ │
│  │  │ Booking  │  │ QR   │  │ Live  │  │  Minutes   │  │ │
│  │  │ & Setup  │  │ Auth │  │Engine │  │  Generator │  │ │
│  │  └─────────┘  └──────┘  └───────┘  └────────────┘  │ │
│  │                      │                                │ │
│  │              ┌───────┴────────┐                       │ │
│  │              │  AI Core Layer │                       │ │
│  │              │ (Transcription │                       │ │
│  │              │  + Processing) │                       │ │
│  │              └───────┬────────┘                       │ │
│  │                      │                                │ │
│  │    ┌─────────────────┼─────────────────────┐         │ │
│  │    │                 │                     │          │ │
│  │    ▼                 ▼                     ▼          │ │
│  │ ┌──────────┐  ┌───────────┐  ┌──────────────────┐   │ │
│  │ │Architect │  │   BRD     │  │  Task Manager    │   │ │
│  │ │  Flow    │  │  Maker    │  │  + Timeline      │   │ │
│  │ │(Diagrams)│  │           │  │    Maker         │   │ │
│  │ └──────────┘  └───────────┘  └──────────────────┘   │ │
│  └─────────────────────────────────────────────────────┘ │
│            │                          │                    │
│            ▼                          ▼                    │
│    ┌──────────────┐          ┌──────────────┐            │
│    │ Zoom API     │          │ Google       │            │
│    │ (Recording)  │          │ Workspace    │            │
│    │              │          │ (Email/Auth) │            │
│    └──────────────┘          └──────────────┘            │
│                                                           │
│                  TARKIE PLATFORM                          │
└─────────────────────────────────────────────────────────┘
```

### 3.2 App Descriptions

| App | Also Known As | Purpose | Status |
|-----|---------------|---------|--------|
| **Meeting Prep** | Preparation App | Client onboarding intake, industry knowledge base, agenda & questionnaire generation, acquisition team handoff processing | To be built (new — this spec) |
| **Meeting Hub** | — | Central orchestrator, booking, attendance, live AI engine, minutes | To be built (this spec) |
| **Architect Flow** | Flowchart Maker | Swimlane diagrams, sequence diagrams, process flowcharts | Existing (initial version) |
| **BRD Maker** | — | Business Requirement Documentation generator | Existing (initial version) |
| **Task Manager** | — | Action items, commitments, assignments, next steps | Existing (initial version) |
| **Timeline Maker** | — | Project timelines, milestones, Gantt-style views | Existing (initial version) |

---

## 4. Meeting Lifecycle

The platform supports the full meeting lifecycle across four phases, starting with preparation before a meeting is even booked.

### 4.0 Phase 0: Meeting Preparation (The Prelude)

This is the **intelligence layer** that sits before the meeting lifecycle begins. It ensures that every Tarkie facilitator is fully prepared before they ever book or conduct a meeting. This app is new and does not yet exist.

#### 4.0.1 The Handoff: Acquisition Team → Client Success

When a new client account is assigned to the Client Success team, the facilitator receives information from the Acquisition team. This information may include:

- **Client profile**: Company name, industry, size, key contacts
- **Proposal / package details**: Which Tarkie modules/products the client has availed
- **Engagement status**: Confirmed deal, pending decision, or exploratory
- **Initial requirements**: High-level notes from sales conversations
- **Special considerations**: Urgency, known pain points, decision-maker preferences

The Meeting Prep App provides a **structured intake form** to capture this handoff, ensuring no information is lost in the transition between teams.

#### 4.0.2 Industry Knowledge Base (Skill Files / .md)

The core of the Meeting Prep App is a **curated knowledge base** stored as Markdown (.md) skill files within the system. These files contain:

- **Industry-specific questionnaires**: Pre-built question sets tailored to different industries (e.g., retail, logistics, manufacturing, healthcare, financial services). Each industry has different processes, pain points, and requirements that Tarkie typically addresses.
- **Module-specific question sets**: For each Tarkie module/product, a set of discovery questions that help uncover the client's specific needs for that module.
- **Best-practice discussion flows**: Recommended sequences for how to structure conversations — what to ask first, what depends on what, and how to go deeper.
- **Common scenarios and patterns**: Known implementation patterns for each industry, so the facilitator can recognize what the client likely needs even before they articulate it.
- **Red flags and gotchas**: Industry-specific pitfalls, common misunderstandings, and areas where clients typically need extra guidance.

**Knowledge Base File Structure (example):**

```
/skills/meeting-prep/
├── industries/
│   ├── retail.md
│   ├── logistics.md
│   ├── manufacturing.md
│   ├── healthcare.md
│   ├── financial-services.md
│   ├── food-and-beverage.md
│   └── general.md
├── modules/
│   ├── module-a-questions.md
│   ├── module-b-questions.md
│   ├── module-c-questions.md
│   └── ...
├── meeting-types/
│   ├── kickoff-guide.md
│   ├── requirements-deep-dive.md
│   ├── follow-up-guide.md
│   ├── feedback-review-guide.md
│   └── optimization-guide.md
└── templates/
    ├── agenda-template-kickoff.md
    ├── agenda-template-requirements.md
    └── brd-outline-template.md
```

These skill files are **maintained and versioned** by the team, representing the collective institutional knowledge of how Tarkie implementations work across industries.

#### 4.0.3 AI-Powered Agenda & Questionnaire Generation

When the facilitator opens the Meeting Prep App for a new client engagement, the AI:

1. **Reads the client profile** — industry, modules availed, engagement status, any notes from the acquisition team
2. **Loads the relevant skill files** — the industry-specific .md file, the module-specific .md files for each availed module, and the meeting type guide
3. **Generates a tailored preparation package** including:
   - **Structured agenda** — suggested topics and flow for the meeting, ordered by priority
   - **Questionnaire** — specific questions to ask the client, organized by topic area. These are not generic — they're contextual, based on the intersection of the client's industry and the modules they've availed
   - **Discussion guide** — suggested flow: what to cover first, what to explore deeper, where to expect complexity
   - **Preparation checklist** — what the facilitator should review or set up before the meeting (e.g., "Review the client's existing process documentation if available", "Prepare a demo of Module X for their industry")
   - **Anticipated requirements** — based on the industry and modules, AI predicts what the client's likely requirements are, so the facilitator can validate rather than discover from scratch

#### 4.0.4 Maintaining Standards

A key goal of the Meeting Prep App is to **standardize the quality of engagement** across all facilitators:

- Every facilitator, regardless of experience level, has access to the same institutional knowledge
- The questionnaires ensure no critical topics are missed
- The industry knowledge base is a living document — as the team learns from new engagements, the .md files are updated
- New team members can ramp up faster because the system guides them through what to ask and how to structure the conversation

#### 4.0.5 Preparation → Meeting Handoff

Once the facilitator has reviewed and customized the preparation package, they can:

- **Create a meeting** directly from the prep — the agenda, questionnaire, and attendee information flow into the Meeting Hub automatically
- **Carry context forward** — when the meeting starts, the AI already knows the client profile, industry, availed modules, and the prepared questions. This context enriches all live AI behaviors (question suggestions in BRD Maker, flowchart generation in Architect Flow, etc.)
- **Mark items as "pre-answered"** — if information was already provided by the acquisition team, the facilitator can mark those questions as answered, so the meeting focuses only on gaps

---

### 4.1 Phase 1: Pre-Meeting (Setup & Booking)

#### 4.1.1 Meeting Creation

- User creates a new meeting in the system
- Each meeting receives a **unique Meeting ID**
- Required fields:
  - Meeting title
  - Date and time
  - Meeting type (see Section 4.4)
  - Client / company name
  - Agenda (free-form or structured)
  - Active tools (which apps to enable: Architect Flow, BRD Maker, Task Manager, Timeline Maker)
- Optional fields:
  - Zoom meeting link (via Zoom API integration)
  - Project reference (link to existing project in the system)
  - Pre-uploaded documents or references

#### 4.1.2 Attendee Pre-Registration

- Facilitator can pre-fill attendees with:
  - Full name
  - Position / role
  - Company name
  - Mobile number
  - Email address
- Pre-registered attendees are marked as "Expected" until confirmed

#### 4.1.3 QR Code Generation

- System generates a **unique QR code** tied to the Meeting ID
- QR code can be:
  - Displayed on-screen during the meeting
  - Printed for in-person meetings
  - Shared digitally for remote attendees
- **QR Scan Flow for new attendees:**
  1. Attendee scans QR code → opens a mobile-friendly registration form
  2. Form collects: Full name, Position, Company name, Mobile number, Email address
  3. **Data Privacy Consent** (mandatory checkbox):
     > "I agree to provide my personal information for the purposes of this meeting. I understand that this data will be used solely for meeting documentation and project-related communication, and will be handled in compliance with the Data Privacy Act."
  4. Attendee submits → record is created, attendance is confirmed
- **QR Scan Flow for pre-registered attendees:**
  1. Attendee scans QR code → system recognizes their email or mobile number
  2. Attendee sees their pre-filled information → confirms attendance with one tap
  3. Record is updated to "Confirmed"

#### 4.1.4 Pre-Meeting AI Preparation

Based on the meeting type and agenda, AI can:

- Suggest questions for the facilitator to ask
- Prepare a discussion framework
- Pull relevant context from previous meetings with the same client
- Pre-populate BRD templates based on the project type

---

### 4.2 Phase 2: During the Meeting (Live AI Engine)

This is the core differentiator of the platform. All features operate in real time.

#### 4.2.1 Meeting Recording & Consent

- Before recording begins, the system displays/announces a consent notice:
  > "This meeting will be recorded and processed with the assistance of AI for the purpose of generating meeting documentation, process flows, and project deliverables. All data will be handled in compliance with the Data Privacy Act."
- Recording options:
  - Audio recording (primary — for transcription)
  - Video recording (optional — via Zoom integration)
  - Screen capture (optional — for referencing shared screens)

#### 4.2.2 Live Transcription & Language Processing

**Critical language requirement:** Meetings will typically be conducted in a **mix of English and Filipino (Tagalog)** — often within the same sentence (code-switching). This is the natural communication style in Philippine business settings. The system must handle this seamlessly.

- Real-time speech-to-text processing with **bilingual support (English + Filipino/Tagalog)**
- Must handle **code-switching** — speakers frequently alternate between English and Filipino mid-sentence (e.g., "So yung process nila for inventory is manual pa, so we need to automate that")
- Speaker identification/diarization (map voices to registered attendees)
- Continuous streaming — transcript updates as people speak

**Translation & Output Quality Pipeline:**

All AI-generated outputs (Minutes of Meeting, BRD, task descriptions, flowchart labels, etc.) must be produced in **professional English**, regardless of the language spoken during the meeting. The pipeline is:

```
Mixed English/Filipino Audio
        │
        ▼
┌────────────────────────┐
│  Speech-to-Text        │  Transcribes in the original
│  (Bilingual capable)   │  mixed language as spoken
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│  Raw Transcript        │  Preserves original language
│  (English + Filipino)  │  for reference and accuracy
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│  AI Translation &      │  Translates Filipino portions
│  Normalization Layer   │  to English while preserving
│                        │  meaning, context, and nuance
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│  Professional English  │  All outputs are generated in
│  Output Generation     │  clear, professional English
│                        │  at excellent quality
└────────────────────────┘
```

**Quality standards for translation and output:**

- Filipino-to-English translation must preserve the **exact intent and meaning** — not just literal word-for-word translation
- Industry-specific terminology must be used correctly (e.g., if a client says "yung warehouse nila," the output should reference "their warehouse operations," not a literal translation)
- Cultural context must be understood — Filipino business communication often uses indirect language, and the AI must interpret intent accurately
- The raw bilingual transcript should be **retained alongside** the English outputs for verification and reference
- All deliverables (MoM, BRD, flowcharts, tasks) must read as if they were written by a native English-speaking business analyst — professional tone, proper grammar, clear structure

#### 4.2.3 Live AI Processing Pipeline

The AI Core Layer continuously processes the live transcript and feeds outputs to the connected apps:

```
Audio Stream
    │
    ▼
┌──────────────────┐
│  Speech-to-Text  │  (Real-time transcription)
│  Engine           │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  AI Processing   │  (LLM: context-aware analysis)
│  Layer           │
│                  │
│  - Summarization │
│  - Entity/topic  │
│    extraction    │
│  - Intent        │
│    detection     │
│  - Ambiguity     │
│    flagging      │
└────────┬─────────┘
         │
    ┌────┼────┬─────────┬──────────┐
    ▼    ▼    ▼         ▼          ▼
  MoM  Tasks  Architect  BRD     Timeline
              Flow
```

#### 4.2.4 Live Minutes of Meeting (MoM)

- AI captures and categorizes discussion points as they happen:
  - **Key Agreements** — decisions made during the meeting
  - **Discussion Points** — topics covered
  - **Action Items** — tasks with assignees (auto-linked to Task Manager)
  - **Open Questions** — unresolved items flagged for follow-up
  - **Parking Lot** — topics deferred to future meetings
- Facilitator can see the MoM building in real time and make corrections

#### 4.2.5 Live Architect Flow (Flowchart Generation)

- Facilitator **triggers** the Architect Flow tool during the meeting when a process is being discussed
- AI listens to the process description and generates:
  - Swimlane diagrams (roles/departments as lanes)
  - Sequence diagrams (step-by-step flows)
  - General flowcharts
- The diagram is rendered live on-screen
- During the meeting, participants can:
  - Validate the generated flow ("Yes, that's correct")
  - Request modifications ("No, step 3 should come before step 2")
  - Mark it as "Agreed" or "For Review"
- Output is saved with the meeting record

#### 4.2.6 Live BRD Maker

- AI analyzes the discussion and:
  - Drafts requirement sections in real time
  - Identifies **gaps and ambiguities** in requirements
  - Generates **suggested clarification questions** for the facilitator
- The facilitator sees a live panel showing:
  - Current BRD draft (populating as discussion progresses)
  - List of AI-suggested questions to ask the client
  - As the client responds, AI captures the answer and may generate follow-up questions
- This creates a guided interview flow powered by AI:
  1. AI suggests question → Facilitator asks client
  2. Client responds → AI captures and processes
  3. AI identifies gaps → Suggests follow-up questions
  4. BRD document updates in real time

#### 4.2.7 Live Task & Timeline Capture

- As action items and commitments are discussed, they're automatically:
  - Created in the Task Manager with assignee, due date (if mentioned), and priority
  - Added to the Timeline Maker if they represent milestones or deadlines
- Facilitator can review and confirm these in real time

---

### 4.3 Phase 3: Post-Meeting (Outputs & Distribution)

#### 4.3.1 Generated Outputs

After the meeting ends, the following artifacts are available for review:

| Output | Description | Status Options |
|--------|-------------|----------------|
| **Minutes of Meeting** | Structured summary with agreements, action items, open questions | Draft → Reviewed → Sent |
| **Flowcharts/Diagrams** | Process flows generated during the meeting | Draft → For Review → Approved |
| **BRD** | Business requirements document | Draft → For Review → Approved |
| **Task List** | Action items with assignees and deadlines | Active → In Progress → Done |
| **Timeline** | Project timeline with milestones | Draft → Approved |
| **Attendance Record** | Full log of attendees with consent records | Final |
| **Full Transcript** | Complete meeting transcript | Final |
| **Recording** | Audio/video file | Archived |

#### 4.3.2 Minutes of Meeting Distribution

- Minutes are **not auto-sent** — they go through a review step
- Facilitator reviews the AI-generated minutes, makes edits if needed
- Once approved, can send via **company domain-authenticated email** (Google Workspace API)
- Email includes:
  - Formatted minutes
  - Links or attachments to flowcharts, BRD, task list (as applicable)
  - Next meeting date (if scheduled)

#### 4.3.3 AI Post-Processing

After the meeting, AI can also:

- Generate a meeting quality score (were all agenda items covered?)
- Flag unresolved items that need follow-up
- Suggest the agenda for the next meeting
- Update project-level dashboards with new information

---

### 4.4 Meeting Types

The system should recognize and adapt behavior based on meeting type:

| Meeting Type | Primary Focus | Key AI Behaviors |
|-------------|---------------|------------------|
| **Kickoff Meeting** | Introductions, project scope, high-level requirements | Generate initial BRD outline, capture stakeholder map, create preliminary timeline |
| **Requirements Discussion** | Deep-dive into processes and specifications | Heavy BRD generation, Architect Flow for process mapping, aggressive clarification questions |
| **Follow-up Meeting** | Progress review, continuing previous discussions | Reference prior meeting context, update existing BRD/flows, track open items |
| **Feedback / Review Meeting** | Client feedback on deliverables | Capture change requests as tasks, update existing documents, flag scope changes |
| **Optimization Meeting** | Process improvements, change requests | Compare current vs. proposed flows, generate optimization recommendations |

---

## 5. Data Model

### 5.1 Core Entities

#### Client Account (Acquisition Handoff)

```
ClientAccount {
  id: UUID
  company_name: String
  industry: Enum [RETAIL, LOGISTICS, MANUFACTURING, HEALTHCARE,
                   FINANCIAL_SERVICES, FOOD_AND_BEVERAGE, EDUCATION,
                   REAL_ESTATE, TECHNOLOGY, OTHER]
  industry_other: String (if industry = OTHER)
  company_size: Enum [SMALL, MEDIUM, LARGE, ENTERPRISE]
  key_contacts: Array<ContactPerson>
  availed_modules: Array<String> (list of Tarkie modules/products)
  engagement_status: Enum [CONFIRMED, PENDING_DECISION, EXPLORATORY]
  proposal_document: URL (optional, link to uploaded proposal)
  acquisition_notes: Text (free-form notes from acquisition team)
  special_considerations: Text (optional)
  assigned_facilitator: UUID (FK → User)
  handed_off_by: String (acquisition team member)
  handed_off_at: DateTime
  created_at: DateTime
  updated_at: DateTime
}

ContactPerson {
  full_name: String
  position: String
  email: String
  mobile: String
  is_decision_maker: Boolean
  notes: String (optional)
}
```

#### Meeting Preparation

```
MeetingPrep {
  id: UUID
  client_account_id: UUID (FK → ClientAccount)
  meeting_id: UUID (FK → Meeting, optional — linked once meeting is created)
  facilitator_id: UUID (FK → User)
  meeting_type: Enum [KICKOFF, REQUIREMENTS, FOLLOWUP, FEEDBACK, OPTIMIZATION]
  status: Enum [DRAFT, READY, IN_MEETING, COMPLETED]

  // AI-Generated Preparation Package
  generated_agenda: JSON (structured agenda items with order and time estimates)
  generated_questionnaire: Array<PrepQuestion>
  generated_discussion_guide: Text (AI-produced flow recommendations)
  generated_checklist: Array<ChecklistItem>
  anticipated_requirements: Array<AnticipatedRequirement>

  // Skill files used for generation
  industry_skill_file: String (path to the .md file used)
  module_skill_files: Array<String> (paths to module .md files used)
  meeting_type_skill_file: String (path to meeting type guide used)

  // Facilitator customization
  custom_notes: Text (facilitator's own preparation notes)
  created_at: DateTime
  updated_at: DateTime
}

PrepQuestion {
  id: UUID
  prep_id: UUID (FK → MeetingPrep)
  category: String (e.g., "Business Process", "Technical Requirements", "Timeline")
  question: Text
  purpose: Text (why this question matters — context for the facilitator)
  source: Enum [INDUSTRY_KB, MODULE_KB, AI_GENERATED, MANUAL]
  status: Enum [PENDING, PRE_ANSWERED, ASKED, ANSWERED, SKIPPED]
  pre_answer: Text (optional — if answered from acquisition handoff data)
  actual_answer: Text (optional — filled during or after meeting)
  follow_up_needed: Boolean
  order: Integer
}

ChecklistItem {
  id: UUID
  prep_id: UUID (FK → MeetingPrep)
  description: Text
  is_completed: Boolean
  category: Enum [REVIEW, SETUP, DEMO_PREP, DOCUMENT_PREP, OTHER]
}

AnticipatedRequirement {
  id: UUID
  prep_id: UUID (FK → MeetingPrep)
  requirement: Text
  confidence: Enum [HIGH, MEDIUM, LOW] (AI confidence level)
  basis: Text (why AI thinks this is likely — e.g., "Common for retail clients using Module X")
  validated: Enum [PENDING, CONFIRMED, REJECTED, MODIFIED]
  validated_notes: Text (optional)
}
```

#### Meeting

```
Meeting {
  id: UUID (system-generated)
  prep_id: UUID (FK → MeetingPrep, optional — links to preparation)
  title: String
  meeting_type: Enum [KICKOFF, REQUIREMENTS, FOLLOWUP, FEEDBACK, OPTIMIZATION]
  status: Enum [SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED]
  scheduled_date: DateTime
  actual_start: DateTime
  actual_end: DateTime
  client_company: String
  client_account_id: UUID (FK → ClientAccount, optional)
  project_id: UUID (FK → Project, optional)
  agenda: Text
  zoom_meeting_id: String (optional)
  zoom_meeting_link: URL (optional)
  qr_code: String (generated)
  active_tools: Array [ARCHITECT_FLOW, BRD_MAKER, TASK_MANAGER, TIMELINE_MAKER]
  recording_url: URL (optional)
  transcript: Text
  privacy_consent_notice: Text
  created_by: UUID (FK → User)
  created_at: DateTime
  updated_at: DateTime
}
```

#### Attendee

```
Attendee {
  id: UUID
  meeting_id: UUID (FK → Meeting)
  full_name: String
  position: String
  company_name: String
  mobile_number: String
  email: String
  registration_type: Enum [PRE_REGISTERED, QR_REGISTERED]
  attendance_status: Enum [EXPECTED, CONFIRMED, NO_SHOW]
  privacy_consent_given: Boolean
  privacy_consent_timestamp: DateTime
  created_at: DateTime
}
```

#### Minutes of Meeting

```
MeetingMinutes {
  id: UUID
  meeting_id: UUID (FK → Meeting)
  version: Integer
  status: Enum [DRAFT, REVIEWED, SENT]
  key_agreements: Array<AgreementItem>
  discussion_points: Array<DiscussionItem>
  action_items: Array<ActionItem> (linked to Task Manager)
  open_questions: Array<QuestionItem>
  parking_lot: Array<ParkingItem>
  ai_generated: Boolean
  reviewed_by: UUID (FK → User, optional)
  sent_at: DateTime (optional)
  sent_to: Array<String> (email addresses)
  created_at: DateTime
  updated_at: DateTime
}
```

#### Flowchart (Architect Flow Output)

```
Flowchart {
  id: UUID
  meeting_id: UUID (FK → Meeting)
  title: String
  diagram_type: Enum [SWIMLANE, SEQUENCE, GENERAL_FLOWCHART]
  diagram_data: JSON (diagram structure/nodes/edges)
  diagram_svg: Text (rendered SVG)
  status: Enum [DRAFT, FOR_REVIEW, AGREED, APPROVED]
  ai_generated: Boolean
  version: Integer
  created_at: DateTime
  updated_at: DateTime
}
```

#### BRD (Business Requirement Document)

```
BRD {
  id: UUID
  meeting_id: UUID (FK → Meeting)
  project_id: UUID (FK → Project, optional)
  title: String
  status: Enum [DRAFT, FOR_REVIEW, APPROVED]
  sections: Array<BRDSection>
  ai_suggested_questions: Array<ClarificationQuestion>
  version: Integer
  created_at: DateTime
  updated_at: DateTime
}

BRDSection {
  id: UUID
  brd_id: UUID (FK → BRD)
  section_type: Enum [OVERVIEW, SCOPE, FUNCTIONAL_REQ, NON_FUNCTIONAL_REQ, 
                       ASSUMPTIONS, CONSTRAINTS, DEPENDENCIES, ACCEPTANCE_CRITERIA]
  title: String
  content: Text
  completeness_score: Float (AI-assessed, 0-1)
  flagged_gaps: Array<String>
  order: Integer
}

ClarificationQuestion {
  id: UUID
  brd_id: UUID (FK → BRD)
  question: Text
  status: Enum [PENDING, ASKED, ANSWERED, DEFERRED]
  answer: Text (optional)
  follow_up_questions: Array<UUID> (self-referencing)
  generated_by_ai: Boolean
  created_at: DateTime
}
```

#### Task

```
Task {
  id: UUID
  meeting_id: UUID (FK → Meeting, source meeting)
  title: String
  description: Text
  assignee: String
  assignee_email: String (optional)
  due_date: Date (optional)
  priority: Enum [LOW, MEDIUM, HIGH, CRITICAL]
  status: Enum [OPEN, IN_PROGRESS, DONE, CANCELLED]
  category: Enum [ACTION_ITEM, COMMITMENT, FOLLOW_UP, DELIVERABLE]
  created_at: DateTime
  updated_at: DateTime
}
```

#### Timeline

```
Timeline {
  id: UUID
  meeting_id: UUID (FK → Meeting, optional)
  project_id: UUID (FK → Project)
  title: String
  milestones: Array<Milestone>
  created_at: DateTime
  updated_at: DateTime
}

Milestone {
  id: UUID
  timeline_id: UUID (FK → Timeline)
  title: String
  target_date: Date
  status: Enum [PENDING, IN_PROGRESS, COMPLETED, DELAYED]
  linked_tasks: Array<UUID> (FK → Task)
  order: Integer
}
```

### 5.2 Entity Relationships

```
ClientAccount (1) ── (*) MeetingPrep
ClientAccount (1) ── (*) Meeting
MeetingPrep (1) ─── (0..1) Meeting
MeetingPrep (1) ─── (*) PrepQuestion
MeetingPrep (1) ─── (*) ChecklistItem
MeetingPrep (1) ─── (*) AnticipatedRequirement
Project (1) ──────── (*) Meeting
Meeting (1) ──────── (*) Attendee
Meeting (1) ──────── (1) MeetingMinutes
Meeting (1) ──────── (*) Flowchart
Meeting (1) ──────── (*) BRD
Meeting (1) ──────── (*) Task
Meeting (1) ──────── (0..1) Timeline
Project (1) ──────── (0..1) Timeline
BRD (1) ──────────── (*) BRDSection
BRD (1) ──────────── (*) ClarificationQuestion
Timeline (1) ─────── (*) Milestone
Milestone (*) ────── (*) Task
```

**Key relationship: MeetingPrep → Meeting**
When a facilitator creates a meeting from a preparation, all context flows forward. The prep's questionnaire feeds the BRD Maker's question engine, the anticipated requirements pre-populate the BRD sections, and the agenda structures the live meeting flow.

---

## 6. AI Core Layer

### 6.1 Speech-to-Text (Recommendations)

Given the need for real-time, low-latency transcription with speaker diarization **and bilingual English/Filipino (Tagalog) support including code-switching**, recommended options:

| Provider | Strengths | Filipino/Bilingual Support | Considerations |
|----------|-----------|---------------------------|----------------|
| **Deepgram** | Excellent real-time streaming, speaker diarization, good accuracy, competitive pricing | Supports Filipino (Tagalog); multi-language mode can handle code-switching | Strong API, WebSocket support for live streaming |
| **OpenAI Whisper** | High accuracy, multilingual (99 languages including Filipino), well-known | Strong Filipino support; handles code-switching reasonably well | Better for batch processing; real-time requires additional infrastructure |
| **Google Speech-to-Text** | Good streaming support, speaker diarization, integrates with Google ecosystem | Supports Filipino (fil-PH); alternative language codes can be set | Pricing can scale quickly; code-switching may require multi-language recognition config |
| **AssemblyAI** | Real-time transcription, speaker labels, built-in summarization | English-focused; Filipino support is limited | May struggle with heavy Filipino code-switching |

**Recommendation:** **Deepgram** for the live streaming use case — it offers WebSocket-based real-time transcription with speaker diarization and has multilingual support including Filipino. For the translation/normalization step (Filipino → English), the **LLM layer (Claude)** is the best choice, as it excels at understanding Filipino-English code-switching, cultural context, and producing professional English outputs. A hybrid approach may also work: use **Whisper** for high-quality batch transcription post-meeting to produce a polished final transcript, while Deepgram handles the live stream.

**Important:** The speech-to-text provider must be evaluated specifically for Filipino-English code-switching accuracy. A spike/proof-of-concept should test real meeting audio samples with mixed language before committing to a provider.

### 6.2 LLM Processing Layer

The AI processing layer sits between transcription and output generation:

- **Primary LLM:** Claude (Anthropic) — for summarization, BRD generation, question generation, context analysis
- **Processing modes:**
  - **Streaming mode** (during meeting): Process transcript chunks every N seconds, update outputs incrementally
  - **Batch mode** (post-meeting): Process the full transcript for final, polished outputs
- **Context management:** Each LLM call should include:
  - Meeting metadata (type, agenda, client, project)
  - Attendee information
  - **Client account profile and industry** (from Meeting Prep / acquisition handoff)
  - **Preparation package** (generated questionnaire, anticipated requirements, discussion guide)
  - Previous meeting history with the same client (if available)
  - Current state of all active tools (BRD draft so far, flowchart state, etc.)
  - **Relevant industry and module skill files** (.md knowledge base)

### 6.3 AI Behavior by Feature

| Feature | AI Role | Input | Output |
|---------|---------|-------|--------|
| **Meeting Prep** | Knowledge Synthesizer + Guide Builder | Client profile, industry .md files, module .md files, acquisition notes | Tailored agenda, questionnaire, discussion guide, checklist, anticipated requirements |
| **Minutes** | Summarizer + Categorizer | Live transcript | Structured MoM (agreements, actions, questions) |
| **Architect Flow** | Process Interpreter | Transcript segment (when triggered) | Diagram JSON (nodes, edges, lanes) |
| **BRD Maker** | Analyst + Interviewer | Transcript + existing BRD state + prep questionnaire | Updated BRD sections + new clarification questions |
| **Task Capture** | Entity Extractor | Transcript | Task objects (assignee, description, due date) |
| **Timeline** | Planner | Transcript + task list | Milestone entries with dates |
| **Clarification** | Gap Analyzer | All context + prep anticipated requirements | Flags ambiguities, suggests questions, validates anticipated requirements |

---

## 7. Integration Points

### 7.1 Zoom API

- **Purpose:** Meeting booking, recording, and potentially real-time audio streaming
- **Key endpoints:**
  - Create meeting → get Zoom link
  - Start/stop recording
  - Retrieve recording files post-meeting
- **Note:** For live transcription, the audio stream may come directly from the browser/app rather than through Zoom's API, depending on architecture

### 7.2 Google Workspace (Email)

- **Purpose:** Sending minutes of meeting via company domain email
- **Authentication:** OAuth 2.0 with domain-level service account or per-user auth
- **Key APIs:**
  - Gmail API — send emails with company domain
  - Google Calendar API (optional) — sync meeting schedules

### 7.3 QR Code System

- **Generation:** Server-side QR code generation (e.g., `qrcode` library)
- **Content:** URL pointing to the attendance registration page with Meeting ID embedded
- **Example:** `https://app.tarkie.com/meeting/{meeting_id}/attend`

---

## 8. Privacy & Compliance

### 8.1 Data Privacy Act Compliance

- All attendee data collection requires explicit, informed consent
- Consent records (timestamp, IP, consent text version) must be stored
- Meeting recordings and transcripts are stored with access controls
- Data retention policy should be defined (how long recordings/transcripts are kept)
- Right to deletion: process for removing attendee data upon request

### 8.2 Recording Consent

- Verbal or displayed notice before recording begins
- System should log when consent was given and by whom
- Option to pause/stop recording if any attendee objects

### 8.3 AI Processing Disclosure

- Attendees must be informed that AI will process the meeting content
- The scope of AI processing should be explained (transcription, summarization, document generation)
- This disclosure is part of the QR registration consent and the pre-meeting announcement

---

## 9. Non-Functional Requirements

### 9.1 Language & Translation Quality (NON-NEGOTIABLE)

This is a critical system requirement that affects every AI-generated output.

- **Input language:** Mixed English and Filipino (Tagalog), including frequent code-switching within sentences
- **Output language:** All deliverables and generated content must be in **professional English**
- **Translation quality standard:** Excellent — outputs must read as if authored by a fluent, native-level English-speaking business analyst
- **Specific quality criteria:**
  - No literal/word-for-word translations — AI must capture intent and meaning
  - Industry and business terminology must be used correctly and consistently
  - Filipino idioms, indirect language, and cultural communication patterns must be interpreted accurately (e.g., "medyo mahirap yung process nila" → "their current process presents significant complexity" — not "their process is a bit difficult")
  - Proper grammar, punctuation, and professional tone in all outputs
  - Technical terms spoken in Filipino must be mapped to their correct English equivalents
- **Raw transcript retention:** The original bilingual transcript must always be preserved alongside the English outputs for reference, verification, and dispute resolution
- **Quality verification workflow:** Facilitators should be able to flag translation issues so the knowledge base and AI prompts can be improved over time

### 9.2 Performance

- Live transcription latency: < 2 seconds from speech to text on screen
- AI output refresh rate: Every 10–30 seconds during live meeting (configurable)
- Translation/normalization should not add more than 1–2 seconds of additional latency to the output pipeline
- System should handle meetings of up to 3 hours without degradation
- Support for concurrent meetings (multiple facilitators using the system simultaneously)

### 9.3 Reliability

- If AI processing fails, the raw transcript must still be captured
- If translation fails, the raw bilingual transcript must still be available
- Graceful degradation: if one tool (e.g., Architect Flow) encounters an error, other tools should continue working
- Auto-save all outputs every 30 seconds during live meetings

### 9.4 Security

- All data in transit encrypted (HTTPS/WSS)
- Data at rest encrypted
- Role-based access control (facilitators, reviewers, admins)
- Meeting data accessible only to authorized team members

### 9.5 Scalability

- Architecture should support adding new output tools in the future
- Plugin-style architecture for the connected apps (Architect Flow, BRD Maker, etc.)
- Language support architecture should allow adding more languages in the future if needed

---

## 10. Feature Priority Matrix

### 10.1 MVP (Phase 1) — Foundation

These are the minimum features to demonstrate the core value proposition:

1. **Meeting Prep App — Client intake & handoff** (structured form to capture acquisition team handoff: client profile, industry, modules availed, notes)
2. **Meeting Prep App — Industry knowledge base** (initial set of .md skill files for at least 3-4 core industries)
3. **Meeting Prep App — AI-generated questionnaire & agenda** (based on client profile + industry + modules)
4. Meeting creation with unique ID and basic metadata (with link from Meeting Prep)
5. QR code generation and attendee registration (with privacy consent)
6. Meeting recording (audio) with live transcription
7. AI-generated Minutes of Meeting (live)
8. Integration with existing Architect Flow (trigger + generate from transcript)
9. Integration with existing BRD Maker (live drafting + question suggestions, informed by prep questionnaire)
10. Task capture from meeting (auto-populate Task Manager)
11. Post-meeting review and email distribution of minutes (Google email API)

### 10.2 Phase 2 (Enhanced)

12. **Meeting Prep — Anticipated requirements** (AI predicts likely requirements for validation)
13. **Meeting Prep — Preparation checklist** (auto-generated pre-meeting to-dos)
14. Speaker diarization (identify who said what)
15. Timeline Maker integration (milestone capture from meetings)
16. Meeting type-aware AI behavior
17. Cross-meeting context (AI references previous meetings with the same client)
18. **Meeting Prep — Knowledge base expansion** (more industries, more module-specific guides)

### 10.3 Phase 3 (Advanced)

19. Zoom API deep integration (auto-book, auto-record)
20. Real-time collaborative editing of outputs during meeting
21. Meeting quality scoring and analytics
22. Auto-suggested follow-up meeting agendas (informed by prep + meeting outcomes)
23. Project-level dashboards aggregating data across meetings
24. Multi-language support
25. **Meeting Prep — Learning loop** (AI suggests updates to .md knowledge base files based on patterns observed across engagements)

---

## 11. Open Questions & Decisions Needed

| # | Question | Options | Decision |
|---|----------|---------|----------|
| 1 | **Tech stack** — What framework/language are the existing apps built with? | TBD (user to specify) | Pending |
| 2 | **Hosting** — Cloud provider preference? | AWS / GCP / Azure / Self-hosted | Not decided |
| 3 | **Database** — Relational or document-based? | PostgreSQL / MongoDB / Hybrid | Pending |
| 4 | **Speech-to-text provider** — Which service for live transcription? | Deepgram / AssemblyAI / Google / Whisper | Open to suggestions |
| 5 | **Audio capture method** — Browser-based mic capture or Zoom audio stream? | Browser API / Zoom SDK / Both | TBD |
| 6 | **Deployment model** — SaaS multi-tenant or single-tenant per client? | This is an internal tool, likely single-tenant | To confirm |
| 7 | **Existing app architecture** — Are the current apps standalone or already connected? | TBD (code review will determine) | Pending |
| 8 | **Mobile support** — Is the QR attendance page the only mobile touchpoint, or should the full app be mobile-responsive? | QR only / Full responsive / Native mobile | TBD |
| 9 | **Offline capability** — Should the system work if internet drops mid-meeting? | Yes (buffer locally) / No (require connection) | TBD |
| 10 | **LLM provider** — Claude API as primary, or multi-provider? | Claude only / Multi-provider | TBD |

---

## 12. Next Steps

1. **Share tech stack details** — What are the existing apps built with?
2. **Code review** — Upload existing Architect Flow, BRD Maker, Task Manager, and Timeline Maker code for Claude Code to review against this spec
3. **Architecture decision** — Based on the code review, decide on the overall system architecture
4. **Prototype** — Build the Meeting Hub MVP (Phase 1 features)
5. **Iterate** — Use the system in real client meetings and refine

---

*This document is a living specification. It will be updated as decisions are made and the system evolves.*

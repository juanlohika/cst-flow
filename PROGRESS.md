# CST FlowDesk — Progress & Handoff Notes

## Stack
- Next.js 14 (App Router), Tailwind CSS, Prisma + SQLite (`dev.db`)
- NextAuth v5 (beta) — JWT sessions, Google OAuth + Credentials provider
- AI: multi-provider abstraction (`src/lib/ai.ts`) — Groq (free, default), Gemini (fallback), Ollama (local)
- API keys stored in `config.json` (gitignored), managed via Admin → Settings UI

---

## 🗺️ Data Model — Account vs Project (CRITICAL CLARIFICATION)

| Term | Model | Source | Description |
|------|-------|--------|-------------|
| **Account** | `ClientProfile` | Meeting Prep module | A company/organization. Has company name, industry, modules availed, contact info. Created in the Accounts module (was: Meeting Prep). |
| **Project** | `Project` | Timeline Maker | A specific engagement/timeline under an account. Has project name, start date, template used. Saved when you click "Save Project" in Timeline. |

**Rules:**
- An account can have zero or many projects.
- A project can optionally be tagged to an account (`clientProfileId` FK on `Project`).
- An account can also have account-maintenance timelines (no specific project — use maintenance template).
- Templates in Admin are neutral — not tied to "project" or "account" type.
- In Timeline Maker: select Account from dropdown (optional) + enter Project Name.
- In Tasks sidebar: standalone projects appear under "My Active Projects"; account-tagged projects appear nested under "Accounts" section.
- In Meetings: prep sessions are created under an account; meetings are linked to prep sessions.

---

## 🚀 Production Deployment Plan

### Target Infrastructure
- **App**: Vercel (Next.js native) or Railway
- **Database**: PostgreSQL (Neon or Railway) — replace SQLite for production
- **Auth**: Keep NextAuth v5, add real Google OAuth credentials

### Steps
1. Provision PostgreSQL DB (Neon recommended — free tier, serverless)
2. Update `prisma/schema.prisma` datasource: `provider = "postgresql"`, add `url = env("DATABASE_URL")`
3. Run `npx prisma migrate deploy` on production DB
4. Set environment variables in Vercel/Railway:
   - `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
   - `DATABASE_URL` (PostgreSQL connection string)
   - `NEXTAUTH_URL` (production URL)
5. Push to Git → Vercel auto-deploys
6. Remove `DEV_PASSWORD` — implement bcrypt password hashing for credentials provider

### Note on Prisma CLI (known issue)
`npx prisma db push` currently fails locally due to ESM conflict with `@prisma/dev`. Workaround: apply migrations via `sqlite3 prisma/dev.db < migration.sql`. This is a dev-only issue — the Prisma client itself works fine at runtime.

---

## 💻 Desktop App Plan (Phase 2)

### Architecture
- **Technology**: Tauri (Rust-based, lighter than Electron) wrapping the Next.js app
- **Purpose**: Offline AI via Ollama — team members install locally, full functionality with no internet
- **Collaboration**: Desktop app connects to the shared production DB for team data; switches to local Ollama for AI

### Deployment Matrix
| User Context | App | DB | AI |
|---|---|---|---|
| Online (browser) | Web | Shared Postgres | Groq/Gemini |
| Offline (desktop) | Tauri | Local SQLite | Ollama |
| Developer | `npm run dev` | Local SQLite | Ollama or Groq |

### Steps (future phase)
1. Add `src-tauri/` directory with Tauri config
2. Bundle Next.js server as a sidecar process
3. Bundle Ollama model download in installer
4. Build installers for macOS (`.dmg`) and Windows (`.exe`)

---

## Auth & Access Control

### DONE
- `src/auth.ts` — real NextAuth (no bypass). Domain restriction: only `@mobileoptima.com`, `@tarkie.com`, `@olern.ph`. `lester.alarcon@mobileoptima.com` = admin role.
- `src/middleware.ts` — protects all routes. Public: `/` (Explore), `/auth/*`, `/api/auth/*`, `/meetings/attend/*`, `/api/meetings/[id]/register`, `/api/meetings/lookup`
- `src/app/auth/signin/page.tsx` — email/password form + Google button + domain error message
- `src/components/layout/LeftNav.tsx` — hides all nav items (except Explore) when unauthenticated
- `.env.local` — `AUTH_SECRET` set, `DEV_PASSWORD=cst2025dev`, `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` set

### TO DO
- Replace `DEV_PASSWORD` with bcrypt password hashing for production

---

## AI Provider System

### DONE
- `src/lib/ai.ts` — unified `generateContent()` adapter for all three providers
- `config.json` — stores keys + `primaryProvider` setting (gitignored)
- Admin → Settings UI manages all provider keys
- Default: **Groq** (`llama-3.3-70b-versatile`) — free tier
- Ollama support: `http://localhost:11434`, model `llama3.2`
- API keys are **global** (server-side `config.json`) — all team members share the same key; no per-user setup needed

### TO DO
- Rotate Groq API key before production
- `ollama pull llama3.2` to complete local model download

---

## Accounts Module (was: Meeting Prep)

### DONE
- `src/app/(app)/meeting-prep/page.tsx` — CRUD for `ClientProfile` (Accounts)
- Nav label updated: "Meeting Prep" → **"Accounts"** in `LeftNav.tsx`
- Labels in meeting prep page updated: "Client Profile" / "New Client Profile" → "Account" / "New Account"
- `GET /api/accounts` — returns all ClientProfiles for account dropdowns across the app

### Key Fields (ClientProfile / Account)
- `companyName`, `industry`, `companySize`, `modulesAvailed`, `engagementStatus`
- `primaryContact`, `primaryContactEmail`, `specialConsiderations`
- Relations: `meetingPrepSessions[]`, `projects[]`

### TO DO
- None — module is complete for Phase 1

---

## Meeting Hub

### DONE
- Full-screen live meeting room at `/meetings/[id]/live`
- Web Speech API continuous transcription (no audio upload, no hallucinations)
- 20s AI polling for Minutes + BRD panels
- QR attendee self-registration at `/meetings/attend/[id]`
- Prep checklist loaded from linked `MeetingPrepSession`
- **Fixed**: Meeting creation no longer requires `status=ready` — shows all prep sessions regardless of status

### TO DO
- Prep checklist auto-check: AI returns `coveredQuestionIds[]` → auto-checks questions
- `PATCH /api/meetings/[id]/checklist` — persist checklist state
- Flowchart button in live room → sends transcript to `/api/architect/generate`
- End Meeting → calls `/api/meetings/[id]/process` → navigates to post-meeting review
- Fix QR code URL to point to `/meetings/attend/[id]`

---

## BRD Maker

### DONE
- `/brd` page — AI chat on left, generated BRD document on right
- AI generation via `/api/brd/generate` with anti-hallucination prompts
- Export to DOCX via `html-to-docx`

### TO DO — BRD Module Enhancements
- **Re-enable SavedWork API** (`/api/works/route.ts` currently returns 503 — was disabled during auth migration)
- Add `title` field to BRD when saving
- Tag BRD to **Account** (`clientProfileId`) and **Project** (`projectId`) when saving
- Add BRD list page (`/brd/list`) — shows all saved BRDs with account/project tags
- Connect meeting-generated BRDs: after meeting ends and `/api/meetings/[id]/process` runs, auto-save BRD to `SavedWork` with `meetingId` reference
- BRD entries from meetings should appear in the BRD list alongside manually created ones

---

## 🎨 Mockup Maker (NEW — Planned)

### Vision
A split-panel app: AI conversation on the left, live HTML canvas preview on the right.
The AI generates HTML mockups aligned with the company design system (loaded as a Skill in Admin).

### Layout
```
┌──────────────────────┬─────────────────────────────────┐
│  AI CONVERSATION     │  HTML CANVAS PREVIEW             │
│  (left, ~380px)      │  (right, flex-1)                 │
│                      │                                  │
│  BRD Context:        │  <iframe> rendering              │
│  [Select BRD ▼]      │  generated HTML                  │
│                      │                                  │
│  Chat input...       │  [Copy HTML] [Open in new tab]   │
└──────────────────────┴─────────────────────────────────┘
```

### Key Features
1. **BRD Context Selector** — dropdown to load any saved BRD as AI context
2. **AI Chat** — user describes the screen/component to mock up
3. **HTML Canvas** — rendered live in an `<iframe>`; updates on each AI response
4. **Design Skill** — Admin loads `design-system.md` skill (same format as other skills). Every AI call injects this skill so all mockups follow company UI standards.
5. **Save Mockup** — saves to `SavedWork` with `appType="mockup"`, tags to account + project

### Design Skill Setup (Admin)
- Add a skill in Admin → Skills with `category: "mockup"`, `slug: "design-system"`
- Content: HTML/CSS conventions, color palette, typography, component patterns
- This skill is auto-injected into every mockup generation prompt

### Implementation Order
1. Create `/api/mockup/generate/route.ts` — accepts `prompt`, `messages`, `brdContext`, `designSkill`; returns HTML string
2. Build `/mockup` page — split panel layout with iframe preview
3. Add BRD context selector (fetches from `/api/works?appType=brd`)
4. Wire AI chat → generate → update iframe
5. Add Save functionality (SavedWork, appType="mockup")
6. Add design skill loader in Admin (preload default design-system.md)
7. Add mockup list page (`/mockup/list`)

### Status
- Nav item added (points to `/mockup`)
- Placeholder page at `src/app/(app)/mockup/page.tsx`
- **NOT YET IMPLEMENTED** — implementation starts next session

---

## Timeline / Gantt

### DONE
- `InteractiveGantt.tsx` — drag/resize bars, sticky task column, color by project
- Hierarchy: depth indentation (20px per level), subtask visual indicator (colored left border)
- Inline task rename: double-click task name
- Add subtask (+) button on hover → inserts child row
- Cascade update: when child bar dragged beyond parent range → ParentAdjustmentModal → confirms → saves both child + parent dates to DB
- Account dropdown in Timeline Maker setup form (pulls from Accounts/ClientProfile)
- "Project Name" label (was "Project / Client Name")
- Task history: all changes (status, reschedule, remarks) logged to `TaskHistory`, shown in History tab of TaskDetailModal

### TO DO
- `onReschedule` — drag bar → persist to DB (currently updates local state only in timeline page; DB save works in Tasks page Gantt)
- `onToggleExpand` — persist expand/collapse state
- Drag-to-reorder rows vertically

### 🔮 Smart Timeline + Capacity Engine (Planned)
See detailed spec below each feature.

#### Terminology
| Term | Definition |
|------|-----------|
| **Plan Allocation** | Total hours budgeted for a task |
| **Daily Load** | Plan Allocation ÷ working days the bar spans |
| **Capacity** | Max productive hours per user per day (default: 8h) |
| **Schedule Health Check** | Detects and flags overloads/conflicts |

#### Feature 2 — Owner vs Assignee Role (TO DO)
- Add `ownerEmail` + `roleTag` to `TimelineItem`
- Timeline generator pre-fills `ownerEmail` from session
- Admin user management page to assign roles + set capacity

#### Feature 3 — Plan Allocation ÷ Days Logic (TO DO)
- `dailyLoad = planAllocationHours / workingDaysInRange`
- Stretching bar → fewer hours/day; shrinking → more hours/day

#### Feature 4 — Schedule Health Check (TO DO)
- Toolbar badge: "⚠ 3 conflicts"
- Modal lists overloaded days + contributing tasks
- "Auto-balance" option sends to AI for redistribution

#### Feature 5 — Cross-Project Conflict Awareness (TO DO)
- "Show my other tasks" toggle in Gantt toolbar
- Ghost bars for read-only tasks from other projects

#### Feature 6 — AI-Aware Timeline Generation (TO DO)
- Pass existing daily load as context to AI prompt
- AI avoids scheduling on already-loaded days

#### Implementation Order
1. Schema: `ownerEmail` on `TimelineItem`, `capacityHoursPerDay` on `User`
2. `GET /api/users` for admin assignment UI
3. `src/lib/capacity.ts` — daily load calculation
4. `src/components/timeline/HealthCheck.tsx`
5. Ghost bars in InteractiveGantt
6. AI prompt update in `/api/timeline/generate`
7. User management page at `/admin/users`

---

## Task Manager

### DONE
- Task list, Gantt, and calendar views in `/tasks`
- Add subtask, task detail modal with History & Remarks tab
- History tab now logs: status changes, reschedules (with dates), standalone remarks — all auto-written on PATCH
- Subtask drag in Gantt now updates visual state correctly (recursive `applyDates`)
- Cascade parent update when child exceeds parent range — saves both to DB
- Tasks sidebar: "My Active Projects" (standalone) + "Accounts" (expanded shows account-tagged projects)
- Removed "Return to Planner" link from sidebar

### TO DO
- DAR (Daily Activity Report) generation and export
- Task completion flow with evidence upload
- Link tasks to `ownerEmail` (connects to Smart Timeline)

---

## Build & Infrastructure

### DONE
- All TypeScript errors fixed
- DB migration applied: `sqlite3 prisma/dev.db < prisma/migrations/.../migration.sql`
- `Project` model now has `clientProfileId` FK linking to `ClientProfile` (Account)
- `GET /api/accounts` — returns all ClientProfiles for dropdowns

### TO DO — Production
1. Switch Prisma datasource to PostgreSQL
2. Set up Neon or Railway PostgreSQL
3. Run `npx prisma migrate deploy` on production DB
4. Configure all env vars in Vercel
5. Set up Google OAuth production redirect URI

---

## Key Files Reference

| What | Where |
|------|-------|
| Auth config | `src/auth.ts` |
| Route protection | `src/middleware.ts` |
| AI abstraction | `src/lib/ai.ts` |
| AI keys config | `config.json` (gitignored) |
| Admin settings UI | `src/app/(app)/admin/page.tsx` |
| Accounts module | `src/app/(app)/meeting-prep/page.tsx` |
| Accounts API | `src/app/api/accounts/route.ts` |
| Live meeting room | `src/app/meetings/[id]/live/page.tsx` |
| Gantt chart | `src/components/timeline/InteractiveGantt.tsx` |
| Timeline page | `src/app/(app)/timeline/page.tsx` |
| Task dashboard | `src/components/tasks/TaskDashboard.tsx` |
| Tasks sidebar | `src/app/(app)/tasks/page.tsx` |
| Left nav | `src/components/layout/LeftNav.tsx` |
| Mockup Maker (placeholder) | `src/app/(app)/mockup/page.tsx` |
| Prisma schema | `prisma/schema.prisma` |
| DB file | `./dev.db` (project root — NOT `prisma/dev.db`) |
| App registry API | `src/app/api/apps/route.ts` |
| App CRUD | `src/app/api/apps/[id]/route.ts` |
| App seed | `src/app/api/apps/seed/route.ts` |
| Meeting process (outputs) | `src/app/api/meetings/[id]/process/route.ts` |

---

## Environment Variables

```
AUTH_SECRET=<generated>
AUTH_GOOGLE_ID=<from Google Cloud Console>
AUTH_GOOGLE_SECRET=<from Google Cloud Console>
NEXTAUTH_URL=http://localhost:3003   # change for production
DEV_PASSWORD=cst2025dev             # remove in production
DATABASE_URL=file:./dev.db          # change to PostgreSQL for production
```

---

## Session: 2026-03-29 — App Builder, Meeting Fix, Post-Meeting Outputs

### Changes completed this session

**1. Meeting POST 500 fix** (`src/app/api/meetings/route.ts`)
- Replaced Prisma transaction with nested create + include (fails on libsql) with sequential `$executeRawUnsafe` calls
- Added `projectId` to the INSERT so meetings can be linked to a task project

**2. LeftNav reorganization** (`src/components/layout/LeftNav.tsx`)
- Structure: Explore → Accounts → AI Apps (collapsible) → Tasks → [divider] → Admin → Settings
- AI Apps submenu loaded dynamically from `GET /api/apps` (filter: `isActive=true`, `slug !== "meeting-prep"`)
- `ICON_MAP` maps DB icon string (e.g. `"CalendarCheck"`) to lucide JSX

**3. App model + API**
- `prisma/schema.prisma`: added `App` model (id, name, slug, icon, href, isActive, isBuiltIn, sortOrder)
- SQL run directly on `./dev.db`: `CREATE TABLE App (...)`, `ALTER TABLE TarkieMeeting ADD COLUMN projectId`
- `GET/POST /api/apps` — list / create
- `PATCH/DELETE /api/apps/[id]` — update / delete (built-in apps blocked from delete)
- `POST /api/apps/seed` — idempotent seed of 6 built-in apps

**Built-in apps seeded:**
| slug | href | icon |
|------|------|------|
| meeting-prep | /meeting-prep | ClipboardList |
| meetings | /meetings | CalendarCheck |
| architect | /architect | GitBranch |
| brd | /brd | FileText |
| mockup | /mockup | Paintbrush |
| timeline | /timeline | Clock |

`meeting-prep` is excluded from the AI Apps nav submenu (it's the top-level "Accounts" item).

**4. Admin App Builder** (`src/app/(app)/admin/page.tsx`)
- "App Prompts" tab → renamed "App Builder"
- CRUD UI: toggle active, inline edit, seed button, new app form
- Skills tab unchanged — still used for editing skill content per app category

**5. Meeting project selector** (`src/app/(app)/meetings/page.tsx`)
- Fetches `/api/projects` on modal mount
- Project dropdown in Details step — passes `projectId` in POST body

**6. Post-meeting outputs** (`src/app/api/meetings/[id]/process/route.ts`)
After Gemini generates Minutes + BRD + Tasks:
- BRD auto-saved to `SavedWork` (`appType: 'brd'`) if meeting has `clientProfileId`
- Action items auto-inserted as `TimelineItem` rows if meeting has `projectId`
  - taskCode format: `MTG-XXXXX`; durationHours: 4; status: pending
  - plannedEnd: AI due date or T+7 days

### Next planned session

**Smart Task Intelligence** (plan file: `~/.claude/plans/zesty-honking-widget.md`)
1. Schema: add `recurringFrequency`, `recurringUntil`, `isRecurringTemplate`, `recurringParentId` to `TimelineItem`; create `UserCapacity` table
2. `src/lib/scheduling.ts` — pure scheduling utilities (materialize recurring, detect overload/conflicts, find next slot)
3. Extend `/api/tasks` GET for windowed recurring instances + conflict/overload annotations
4. `RecurringConfig.tsx` component + new tab in `TaskDetailModal`
5. `OverloadBadge.tsx` + `ConflictWarning.tsx` in `TaskDashboard`
6. `PersonalDashboard.tsx` + `/api/dashboard` + `/api/ai/day-planner`

# ARIMA & Eliana — 5-Slide Showcase

> **Use:** paste this whole file into Claude with the prompt below to generate a 5-slide deck.

## Prompt for Claude

```
Create a 5-slide PowerPoint deck from this brief.
Audience: Tarkie / Mobile Optima internal team.
Per slide: title, 3-4 bullet points, 2-3 sentence speaker notes.
Tone: confident, concise, builder energy. No corporate filler.
Output as numbered markdown ready to paste into PowerPoint.
```

---

## Context (one paragraph)

CST OS has two production AI agents — **ARIMA** (Relationship Manager) and **Eliana** (Business Analyst) — operating across web, Telegram, and the client portal. Together they automate account management, courtesy-call compliance, proposal writing, BRD authoring, and portfolio-wide reporting. Branded purple `#7C73E8`. Powered by Gemini 2.0 + tool-use.

---

## The 5 Slides

### Slide 1 — Meet ARIMA & Eliana
Two AI teammates built into CST OS.

- **ARIMA** — Relationship Manager. Lives in Telegram (client GCs, Super Admin GC, RM team rooms) + web. Daily account work, courtesy calls, requests, intelligence.
- **Eliana** — Business Analyst. Discovery sessions, BRD authoring.
- Same engine (Gemini 2.0 + tool use), different personas + skills.
- Switchable per Telegram GC via `/mode arima` / `/mode eliana`.

**Speaker notes:** Not chatbots — actual agents that take real actions like booking meetings, generating proposals, and DMing teammates with overdue alerts.

---

### Slide 2 — Account Health & Portfolio Visibility
Real-time portfolio insight for everyone.

- **Executive Summary**: red/yellow/green health per account; per-Tier, per-Group, per-RM breakdowns; AI-clustered top risks + opportunities across 50+ accounts.
- **Lifecycle tracking**: Exploration → Pending → Implementation → Hypercare → Maintenance. ARIMA escalates if hypercare exceeds 90 days.
- **Outputs**: live web dashboard + PDF + Word + Google Sheet sync.
- **Scoped**: admins see all, RMs see only their assigned accounts.

**Speaker notes:** Replaces the manual portfolio review meeting. CEO opens one page, sees the full book. RMs see their slice automatically — no permission setup needed.

---

### Slide 3 — Telegram-Native AI (3 Binding Modes)
ARIMA in Telegram, anywhere your team works.

- **Client GCs** — one GC per account. Multiple bind keys supported (Internal vs Client-facing). One-tap setup via deep link + QR.
- **Super Admin GC** — portfolio-wide queries. Allowlist-gated, audited, time-bound. Tools: `portfolio_health_summary`, `find_accounts_by_criteria`, `compare_accounts`.
- **RM Team Rooms** — one GC per RM, live-scoped to their assigned accounts. Commands: `/myaccounts`, `/redaccounts`, `/overdue`.
- **Proactive alerts**: daily hypercare sweep DMs PM + Super Admins; bi-weekly maintenance updates; monthly CC compliance reports.

**Speaker notes:** ARIMA refuses cross-RM queries cleanly. Portfolio data never leaves the SA GC. Every tool call is audited. Onboarding a new GC = ~10 seconds.

---

### Slide 4 — Conversational Document Generation
Chat with ARIMA / Eliana. Get a branded PDF.

- **Proposal Maker** — chat-left / preview-right. Tell ARIMA the scope + cost, get a Tarkie-branded PDF in <5 minutes. Cost numbers never invented — always user-confirmed. Auto-files to `Proposals/<Account>/`.
- **BRD Maker** — Eliana asks discovery questions, captures answers, generates Mermaid sequence diagrams, exports Word + PDF.
- **Image attachments**: drop a whiteboard photo or prior quote — Gemini Vision reads it and incorporates the data.
- **Brand-exact output**: actual Word template filled via docxtemplater → Drive auto-converts → PDF preserves all styling.

**Speaker notes:** Proposal generation went from 2-3 hours to 5 minutes. BRD from 1 day to 1 hour. AI judgment chooses what sections apply; the template stays untouched between proposals.

---

### Slide 5 — Admin Control + What's Next
You tune the AI without writing code.

- **Skills** — markdown system prompts per app (`brd`, `proposal`, `arima`, `eliana`), editable in `/admin/skills`. Reorder priorities, change voice, add domain knowledge.
- **Guardrails** — forbidden topics + phrases, required disclosures, escalation triggers, off-hours messages. All admin-editable.
- **Tool autonomy** — every ARIMA tool registered with `auto` / `approval` / `disabled` levels. Grant or revoke per tool.
- **Coming next**: ARIMA-driven proposal creation inside Telegram chat. Tier rooms + group rooms. Admin Console reorganization.

**Speaker notes:** Anyone with admin access can change how ARIMA writes, what it refuses, when it escalates, which tools it can use — no deployment needed. The system gets sharper as the team teaches it.

---

## Visual notes for the deck

- Primary color: Tarkie purple `#7C73E8`
- Suggested screenshots:
  - Slide 2: the Account Health executive summary (the donut + Tier breakdown)
  - Slide 3: the Telegram SA GC with ARIMA replying to `/ccstatus`
  - Slide 4: the Proposal Maker two-panel chat + preview UI
  - Slide 5: the `/admin/skills` table view
- Avoid stock imagery — product screenshots only.

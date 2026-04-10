# Tarkie PowerPoint Add-in
## Technical Specification & Implementation Plan

**Version:** 1.0 | **Date:** April 2026 | **Confidential**

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Component Breakdown](#3-component-breakdown)
4. [Claude AI Integration](#4-claude-ai-integration)
5. [PowerPoint Integration via Office JS](#5-powerpoint-integration-via-office-js)
6. [Authentication & Security](#6-authentication--security)
7. [Deployment & Distribution](#7-deployment--distribution)
8. [Implementation Plan](#8-implementation-plan)
9. [Effort & Cost Estimates](#9-effort--cost-estimates)
10. [Risks & Mitigations](#10-risks--mitigations)
11. [Recommended Next Steps](#11-recommended-next-steps)

---

## 1. Executive Summary

This document defines the technical specification and implementation plan for the Tarkie PowerPoint Add-in — an AI-powered presentation generator that lives natively inside Microsoft PowerPoint. The add-in enables Tarkie team members to generate fully branded, client-specific presentation decks in minutes by leveraging Claude AI, existing client data from Turso, and Tarkie's standardized PowerPoint templates.

The system is designed to eliminate manual deck creation, ensure brand consistency across all client-facing presentations, and allow non-technical staff to produce professional outputs with minimal effort.

### Core Capabilities

- Full deck generation — one click generates a complete, populated presentation
- Per-slide quick actions — preset buttons for common edits on individual slides
- Chat-based instructions — natural language commands to update any slide
- Photo arrangement — automatic layout and alignment of pasted images
- Live client data — pulls real account information from Turso at generation time
- Brand accuracy — writes directly into open PowerPoint file using Slide Master layouts

### Non-Goals (Out of Scope for V1)

- Video or screen recording editing
- Real-time co-editing between multiple users
- Publishing or sharing decks from within the add-in
- Mobile PowerPoint support

---

## 2. System Architecture

The add-in follows a three-tier architecture: a frontend sidebar UI hosted on Firebase, a secure backend layer running on Firebase Cloud Functions, and existing data infrastructure (Turso DB + Tarkie Team OS). Claude API is called exclusively from the backend — the API key is never exposed to the client.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│              MICROSOFT POWERPOINT                   │
│                                                     │
│   ┌─────────────────────┐   ┌──────────────────┐   │
│   │   Active Slide       │   │  Add-in Sidebar  │   │
│   │   (your template)    │   │  (Firebase Host) │   │
│   │                     │   │                  │   │
│   │  ← Content written  │   │  Client picker   │   │
│   │    via Office JS    │   │  Deck type       │   │
│   │                     │   │  Chat box        │   │
│   └─────────────────────┘   │  Quick actions   │   │
│                             └────────┬─────────┘   │
└──────────────────────────────────────┼─────────────┘
                                       │ HTTPS
                                       ▼
                        ┌──────────────────────────┐
                        │  Firebase Cloud Function  │
                        │                          │
                        │  1. Verify Firebase Auth  │
                        │  2. Query Turso (client)  │
                        │  3. Build Claude prompt   │
                        │  4. Call Claude API       │
                        │  5. Return slide content  │
                        └──────┬───────────┬────────┘
                               │           │
                  ┌────────────▼──┐   ┌────▼──────────────┐
                  │  Turso DB      │   │   Claude API       │
                  │  (client data) │   │  (content gen.)    │
                  └───────────────┘   └───────────────────┘
```

### Technology Stack

| Layer | Technology |
|---|---|
| Add-in Frontend | HTML / CSS / JavaScript (Office JS API) |
| Add-in Hosting | Firebase Hosting (existing project) |
| Authentication | Firebase Auth (existing team accounts) |
| Backend / API Gateway | Firebase Cloud Functions (Node.js) |
| Database | Turso (existing — client profiles, deck templates) |
| AI Engine | Claude API — claude-sonnet-4-20250514 |
| File Storage | Firebase Storage (master .pptx templates) |
| PowerPoint Integration | Office JS API (official Microsoft Add-in SDK) |
| Add-in Manifest | XML manifest file — deployed via M365 Admin or shared URL |

---

## 3. Component Breakdown

### 3.1 Add-in Sidebar UI

The sidebar is a single-page HTML/JS app served from Firebase Hosting. It loads inside PowerPoint's task pane and communicates with the active presentation via Office JS. It has three functional zones:

**Zone A — Deck Generator**
- Client selector dropdown (populated from Turso via Cloud Function)
- Deck type selector (Kickoff, Takeover, Training, Recommendation, etc.)
- Generate Full Deck button — triggers full deck population
- Progress indicator while generation runs

**Zone B — Slide Chat**
- Free-text chat box — staff types natural language instructions
- Slide selector — choose which slide to target, or all slides
- Apply button — sends instruction to Cloud Function, updates slide(s)
- Chat history — shows last 5 interactions for reference

**Zone C — Quick Actions**
- Triggered when staff selects a slide in PowerPoint
- Context-aware buttons: Regenerate, Make Shorter, Make Formal, Add Data, Arrange Photos
- Photo layout picker: 2-column, 3-column, 2x2 grid, full bleed

#### Sidebar UI Mockup

```
┌─────────────────────────────┐
│  🎯 TARKIE DECK GENERATOR   │
│                             │
│  Client: [ABC Corp      ▼]  │
│  Deck:   [Kickoff       ▼]  │
│                             │
│  [Generate Full Deck]       │
│  ─────────────────────────  │
│  💬 SLIDE CHAT              │
│                             │
│  Slide: [5 - Team Intro ▼]  │
│                             │
│  ┌───────────────────────┐  │
│  │ Update slide 5, add   │  │
│  │ team members from     │  │
│  │ ABC Corp profile      │  │
│  └───────────────────────┘  │
│                             │
│  [Apply to This Slide]      │
│  [Apply to All Slides]      │
│  ─────────────────────────  │
│  ⚡ QUICK ACTIONS           │
│  [Regenerate] [Shorter]     │
│  [Formal]     [Add Data]    │
│  [Arrange Photos]           │
└─────────────────────────────┘
```

---

### 3.2 Firebase Cloud Functions

Three primary Cloud Functions handle all backend logic:

**`generateFullDeck(clientId, deckType)`**
- Fetches client profile from Turso
- Fetches deck template slide map from Turso
- Fetches master .pptx template URL from Firebase Storage
- Builds structured prompt per slide and calls Claude API
- Returns JSON: array of slide content objects

**`updateSlide(clientId, slideNumber, instruction, currentContent)`**
- Receives staff instruction + current slide content as context
- Injects client profile from Turso into system prompt
- Calls Claude API with targeted instruction
- Returns updated content for that specific slide only

**`arrangePhotos(slideNumber, imageCount, layoutType)`**
- Receives current image positions via Office JS
- Calculates new positions based on layout type and slide dimensions
- Returns coordinate map — add-in applies via Office JS
- No Claude call needed — pure layout math

---

### 3.3 Turso Database Schema

The following tables are added to the existing Turso instance. Client profiles already exist — only the deck-related tables are new.

```sql
-- Existing table (already in Turso)
clients (id, name, industry, go_live_date, active_users,
         modules, key_contacts, usage_trend, ...)

-- New: deck template definitions
deck_templates (
  id           TEXT PRIMARY KEY,
  deck_type    TEXT,    -- 'kickoff', 'takeover', 'training'
  template_url TEXT,   -- Firebase Storage path to .pptx file
  slide_map    TEXT,   -- JSON: slide structure & content rules
  version      TEXT,
  updated_at   DATETIME
);

-- New: generation logs (for usage tracking & audit)
deck_generations (
  id           TEXT PRIMARY KEY,
  user_id      TEXT,
  client_id    TEXT,
  deck_type    TEXT,
  tokens_used  INTEGER,
  created_at   DATETIME
);
```

---

### 3.4 Slide Map Structure

Each deck template has a `slide_map` JSON that tells the add-in exactly what content goes on each slide, what comes from Turso directly, and what Claude generates. This is the key to accuracy.

```json
{
  "deck_type": "kickoff",
  "slides": [
    {
      "slide_number": 1,
      "name": "Cover",
      "layout": "COVER",
      "placeholders": {
        "title": "{{client.name}} Kickoff Meeting",
        "subtitle": "{{meta.date}} | Presented by {{meta.presenter}}"
      },
      "source": "template"
    },
    {
      "slide_number": 3,
      "name": "Project Overview",
      "layout": "CONTENT_LEFT",
      "placeholders": {
        "title": "Project Overview",
        "content": {
          "source": "claude",
          "prompt": "Write 3 concise bullet points summarizing the project for {{client.name}}, a {{client.industry}} company going live on {{client.go_live_date}}"
        }
      }
    },
    {
      "slide_number": 5,
      "name": "Team Introduction",
      "layout": "TWO_COLUMN",
      "placeholders": {
        "title": "Key Contacts",
        "content": {
          "source": "turso",
          "field": "client.key_contacts"
        }
      }
    }
  ]
}
```

---

## 4. Claude AI Integration

### 4.1 Prompt Architecture

Claude receives a structured system prompt on every call that includes the client profile and deck context. Staff never needs to re-explain who the client is. Individual prompts are kept small and targeted.

```javascript
// System prompt injected on every call
const systemPrompt = `
You are a presentation content assistant for Tarkie,
a SaaS field operations platform.

CURRENT CLIENT PROFILE:
- Name: ${client.name}
- Industry: ${client.industry}
- Active Users: ${client.active_users}
- Modules: ${client.modules.join(', ')}
- Go-live Date: ${client.go_live_date}
- Key Contacts: ${client.key_contacts}
- Usage Trend: ${client.usage_trend}

CURRENT DECK: ${deckType}
CURRENT SLIDE: ${slideNumber} - ${slideName}

RULES:
- Always respond in valid JSON only
- Keep bullet points concise (max 12 words each)
- Use professional, client-facing language
- Never include placeholder text in output
- Tone: confident, helpful, solution-focused
`;
```

### 4.2 Token Efficiency

By separating what Claude generates vs. what comes directly from Turso, token usage stays minimal:

| Content Type | Source | Claude Tokens Used |
|---|---|---|
| Client name, contacts, dates | Turso (direct) | 0 |
| Usage stats, active users | Turso (direct) | 0 |
| Module list, go-live info | Turso (direct) | 0 |
| Project overview bullets | Claude | ~300–400 |
| Recommendations, insights | Claude | ~400–500 |
| Photo arrangement logic | Math (no Claude) | 0 |
| Quick action rewrites | Claude | ~200–300 |
| Full deck generation (15 slides) | Mixed | ~2,000–3,000 |

> 💡 **Cost Estimate:** A full 15-slide deck costs approximately $0.02–0.05 at current Claude API pricing. A single slide update costs under $0.005.

### 4.3 Example Prompts Staff Can Use

| What Staff Types | What Happens |
|---|---|
| *"Update slide 5, add team members from ABC Corp"* | Pulls contacts from Turso, rewrites slide 5 |
| *"Make slide 3 more concise, max 3 bullets"* | Rewrites slide 3 content shorter |
| *"Add a slide after slide 4 about their active modules"* | Creates new slide with module data from Turso |
| *"Change the tone of slide 6 to be more formal"* | Rewrites slide 6 with formal language |
| *"Summarize the whole deck in one slide at the end"* | Generates a summary slide and appends it |
| *"Replace all placeholder dates with ABC Corp's go-live date"* | Scans all slides, updates dates from Turso |

---

## 5. PowerPoint Integration via Office JS

### 5.1 How Content Is Written to Slides

Office JS gives the add-in full programmatic access to the open presentation. Content is written directly into existing placeholder shapes on each slide — not creating new text boxes. This preserves your Slide Master formatting exactly.

```javascript
// Writing content into a slide placeholder
async function populateSlide(slideIndex, content) {
  await PowerPoint.run(async (context) => {
    const slide = context.presentation.slides
                  .getItemAt(slideIndex);
    slide.load('shapes');
    await context.sync();

    // Find placeholder by name (set in your Slide Master)
    const titleShape = slide.shapes.items
      .find(s => s.name === 'Title Placeholder');

    const contentShape = slide.shapes.items
      .find(s => s.name === 'Content Placeholder');

    titleShape.textFrame.text = content.title;
    contentShape.textFrame.text = content.body;

    await context.sync();
  });
}
```

### 5.2 Photo Arrangement

When staff pastes images onto a slide and triggers Arrange Photos, Office JS reads current image positions, the Cloud Function calculates the new layout, and Office JS repositions each image precisely.

```javascript
// Auto-arrange images into a grid layout
async function arrangePhotos(layout) {
  await PowerPoint.run(async (context) => {
    const slide = context.presentation
                  .getSelectedSlides().getItemAt(0);
    slide.load('shapes');
    await context.sync();

    // Get all image shapes on slide
    const images = slide.shapes.items
      .filter(s => s.type === 'Image');

    // Calculate grid positions
    const positions = calculateLayout(images.length, layout);

    // Apply positions
    images.forEach((img, i) => {
      img.left   = positions[i].x;
      img.top    = positions[i].y;
      img.width  = positions[i].w;
      img.height = positions[i].h;
    });

    await context.sync();
  });
}
```

### 5.3 Template Workflow

The recommended workflow for staff creating a new deck:

1. Open the correct master template file (e.g., `Kickoff_Template.pptx`) from the shared folder
2. Save a copy with the client name and date (e.g., `ABC_Corp_Kickoff_May2026.pptx`)
3. Open the Tarkie add-in from the PowerPoint ribbon
4. Log in with existing Tarkie/Firebase credentials
5. Select the client from the dropdown
6. Click **Generate Full Deck** — add-in populates all slides
7. Use the chat box or quick actions to refine any slides
8. Save and share the completed deck

---

## 6. Authentication & Security

### 6.1 Team Access

Firebase Auth handles all authentication. Since your team already has accounts on your Team OS (Firebase project), they use the same credentials to access the add-in. No new accounts are created.

- Login options: Email/Password or Google Sign-in (whichever Team OS uses)
- Session persists — staff only logs in once per device
- Unauthorized users cannot trigger Cloud Functions — all requests require a valid Firebase token

### 6.2 API Key Security

The Claude API key is stored exclusively as a Firebase Cloud Function environment variable. It is never sent to the browser, never in the add-in code, and never visible to staff.

```bash
# Store API key securely in Firebase
firebase functions:config:set claude.api_key="your-key-here"

# Access inside Cloud Function only
const apiKey = functions.config().claude.api_key;
# This value never leaves the server
```

### 6.3 Usage Controls

| Control | Implementation |
|---|---|
| Per-user rate limiting | Track requests in `deck_generations` table, enforce in Cloud Function |
| Monthly cost cap | Set spending limit in Anthropic console dashboard |
| Audit trail | Every generation logged with user_id, client_id, tokens_used |
| Role-based access | Restrict deck types by user role via Firebase Auth custom claims |
| Turso access | Cloud Function holds Turso credentials — never exposed to client |

---

## 7. Deployment & Distribution

### 7.1 Firebase Deployment

Since your Team OS already runs on Firebase, deploying the add-in is simply adding new files and functions to the existing project:

```bash
# Deploy add-in frontend to existing Firebase Hosting
firebase deploy --only hosting:addin

# Deploy new Cloud Functions
firebase deploy --only functions:generateFullDeck
firebase deploy --only functions:updateSlide
firebase deploy --only functions:arrangePhotos

# Add-in will be available at:
# https://your-project.web.app/addin/
```

### 7.2 Distributing to Your Team

**Option A — Microsoft 365 Admin Center (Recommended)**
- Upload the add-in manifest XML once to M365 Admin Center
- Assign to your team or the entire organization
- Add-in automatically appears in PowerPoint for all assigned users
- No installation needed by individual team members

**Option B — Sideloading via Shared Manifest URL**
- Host the `manifest.xml` on Firebase Hosting
- Each team member adds it once: Insert → Get Add-ins → My Add-ins → Upload My Add-in
- After that, it appears permanently in their PowerPoint ribbon
- Suitable if you don't have M365 Admin access

> 📌 **Note:** The manifest XML simply points to your Firebase Hosting URL. When you update the add-in, all users automatically get the latest version — no reinstallation needed.

---

## 8. Implementation Plan

The build is structured in four phases. Each phase produces a working, usable output — not just progress toward a future release.

### Phase 1 — Foundation (Week 1–2)

> 🎯 **Deliverable:** Working add-in prototype that generates one deck type (Kickoff) for one client using real data.

- [ ] Set up Office JS add-in scaffold and manifest file
- [ ] Deploy basic sidebar UI to existing Firebase Hosting
- [ ] Create `generateFullDeck` Cloud Function
- [ ] Connect Cloud Function to Turso — read existing client profiles
- [ ] Integrate Claude API into Cloud Function
- [ ] Build slide map for Kickoff deck type
- [ ] Upload Kickoff master template to Firebase Storage
- [ ] Implement content writing to PowerPoint via Office JS
- [ ] Test end-to-end: select client → generate → populated deck

### Phase 2 — Interaction Modes (Week 3–4)

> 🎯 **Deliverable:** All three interaction modes working — full generation, slide chat, and quick actions.

- [ ] Build Slide Chat UI and `updateSlide` Cloud Function
- [ ] Implement conversation history within a session
- [ ] Build Quick Actions panel (Regenerate, Make Shorter, Make Formal, Add Data)
- [ ] Implement photo arrangement (`arrangePhotos` Cloud Function + Office JS)
- [ ] Add slide selector — target specific slides or all slides
- [ ] Add Firebase Auth login to the sidebar
- [ ] Test all three interaction modes thoroughly

### Phase 3 — More Deck Types (Week 5–6)

> 🎯 **Deliverable:** All standard deck types available — Takeover, Training, Recommendation, Admin Training.

- [ ] Upload remaining master templates to Firebase Storage
- [ ] Build slide maps for each deck type
- [ ] Add deck type selector to sidebar UI
- [ ] Implement usage logging in `deck_generations` table
- [ ] Add per-user rate limiting
- [ ] Polish UI — loading states, error messages, success feedback

### Phase 4 — Intelligence & Refinement (Week 7–8)

> 🎯 **Deliverable:** Production-ready add-in with full client intelligence and team distribution.

- [ ] Enrich client profiles in Turso — add more fields as needed
- [ ] Connect to Tarkie backend API for live usage data (if available)
- [ ] Build admin view — usage logs, token costs per user
- [ ] Distribute to full team via M365 Admin Center or sideload
- [ ] Create internal documentation and short training video for team
- [ ] Collect feedback and iterate on prompt quality and UI

---

## 9. Effort & Cost Estimates

### 9.1 Build Effort

| Component | Estimated Effort | Phase |
|---|---|---|
| Add-in scaffold + manifest | 0.5 days | 1 |
| Firebase Hosting setup (add-in route) | 0.5 days | 1 |
| `generateFullDeck` Cloud Function | 2 days | 1 |
| Turso integration | 0.5 days | 1 |
| Claude API integration | 0.5 days | 1 |
| Slide map for Kickoff deck | 1 day | 1 |
| Office JS content writing | 1.5 days | 1 |
| Slide Chat + `updateSlide` function | 2 days | 2 |
| Quick Actions panel | 1.5 days | 2 |
| Photo arrangement | 1.5 days | 2 |
| Firebase Auth in sidebar | 0.5 days | 2 |
| Additional deck types (x4) | 3 days | 3 |
| Usage logging + rate limiting | 1 day | 3 |
| Admin view + distribution | 1.5 days | 4 |
| Testing + refinement | 3 days | 4 |
| **TOTAL** | **~20 days** | |

### 9.2 Ongoing Running Costs

| Cost Item | Estimate |
|---|---|
| Firebase Hosting | Free tier (existing project) |
| Firebase Cloud Functions | Free tier covers ~2M calls/month |
| Firebase Storage (templates) | Negligible — small .pptx files |
| Firebase Auth | Free — unlimited users |
| Turso DB | Existing subscription — no change |
| Claude API — Full deck (15 slides) | ~$0.02–0.05 per deck |
| Claude API — Single slide update | ~$0.003–0.005 per update |
| Claude API — 20 decks/month estimate | ~$0.40–1.00/month |
| Microsoft 365 (existing licenses) | No change |

> 💡 **Key Point:** For a team generating 20 decks per month, total Claude API cost is under $1/month. The dominant cost is build time, not running cost.

---

## 10. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Slide Master placeholder names inconsistent across templates | Medium | Audit all templates before build — standardize placeholder names in Slide Master |
| Office JS limitations on certain PowerPoint versions | Low | Test on team's actual PowerPoint version early in Phase 1 |
| Claude output not matching expected format | Medium | Use strict JSON output prompts + validation layer in Cloud Function |
| Cold start delay on Cloud Functions | Low | Use Firebase min-instance setting for always-warm functions |
| Client data in Turso incomplete for some accounts | Medium | Add graceful fallbacks — Claude generates from partial data with placeholders |
| Team adoption — staff revert to manual | Low | Phase 1 prototype demonstration, iterative feedback loop |
| API key exposure | Very Low | Key lives only in Cloud Function env — never in client code |

---

## 11. Recommended Next Steps

To begin Phase 1 immediately, the following inputs are needed:

1. Share the **Kickoff master template** (`.pptx`) — so placeholder names can be mapped
2. Confirm the **Turso client table schema** — so the Cloud Function query can be written
3. Confirm **Firebase project name** — to set up the new hosting route and functions
4. Identify **one test client** in Turso — for end-to-end prototype testing
5. Confirm **PowerPoint version** used by the team — to validate Office JS compatibility

> ✅ **Ready to Build:** Once the Kickoff template and Turso schema are shared, Phase 1 development can begin immediately. The prototype can be functional within 2 weeks.

---

*Tarkie | www.tarkie.com | Confidential*

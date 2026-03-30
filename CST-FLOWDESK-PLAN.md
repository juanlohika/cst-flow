# 🚀 CST FlowDesk: Project Manifest & Master Plan

## 🧠 1. System Overview
**Name:** CST FlowDesk  
**Company:** Mobile Optima (Tarkie Implementation)  
**Core Purpose:** A "Department OS" hub for the Client Success Team (CST) to streamline the journey from Signed Contract to Go-Live. It acts as an AI-powered Business Analyst and Project Management workspace.

### Core User Personas:
*   **Business Analysts:** Converting messy client meetings into structured BRDs.
*   **Project Managers:** Turning requirements into automated timelines and tasks.
*   **Implementation Specialists:** Visualizing complex client processes into "Figma-like" flowcharts.

---

## 🎨 2. Design Language: "Google Antigravity"
The UI must feel weightless, modern, and professional (inspired by Google Stitch/AI Studio).

*   **Background:** Off-white (`#F8F9FA`).
*   **Cards:** Pure white, `rounded-2xl` or `rounded-3xl`, soft shadows (`shadow-sm`).
*   **Primary Color:** Google Blue (`#1A73E8`).
*   **Typography:** Clean Sans-Serif (Inter or Geist).
*   **Layout:** Card-based directory on the home page; Split-pane (Chat on left, Canvas/Document on right) for tools.

---

## 🛠 3. Technical Stack
*   **Framework:** Next.js 14 (App Router).
*   **Styling:** Tailwind CSS + Shadcn UI.
*   **The Brain:** Google AI Studio (Gemini 1.5 Pro/Flash).
    *   *Why:* Native audio processing, 2M token context window, cost-effective.
*   **Diagramming:** React Flow (Infinite Canvas, Zoom/Pan like Figma).
*   **Auth:** NextAuth.js with Google Auth 2.0 (Domain-restricted to `@yourcompany.com`).
*   **Export:** `html-to-image` for 4x Resolution PNGs (for PowerPoint).

---

## 🧩 4. Core Modules (The Apps)

### 1️⃣ BRD Maker (AI-Assisted)
*   **Input:** Chat, Meeting Transcripts, or **Smart Dictation**.
*   **Output:** Developer-ready Business Requirement Documents.
*   **Features:** Markdown rendering, table generation, and "Low-Fidelity Mockup" suggestions.

### 2️⃣ Timeline Maker
*   **Input:** BRD data or project constraints.
*   **Output:** Interactive Gantt/Table view (Notion-style).
*   **Logic:** Must account for PH Holidays and Tarkie-specific implementation phases.

### ⚙️ Admin Module (System Settings)
*   **Description:** Administrative dashboard for global configuration.
*   **Features:** Secure form to input, update, and manage the AI API Key (e.g., Gemini) so it is never hardcoded.

### 3️⃣ Workflow Architect (Infinite Canvas)
*   **Input:** Step-by-step process descriptions via voice or text.
*   **Output:** High-fidelity Swimlane Diagrams.
*   **UI Experience:** Smooth Figma-like zoom/pan using **React Flow**.
*   **Export:** High-res PNG for professional PowerPoint presentations.

---

## 🎤 5. The "Smart Mic" Feature (Critical)
Every chat box must include a microphone icon powered by **OpenAI Whisper** or **Gemini Native Audio**.
*   **Pre-Processing Logic:** Raw audio is transcribed $\rightarrow$ AI cleans filler words ("um", "ah", "like") $\rightarrow$ AI removes off-topic tangents $\rightarrow$ Polished text is entered into the chat.

---

## 🗺 6. Implementation Roadmap

### Phase 1: The Shell (Current)
*   [ ] Set up Next.js 14 in Project IDX.
*   [ ] Build "Antigravity" Landing Page.
*   [ ] Configure Tailwind theme.

### Phase 2: The Brain & Auth
*   [ ] Connect Gemini 1.5 API via `google-generative-ai` SDK.
*   [ ] Implement Google OAuth (Domain locked).

### Phase 3: The Architect (Infinite Canvas)
*   [ ] Integrate **React Flow**.
*   [ ] Create "JSON-to-Diagram" logic where Gemini outputs node/edge data.
*   [ ] Build the "High-Res PNG" export tool.

### Phase 4: The Smart Mic
*   [ ] Build the Audio Recording component.
*   [ ] Implement the "Clean-up" prompt logic.

---

## 🤖 7. Instructions for Project IDX AI
*Copy and paste this into the IDX AI chat to "prime" it:*

> "We are building **CST FlowDesk**. Please refer to the `CST-FLOWDESK-PLAN.md` file for all project requirements. We are using **Next.js 14** and **Gemini 1.5**. Our first priority is building a modular UI that looks like Google's 'Antigravity' design. Start by helping me verify the `layout.tsx` and `page.tsx` match the directory-style UI discussed in the plan."

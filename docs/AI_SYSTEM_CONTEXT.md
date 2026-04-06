# AI System Context - CST FlowDesk

This document provides architectural and logic context for AI agents (like Claude Code) maintaining or extending this repository.

## 1. High-Level Architecture
- **Framework**: Next.js 14+ (App Router).
- **Database**: SQLite/libSQL via Drizzle ORM.
- **State Management**: React `useState` + `useEffect` for dashboard components, heavily reliant on server-side fetching.
- **Authentication**: Next-Auth (v5).
- **API Strategy**: RESTful handlers in `src/app/api/`. Use `materializeRecurringInstances` for recurring schedules.

## 2. Core Business Logic (Critical Path)

### **Timeline & Buffer Logic (Weekend-Skipping)**
All task completion and "Client Deadline" logic MUST skip weekends.
- **Primary Utility**: `src/lib/date-utils.ts` -> `addDaysSkippingWeekends(dateStr, paddingDays)`.
- **Database Fields**: `plannedEnd` (internal deadline) vs. `externalPlannedEnd` (client-facing deadline, includes padding).
- **Orange Bars**: In the Gantt view, `externalPlannedEnd` is rendered as an orange buffer extension.

### **Hierarchy & Progress Roll-up**
The `TimelineItem` table supports `parentId` for subtask nesting.
- **Parent Dates**: Parents auto-inherit the MIN(`plannedStart`) and MAX(`plannedEnd`) of their subtasks.
- **Progress Calculation**: Handled in `TaskDashboard.tsx` and `DonutChart.tsx`.

### **Project Lifecycle: Active vs. Archived**
- **Active Projects**: `archived: false`. Visible in the sidebar "Individual Roadmaps".
- **Archived Projects**: `archived: true`. Filtered from active sidebar but visible in the "Archived Roadmaps" explorer.

## 3. UI/UX Paradigm
- **Task Dashboard**: The central hub at `src/app/(app)/tasks/page.tsx`.
- **Views**: List, Calendar, Gantt, Kanban, Summary (L0), and Settings.
- **Gantt Level 0 (Summary Mode)**: Derived by `transformToLevelZero` in `TaskDashboard.tsx`. It collapses all project tasks into a single project-level summary row.

## 4. Database Schema Key Tables
- **`projects`**: Top-level containers.
- **`timelineItems`**: Tasks and subtasks. Contains `paddingDays` and `externalPlannedEnd`.
- **`projectStakeholders`**: External contacts managing project access.
- **`taskAssignments`**: Joins users to `timelineItems`.

---

## 5. Deployment Info
- Hosted on **Firebase App Hosting**.
- Database synced via **Turso** (SQLite).
- **Admin Lockdown**: Enabled for authorized domains only.

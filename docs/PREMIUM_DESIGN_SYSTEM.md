# Premium Design System - CST FlowDesk

This document outlines the "Anti-Stitch" Design System established for CST FlowDesk's premium management workspace.

## 1. Design Philosophy
The system prioritizes **Clarity, Precision, and Luxury**. It is a high-contrast, professional light theme designed for corporate project management.
- **Anti-Stitch**: We have moved away from legacy "Rounded Grey Boxes" and "Stitch-like" UI. 
- **Space-First**: Prioritizes generous whitespace, soft shadows, and clean borders over heavy fills.

## 2. Core Tokens

### **Colors**
- **Primary**: `bg-indigo-600` / `text-indigo-600` (Main Actions).
- **Secondary**: `bg-slate-900` / `text-slate-900` (High Contrast/Headers).
- **Success**: `bg-emerald-500` / `text-emerald-700` (Completion/Profitability).
- **Warning**: `bg-amber-500` / `text-amber-700` (In-Progress/Alerts).
- **Client Buffer**: `bg-orange-400` / `text-orange-600` (External Deadlines).

### **Typography**
- **Headers**: Capitalized, black-weight, wide-tracking (`tracking-widest`).
- **Body**: Clean sans-serif, high legibility.
- **Micro-Copy**: 8px - 10px, font-black, uppercase for labels.

## 3. Standard Components
- **`InteractiveGantt.tsx`**: Dynamic SVG/HTML hybrid chart. Supports `isSummary` mode for strategic L0 views.
- **`BufferModal.tsx`**: Specialized modal with weekend-skipping date arithmetic.
- **`ProjectSettingsView.tsx`**: The hub for Stakeholder CRUD and team management.
- **`DonutChart.tsx`**: Strategic health visualization for project progress.

## 4. Patterns
- **Hover Effects**: All interactive bars and cards should have subtle scaling (`hover:scale-[1.02]`) and soft shadow transitions.
- **Glassmorphism**: Limited to overlays and tooltips using `backdrop-blur-sm`.
- **Skeleton States**: Used during task fetching in the dashboard to maintain visual stability.

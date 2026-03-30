# Design Skills — Tarkie UI Design System

Use this file when converting wireframes into high-fidelity screens. Every decision here is derived from a working production design system. Follow these conventions exactly.

---

## 1. Foundation

### Font
- **Family**: Inter (all text, no exceptions)
- **Weights**: 400 regular, 500 medium, 600 semibold, 700 bold
- **Scale** (use these sizes only):
  - `10px` — subtext, captions
  - `12px` — labels, table cells, nav items, buttons, filter chips, badges (primary UI scale)
  - `14px` — body text, menu option labels, search inputs
  - `16px` — body md
  - `18px` — heading sm
  - `20px` — heading md
  - `24px` — heading lg

### Colors (primitives → semantic → component)
Always reference semantic tokens, never raw hex in components.

**Key semantic tokens:**
- `--color-surface-default` = white (page bg, table rows, bars)
- `--color-surface-subtle` = gray-50 `#FAFAFA` (hover states, subtle bg)
- `--color-surface-muted` = gray-100 `#F5F5F5` (nav hover bg)
- `--color-surface-table-header` = gray-35 `#FCFCFC` (column headers)
- `--color-text-primary` = gray-800 `#252B37` (lead text, headings)
- `--color-text-muted` = gray-600 `#535862` (column headers, default cell text)
- `--color-text-secondary` = gray-500 `#717680` (subtext)
- `--color-border-default` = gray-200 `#E9EAEB` (all borders/dividers)
- `--color-blue-500` = `#2162F9` (primary, active states)
- `--color-blue-50` = `#F1F7FF` (active bg on nav, selected states)

---

## 2. Layout

### Page Shell
```
┌─────────────────────────────────────────────┐
│ Left Nav (255px, collapsible)               │
│  ┌──────────────────────────────────────┐   │
│  │ Global Bar (40px)                    │   │
│  │ Tabs Bar (40px)                      │   │
│  │ Filter Bar (40px)                    │   │
│  │ Table / Content (flex: 1)            │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```
- Outer wrapper: `display: flex; height: 100vh; overflow: hidden`
- Content area: `flex: 1; display: flex; flex-direction: column; overflow: auto; min-width: 0`
- All bars: `height: 40px`, `border-bottom: 1px solid var(--color-border-default)`, `background: var(--color-surface-default)`

### Global Bar
- Left: hamburger icon (ghost, only when nav closed) + Breadcrumb component
- Right: icon buttons (secondary variant) + 24px avatar circle
- Padding: `0 16px`, gap between right icons: `8px`

### Tabs Bar
- Left: Tabs component (bottom-aligned with `align-self: flex-end`)
- Right: primary action button (e.g. "+ New Dashboard")
- Tabs: active `font-weight: 500`, idle `font-weight: 400`, indicator color gray-800
- Tab icon size: 16px

### Filter Bar
- Left: FilterChip components + placeholder "Filter" button
- Right: tertiary icon buttons (Search, Sort) + tertiary button with icon+text (Settings)
- Gap: `8px` on both sides
- Clicking a filter chip label opens a dropdown menu (SelectionMenu or MultiSelectMenu)

---

## 3. Components

### Button
**Variants**: primary, secondary, tertiary, ghost, placeholder, destructive
**Sizes**: sm (20px), md (24px), lg (28px), xl (32px)
**Border radius**: `rounded-md` = 6px for all

| Variant     | Background | Border        | Text     | Shadow                              |
|-------------|------------|---------------|----------|-------------------------------------|
| primary     | blue-500   | blue-600      | white    | none                                |
| secondary   | white      | transparent   | gray-800 | `0 0 1px 1px rgba(147,151,156,.19)` |
| tertiary    | white      | transparent   | gray-600 | `0 0 1px 1px rgba(147,151,156,.19)` |
| ghost       | transparent| transparent   | gray-600 | none                                |
| placeholder | gray-50    | gray-200 dash | gray-500 | none                                |
| destructive | ember-500  | ember-500     | white    | none                                |

- Icons injected via `React.cloneElement`, size matches button size (14px for sm/md/lg/xl)
- `IconButton` = icon-only square button (same height = width)

### Badge
**Colors**: gray, blue, green, yellow, orange, red/ember, violet
**Sizes**: sm (20px min-height), md, lg
**outline prop**: adds `ring-1 ring-inset` (never affects height)

**StatusBadge** statuses: `active` (green), `draft` (gray), `archived` (violet), `published` (blue)

### FilterChip
- Size md: height 24px, radius 6px, font 12px
- Structure: [label button] [1px divider] [× clear button]
- Has `onLabelClick` prop for opening filter menus

### Tabs
- Bottom border indicator, no background highlight
- Font: 12px, active 500, idle 400
- Icon size: 16px, strokeWidth: 2
- Invisible heavy-weight span prevents layout shift on weight change

### Breadcrumb
- Use the Breadcrumb component, never a plain `<span>` or heading
- Items array: `[{ label }, { label, href? }]`

---

## 4. Table

### Structure
- Full viewport width, no border radius, no outer border
- Grid columns defined with CSS grid: `gridTemplateColumns`

### Column Headers
- Background: `--cell-header-bg` = gray-35 `#FCFCFC`
- Font: 12px, medium (500), gray-600
- Small icon (10px) before each label, same color as text
- Border-bottom: 1px solid gray-200

### Data Rows
- Background: white (`--cell-bg`)
- Hover: gray-50 (`--cell-hover-bg`), 100ms transition
- Row dividers: 1px solid gray-200 (`--cell-border-color`)
- Heights: base 40px, tall 64px

### Cell Types
- `TextCell` — lead variant (gray-800, medium) or default variant (gray-600, regular)
- `BadgeCell` — renders a single Badge
- `MultiBadgeCell` / `VisibleToCell` — badge overflow: max 2 rows, "+N more" gray outline badge via ResizeObserver
- `StatusCell` — renders StatusBadge
- `ActionsCell` — ghost icon buttons (Pencil, MoreHorizontal)
- `IconTextCell` — IconFeature (sm, outline) + lead text

---

## 5. Left Navigation

- Width: 255px, `border-right: 1px solid gray-200`
- Header: Tarkie logo (blue `#2162F9`, green dot `#44EB7C`) + ChevronLeft close button
- Scrollable item list: custom scrollbar (8px, gray-100 thumb)
- Bottom: client logo placeholder (120×40px, gray-50 rect)

### Nav Items
- Font: 12px, medium (500), gray-800
- Icon: 14px, strokeWidth: 2, same color as text
- Padding: 6px vertical, 8px horizontal, 6px border-radius, 2px gap between items
- Active: blue-50 bg, blue-500 text + icon
- Hover: blue-50 bg, blue-500 text + icon
- Expandable items: ChevronRight (collapsed) / ChevronDown (expanded)
- Sub-items: indent 32px from left

### Hamburger
- Ghost icon button in global bar, only visible when nav is closed
- Clicking reopens the nav

---

## 6. Menu Options

Two components:
- **MultiSelectMenu** — checkboxes (square), multi-selection
- **SelectionMenu** — check circles (round), single selection (circle only shows when selected)

### Container
- Width: 280px, radius: 12px (= item radius 8px + padding 4px)
- Border: 1px solid gray-200, shadow: `0 2px 12px rgba(0,0,0,0.08)`
- Max-height: 220px before scrolling

### Options
- Padding: 8px horizontal, 6px vertical, 8px border-radius
- Font: 12px, medium (500), gray-800
- Hover: gray-50 bg
- Checkbox/CheckCircle size: sm (12px), on right side

### Variants
- `iconType`: `none` | `user` (lucide User icon) | `avatar` (16px circular image)
- `showSearch`: adds search bar with bottom border at top
- `renderOptionLabel`: custom renderer (e.g. StatusBadge instead of text)
- `pinnedOptions`: always-visible items at bottom, separated by a divider constrained to 4px padding

### Scrollbar
All scrollbars use `.styled-scroll` class: 8px wide, gray-100 thumb, transparent track.

### Positioning
- Triggered by FilterChip `onLabelClick`
- `position: absolute; top: calc(100% + 4px); left: 0; z-index: 100`
- Close on outside click via `mousedown` document listener

---

## 7. Form Controls

### Checkbox
- Sizes: sm (12px), md (16px)
- Border-radius: 4px (square)
- Unchecked: white bg, gray-300 border → blue-500 border on hover
- Checked: blue-500 bg + border, white checkmark SVG
- Indeterminate: blue-500 bg, white dash

### CheckCircle
- Same as Checkbox but `border-radius: 50%`

### Radio (circle)
- 16×16px, gray-50 fill, 1px stroke
- Unchecked: gray-300 border → blue on hover
- Checked: blue-500 border, blue-500 dot center

### RadioButton / RadioGroup
- Pill shape, 28px height, 6px radius
- Unselected: white bg, gray-200 border, gray-600 text
- Selected: blue-50 bg, blue-500 border, blue-500 text, 500 weight

---

## 8. Icon Feature

Square container with icon, used as visual indicator.

- **Colors**: gray, blue, green, yellow, orange, red, violet
- **Sizes**: xs (12px), sm (20px), md (22px), lg (36px), xl (44px)
- **outline prop**: ring-1 ring-inset (no height impact)
- Icon strokeWidth: 2

---

## 9. Scrollbar Convention

Apply `className="styled-scroll"` to any scrollable element.
Single source of truth in `scrollbar.css`:
- Width: 8px
- Thumb: gray-100
- Track: transparent

To avoid gap between scrollbar and container:
- Zero padding on the scroll container itself
- Wrap content in an inner `<div>` with padding
- Add `overflow: hidden` to parent container

---

## 10. Spacing Conventions

| Context                  | Value  |
|--------------------------|--------|
| Bar padding (horizontal) | 12–16px|
| Bar height               | 40px   |
| Icon button gap (bars)   | 8px    |
| Nav item padding         | 6px 8px|
| Nav item gap             | 2px    |
| Table cell padding X     | 12px   |
| Table cell padding Y     | 8px    |
| Menu item padding X      | 8px    |
| Menu item padding Y      | 6px    |
| Menu list padding        | 4px    |
| Filter chip gap          | 8px    |

---

## 11. Token Architecture

```
primitives/colors.css     → @theme {}  (Tailwind utility classes)
primitives/typography.css → @theme {}
primitives/spacing.css    → @theme {}
        ↓
semantic/colors.css       → :root {}  (role-based aliases)
semantic/typography.css   → :root {}
        ↓
component/*.css           → :root {}  (component-specific tokens)
        ↓
components/*.jsx          → consume via var(--token-name)
```

Never reference primitive tokens directly in components. Always go through semantic → component tokens.

---

## 12. Reference Screen

The canonical high-fidelity reference is `table_attempt_V1` in Storybook (`Prototypes/table_attempt_V1`). It demonstrates:
- Full page shell with collapsible left nav
- All three bars (global, tabs, filter) stacked
- Working filter dropdowns (SelectionMenu for date, MultiSelectMenu with badges for status)
- Table with typed cells, hover states, badge overflow

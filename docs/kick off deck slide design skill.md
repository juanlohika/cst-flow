# Tarkie Slide Builder — Design System
### Knowledge File for AI-Powered Slide Generation
**Source:** Extracted from Tarkie Kick-Off Deck (Accutech Steel & Service Inc.)  
**Version:** 1.0  
**Usage:** This file is the single source of truth for all visual output. Every AI-generated block, every component render, and every PDF export must conform to these specs.

---

## 1. Brand Identity

```
Product:    Tarkie — Your One-Stop Automation Partner
Company:    MobileOptima, Inc.
Copyright:  ©2012-2025 Copyright MobileOptima, Inc. All rights reserved.
Tone:       Professional, clean, modern, tech-forward
Ratio:      16:9 widescreen (1920×1080px reference, or 1280×720px for screen)
```

---

## 2. Color Palette

All colors are extracted directly from the production deck.

### 2.1 Core Colors

| Token | Hex | Usage |
|---|---|---|
| `--color-primary` | `#2162F9` | Main brand blue — slide backgrounds, headers, CTAs, section dividers |
| `--color-primary-dark` | `#2C448A` | Dark navy — footer bars, table headers, deep accents |
| `--color-accent-green` | `#43EB7C` | Bright green — highlights, bullet markers, decorative dashes, key callouts |
| `--color-accent-green-light` | `#73FB79` | Light green — secondary highlights, hover states |
| `--color-accent-green-pale` | `#2FFF66` | Pale green — rare use, glow effects only |
| `--color-white` | `#FFFFFF` | All text on dark backgrounds, slide body backgrounds |
| `--color-black` | `#000000` | Text on white slides, table borders |
| `--color-surface-blue` | `#DCEAF7` | Light blue — table row alternates, subtle content areas |
| `--color-dark-green` | `#005015` | Deep green — used sparingly for status badges or labels |
| `--color-yellow-flag` | `#FFFF00` | Yellow — use only for warning callouts or flagged items |

### 2.2 Slide Background Types

| Slide Type | Background | Text Color |
|---|---|---|
| Cover / Title | `#2162F9` (full bleed blue) | `#FFFFFF` |
| Section Divider | `#2162F9` (full bleed blue) | `#FFFFFF` |
| Content Slide (light) | `#FFFFFF` | `#000000` / `#2C448A` |
| Content Slide (dark) | `#2C448A` | `#FFFFFF` |
| SPARKLE Framework | `#2162F9` | `#FFFFFF` |

### 2.3 CSS Variables (for implementation)

```css
:root {
  --color-primary:            #2162F9;
  --color-primary-dark:       #2C448A;
  --color-accent-green:       #43EB7C;
  --color-accent-green-light: #73FB79;
  --color-white:              #FFFFFF;
  --color-black:              #000000;
  --color-surface-blue:       #DCEAF7;
  --color-dark-green:         #005015;
  --color-yellow-flag:        #FFFF00;

  /* Semantic aliases */
  --color-slide-bg-dark:      var(--color-primary);
  --color-slide-bg-light:     var(--color-white);
  --color-slide-bg-navy:      var(--color-primary-dark);
  --color-text-on-dark:       var(--color-white);
  --color-text-on-light:      var(--color-black);
  --color-text-heading-blue:  var(--color-primary-dark);
  --color-highlight:          var(--color-accent-green);
  --color-table-header-bg:    var(--color-primary-dark);
  --color-table-row-alt:      var(--color-surface-blue);
  --color-footer-bg:          var(--color-primary-dark);
}
```

---

## 3. Typography

All fonts extracted from the production deck. The deck uses a **multi-font system** — each font serves a distinct role.

### 3.1 Font Stack

| Token | Font | Weight | Role |
|---|---|---|---|
| `--font-display` | `Quicksand` | Bold (700) | Hero titles on dark/blue slides (Cover, Section Dividers) |
| `--font-heading` | `DM Sans` | Bold (700) | Slide titles on light/content slides |
| `--font-subheading` | `Century Gothic` | Regular + Bold | Section labels, SPARKLE letters, framework keys |
| `--font-body` | `Inter` | Regular (400) | Body text, bullet points, table cell content |
| `--font-body-alt` | `Arial MT Pro` | Regular + Bold | Alternative body, table headers, footnotes |
| `--font-fallback` | `Arial, sans-serif` | Any | Web fallback if primary fonts unavailable |

### 3.2 Font Size Scale

Sizes extracted from actual slides. All values in `pt` (for PDF) and `px` equivalents (for web at 96dpi, multiply pt × 1.333).

| Token | pt | px (web) | Font | Usage |
|---|---|---|---|---|
| `--text-hero` | 72–88pt | 96–117px | Quicksand Bold | Main title on Cover slide |
| `--text-display` | 54–66pt | 72–88px | Quicksand Bold | Section divider titles ("PAIN POINTS", "NEXT STEPS") |
| `--text-h1` | 40–48pt | 53–64px | DM Sans Bold | Primary slide title on content slides |
| `--text-h2` | 32–36pt | 43–48px | DM Sans Bold / Century Gothic Bold | Slide subtitle, framework headings |
| `--text-h3` | 27–30pt | 36–40px | DM Sans Bold | Section labels within a slide |
| `--text-h4` | 20–24pt | 27–32px | Inter Bold / DM Sans Bold | Table column headers, sub-labels |
| `--text-body` | 12–14pt | 16–19px | Inter Regular | Body text, bullet lists, table cells |
| `--text-caption` | 12pt | 16px | Arial MT Pro Regular | Footer text, copyright, confidentiality tag |
| `--text-tag` | 12pt | 16px | Arial MT Pro Bold | "CONFIDENTIAL" watermark label |

### 3.3 Type Rules

```
- Headings on DARK (blue) slides:     color: #FFFFFF, font: Quicksand Bold or DM Sans Bold
- Headings on LIGHT (white) slides:   color: #2C448A, font: DM Sans Bold
- Body on DARK slides:                color: #FFFFFF, font: Inter Regular
- Body on LIGHT slides:               color: #000000, font: Inter Regular
- Table headers:                      color: #FFFFFF, bg: #2C448A, font: Arial MT Pro Bold
- Table cells:                        color: #000000, font: Inter Regular or Arial MT Pro
- CONFIDENTIAL tag:                   color: #000000 on light, #FFFFFF on dark; top-right corner
- Footer copyright:                   color: #FFFFFF, font: Arial MT Pro, 12pt, bottom strip
- Italic accent text:                 Quicksand Bold italic (used for subtitles, taglines)
- Green accent text:                  color: #43EB7C — used for highlighted keywords in dark slides
```

---

## 4. Slide Layout System

### 4.1 Slide Dimensions

```
Reference size:  1920 × 1080 px  (16:9)
Web render:      1280 × 720 px   (scaled)
Margins:         60px top/bottom, 80px left/right (on 1280px canvas)
Content area:    1120 × 560 px
Footer height:   48px
Header/tag area: 40px
```

### 4.2 Layout Variants

| Layout ID | Description | Used For |
|---|---|---|
| `full-bleed-dark` | Full blue background, centered content | Cover, Section Dividers |
| `content-light` | White background, top title, content below | Agenda, Team tables, Pain Points, Next Steps |
| `content-dark` | Dark navy background, content cards | SPARKLE Framework content slides |
| `two-column` | Left column content, right column content or image | Phase details, Device specs |
| `table-full` | Title top, full-width table body | Fit-Gap, Prerequisites, Next Steps tables |
| `flowchart` | Title top, full-width diagram area | Current Process, Recommended Process |
| `timeline` | Title top, full-width timeline embed | Timeline, Project phases |

### 4.3 Persistent Elements (Every Slide)

```
TOP-RIGHT:   "CONFIDENTIAL" tag
             font: Arial MT Pro Bold, 12pt
             color: #000000 on light slides, #FFFFFF on dark slides

BOTTOM BAR:  Footer strip, full width, height 48px
             background: #2C448A
             left: Tarkie logo (white version)
             right: Copyright text (white, 12pt, Arial MT Pro)
             text: "©2012-2025 Copyright MobileOptima, Inc. All rights reserved..."
```

---

## 5. Component Specs

### 5.1 Tables

```
Table Header Row:
  background:       #2C448A
  text color:       #FFFFFF
  font:             Arial MT Pro Bold, 14pt
  padding:          12px 16px
  text-transform:   UPPERCASE
  border-bottom:    2px solid #43EB7C  ← green accent line under header

Table Body Rows:
  background (odd):   #FFFFFF
  background (even):  #DCEAF7  ← light blue alternating
  text color:         #000000
  font:               Inter Regular, 12–14pt
  padding:            10px 16px
  border:             1px solid #D0D0D0

Table Container:
  border:             none (borderless outer edge)
  border-radius:      0 (sharp corners)
  width:              100% of content area
```

### 5.2 Bullet Lists

```
Marker style:       Custom — small dash or filled circle in #43EB7C
Marker size:        8px circle or 16px dash
Text:               Inter Regular, 14pt, #000000 (light) or #FFFFFF (dark)
Line height:        1.6
Item spacing:       8px between items
Indent:             24px from left margin
Bold keywords:      font-weight: 700, same color as text (not a different color)
Italic subtext:     Inter Italic, same size, color: #666666 on light
```

### 5.3 Section Divider Slides

```
Background:         #2162F9 (full bleed)
Decorative dashes:  4–6 horizontal dashes, color: #43EB7C, 
                    width: ~80px, height: 8px, border-radius: 4px
                    positioned: left and right of the title text
Title:              Quicksand Bold, 54–66pt, #FFFFFF, centered
Layout:             Vertically and horizontally centered
```

### 5.4 Phase / Module Cards

```
Phase label (e.g. "PHASE 1"):
  background:       #43EB7C  ← bright green pill/banner
  text:             #000000 or #005015, DM Sans Bold, 28–36pt
  padding:          12px 32px
  border-radius:    4px

Phase content area:
  background:       #FFFFFF
  border-left:      4px solid #43EB7C
  padding:          16px 24px
  bullet text:      Inter Regular, 14pt, #000000
  italic note:      Inter Italic, 12pt, #2162F9
```

### 5.5 SPARKLE Framework Rows

```
Letter cell (S, P, A, R, K, L, E):
  background:       #2162F9
  text:             #43EB7C (green), Century Gothic Bold, 40–48pt
  width:            64px
  border-right:     2px solid #43EB7C

Label cell (e.g., "Single Source of Truth"):
  background:       #2C448A
  text:             #FFFFFF, DM Sans Bold, 20pt
  width:            220px

Description cell:
  background:       #FFFFFF or alternating #DCEAF7
  text:             #000000, Inter Regular, 13pt
  padding:          12px 16px
```

### 5.6 Agenda List

```
Title:              "AGENDA:", DM Sans Bold, 40pt, #2C448A
Items:
  marker:           filled circle, #2162F9, 8px
  text:             Inter Regular, 14–16pt, #000000
  spacing:          10px between items
```

### 5.7 Cover / Title Slide

```
Background:         #2162F9 (full bleed)
Logo:               White Tarkie wordmark, top-left or center
Tagline:            "Your One-Stop Automation Partner"
                    Quicksand Bold Italic, 24pt, #FFFFFF
Main title:         "Kick-Off Meeting"
                    Quicksand Bold, 72pt, #FFFFFF, with strikethrough effect on "Kick-Off" 
                    in accent green
Subtitle:           "Aligning on next steps, timelines, and success metrics"
                    Quicksand Regular Italic, 22pt, #FFFFFF
                    "success metrics" in #43EB7C (green accent)
"Presented to:":    Inter Regular, 16pt, #FFFFFF
Client logo area:   White box, right-aligned, 160×80px
```

---

## 6. Decorative Elements

```
Green dashes (accent lines):
  Used on: Section dividers, phase headers, SPARKLE rows
  Color: #43EB7C
  Shape: Rounded rectangle (border-radius: 4px)
  Sizes: 60–100px wide × 8px tall
  Placement: Flanking titles on dark slides (left and right of text)

Gradient overlays:
  Subtle on hero images: linear-gradient(to bottom, rgba(33,98,249,0.7), rgba(44,68,138,0.9))

Icon circles:
  Background: #43EB7C or #2162F9
  Icon color: #FFFFFF or #2C448A
  Size: 48–64px diameter
  Border-radius: 50%
```

---

## 7. AI Block Generation Rules

When AI generates content for any slide block, it **must** return structured output that maps to these design tokens. The AI prompt system should append the following instruction to every block prompt:

```
Return output as JSON matching this structure:
{
  "blockType": "bullet-list | table | text | phase-card | ...",
  "slideBackground": "dark | light | navy",
  "content": { ... block-specific fields ... },
  "designHints": {
    "accentWords": ["words to highlight in green"],
    "headerColor": "#2C448A or #FFFFFF",
    "useGreenMarkers": true
  }
}

BRAND RULES TO FOLLOW:
- Never use colors outside the palette defined in design.md
- Heading font: DM Sans Bold (light slides) or Quicksand Bold (dark slides)  
- Body font: Inter Regular
- Green accent (#43EB7C) for highlights and markers only — not for large text blocks
- All tables must follow the dark header / alternating row pattern
- Keep text concise — slides are presentations, not documents
- Max 6 bullet points per list block
- Max 8 rows per table block (add pagination if more needed)
```

---

## 8. PDF Export Spec

```
Page size:          1920 × 1080 px (landscape)
Bleed:              0
Resolution:         150 DPI minimum, 300 DPI for print
Font embedding:     All fonts must be embedded
Footer:             Rendered on every page from brand config
Confidential tag:   Rendered on every page top-right
File naming:        [ClientName]_KickOff_[YYYY-MM-DD].pdf
Compression:        Medium (balance size vs quality)
```

---

## 9. Quick Reference — Colors at a Glance

```
#2162F9  ████  Primary Blue       — main brand, backgrounds, buttons
#2C448A  ████  Dark Navy          — footer, table headers, headings on light
#43EB7C  ████  Accent Green       — highlights, markers, dashes, phase banners
#73FB79  ████  Light Green        — secondary highlights
#DCEAF7  ████  Surface Blue       — table row alternates
#FFFFFF  ████  White              — text on dark, light slide backgrounds
#000000  ████  Black              — text on white, table borders
#005015  ████  Dark Green         — status labels (sparingly)
#FFFF00  ████  Yellow             — warnings/flags only
```

---

*End of design.md — v1.0*  
*Update this file when the Tarkie brand guide changes. All components auto-inherit from this spec.*

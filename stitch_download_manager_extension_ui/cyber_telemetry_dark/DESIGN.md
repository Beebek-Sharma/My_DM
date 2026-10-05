---
name: Cyber Telemetry Dark
colors:
  surface: '#0d1320'
  surface-dim: '#0d1320'
  surface-bright: '#333948'
  surface-container-lowest: '#080e1b'
  surface-container-low: '#161b29'
  surface-container: '#1a1f2d'
  surface-container-high: '#242a38'
  surface-container-highest: '#2f3543'
  on-surface: '#dde2f5'
  on-surface-variant: '#bdc8d1'
  inverse-surface: '#dde2f5'
  inverse-on-surface: '#2a303f'
  outline: '#87929a'
  outline-variant: '#3e484f'
  surface-tint: '#7bd0ff'
  primary: '#8ed5ff'
  on-primary: '#00354a'
  primary-container: '#38bdf8'
  on-primary-container: '#004965'
  inverse-primary: '#00668a'
  secondary: '#bcc7de'
  on-secondary: '#263143'
  secondary-container: '#3e495d'
  on-secondary-container: '#aeb9d0'
  tertiary: '#4ee6aa'
  on-tertiary: '#003825'
  tertiary-container: '#22c990'
  on-tertiary-container: '#004e35'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#c4e7ff'
  primary-fixed-dim: '#7bd0ff'
  on-primary-fixed: '#001e2c'
  on-primary-fixed-variant: '#004c69'
  secondary-fixed: '#d8e3fb'
  secondary-fixed-dim: '#bcc7de'
  on-secondary-fixed: '#111c2d'
  on-secondary-fixed-variant: '#3c475a'
  tertiary-fixed: '#68fcbf'
  tertiary-fixed-dim: '#45dfa4'
  on-tertiary-fixed: '#002114'
  on-tertiary-fixed-variant: '#005137'
  background: '#0d1320'
  on-background: '#dde2f5'
  surface-variant: '#2f3543'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '700'
    lineHeight: 20px
    letterSpacing: -0.3px
  headline-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: -0.2px
  headline-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0px
  body-lg:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0px
  body-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0px
  body-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0px
  label-lg:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0px
  label-md:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0px
  label-sm:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: 0.3px
  caption:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 0.75rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.375rem
  space-md: 0.5rem
  space-lg: 0.75rem
  space-xl: 1rem
---

## Brand & Style

This design system expresses a high-density, mission-control cyber-utilitarian aesthetic tailored specifically for browser extension popups and precision system utilities. It rejects empty decorative whitespace in favor of crystalline information density, tactical visual feedback, and technical confidence. The emotional response is one of total operational control, speed, and real-time clarity.

The visual style blends dark glassmorphism with high-contrast tactical telemetry. Deep midnight navy and obsidian slate canvas layers establish an immersive low-strain foundation. Frosted semi-translucent surfaces, hairline glass outlines, and vibrant electric cyan accents produce an interface reminiscent of professional developer consoles and aerospace telemetry readouts.

## Colors

The palette operates in strict dark mode, anchored by deep slate and midnight navy tones with surgical hits of vibrant state color.

- **Base Canvases & Tiers:** 
  - Bedrock canvas: `#0b111e`
  - Base viewport: `#0f172a`
  - Container elevated: `#131c2e`
  - Floating and surface high: `#1e293b`
  - Interactive item surface: `rgba(30, 41, 59, 0.70)` with frosted glass blur.
- **Accents:** 
  - Primary Electric Sky Cyan (`#38bdf8`) drives progress indicators, focused inputs, active tabs, and primary triggers.
  - Secondary Deep Slate (`#1e293b`) provides structural contrast for resting containers and form elements.
  - Success Emerald Green (`#34d399` / `#10b981`) communicates completed files, verified checksums, and positive actions.
  - Auxiliary status tokens include Warning Amber (`#fbbf24`), Destructive Rose (`#f87171`), and Stream Violet (`#c084fc`).
- **Dividers & Strokes:**
  - Hairline glass stroke: `rgba(255, 255, 255, 0.08)`
  - Elevated borders and dividers: `rgba(255, 255, 255, 0.10)`

## Typography

The type system prioritizes micro-legibility within a tight extension canvas. Inter is employed throughout for its neutral glyph geometry, elevated x-height, and precise vertical alignment.

- **Filenames & Primary Items:** Set in `headline-sm` (13px/18px, weight 600) with forced word-breaking (`word-break: break-all`) to handle long hash-based filenames without layout rupture.
- **Labels & Micro-Chips:** Use `label-sm` with text-transform uppercase and +0.3px tracking to maintain optical clarity below 11px.
- **Telemetry Readouts:** Use `body-sm` (11px/14px). Multi-part stats (speed, total size, ETA) are punctuated by a centered mid-dot (`•`) padded with 4px horizontal space.

## Layout & Spacing

The layout is built for high-density, fixed-viewport extension containers (540px wide by 580px high). It avoids excessive empty margins, using a strict 4px baseline rhythm to structure dense lists and status bars.

### Structure
- **Frame Chassis:** A vertical flexbox stack consisting of a pinned top bar, horizontal navigation tabs, dynamic control/filter row, scrollable content card list (`flex: 1`, `overflow-y: auto`), and a pinned status footer.
- **Card Margins & Padding:** The main content panel applies a 16px (`margin`) outer horizontal buffer. Cards internal padding is set to 12px 14px with an 8px to 10px stack gap (`gutter`).
- **Scroll Behavior:** Slim customized WebKit scrollbars (6px width, `rgba(255, 255, 255, 0.15)` thumb, 4px radius) prevent horizontal content shifting.

## Elevation & Depth

Visual hierarchy is established using layered glassmorphism, surface-tinted tonal tiers, and fine hairline borders rather than heavy drop shadows.

- **Layer 0 (Canvas Bedrock):** Solid `#0b111e` to `#0f172a` base.
- **Layer 1 (Pinned Chrome):** Top headers, tab strips, and pinned footers use `rgba(15, 23, 42, 0.85)` with a `12px` backdrop blur and a crisp `1px solid rgba(255, 255, 255, 0.10)` lower edge.
- **Layer 2 (Resting Cards):** Interactive item cards use `rgba(30, 41, 59, 0.70)` with a subtle `1px solid rgba(255, 255, 255, 0.08)` perimeter.
- **Layer 3 (Hover & Focus States):** Card elevation on hover shifts the border to `rgba(56, 189, 248, 0.30)` and introduces a muted, diffused ambient shadow `0 4px 14px rgba(0, 0, 0, 0.25)`.
- **Glow Accents:** Key operational telemetry—such as the active status pill and download tray glyph—use an ambient cyan backlight (`box-shadow: 0 0 12px rgba(56, 189, 248, 0.35)`).

## Shapes

The design uses a balanced rounded geometry (`roundedness: 2`, 8px base) that softens the technical density of the UI while preserving efficient space utilization.

- **Primary Cards & Containers:** 10px radius (`rounded-card`) to frame complex item rows neatly.
- **Inputs & Action Buttons:** 8px radius (`rounded-input`) to ensure interactive clickability without wasting corner space.
- **Micro Controls & Badges:** 4px to 6px radius for compact icon buttons, dropdown selectors, and metadata chips.
- **Progress Tracks & Sliders:** Full pill radius (`9999px`) on the internal fill bar to convey smooth, fluid momentum.

## Components

### Buttons & Utility Triggers
- **Primary Action Buttons:** Electric Sky Cyan (`#38bdf8`) background with Midnight Navy (`#0f172a`) bold text, 8px radius. On hover, transitions to `#0ea5e9` with a subtle `-1px` vertical lift.
- **Secondary / Glass Buttons:** Translucent fill (`rgba(255, 255, 255, 0.08)`), hairline border (`rgba(255, 255, 255, 0.10)`), polar white text.
- **Micro Card Controls:** Compact sizing (4px 8px padding, 11px font size). Success variants (resume/open) hover to `rgba(52, 211, 153, 0.20)` with `#d1fae5` text. Danger variants (cancel/delete) hover to `rgba(239, 68, 68, 0.20)` with `#fecaca` text.

### Download & Sniffer Cards
- **Download Item Card:** Backed by `rgba(30, 41, 59, 0.70)`, hairline border, 10px radius, 12px 14px padding. Contains:
  1. *Top row:* Filename (truncated or wrapped cleanly), file-type tag, and semantic status pill.
  2. *Middle track:* 6px high progress track with dual-stop linear gradient (`#38bdf8` to `#0284c7` for active, `#34d399` to `#059669` for completed).
  3. *Bottom row:* Left-aligned telemetry metrics (`Speed • Transferred / Total`) and right-aligned micro-action buttons.
- **Media Sniffer Card:** Streamlined row with network protocol badge (HLS, DASH, MP4), title, truncated origin URL, and quick-download CTA.

### Status Chips & Badges
- Compact pill elements (2px 7px padding, 10px uppercase type, bold).
- Background colors use 20% alpha fills of the semantic state (e.g., cyan for downloading, emerald for completed, amber for paused, rose for failed).

### Input Fields & Search
- Translucent dark trough (`rgba(15, 23, 42, 0.80)`), 8px radius, 9px 12px padding.
- Focused state applies an electric cyan border and a 2px outer ambient ring (`rgba(56, 189, 248, 0.20)`). Placeholder text in muted slate (`#94a3b8`).

### Navigation Tabs
- Borderless horizontal bar pinned below the main header. Inactive items use muted slate typography (`#94a3b8`); active tabs transition to electric cyan (`#38bdf8`) anchored by a 2px solid cyan bottom bar.
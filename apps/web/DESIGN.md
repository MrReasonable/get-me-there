---
name: get-me-there
description: A concourse split-flap departure board for the cheapest date pairs found, with honest coverage and provenance.
colors:
  steel-hi: "#c4c8ca"
  steel: "#b0b5b8"
  steel-lo: "#969ca0"
  steel-edge: "#6f767a"
  steel-deep: "#50565a"
  enamel: "#eef0ed"
  enamel-lo: "#e2e5e2"
  enamel-edge: "#c3c8c6"
  field: "#fbfcfb"
  ink: "#111315"
  ink-2: "#2c3236"
  ink-3: "#454c51"
  ink-bad: "#6f120b"
  ink-warn: "#4a3200"
  board: "#0b0c0d"
  board-2: "#16191b"
  board-line: "#2c3034"
  board-edge: "#5b6166"
  flap-top: "#282b2e"
  flap-low: "#202326"
  flap-ink: "#f1f1ec"
  flap-ink-2: "#b8bcbf"
  amber: "#ffb22e"
  red: "#ff6b5f"
  dim: "#9ca1a5"
  lamp-off: "#2a2d30"
  lamp-white: "#e9e7de"
  alarm: "#a3231a"
  focus-out: "#ffffff"
  focus-in: "#000000"
  lamp-band-0: "#fff1cc"
  lamp-band-1: "#d9cfb4"
  lamp-band-2: "#b0a68d"
  lamp-band-3: "#8a826c"
  lamp-band-4: "#6b6556"
  series-black: "#111315"
  series-signal-red: "#a3231a"
  series-signage-blue: "#1f5f8b"
  series-ochre: "#8a5a00"
  series-signal-green: "#3f6b2a"
  series-violet: "#6b3f8f"
typography:
  flap:
    fontFamily: "Barlow Condensed, Arial Narrow, Roboto Condensed, sans-serif"
    fontSize: "calc(var(--cw) * 1.3)"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "tnum, lnum"
  headline:
    fontFamily: "Barlow Condensed, Arial Narrow, Roboto Condensed, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "0.04em"
  title:
    fontFamily: "Barlow Condensed, Arial Narrow, Roboto Condensed, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.06em"
  title-sub:
    fontFamily: "Barlow Condensed, Arial Narrow, Roboto Condensed, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "0.08em"
  label:
    fontFamily: "Barlow Condensed, Arial Narrow, Roboto Condensed, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0.1em"
  button:
    fontFamily: "Barlow Condensed, Arial Narrow, Roboto Condensed, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0.07em"
  figure:
    fontFamily: "Barlow Condensed, Arial Narrow, Roboto Condensed, sans-serif"
    fontWeight: 600
    letterSpacing: "0.02em"
    fontFeature: "tnum, lnum"
  body:
    fontFamily: "Atkinson Hyperlegible Next, Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: "Atkinson Hyperlegible Next, Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
  field-label:
    fontFamily: "Atkinson Hyperlegible Next, Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.25
  mono:
    fontFamily: "Atkinson Hyperlegible Mono, ui-monospace, SF Mono, monospace"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.3
rounded:
  cell: "2px"
  control: "3px"
  plate: "4px"
  lamp: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  gutter: "28px"
  gutter-phone: "16px"
  target: "44px"
components:
  button:
    backgroundColor: "{colors.steel-lo}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "4px 14px"
    height: "44px"
  button-hover:
    backgroundColor: "{colors.steel}"
  button-primary:
    backgroundColor: "{colors.board}"
    textColor: "{colors.flap-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "4px 14px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.board}"
    textColor: "{colors.red}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "4px 14px"
    height: "44px"
  button-quiet:
    textColor: "{colors.flap-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "4px 14px"
    height: "44px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
    height: "44px"
  tag:
    backgroundColor: "{colors.board}"
    textColor: "{colors.flap-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.cell}"
    padding: "3px 7px 2px"
  tag-warn:
    backgroundColor: "{colors.board}"
    textColor: "{colors.amber}"
  tag-bad:
    backgroundColor: "{colors.board}"
    textColor: "{colors.red}"
  tag-dim:
    backgroundColor: "{colors.board}"
    textColor: "{colors.dim}"
  plate:
    backgroundColor: "{colors.enamel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.plate}"
    padding: "22px 26px"
  frame:
    backgroundColor: "{colors.board}"
    textColor: "{colors.flap-ink}"
    padding: "14px 18px 16px"
  flap-cell:
    backgroundColor: "{colors.flap-top}"
    textColor: "{colors.flap-ink}"
    typography: "{typography.flap}"
    rounded: "{rounded.cell}"
  nav-link:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  nav-link-current:
    backgroundColor: "{colors.board}"
    textColor: "{colors.flap-ink}"
  command:
    backgroundColor: "{colors.board}"
    textColor: "{colors.flap-ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
---

# Design System: get-me-there

## Overview

**Creative North Star: "The Concourse Departure Board"**

Every view is a station concourse. The ground is brushed steel; data hangs on matte black split-flap boards in bolted steel frames; forms and long reading are screwed to white enamel plates. Date pairs are departures ranked by price, and when a run lands the board flips. The world was chosen by Ian on 2026-10-26 from a working preview; its staging is board first, enamel plates for reading.

Density is high and deliberate: a board row carries the date pair, nights, price, how far it was checked, journey time and airports in fixed flap cells, with the same facts in plain words beneath in the board's second ink. Character is carried by materials (grain, rivets, screws, hinges, lamps), never by decorative colour. Two lamp colours exist, amber for "not checked" or "stale" and a dim red for "failed", and they burn only on black. Months are a lamp matrix, not a coloured calendar grid.

The direction contract refuses card dashboards and price-calendar widgets. Plates are still used as plates: Status and Providers set one enamel plate per check or source beside or below a board, because those are notices to read, not data to rank.

**Key Characteristics:**
- Three materials, each with one job: steel ground and furniture, black boards for data, enamel plates for reading and forms.
- Painted caps in Barlow Condensed for names, labels, buttons and money; Atkinson Hyperlegible Next for every sentence.
- Split-flap cells of fixed width, each glyph drawn in its own cell, with a hinge line across the middle.
- Context variables (`--fg`, `--fg-2`, `--line`, `--bad`, `--warn`) redefine themselves on steel, plate and board, so one component reads right on any of them.
- Every state is a glyph plus words, with a lamp where the board has one; colour is never the only cue.
- Every target is at least 44px tall.

## Colors

A material palette (steel, enamel, black) with two signal lamps that burn only on black.

### Primary
- **Board Black** (`board`): the ground of every flap board, frame interior, tag, command chip, primary button and current nav tile. A lit or hovered row lifts to **Lit Row Black** (`board-2`).
- **Flap White** (`flap-ink`): characters on flaps and the board's first ink (12.6:1 on a flap, 17.3:1 on the board). **Flap Grey** (`flap-ink-2`) is the board's second ink: column names, words under a row, captions.
- **Flap Faces** (`flap-top`, `flap-low`): the upper and lower halves of a split-flap cell, split at the hinge.

### Secondary
- **Amber Lamp** (`amber`): "not checked", "stale", "partial", calendar-basis prices and their how-far-checked flap, the Update board button's ink and ring, the lit lamp's outline in the overview, and the amber rule round the itinerary an alert email opened. 7.9:1 on a flap.

### Tertiary
- **Dim Red Lamp** (`red`): "failed" on black: failed itinerary rows, the danger button's ink, the failed tag and lamp. The dimmest red that passes AA on a flap (5.1:1).
- **Alarm Red** (`alarm`): the full-width synthetic-data banner only, white bold words with a cross (7.5:1).

### Neutral
- **Steel family** (`steel-hi`, `steel`, `steel-lo`, `steel-edge`, `steel-deep`): the page ground under a fine horizontal grain, the top strip, steel buttons (`steel-hi` to `steel-lo` gradient), field and frame edges.
- **Enamel family** (`enamel`, `enamel-lo`, `enamel-edge`, `field`): plates, plate insets, plate edges and white input fields.
- **Light-ground inks** (`ink`, `ink-2`, `ink-3`): text on steel and enamel. `ink-3` is a hint ink for enamel only (7.6:1); on steel the third ink falls back to `ink-2`.
- **Light-ground state inks** (`ink-bad`, `ink-warn`): "failed" and "warn" in words on steel or enamel (both above 5.7:1 on steel).
- **Board rules** (`board-line`, `board-edge`): row rules, header rules and on-board control edges.
- **Dim** (`dim`): superseded rows and disabled sources on black, struck through where it is a price.
- **Lamp sockets** (`lamp-off`, `lamp-white`): an unlit socket, and the white lamp for verified or OK.

### Data inks
- **Lamp bands** (`lamp-band-0` to `lamp-band-4`): the overview's single-hue sequential scale by price quintile; band 0, the cheapest fifth, burns brightest. Glyphs on bands 0 to 3 are black, on band 4 white; band 4 carries a `lamp-band-2` ring so it never reads as an unlit socket. A flat scale (fewer than ten figures, or a spread under 10% of the cheapest) uses `lamp-band-3` for every day.
- **Chart series** (`series-black`, `series-signal-red`, `series-signage-blue`, `series-ochre`, `series-signal-green`, `series-violet`): History's categorical inks on enamel, each at least 5:1 on the plate and backed by a dash style and a legend label.

### Named Rules
**The Lamps Burn on Black Rule.** Amber and the dim red sit only on a black ground: a board, a flap, a black tag, a black button or a lamp ringed in black. They never colour text, rules or fills directly on enamel or steel (both fail 4.5:1 there). On a light ground, "failed" uses `ink-bad` and "warn" uses `ink-warn`. A black tag carrying amber on an enamel plate obeys the rule; amber words on the plate do not.

**The Context Ink Rule.** Shared components read `--fg`, `--fg-2`, `--fg-3`, `--line`, `--line-strong`, `--bad` and `--warn`, which steel, `.plate`, `.on-board` and `.frame` each redefine. Use the context variables (and the `text-bad`, `text-warn` utilities that map to them) instead of naming a lamp colour, so a component cannot put amber on enamel by being moved.

**The Asserted Pair Rule.** Every text colour pair is written beside its token with its ratio and asserted at 4.5:1 by `test/world/contrast.test.ts`. A new text token or ground joins that test before it ships.

## Typography

**Display Font:** Barlow Condensed (with Arial Narrow, Roboto Condensed)
**Body Font:** Atkinson Hyperlegible Next (with Atkinson Hyperlegible, system-ui)
**Label/Mono Font:** Atkinson Hyperlegible Mono (with ui-monospace, SF Mono)

**Character:** Barlow Condensed is the paint on the board: condensed caps, tracked open, in fixed cells and on every label. Atkinson Hyperlegible Next does the reading, plain and wide, on enamel and under board rows. All faces are self-hosted through @fontsource; nothing loads from a CDN.

### Hierarchy
- **Flap** (600, cell width x 1.3, line-height 1): split-flap glyphs, upper case, tabular lining figures. The cell width `--cw` is set per context: 11px to 24px on the name board, 10px to 17px on the Dates board by container width, 13px on a phone board, 9px to 15px for the brand, switch and estimate strips.
- **Headline** (700, 32px, 1.05, 0.04em, caps): a view's name on steel; 28px on a phone.
- **Title** (700, 22px, 1.1, 0.06em, caps): a section's name; 20px on a phone. The board title is 21px at 0.12em.
- **Title sub** (700, 17px, 1.15, 0.08em, caps): a plate's group heading.
- **Label** (600, 14px, 1.1, 0.1em, caps): painted labels, board column names (0.12em on a board), nav tier names, tags.
- **Button** (600, 16px, 1.1, 0.07em, caps): every button and segmented tile; 15px in the small size.
- **Body** (400, 16px, 1.5): all reading text; ledes cap at 70ch.
- **Body small** (400, 14px, 1.4): hints, the status line, the words under a board row (13.5px there).
- **Field label** (700, 15px, 1.25): form labels on plates, in Atkinson, not in caps.
- **Mono** (400, 15px, 1.3): commands on a black chip, codes.

### Named Rules
**The Money Wears No Slash Rule.** Money is set in Barlow Condensed tabular lining figures (`.figure` in reading text, `[data-cost]` for cost and cap figures, flap cells on the board), because Atkinson's zero is slashed. The slashed zero stays where it helps: commands and codes in Atkinson Hyperlegible Mono.

**The Paint and Read Rule.** Caps in Barlow Condensed name things (views, sections, columns, buttons, tags); sentences are Atkinson in sentence case. Never set a sentence in painted caps, and never set a button label in Atkinson.

## Layout

One full-width column on a steel ground, inset by a gutter of 28px on a desk and 16px below 900px; the only system breakpoint is 899/900px. The shell is a steel strip: brand flaps, a two-tier nav (Decide: Dates, History; Set up: Searches, Providers, Alerts, Status), the search picker, and a status line with the run, its state and a "Progress and spend" fold. Under it, a view opens with its name (in large flaps on Dates and a date pair's detail, in painted caps elsewhere), its run and coverage lines, then its board at full width with column names painted on the frame.

Two-column layouts appear only at 900px and up: the Searches form (fields left, a sticky estimate column of 300px to 400px right), Status (a sticky board beside its plates), Alerts (a 28rem form beside the rules), a date pair's per-airport-pair plates (two equal columns). All collapse to one column on a phone.

On a phone the nav is one row (brand words, the current tier and view, an "All views" menu that drops a steel shelf), the status folds to its summary, and the Dates board turns each row into a stacked card inside the same black board: dates left, price right, the rest beneath. Rows keep their table roles explicitly.

Spacing runs on a 4px base (4, 8, 12, 16, 24); boards and plates use slightly looser interior padding (14px to 26px) so screws and rivets stay clear of content. Every interactive target is at least 44px tall.

## Elevation & Depth

Depth is physical and shallow: things are mounted, not floating. Plates sit proud of the steel with a lit top edge and a soft drop; frames cast a deeper shadow; flap cells have a lit upper lip and a dark lower lip; buttons are pressed in on `:active`. The only floating layers are the combobox list and the phone nav shelf, which drop from the control that opened them.

### Shadow Vocabulary
- **Plate mount** (`0 1px 0 rgb(255 255 255 / 0.8) inset, 0 2px 0 rgb(0 0 0 / 0.08), 0 4px 12px rgb(0 0 0 / 0.18)`): every enamel plate.
- **Frame mount** (`0 0 0 1px #4d5357, 0 6px 18px rgb(0 0 0 / 0.35)`): a board in its bolted frame.
- **Flap cell** (`inset 0 1px 0 rgb(255 255 255 / 0.09), inset 0 -1px 0 rgb(0 0 0 / 0.5), 0 1px 1px rgb(0 0 0 / 0.9)`): each split-flap cell.
- **Flap strip** (`inset 0 0 0 1px #000, 0 1px 0 rgb(255 255 255 / 0.45), 0 3px 8px rgb(0 0 0 / 0.25)`): a black strip of flaps on steel or enamel.
- **Steel button** (`inset 0 1px 0 rgb(255 255 255 / 0.5), 0 1px 2px rgb(0 0 0 / 0.2)`), pressed (`inset 0 1px 3px rgb(0 0 0 / 0.3)`).
- **Drop** (`0 0 0 1px #000, 0 10px 24px rgb(0 0 0 / 0.35)`): the combobox list; the nav shelf uses `0 8px 18px rgb(0 0 0 / 0.28)`.
- **Amber glow** (`0 0 8px rgb(255 178 46 / 0.75)`): a lit amber row lamp, on black.

### Named Rules
**The Mounted, Not Floating Rule.** Surfaces are fixed to the concourse: a plate, a frame or a strip. Shadows describe mounting and pressing; nothing hovers or lifts on hover.

## Shapes

Hardware corners: 2px on flap cells, tags and lamp sockets; 3px on buttons, fields, strips and command chips; 4px on plates and insets. Frames are square, with a 10px steel border (6px on a phone) drawn as a vertical metal gradient and four rivets at the corners (hidden on a phone). Plates carry two screws at their top corners, drawn in the background. Lamps are circles; an unlit socket in the overview is a 2px-cornered square, so "no figure" differs from "dimmest band" by shape as well as light. Selected tiles and current nav items carry a solid bar under the label (3px to 4px) so the cue survives forced colours.

## Components

### Buttons
Board furniture: caps in the flap face, 44px tall.
- **Shape:** gently squared (3px).
- **Steel (default):** ink caps on a `steel-hi` to `steel-lo` gradient with a `steel-edge` border; hover lightens; active presses in.
- **Primary:** a black flap tile with white caps. One per decision area (Show estimate, Run now, Apply).
- **Danger:** black, with the red lamp's ink and a cross.
- **Quiet:** outlined caps in the context ink, for use on a board.
- **Update board:** a primary button with amber ink and an inset amber ring, on the Dates board.
- **Text:** an underlined text action for sort headers and "Clear filters", 44px tall.
- **Disabled:** dashed border, flat, `not-allowed` cursor; never just faded.

### Tags and chips
- **Tag:** a black flap chip with a glyph and a word in painted caps; flap white, amber (warn, stale, not checked, dashed amber border when not checked), red (failed, struck through) or dim. Readable on steel, enamel and board alike because its own ground is black.
- **Chip:** an outlined mark in the context ink for a provider name (Fixture, CF).
- **Airport chip:** a black chip with the code in flap caps, the name in flap grey and a 44px remove button.

### Plates and frames
- **Plate:** enamel, 4px corners, two screws, plate mount shadow, 22px by 26px padding (20px by 16px on a phone). Holds forms, notices, coverage and long reading; an inset (`enamel-lo`) holds the estimate or a sub-panel.
- **Frame:** a black board inside a 10px bolted steel frame with corner rivets. Holds every board: Dates, the itineraries, the Status board, the overview.
- **Status card:** a plate whose state also shows as a lamp at its left edge (white, amber, red or unlit), beside its tag's word.

### Inputs / Fields
- **Style:** white field, 1px `steel-deep` border, 3px corners, a faint inner shadow, 16px Atkinson, 44px tall. On a board, a select turns to `flap-top` with flap ink.
- **Focus:** the global focus ring: a 3px white outline with a black gap, readable on steel, enamel and board.
- **Error / Disabled:** invalid is a 2px `ink-bad` border with words; disabled is `enamel-lo` with a dashed border.
- **Segmented tiles:** window presets and the price basis are white tiles with a heavier bottom edge; the chosen one inverts to a black tile with a white bar under it.

### Navigation
A steel strip. Tier names in painted caps; links in Atkinson 15px semibold, 44px tall; hover lightens and underlines. The current view is an inverted black tile with a 4px bar beneath. On a phone: one row and an "All views" menu that drops a steel shelf.

### Split-flap cells (signature)
Each character sits in its own fixed cell (width `--cw`, height 1.62 x `--cw`) with a hinge hairline across the middle. The glyph is drawn from `data-ch`, so cells hold no text: the words beside them are the accessible text. The arrow is a drawn SVG stroke, not the font's arrow; in a flip's half-cells its stand-in is an en dash.

A flip lays three half-cells over a changed cell: the old top falls, the old bottom waits, the new bottom lands. Each step is 84ms (fall eased in, landing with a slight overshoot), at most three drum steps per cell, cells staggered 6ms left to right and rows 34ms top to bottom. The new text is in the page before any motion starts. Under `prefers-reduced-motion: reduce`, a flip is one update with no cascade.

### Row lamps and the overview lamp matrix (signature)
A row lamp is an 11px dot: white for verified, amber (glowing) for not checked or stale, red for failed, hollow for superseded, unlit for none; it always sits beside a glyph flap and words. The overview is a lamp matrix per month: each day a strip of stay-length lamps shaded by price band, the lit one ringed in amber, a "partly not searched" lamp striped in its own ink, and an unlit square socket with a glyph where there is no figure.

### Loading and the command chip
- **Loading:** a line of painted caps with an amber lamp warming (a steady lamp when motion is reduced), never a spinner over content.
- **Command:** Atkinson Mono on a black chip, wrapping anywhere.

## Do's and Don'ts

### Do:
- **Do** put ranked data (date pairs, itineraries, checks) on a black board in a bolted frame, and forms, notices and long reading on enamel plates.
- **Do** set amber and the dim red only on black (board, flap, black tag, black button, black-ringed lamp); use `ink-bad` and `ink-warn` for failed and warn on enamel or steel.
- **Do** give every state a glyph and words (▲ warn, ✕ failed, ✓ verified, ◐ partly, ○ not checked), with a lamp where the board has one.
- **Do** set money in Barlow Condensed tabular lining figures (`.figure`, `[data-cost]`); keep the slashed zero for commands and codes in Atkinson Hyperlegible Mono.
- **Do** draw the arrow in flaps as an SVG stroke, never the typed glyph.
- **Do** make a flip one update with no cascade under `prefers-reduced-motion: reduce`, and keep the new text in the page before any motion.
- **Do** read colours through the context variables so a component reads right on steel, plate and board.
- **Do** keep every target at least 44px tall and carry a selected or current state as a bar or inversion as well as colour.
- **Do** add every new text pair to the contrast test at 4.5:1.

### Don't:
- **Don't** put amber or the dim red as text, rules or fills directly on enamel or steel.
- **Don't** carry a state by colour alone, including the overview's bands: the band number is in the legend and the readout.
- **Don't** set money in Atkinson Hyperlegible Next, whose zero is slashed.
- **Don't** build card dashboards for ranked data or price-calendar widgets of coloured numbers; the board ranks, the lamp matrix shows months.
- **Don't** put words inside flap cells for readers; the flaps are decorative and the words beside them are the text.
- **Don't** use a spinner over content; use the warming lamp line.
- **Don't** set styles from markup: the CSP blocks inline styles, so every look is a stylesheet rule.

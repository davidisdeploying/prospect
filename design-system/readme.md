# Prospect — Design System

> **A job-application tracker built on the prospector's funnel:** survey a wide field of raw listings, sift away the worthless, and work the few that show real value.
> **Through-line:** *Survey wide, stake narrow, work the vein.*

**Status:** locked v1 · single-accent discipline in force

---

## What Prospect is

Prospect is a job-application tracker. Its users are general job seekers — often stressed, mid-hunt, anxiously checking whether they got the interview. The whole product is organized around the **prospector's funnel**: you survey a huge field of raw listings, discard most of it as worthless, and the point is finding the rare valuable thing.

The mining metaphor is **load-bearing, not decorative**. Every product decision should be derivable from the funnel. But the metaphor runs **loud in the brand layer and quiet in the interactive layer** — a stressed user must never have to learn geology to find out where an application stands.

### The Pipeline (the spine of the product)

Application stages map onto the funnel. Each board column shows the mining name with a plain gloss beneath it.

| Stage | Plain meaning |
|---|---|
| **Showings** | Saved / interested |
| **Staked** | Applied |
| **Working the Vein** | Interviewing |
| **Strike** | Offer |
| **Tailings** | Rejected / dead / withdrawn |

`Tailings` is the load-bearing emotional move of the system — it reframes rejection as a normal byproduct of mining, not a personal failure. Use it deliberately.

---

## Sources

This system was reverse-engineered from the original Prospect brand kit and marketing site, provided as a read-only codebase:

- `Prospect/DESIGN.md` — the brand doctrine (premise, doctrine, pipeline, lexicon, voice, color, type, logomark, locked rules). Mirrored here at `reference/DESIGN.md`.
- `Prospect/index.html` — the single-page marketing site (hero + claim map + strata funnel + claim ticket + hunt report). Mirrored at `reference/prospect-landing.html`.
- `Prospect/prospect-mark.svg`, `Prospect/prospect-wordmark.svg` — brand marks. Copied into `assets/`.

No live Figma or running app was provided; the UI kit recreates the landing site and extends the documented funnel into the app surfaces (Claim Map board, Claim ticket, Hunt Report) described in the doctrine.

---

## CONTENT FUNDAMENTALS

How Prospect writes. The voice is the interface's own — confident, plain, mining-flavored in the brand layer only.

**Casing.** Sentence case everywhere — buttons, headings, microcopy. Mining proper nouns (Showings, Staked, Working the Vein, Strike, Tailings) capitalize as stage names. Mono labels (eyebrows, column heads, key-value keys) are UPPERCASE with wide letter-spacing.

**Person.** Second person ("Stake your first claim", "Survey the field"). The interface addresses *you*. It never speaks as a person and never apologizes.

**Voice & verbs.** Active voice, plain verbs. A control says exactly what happens when used and keeps the same name through the whole flow. The add button says **"Stake a claim"** and the resulting toast says **"Claim staked,"** never "Submitted."

**The legibility rule (locked).** Heavy where it delights, plain where someone is anxious. Mining vocabulary lives in: the name, the logo, color, dashboard titles, empty states, microcopy. Interactive controls *always* carry plain meaning underneath the mining term — a subtitle or tooltip, never a decode puzzle.

**Errors** don't apologize and are never vague. **Empty screens** are invitations to act, written in the interface's voice.

**Specimen copy:**
- Hero: *"Survey wide. Stake narrow. Work the vein."*
- Lede: *"Most job hunts drown in tabs and spreadsheets. Prospect treats the search like prospecting…"*
- Empty board: **"No claims staked. Survey the field."**
- Empty Tailings: **"Nothing in the tailings pond yet."**
- Offer reached: **"Strike."**
- CTA note: *"free · self-hosted · no recruiter spam"* (mono, lowercase, middot-separated)

**Lexicon** (brand-layer only — never the *only* label on a control):
A *claim* = a tracked job · *Stake a claim* = add a job · *Core samples / Logbook* = per-job notes · *Hunt Report / Yield* = analytics · *Tailings Pond* = archive of dead claims · *Paydirt* = the win state · *Survey the field* = browse/import listings.

**Emoji:** none. Never. Iconography and the gold accent carry all the visual punctuation.

---

## VISUAL FOUNDATIONS

**Overall vibe.** Prospect-office ledger meets dark control surface. 1849 gravitas, dark mineral base, one scarce gold accent that the eye is trained to chase. Cool, wet, slate — not a warm darkroom. Calm, dense, legible; never decorative for its own sake.

**Color.** Dark mineral base (`Wet Slate #1B2327`), exactly **one `Placer Gold #CDA349` accent per view**, reserved for the single most valuable or active thing on screen. Everything else is rock, slate, and quartz. Support colors: `Verdigris #4C8C78` (positive/rich states), `Iron Oxide #A14B33` (dead/tailings/destructive), `Quartz #E7E1D3` (text), `Galena #6E767B` (muted lines + secondary text). Surfaces step from `#10171A` (sunken wells) → `#1B2327` (base) → `#212B2F` (cards) → `#283338` (raised). **No off-palette colors, ever.** Gold gradients use highlight `#E2C06B` / shadow `#A57E2C` / edge `#8F6E26`.

**Typography.** Three families, strict roles. **Slab serif** (Zilla Slab; premium Roslindale/Domaine) for personality — headlines, stage titles, wordmark — used *with restraint*. **Humanist sans** (Inter; premium Söhne) does the heavy lifting: dense application data, long lists. **Mono** (JetBrains Mono; premium Spline Sans Mono) for **all** metrics — numbers, dates, yields, counts, styled as metric readings, plus eyebrows and structural labels in wide-tracked uppercase. Clear weight contrast: slab 600–700, sans 400–600.

**Backgrounds.** Flat dark slate. The only texture is a very faint repeating vertical rule (`rgba(110,118,123,.05)` every 120px) reading like survey gridlines / claim boundaries — apply via `.prospect-field`. No photographs, no full-bleed imagery, no big gradients in chrome. Gradients appear only as the gold seam/nugget facets and the gold wash on the single accented card.

**Cards.** `--surface-card #212B2F`, 1px `--line` border, `--r-md` (9px) for claim cards / `--r-lg` (14px) for panels & boards. Subtle shadow (`--shadow-card`); boards read as wells sunk into the slate (`--shadow-panel`, deep `#10171A` fill). The single accented ("Strike") card swaps its border to `--gold-sh` and fills with a vertical gold wash gradient.

**Borders & dividers.** 1px hairlines in `--line` on dark. Dashed `--galena-dim` separators for "torn ticket" edges on claim tickets. Riffle/structural lines in Galena at low opacity.

**Radii.** 6px chips/stamps · 9px cards/inputs/buttons · 14px panels/boards/dialogs · 999px status chips & avatars. Nothing fully sharp, nothing very round — prospect-ledger restraint.

**Shadows.** Two systems: **recess** (inset wells — panels sunk into slate) and **elevation** (cards/popovers lift with soft, long, low-opacity black shadows). A **gold glow** (`--shadow-strike`) exists but is spent only on the one accented element.

**Motion.** Restrained. Fast (120ms) for hover/press, base (180ms) for state changes, ease-out / ease-in-out. No bounces, no infinite decorative loops. Respect `prefers-reduced-motion`.

**Hover / press.** Gold buttons lighten to `--gold-hi` on hover; ghost buttons brighten their border from `--galena-dim` to `--galena`. Nav links go from `--galena` to `--quartz`. Press states darken toward `--gold-sh` and/or nudge 1px. Focus is always a 2px gold ring, 2px offset.

**Transparency & blur.** Sticky header uses `backdrop-filter: blur(8px)` over `rgba(27,35,39,.82)`. Gold washes are low-alpha rgba fills. Otherwise surfaces are opaque.

**Imagery color vibe.** Cool, dark, mineral. If photography is ever introduced, it should be desaturated, cool-toned, low-key — never warm or bright. The only warmth permitted in a view is the single gold accent.

---

## ICONOGRAPHY

Prospect ships **no icon font and no bundled SVG icon set** in the source — the marketing site uses Unicode arrows (`→`) and the brand marks only. For the design system we standardize on **[Lucide](https://lucide.dev)** (linked from CDN) as the system icon set: its 1.5–2px stroke, square-ish geometry, and rounded joins match the prospect-ledger restraint and sit well against slate. Icons inherit `currentColor` and render in `--text-muted` / `--text-soft` by default; an icon may take the gold accent **only** when it marks the single accented element in a view.

**Rules.** Stroke icons only (no filled/duotone). Default 18–20px in UI, stroke-width 1.75. Never use emoji. Unicode middots (`·`) and arrows (`→`) are idiomatic in mono microcopy and may stand in for icons. If Lucide lacks a needed glyph, substitute the nearest Lucide option before drawing anything custom — and flag it.

**Brand marks** (`assets/`):
- `prospect-mark.svg` — primary gold-pan mark (3/4 perspective), 32px and up.
- `prospect-mark-compact.svg` — simplified concentric cut for 16–24px (favicon, app icon). *Reconstructed for this system; the original codebase referenced but did not ship it — please confirm or replace.*
- `prospect-wordmark.svg` — the lockup wordmark.

---

## Index — what's in this system

**Foundations**
- `styles.css` — the entry point consumers link (imports only).
- `tokens/colors.css` · `tokens/typography.css` · `tokens/spacing.css` · `tokens/fonts.css` · `tokens/base.css`
- `guidelines/*.html` — foundation specimen cards (Colors, Type, Spacing, Brand) shown in the Design System tab.

**Components** (`components/`) — reusable React primitives, namespaced on the compiled bundle:
- `core/` — Button, IconButton, Badge, Chip, Tag
- `forms/` — Input, Select, Textarea, Checkbox, Switch
- `data/` — ClaimCard, StatChip, KeyValue, StageColumnHead, EmptyState
- `feedback/` — Toast, Tooltip, Dialog
- `brand/` — Logo, Wordmark

**UI kit** (`ui_kits/prospect-app/`) — high-fidelity click-through recreation: the Claim Map board, an Hunt Report, a claim detail drawer (ticket + logbook), the Tailings Pond archive, and a "Stake a claim" dialog. Interactive — stake a claim, open a claim, move one to tailings.

**Templates** (`templates/`) — copyable starting points consuming projects can seed from:
- `landing/` — marketing hero + live claim-map preview in the house style.

**Reference** (`reference/`) — verbatim copies of the original `DESIGN.md` and landing page.

**Assets** (`assets/`) — brand marks.

**SKILL.md** — makes this folder usable as a downloadable Agent Skill.

# Prospect — Design System

> A job-application tracker built on the prospector's funnel: survey a wide field of raw listings, sift away the worthless, and work the few that show real value.

**Status:** locked v1 · single-accent discipline in force

---

## Premise

The mining metaphor is load-bearing, not decorative. Prospecting *is* the job hunt: you survey a huge field of raw material, discard most of it as worthless, and the entire point is finding the rare valuable thing. Every product decision should be derivable from that funnel. Where the metaphor stops explaining the function, drop it — see **Doctrine** below.

The same way Loupe's darkroom language only works because its users are photographers, Prospect's users are general job seekers, often stressed, who do not speak mining. So the metaphor runs loud in the brand layer and quiet in the interactive layer.

---

## Doctrine

**Through-line:** *Survey wide, stake narrow, work the vein.* — scan many listings, commit to few, go deep on the best. This drives the funnel and the UI hierarchy.

**Scarcity is the theme.** Gold is rare in the ground, so gold is rare in the interface. Exactly one gold accent per view, reserved for the single most valuable or active thing on screen. Everything else is rock, slate, and quartz. This is not an arbitrary constraint borrowed from Loupe; it is the metaphor enforcing itself.

**The legibility rule (locked).** Heavy where it delights, plain where someone is anxiously checking whether they got the interview. Mining vocabulary lives in: the name, the logo, color, dashboard titles, empty states, and microcopy. The actual board columns and status controls carry plain meaning underneath every mining term — a subtitle or tooltip, never a decode puzzle. A stressed user should never have to learn geology to find out where an application stands.

---

## The Pipeline

The prospector's funnel maps directly onto application stages. Each column shows the mining name with a plain gloss beneath it.

| Stage | Plain meaning | Why |
|---|---|---|
| **Showings** | Saved / interested | A *showing* is a surface trace of mineral worth investigating — and it doubles as having shown interest. |
| **Staked** | Applied | You've staked your claim on it. |
| **Working the Vein** | Interviewing | It's looking rich; you're digging in. |
| **Strike** | Offer | You hit paydirt. |
| **Tailings** | Rejected / dead / withdrawn | The waste rock left after extraction. Reframes rejection as a normal byproduct of mining, not a personal failure. |

`Tailings` is the load-bearing emotional move of the whole system. Use it deliberately.

---

## Lexicon

Brand-layer vocabulary. Use in titles, microcopy, and marketing — not as the only label on an interactive control.

- **A claim** — a single tracked job (the card).
- **Stake a claim** — add a job.
- **Core samples** / **Logbook** — per-job notes.
- **Hunt Report** / **Yield** — the analytics view.
- **Tailings Pond** — the archive of dead claims.
- **Paydirt** — the win state; the dream outcome.
- **Survey the field** — the act of browsing/importing listings.

---

## Voice & microcopy

Active voice, sentence case, plain verbs. Errors don't apologize and are never vague. Empty screens are invitations to act, written in the interface's voice, not a person's.

- Empty board: **"No claims staked. Survey the field."**
- Empty Tailings: **"Nothing in the tailings pond yet."**
- Add action button: **"Stake a claim"** (and the resulting toast says **"Claim staked,"** never "Submitted").
- Offer reached: **"Strike."**

A control says exactly what happens when used, and keeps the same name through the whole flow.

---

## Color

Dark mineral base, one scarce gold accent, mineral support colors. Named after what they are.

| Token | Hex | Role |
|---|---|---|
| **Wet Slate** | `#1B2327` | Base background (cooler/wetter than a darkroom bench — panning happens in water) |
| **Placer Gold** | `#CDA349` | The scarce accent. One per view. The gold a prospector pans from stream gravel. |
| **Verdigris** | `#4C8C78` | Secondary positive / "rich" states (oxidized copper) |
| **Iron Oxide** | `#A14B33` | Dead / tailings / destructive (rust) |
| **Quartz** | `#E7E1D3` | Ink and primary text (quartz is the host rock gold veins run through) |
| **Galena** | `#6E767B` | Muted structural lines, dividers, secondary text (lead-gray ore) |

Gold tints for the nugget / accent gradients: highlight `#E2C06B`, shadow `#A57E2C`, edge `#8F6E26`.

**Light-mode swap:** on light surfaces the Quartz rim/text flips to Wet Slate; the recess shadow and Galena lines hold on both.

---

## Typography

Where Loupe uses a soft Latin display (Fraunces), Prospect uses a **slab serif** — prospect-office ledger, stock-certificate, 1849 gravitas — paired with a humanist sans for stress-legible body text and a mono for metric readings.

- **Display — slab serif.** Roslindale or Domaine (premium); Zilla Slab (free fallback). Used with restraint: headlines, stage titles, the wordmark.
- **Body — humanist sans.** Inter or Söhne. Carries dense application data and long lists without fatigue.
- **Metrics — monospace.** Numbers, dates, yields, counts, styled as metric readings. JetBrains Mono for portfolio consistency, or Spline Sans Mono to differentiate from Loupe.

Set an intentional scale with clear weight contrast between the slab display and the sans body; let the slab be the personality and the sans disappear into legibility.

---

## Logomark

A **gold pan** — a circle holding a single gold nugget. It rhymes with Loupe's circular lens (both round tools of close inspection) while being unmistakably its own object.

**Construction.** A shallow pan in 3/4 perspective — a tilted rim ellipse with a deep front wall and two riffle ridges on the back inner wall, so it reads unmistakably as a gold pan rather than a dish or a loupe. One faceted Placer Gold nugget, with a specular glint, a cast shadow, and two fine flecks, sits settled at the bottom front — gold is heavy, so it sinks. The nugget is the only gold in the mark: the one-accent rule embodied in the symbol.

**Two cuts.** `prospect-mark.svg` is the primary mark (perspective pan), for any context at 32px and up — nav, lockup, social. `prospect-mark-compact.svg` is a simplified concentric cut that holds its read at 16–24px, used as the favicon and app icon where the perspective detail would muddy.

**Color flip.** Primary on Wet Slate. On light, flip the rim/quartz strokes to Wet Slate; the recess and nugget are unchanged.

Alternates considered and held in reserve: headframe silhouette (the tower over a shaft), scale balance.

See `prospect-mark.svg`.

---

## Locked rules

1. One gold accent per view. Always.
2. Mining vocabulary is brand-layer; interactive controls always carry plain meaning underneath.
3. Color tokens are named for the mineral, used for the role. No off-palette colors.
4. Slab display used with restraint; sans body does the heavy lifting; mono for all metrics.
5. The funnel — Showings → Staked → Working the Vein → Strike, with Tailings off to the side — is the spine of the product.

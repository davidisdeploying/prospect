---
name: prospect-design
description: Use this skill to generate well-branded interfaces and assets for Prospect (a job-application tracker built on the prospector's funnel — survey wide, stake narrow, work the vein), either for production or throwaway prototypes/mocks. Contains essential design guidelines, colors, type, fonts, assets, components, and a UI kit for prototyping.
user-invocable: true
---

Read the `readme.md` file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes), copy assets out and create static HTML files for the user to view. If working on production code, copy assets and read the rules here to become an expert in designing with this brand.

**The one rule above all:** exactly one Placer Gold (`#CDA349`) accent per view, reserved for the single most valuable or active thing on screen. Everything else is rock, slate, and quartz. Mining vocabulary is brand-layer; interactive controls always carry the plain meaning underneath (a gloss or tooltip).

Key files:
- `readme.md` — full design guide: content fundamentals, visual foundations, iconography, index.
- `styles.css` — link this; pulls in all tokens + fonts.
- `tokens/` — colors, typography, spacing CSS custom properties.
- `components/` — React primitives (Button, Badge, ClaimCard, StatChip, Dialog, …) under namespace `window.ProspectDesignSystem_c3fd64`.
- `ui_kits/prospect-app/` — interactive recreation of the app (Claim Map board, Hunt Report, claim drawer, stake dialog).
- `templates/landing/` — copyable marketing-landing starting point.
- `guidelines/` — foundation specimen cards.
- `assets/` — gold-pan logomark (primary + compact) and wordmark.

If the user invokes this skill without other guidance, ask what they want to build, ask a few questions, and act as an expert Prospect designer who outputs HTML artifacts or production code as needed.

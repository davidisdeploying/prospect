**Badge** — the pipeline stage chip; mono caps, tone-tinted. `Strike` is `gold` (the view's scarce accent), `Tailings` is `danger`.

```jsx
<Badge tone="gold">Strike</Badge>
<Badge tone="positive">Working the Vein</Badge>
<Badge tone="danger">Tailings</Badge>
<Badge tone={STAGE_TONE[stage]}>{stage}</Badge>
```

Tones: `neutral | gold | positive | danger`. Use the `STAGE_TONE` map to derive tone from a stage name. `solid` fills the chip.

**Button** — Prospect's action button; gold is the scarce accent, so at most one `variant="gold"` per view for the single most valuable action.

```jsx
<Button variant="gold">Stake a claim</Button>
<Button variant="ghost">See the dig →</Button>
<Button variant="quiet" size="sm">Cancel</Button>
<Button variant="danger" size="sm">Move to tailings</Button>
```

Variants: `gold` (primary, once per view), `ghost` (default outline), `quiet` (text-only), `danger` (Iron Oxide, destructive). Sizes `sm | md | lg`. Pass `iconLeft` / `iconRight` with a Lucide SVG node. Focus shows the gold ring automatically.

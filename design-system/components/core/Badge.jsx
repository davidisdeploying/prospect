import React from 'react';

/**
 * Prospect — Badge (status chip)
 * The pipeline stage indicator. Mining name on the chip; the plain meaning
 * lives nearby (column gloss / tooltip), never decoded here.
 */
const TONES = {
  neutral:  { color: 'var(--text-muted)', border: 'var(--galena-dim)', bg: 'transparent' },
  gold:     { color: 'var(--accent)',     border: 'var(--gold-sh)',     bg: 'var(--accent-wash-soft)' },
  positive: { color: 'var(--positive)',   border: 'var(--positive)',    bg: 'transparent' },
  danger:   { color: 'var(--danger)',     border: 'var(--danger)',      bg: 'transparent' },
};

/** Map a pipeline stage to its tone. Strike = gold (the scarce accent). */
export const STAGE_TONE = {
  Showings: 'neutral',
  Staked: 'neutral',
  'Working the Vein': 'positive',
  Strike: 'gold',
  Tailings: 'danger',
};

export function Badge({
  tone = 'neutral',      // 'neutral' | 'gold' | 'positive' | 'danger'
  solid = false,
  style,
  children,
  ...rest
}) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--font-mono)',
        fontSize: 10.5,
        fontWeight: 500,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        padding: '4px 9px',
        borderRadius: 'var(--r-pill)',
        border: '1px solid',
        borderColor: solid ? 'transparent' : t.border,
        background: solid ? t.color : t.bg,
        color: solid ? 'var(--text-on-gold)' : t.color,
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}

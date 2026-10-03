import React from 'react';

/**
 * Prospect — Toast
 * Confirmation in the interface's voice ("Claim staked," never "Submitted").
 * Slides up from bottom; tone tints the left rule.
 */
export function Toast({ message, tone = 'neutral', action = null, style, ...rest }) {
  const accent = {
    neutral: 'var(--galena)',
    gold: 'var(--accent)',
    positive: 'var(--positive)',
    danger: 'var(--danger)',
  }[tone] || 'var(--galena)';

  return (
    <div
      role="status"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 14,
        background: 'var(--surface-raised)',
        border: '1px solid var(--line)',
        borderLeft: `3px solid ${accent}`,
        borderRadius: 'var(--r-md)',
        boxShadow: 'var(--shadow-pop)',
        padding: '12px 16px',
        fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--text-body)',
        ...style,
      }}
      {...rest}
    >
      <span>{message}</span>
      {action}
    </div>
  );
}

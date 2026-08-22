import React from 'react';

/**
 * Prospect — Tag
 * Quiet metadata pill for claim attributes (comp, location, source).
 * Mono, low-key; never gold.
 */
export function Tag({ icon = null, style, children, ...rest }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--text-muted)',
        background: 'var(--bg-sunken)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-sm)',
        padding: '3px 8px',
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}

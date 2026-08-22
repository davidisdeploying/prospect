import React from 'react';

/**
 * Prospect — Tooltip
 * Carries the plain meaning behind a mining term (the legibility rule).
 * Hover/focus to reveal a small dark popover.
 */
export function Tooltip({ label, side = 'top', children, style, ...rest }) {
  const [open, setOpen] = React.useState(false);
  const pos = {
    top:    { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 8 },
    bottom: { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 8 },
    left:   { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 8 },
    right:  { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 8 },
  }[side];

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', ...style }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      {...rest}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className="ds-tooltip-fade"
          style={{
            position: 'absolute', ...pos, zIndex: 40, whiteSpace: 'nowrap',
            background: 'var(--slate-900)', color: 'var(--text-body)',
            border: '1px solid var(--line)', borderRadius: 'var(--r-sm)',
            boxShadow: 'var(--shadow-pop)',
            padding: '6px 10px', fontFamily: 'var(--font-sans)', fontSize: 12.5,
            pointerEvents: 'none',
          }}
        >{label}</span>
      )}
    </span>
  );
}

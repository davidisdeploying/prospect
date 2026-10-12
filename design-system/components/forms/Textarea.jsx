import React from 'react';
import { labelStyle } from './Input.jsx';

/**
 * Prospect — Textarea
 * For core samples / logbook notes. Sunken well, gold focus, sans body.
 */
export function Textarea({ label, hint, rows = 4, id, style, ...rest }) {
  const fid = id || (label ? `ta-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && <label htmlFor={fid} style={labelStyle}>{label}</label>}
      <textarea
        id={fid}
        rows={rows}
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
          lineHeight: 1.55,
          color: 'var(--text-body)',
          background: 'var(--bg-sunken)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-md)',
          padding: '10px 12px',
          outline: 'none',
          resize: 'vertical',
          transition: 'border-color var(--dur-flick) var(--ease-sluice), box-shadow var(--dur-flick) var(--ease-sluice)',
          ...style,
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent)';
          e.currentTarget.style.boxShadow = '0 0 0 2px rgba(205,163,73,.22)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--line)';
          e.currentTarget.style.boxShadow = 'none';
        }}
        {...rest}
      />
      {hint && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{hint}</span>}
    </div>
  );
}

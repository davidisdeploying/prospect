import React from 'react';
import { labelStyle } from './Input.jsx';

/**
 * Prospect — Select
 * Native select restyled into a sunken well with a mono caret.
 */
export function Select({ label, hint, options = [], id, style, children, ...rest }) {
  const fid = id || (label ? `sel-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && <label htmlFor={fid} style={labelStyle}>{label}</label>}
      <div style={{ position: 'relative', display: 'flex' }}>
        <select
          id={fid}
          style={{
            appearance: 'none',
            WebkitAppearance: 'none',
            width: '100%',
            fontFamily: 'var(--font-sans)',
            fontSize: 14,
            color: 'var(--text-body)',
            background: 'var(--bg-sunken)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)',
            padding: '10px 34px 10px 12px',
            outline: 'none',
            cursor: 'pointer',
            transition: 'border-color var(--dur-flick) var(--ease-sluice)',
            ...style,
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; }}
          {...rest}
        >
          {children || options.map((o) => {
            const val = typeof o === 'string' ? o : o.value;
            const lab = typeof o === 'string' ? o : o.label;
            return <option key={val} value={val}>{lab}</option>;
          })}
        </select>
        <span style={{
          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
          pointerEvents: 'none', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12,
        }}>▾</span>
      </div>
      {hint && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{hint}</span>}
    </div>
  );
}

import React from 'react';

/**
 * Prospect — Input
 * Field sits in a sunken well; gold focus ring. Mono label above.
 */
export function Input({
  label,
  hint,
  mono = false,
  invalid = false,
  id,
  style,
  ...rest
}) {
  const fid = id || (label ? `in-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && (
        <label htmlFor={fid} style={labelStyle}>{label}</label>
      )}
      <input
        id={fid}
        aria-invalid={invalid || undefined}
        style={{
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
          fontSize: 14,
          color: 'var(--text-body)',
          background: 'var(--bg-sunken)',
          border: '1px solid',
          borderColor: invalid ? 'var(--danger)' : 'var(--line)',
          borderRadius: 'var(--r-md)',
          padding: '10px 12px',
          outline: 'none',
          transition: 'border-color var(--dur-flick) var(--ease-sluice), box-shadow var(--dur-flick) var(--ease-sluice)',
          ...style,
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = invalid ? 'var(--danger)' : 'var(--accent)';
          e.currentTarget.style.boxShadow = '0 0 0 2px rgba(205,163,73,.22)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = invalid ? 'var(--danger)' : 'var(--line)';
          e.currentTarget.style.boxShadow = 'none';
        }}
        {...rest}
      />
      {hint && (
        <span style={{ fontSize: 12, color: invalid ? 'var(--danger)' : 'var(--text-muted)' }}>{hint}</span>
      )}
    </div>
  );
}

export const labelStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10.5,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
};

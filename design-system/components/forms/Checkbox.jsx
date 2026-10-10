import React from 'react';

/**
 * Prospect — Checkbox
 * Square check; gold fill when set (counts as accent — use sparingly in lists).
 */
export function Checkbox({ label, checked, onChange, disabled = false, style, ...rest }) {
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--text-body)', ...style,
    }}>
      <span
        role="checkbox"
        aria-checked={checked}
        onClick={() => !disabled && onChange && onChange(!checked)}
        style={{
          width: 18, height: 18, flex: 'none',
          borderRadius: 5,
          border: '1px solid',
          borderColor: checked ? 'var(--accent-press)' : 'var(--galena)',
          background: checked ? 'var(--accent)' : 'var(--bg-sunken)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background var(--dur-flick) var(--ease-sluice), border-color var(--dur-flick) var(--ease-sluice)',
        }}
      >
        {checked && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6.2 5 8.7 9.5 3.5" stroke="#1C1A12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {label && <span>{label}</span>}
      <input type="checkbox" checked={checked} onChange={(e) => onChange && onChange(e.target.checked)} disabled={disabled} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} {...rest} />
    </label>
  );
}

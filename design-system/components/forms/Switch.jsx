import React from 'react';

/**
 * Prospect — Switch
 * Toggle; gold track when on. The knob is quartz.
 */
export function Switch({ checked, onChange, label, disabled = false, style, ...rest }) {
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--text-body)', ...style,
    }}>
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange && onChange(!checked)}
        style={{
          position: 'relative', width: 38, height: 22, flex: 'none',
          borderRadius: 999,
          background: checked ? 'var(--accent)' : 'var(--galena-dim)',
          border: '1px solid',
          borderColor: checked ? 'var(--accent-press)' : 'var(--galena)',
          transition: 'background var(--dur-state) var(--ease-sluice), border-color var(--dur-state) var(--ease-sluice)',
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: 999,
          background: checked ? 'var(--text-on-gold)' : 'var(--quartz)',
          transition: 'left var(--dur-state) var(--ease-sluice)',
        }} />
      </span>
      {label && <span>{label}</span>}
      <input type="checkbox" checked={checked} onChange={(e) => onChange && onChange(e.target.checked)} disabled={disabled} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} {...rest} />
    </label>
  );
}

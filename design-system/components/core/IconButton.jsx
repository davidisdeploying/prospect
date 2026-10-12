import React from 'react';

/**
 * Prospect — IconButton
 * Square, quiet affordance for toolbar / card actions. Houses a Lucide SVG.
 */
export function IconButton({
  size = 'md',           // 'sm' | 'md'
  variant = 'ghost',     // 'ghost' | 'gold'
  label,                 // accessible label (required)
  disabled = false,
  onClick,
  style,
  children,
  ...rest
}) {
  const dim = size === 'sm' ? 30 : 36;
  const isGold = variant === 'gold';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: dim,
        height: dim,
        borderRadius: 'var(--r-md)',
        border: '1px solid',
        borderColor: isGold ? 'var(--accent-press)' : 'var(--galena-dim)',
        background: isGold ? 'var(--accent)' : 'transparent',
        color: isGold ? 'var(--text-on-gold)' : 'var(--text-muted)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'background var(--dur-flick) var(--ease-sluice), border-color var(--dur-flick) var(--ease-sluice), color var(--dur-flick) var(--ease-sluice), transform var(--dur-flick) var(--ease-sluice)',
        ...style,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (isGold) e.currentTarget.style.background = 'var(--accent-hover)';
        else { e.currentTarget.style.borderColor = 'var(--galena)'; e.currentTarget.style.color = 'var(--text-body)'; }
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = isGold ? 'var(--accent)' : 'transparent';
        e.currentTarget.style.borderColor = isGold ? 'var(--accent-press)' : 'var(--galena-dim)';
        e.currentTarget.style.color = isGold ? 'var(--text-on-gold)' : 'var(--text-muted)';
        e.currentTarget.style.transform = 'none';
      }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = 'translateY(1px)'; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = 'none'; }}
      {...rest}
    >
      {children}
    </button>
  );
}

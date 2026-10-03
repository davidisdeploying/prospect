import React from 'react';

/**
 * Prospect — Button
 * Gold is the scarce accent: use variant="gold" for the ONE primary action
 * in a view; everything else is ghost or quiet.
 */
export function Button({
  variant = 'ghost',     // 'gold' | 'ghost' | 'quiet' | 'danger'
  size = 'md',           // 'sm' | 'md' | 'lg'
  iconLeft = null,
  iconRight = null,
  disabled = false,
  type = 'button',
  onClick,
  style,
  children,
  ...rest
}) {
  const pads = {
    sm: '8px 12px',
    md: '11px 18px',
    lg: '14px 22px',
  };
  const fonts = { sm: 13, md: 14.5, lg: 16 };

  const variants = {
    gold: {
      background: 'var(--accent)',
      color: 'var(--text-on-gold)',
      borderColor: 'var(--accent-press)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-body)',
      borderColor: 'var(--galena-dim)',
    },
    quiet: {
      background: 'transparent',
      color: 'var(--text-muted)',
      borderColor: 'transparent',
    },
    danger: {
      background: 'transparent',
      color: 'var(--danger)',
      borderColor: 'var(--danger)',
    },
  };

  const v = variants[variant] || variants.ghost;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        fontFamily: 'var(--font-sans)',
        fontWeight: 600,
        fontSize: fonts[size],
        lineHeight: 1,
        padding: pads[size],
        borderRadius: 'var(--r-md)',
        border: '1px solid',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'background var(--dur-flick) var(--ease-sluice), border-color var(--dur-flick) var(--ease-sluice), transform var(--dur-flick) var(--ease-sluice)',
        whiteSpace: 'nowrap',
        ...v,
        ...style,
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (variant === 'gold') e.currentTarget.style.background = 'var(--accent-hover)';
        else if (variant === 'ghost') e.currentTarget.style.borderColor = 'var(--galena)';
        else if (variant === 'quiet') e.currentTarget.style.color = 'var(--text-body)';
        else if (variant === 'danger') e.currentTarget.style.background = 'var(--danger-wash)';
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = v.background;
        e.currentTarget.style.borderColor = v.borderColor;
        e.currentTarget.style.color = v.color;
        e.currentTarget.style.transform = 'none';
      }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = 'translateY(1px)'; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = 'none'; }}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}

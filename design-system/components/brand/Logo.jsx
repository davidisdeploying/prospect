import React from 'react';

/**
 * Prospect — Logo (the gold pan)
 * Self-contained inline SVG so it renders anywhere without an asset path.
 * variant="primary" is the 3/4 perspective pan (32px+); "compact" is the
 * concentric cut for 16–24px. The nugget is the only gold in the mark.
 */
export function Logo({ size = 40, variant = 'primary', title = 'Prospect', style, ...rest }) {
  if (variant === 'compact') {
    return (
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={title} style={{ display: 'block', ...style }} {...rest}>
        <circle cx="60" cy="60" r="50" fill="#10171A" />
        <circle cx="60" cy="60" r="50" fill="none" stroke="#E7E1D3" strokeWidth="7" />
        <circle cx="60" cy="60" r="33" fill="none" stroke="#6E767B" strokeWidth="2.5" opacity="0.55" />
        <polygon points="44,68 50,50 60,43 71,47 78,60 71,73 54,76" fill="#CDA349" stroke="#8F6E26" strokeWidth="2" strokeLinejoin="round" />
        <polygon points="50,50 60,43 65,57 52,60" fill="#E2C06B" />
        <polygon points="71,47 78,60 71,73 62,58" fill="#A57E2C" />
        <circle cx="56" cy="54" r="2.4" fill="#F6E8B0" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={title} style={{ display: 'block', ...style }} {...rest}>
      <path d="M14,52 Q60,118 106,52" fill="#10171A" />
      <ellipse cx="60" cy="52" rx="46" ry="18" fill="#10171A" />
      <path d="M32,49 Q60,40 88,49" fill="none" stroke="#6E767B" strokeWidth="1.8" opacity="0.5" />
      <path d="M37,45.5 Q60,38 83,45.5" fill="none" stroke="#6E767B" strokeWidth="1.8" opacity="0.4" />
      <ellipse cx="60" cy="52" rx="46" ry="18" fill="none" stroke="#E7E1D3" strokeWidth="6" strokeLinecap="round" />
      <path d="M14,52 Q60,118 106,52" fill="none" stroke="#E7E1D3" strokeWidth="6" strokeLinecap="round" />
      <ellipse cx="60" cy="81" rx="16" ry="3" fill="#000" opacity="0.42" />
      <circle cx="43" cy="74" r="1.7" fill="#CDA349" />
      <circle cx="79" cy="75" r="1.6" fill="#CDA349" />
      <polygon points="45,77 50,63 60,57.5 70,60 77,70 71,81 56,83" fill="#CDA349" stroke="#8F6E26" strokeWidth="1.7" strokeLinejoin="round" />
      <polygon points="50,63 60,57.5 64,68 53,70.5" fill="#E2C06B" />
      <polygon points="70,60 77,70 71,81 63,69" fill="#A57E2C" />
      <circle cx="55" cy="64" r="2" fill="#F6E8B0" />
    </svg>
  );
}

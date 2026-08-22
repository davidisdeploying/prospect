import React from 'react';
import lockupUrl from '../../assets/prospect-lockup.svg';

/**
 * Prospect — Wordmark (lockup)
 * Pickaxe + "Prospect." lockup (Logo v2). Renders the approved lockup asset.
 */
export function Wordmark({ size = 24, showMark = true, style, ...rest }) {
  return (
    <img
      src={lockupUrl}
      alt="Prospect"
      style={{ height: size * 1.75, width: 'auto', display: 'block', ...style }}
      {...rest}
    />
  );
}

import * as React from 'react';

/** The gold-pan logomark. `primary` = perspective pan (32px+), `compact` = concentric (16–24px). */
export interface LogoProps {
  /** @default 40 */
  size?: number;
  /** @default 'primary' */
  variant?: 'primary' | 'compact';
  title?: string;
}

export function Logo(props: LogoProps): JSX.Element;

import * as React from 'react';

/** Reveals the plain meaning behind a mining term (the legibility rule). */
export interface TooltipProps {
  /** The plain-meaning text, e.g. "In review / screening". */
  label: React.ReactNode;
  /** @default 'top' */
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactNode;
}

export function Tooltip(props: TooltipProps): JSX.Element;

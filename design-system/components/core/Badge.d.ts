import * as React from 'react';

/**
 * Pipeline status chip — mono caps, tinted by tone. The mining stage name goes
 * on the chip; its plain meaning lives nearby (never decoded on the chip).
 */
export interface BadgeProps {
  /** @default 'neutral' */
  tone?: 'neutral' | 'gold' | 'positive' | 'danger';
  /** Filled instead of outline. @default false */
  solid?: boolean;
  children?: React.ReactNode;
}

export function Badge(props: BadgeProps): JSX.Element;

/** Maps a pipeline stage name to its Badge tone. */
export const STAGE_TONE: Record<string, BadgeProps['tone']>;

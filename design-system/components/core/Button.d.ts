import * as React from 'react';

/**
 * Prospect's primary action button. Gold is the scarce accent — at most one
 * `variant="gold"` button per view, reserved for the single most valuable action.
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight. Use 'gold' only once per view. @default 'ghost' */
  variant?: 'gold' | 'ghost' | 'quiet' | 'danger';
  /** @default 'md' */
  size?: 'sm' | 'md' | 'lg';
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  disabled?: boolean;
  children?: React.ReactNode;
}

export function Button(props: ButtonProps): JSX.Element;

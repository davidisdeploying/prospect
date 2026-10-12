import * as React from 'react';

/** Square icon-only button for toolbar and card actions. Houses a Lucide SVG. */
export interface IconButtonProps {
  /** @default 'md' */
  size?: 'sm' | 'md';
  /** @default 'ghost' */
  variant?: 'ghost' | 'gold';
  /** Accessible label — required. */
  label: string;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children?: React.ReactNode;
}

export function IconButton(props: IconButtonProps): JSX.Element;

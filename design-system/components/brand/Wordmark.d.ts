import * as React from 'react';

/** Mark + slab "Prospect" lockup, as used in nav and footers. */
export interface WordmarkProps {
  /** Wordmark font-size in px; the mark scales to 1.75×. @default 24 */
  size?: number;
  showMark?: boolean;
}

export function Wordmark(props: WordmarkProps): JSX.Element;

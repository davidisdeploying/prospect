import * as React from 'react';

/** Modal in a raised slate panel over a slate scrim. Slab title, sans body, actions row. */
export interface DialogProps {
  open: boolean;
  title?: React.ReactNode;
  /** Actions row, right-aligned in a sunken footer. */
  footer?: React.ReactNode;
  onClose?: () => void;
  /** @default 460 */
  width?: number;
  children?: React.ReactNode;
}

export function Dialog(props: DialogProps): JSX.Element | null;

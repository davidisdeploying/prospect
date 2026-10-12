import * as React from 'react';

/** Square checkbox; gold fill when set. */
export interface CheckboxProps {
  label?: React.ReactNode;
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
}

export function Checkbox(props: CheckboxProps): JSX.Element;

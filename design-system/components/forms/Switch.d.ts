import * as React from 'react';

/** Toggle switch; gold track when on, quartz knob. */
export interface SwitchProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
}

export function Switch(props: SwitchProps): JSX.Element;

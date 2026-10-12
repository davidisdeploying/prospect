import * as React from 'react';

interface Option { value: string; label: string; }

/** Restyled native select — sunken well, mono caret. */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  /** Options as strings or {value,label}; or pass <option> children. */
  options?: (string | Option)[];
}

export function Select(props: SelectProps): JSX.Element;

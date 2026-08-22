import * as React from 'react';

/**
 * Text field — sits in a sunken well with a gold focus ring and a mono label.
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Mono uppercase label rendered above the field. */
  label?: string;
  /** Helper or error text below. */
  hint?: string;
  /** Render the value in monospace (for codes, comp, dates). */
  mono?: boolean;
  invalid?: boolean;
}

export function Input(props: InputProps): JSX.Element;

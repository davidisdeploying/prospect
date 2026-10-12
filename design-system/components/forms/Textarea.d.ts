import * as React from 'react';

/** Multi-line field for core samples / logbook notes. Sunken well, gold focus. */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  rows?: number;
}

export function Textarea(props: TextareaProps): JSX.Element;

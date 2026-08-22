import * as React from 'react';

/** Confirmation toast in the interface's voice. Tone tints the left rule. */
export interface ToastProps {
  message: React.ReactNode;
  /** @default 'neutral' */
  tone?: 'neutral' | 'gold' | 'positive' | 'danger';
  /** Optional inline action (e.g. an Undo button). */
  action?: React.ReactNode;
}

export function Toast(props: ToastProps): JSX.Element;

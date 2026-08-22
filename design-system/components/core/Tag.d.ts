import * as React from 'react';

/** Quiet mono metadata pill for claim attributes (comp, location, source). Never gold. */
export interface TagProps {
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

export function Tag(props: TagProps): JSX.Element;

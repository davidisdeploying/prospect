import React from 'react';

// §3.6 Paydirt — the pickaxe-head mark, inlined as JSX from
// design-system/assets/prospect-mark-pick.svg so its gold arc can carry a
// stroke-dashoffset draw. The mark is otherwise only ever consumed as an
// <img src={lockupUrl}> (Wordmark.jsx), which can't be stroke-animated from
// the host document. The quartz handle stays a static, non-gold stroke.
export function PaydirtMark() {
  return (
    <svg
      width="26" height="26" viewBox="0 0 64 64"
      aria-hidden="true"
      style={{ position: 'absolute', top: 8, right: 8, pointerEvents: 'none' }}
    >
      <path d="M32,15 L32,55" fill="none" stroke="var(--quartz)" strokeWidth="6" strokeLinecap="round" />
      <path className="paydirt-arc" d="M13,27 Q32,9 51,27" fill="none" stroke="var(--placer-gold)" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

import { flushSync } from 'react-dom';

// §3.2 spatial continuity — the claim travels. Progressive enhancement:
// browsers without View Transitions get a plain synchronous swap, so the
// app is 100% functional and legible with zero animation support (§5.7).
export function withViewTransition(apply, { toTailings = false } = {}) {
  if (typeof document === 'undefined' || !document.startViewTransition) {
    apply();
    return Promise.resolve();
  }
  const root = document.documentElement;
  if (toTailings) root.setAttribute('data-vt-sink', '');
  const transition = document.startViewTransition(() => flushSync(apply));
  return transition.finished.finally(() => {
    if (toTailings) root.removeAttribute('data-vt-sink');
  });
}

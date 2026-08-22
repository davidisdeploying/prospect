import React from 'react';

/**
 * Prospect — Dialog
 * Native <dialog>: the element itself is the raised slate panel; the
 * browser's ::backdrop (styled in motion.css) is the scrim. Kept mounted
 * across open/close so motion.css's @starting-style/allow-discrete
 * transition can animate both entrance and exit (§3.5).
 */
export function Dialog({ open, title, children, footer = null, onClose, width = 460, style, ...rest }) {
  const dialogRef = React.useRef(null);
  const titleId = React.useId();

  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  function handleCancel(e) {
    // Esc: don't let the browser snap it shut — close via `open` going
    // false so the same animated exit plays as backdrop-click/Cancel.
    e.preventDefault();
    onClose && onClose();
  }

  function handleClick(e) {
    // Native backdrop-click: the click target is the <dialog> itself only
    // when it lands outside the rendered content box.
    if (e.target === dialogRef.current) onClose && onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="ds-dialog"
      aria-labelledby={title ? titleId : undefined}
      onCancel={handleCancel}
      onClick={handleClick}
      style={{ width, maxWidth: '100%', ...style }}
      {...rest}
    >
      {title && <div id={titleId} className="ds-dialog-title">{title}</div>}
      <div className="ds-dialog-body">{children}</div>
      {footer && <div className="ds-dialog-footer">{footer}</div>}
    </dialog>
  );
}

/**
 * An explanation kept behind a small "i", shown while the pointer is over it or it has focus.
 *
 * For text that explains how a control behaves rather than something the user has to act on: a warning
 * or a flag stays on screen as a line of its own. The text is the button's description as well, so a
 * screen reader reads it without the pointer. The mark is a letter in a CSS circle, not an image.
 */

import { useId } from 'react';

export function InfoTip({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  const id = useId();
  return (
    <span className="info-tip">
      <button type="button" className="info-tip-mark" aria-label={label} aria-describedby={id}>
        i
      </button>
      <span id={id} role="tooltip" className="info-tip-text">
        {children}
      </span>
    </span>
  );
}

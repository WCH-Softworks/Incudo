/**
 * An action that asks first: the first click arms it, and the second, on a button that says what it will do, does it.
 * Left alone it disarms after four seconds.
 *
 * Not `window.confirm`: in the Tauri window `tauri-plugin-dialog` replaces it with an async function, whose promise is
 * truthy whatever the answer, so `if (!window.confirm(…)) return` never returned and nothing was asked. A guard test
 * (`tools/verify/src/desktop-dialogs.test.ts`) keeps the page's own dialogs out of the shell.
 */

import { useEffect, useState } from 'react';

export function ArmedButton({
  label,
  armedLabel,
  onConfirm,
  disabled,
  className,
  armedClassName = 'danger',
}: {
  label: string;
  /** What the second click does, in words. */
  armedLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
  /** The armed button's class: `danger` unless the action loses nothing. */
  armedClassName?: string;
}): React.JSX.Element {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={armedClassName || undefined}
      disabled={disabled}
      onClick={() => {
        setArmed(false);
        onConfirm();
      }}
    >
      {armedLabel}
    </button>
  );
}

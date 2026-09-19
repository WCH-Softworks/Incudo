/**
 * The React side of `packages/ui`'s command list — ADR 0037.
 *
 * What a command *is*, when it is *available*, and which key means it are all in
 * `commands.ts` under `node --test`. This file holds three things that cannot be there because
 * each needs a window: the one keyboard listener, the bridge to the native menu, and a
 * `latest` cell that lets a menu item created once at startup call the handler of whatever
 * screen is showing now.
 *
 * **The page owns the keyboard, in every build, and a menu is for the mouse.** This was first
 * written the other way round — a native menu registering accelerators, and the listener only
 * where there was no menu — and pressing the keys in the Tauri window on Windows showed it was
 * wrong: WebView2 delivers the keystroke to the page and the host's accelerator table never runs
 * the item, so nothing happened. A shortcut now has one way in. See ADR 0037.
 *
 * **Staying in step with app state.** `Shell` hands over a freshly resolved list on every
 * render (`update`), which is cheap: a ref write, and a menu sync that sends only flags that
 * changed. Sending to a native menu is asynchronous, so `run` checks the *latest* list again
 * before calling a handler — a menu item clicked in the gap between a state change and its
 * sync finds its command already disabled and does nothing.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  NO_WORKSPACE,
  isEnabled,
  keyOutcome,
  resolveCommands,
  type CommandHost,
  type CommandId,
  type InstalledMenu,
  type Os,
  type ResolvedCommand,
} from '@incudo/ui';

export type CommandHandlers = Partial<Record<CommandId, () => void>>;

/** What a screen holds while it is on screen: the current list and what each command does. */
export interface CommandBinder {
  readonly os: Os;
  /** Called every render by whatever screen has commands. Cheap. */
  update(resolved: readonly ResolvedCommand[], handlers: CommandHandlers): void;
  /** Called when that screen goes away. Every command becomes unavailable. */
  release(): void;
}

interface Bound {
  resolved: readonly ResolvedCommand[];
  handlers: CommandHandlers;
}

/** The launcher, or nothing mounted yet: no command is available and none does anything. */
const IDLE: Bound = { resolved: resolveCommands(NO_WORKSPACE), handlers: {} };

export function useCommandHost(host: CommandHost): CommandBinder {
  const latest = useRef<Bound>(IDLE);
  const menu = useRef<InstalledMenu | null>(null);
  const started = useRef(false);

  const run = useCallback((id: CommandId): void => {
    const { resolved, handlers } = latest.current;
    if (!isEnabled(resolved, id)) return;
    handlers[id]?.();
  }, []);

  // Once for the life of the app. A ref rather than the effect's cleanup, because StrictMode
  // mounts, unmounts and mounts again in development and the menu should exist once.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void host.install(run).then((installed) => {
      menu.current = installed;
      installed?.sync(latest.current.resolved);
    });
  }, [host, run]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const outcome = keyOutcome(event, host.os, latest.current.resolved);
      if (!outcome) return;
      // Claimed even if it will not run: see `keyOutcome`.
      event.preventDefault();
      if (outcome.run) run(outcome.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [host, run]);

  return useMemo<CommandBinder>(
    () => ({
      os: host.os,
      update(resolved, handlers) {
        latest.current = { resolved, handlers };
        menu.current?.sync(resolved);
      },
      release() {
        latest.current = IDLE;
        menu.current?.sync(IDLE.resolved);
      },
    }),
    [host],
  );
}

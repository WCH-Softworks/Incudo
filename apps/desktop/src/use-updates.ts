/**
 * The window's side of updating itself — ADR 0133. Holds the {@link UpdateStatus} and the remembered preference, and
 * runs the start check once; every sentence and every decision about what to show is `packages/ui/src/app-update.ts`'s.
 *
 * Here, above the launcher and the workspace, because a window has one app version: the start check runs whichever of
 * the two is on screen, and its dialog shows over either.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppUpdater, Storage } from '@incudo/core';
import {
  DEFAULT_UPDATE_PREFERENCES,
  UPDATE_IDLE,
  checkForUpdate,
  installUpdate,
  readUpdatePreferences,
  updateBusy,
  updateDialog,
  writeUpdatePreferences,
  type UpdateAction,
  type UpdateDialogView,
  type UpdatePreferences,
  type UpdateStatus,
} from '@incudo/ui';

export interface Updates {
  /** False in the browser build: no command, no Settings section, no start check. */
  available: boolean;
  status: UpdateStatus;
  view: UpdateDialogView | null;
  busy: boolean;
  preferences: UpdatePreferences;
  /** A check someone asked for: the menu's command and the Settings button. Each answer is said. */
  check: () => void;
  act: (action: UpdateAction) => void;
  setCheckOnStart: (on: boolean) => void;
}

export function useUpdates(updater: AppUpdater, storage: Storage, currentVersion: string): Updates {
  const [status, setStatus] = useState<UpdateStatus>(UPDATE_IDLE);
  const [preferences, setPreferences] = useState<UpdatePreferences>(DEFAULT_UPDATE_PREFERENCES);
  // A check or install in flight, read synchronously so a double click starts one.
  const running = useRef(false);

  const run = useCallback(
    async (manual: boolean) => {
      if (running.current) return;
      running.current = true;
      setStatus({ kind: 'checking', manual });
      try {
        setStatus(await checkForUpdate(updater, manual, (error) => console.warn('The update check failed.', error)));
      } finally {
        running.current = false;
      }
    },
    [updater],
  );

  // Once per window, after the remembered preference is read: never before, or turning it off would not hold.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void readUpdatePreferences(storage).then((remembered) => {
      setPreferences(remembered);
      if (updater.available && remembered.checkOnStart) void run(false);
    });
  }, [storage, updater, run]);

  const install = useCallback(async () => {
    if (running.current || (status.kind !== 'found' && status.kind !== 'failed')) return;
    const update = status.update;
    if (!update) return;
    running.current = true;
    try {
      setStatus(await installUpdate(updater, update, setStatus));
    } finally {
      running.current = false;
    }
  }, [status, updater]);

  const act = useCallback(
    (action: UpdateAction) => {
      switch (action) {
        case 'install':
        case 'retry-install':
          void install();
          return;
        case 'retry-check':
          void run(true);
          return;
        case 'later':
        case 'close':
          setStatus(UPDATE_IDLE);
          return;
      }
    },
    [install, run],
  );

  const setCheckOnStart = useCallback(
    (on: boolean) => {
      const next = { ...preferences, checkOnStart: on };
      setPreferences(next);
      void writeUpdatePreferences(storage, next);
    },
    [preferences, storage],
  );

  return {
    available: updater.available,
    status,
    view: updateDialog(status, currentVersion),
    busy: updateBusy(status),
    preferences,
    check: () => void run(true),
    act,
    setCheckOnStart,
  };
}

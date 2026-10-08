/**
 * What every screen of the phone app is handed: the ports (`platform.ts`), the library and the content sources, and the
 * screens' names and parameters. One object made once in `App`, so a screen never builds a port of its own.
 */

import { createContext, useContext } from 'react';

import type { FileSaver, GameSystem } from '@incudo/core';
import type { CharacterLibrary, ContentSources } from '@incudo/ui';

import type { MobileFilePicker, MobileShareInbox } from './platform.ts';
import type { createMobileZipCodec } from './zip.ts';

export type Screens = {
  Library: undefined;
  Sheet: { name: string; title: string };
  /** A library character to edit (`name`), or a new one of a system's kind. */
  Build: { name: string; title: string } | { systemId: string; kindId: string; title: string };
  NewCharacter: undefined;
  Content: undefined;
};

export interface Platform {
  library: CharacterLibrary;
  picker: MobileFilePicker;
  /** Files another app shares to this one or opens with it (ADR 0099). Only the app's own build receives any. */
  inbox: MobileShareInbox;
  /** Where "Export" can send a file: a folder the user picks, or the share sheet. */
  folderSaver: FileSaver;
  shareSaver: FileSaver;
  zip: ReturnType<typeof createMobileZipCodec>;
  systems: GameSystem[];
  /** The content a build loads (ADR 0086). Nothing else asks for it. */
  sources: ContentSources;
}

export const PlatformContext = createContext<Platform | null>(null);

export function usePlatform(): Platform {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error('No platform: App renders the screens inside its provider.');
  return platform;
}

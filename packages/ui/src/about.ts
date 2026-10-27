/**
 * What the About screen says, written once for every shell (ROADMAP Phase 9, ADR 0010).
 *
 * The support links are the same two the README's Support section and `.github/FUNDING.yml` list, and
 * `tools/verify/src/support-links.test.ts` holds all three to the same addresses, so a renamed page cannot leave the
 * app pointing at the old one.
 *
 * ADR 0010 says how they are worded, and that is why the words are here rather than in a pane: support pays for
 * development and unlocks nothing, and the links never sit on a screen that shows licensed material. A shell puts
 * this on a screen of its own settings (the desktop's Settings), never beside content, a character or a sheet.
 */

import type { GameSystem } from '@incudo/core';

export interface AboutLink {
  /** When, as a person chooses between them: "Every month", "Once". */
  label: string;
  /** The address as printed, with no scheme: "patreon.com/incudo". */
  text: string;
  url: string;
}

/** Where the code is. */
export const SOURCE_LINK: AboutLink = {
  label: 'Source code',
  text: 'github.com/WCH-Softworks/Incudo',
  url: 'https://github.com/WCH-Softworks/Incudo',
};

/** Recurring first, as the README lists them. */
export const SUPPORT_LINKS: readonly AboutLink[] = [
  { label: 'Every month', text: 'patreon.com/incudo', url: 'https://patreon.com/incudo' },
  { label: 'Once', text: 'ko-fi.com/willcaphir', url: 'https://ko-fi.com/willcaphir' },
];

/** Every address the About screen may open, which is what a shell's permission to open links is scoped to. */
export const ABOUT_URLS: readonly string[] = [SOURCE_LINK.url, ...SUPPORT_LINKS.map((link) => link.url)];

export const ABOUT_SUMMARY =
  'A character builder for tabletop games. Free and open source under the MIT licence. ' +
  'Incudo ships no rulebook content: what you build with comes from the content sources you add.';

export const SUPPORT_TEXT =
  'Incudo is free and will stay free. Support pays for its development and unlocks nothing: ' +
  'no feature, no content and no earlier build is ever kept for supporters.';

/** One shipped system's notice, as About prints it. */
export interface SystemAttribution {
  /** The system's name, as its card names it. */
  system: string;
  /** The notice its licence asks for, word for word from the definition's `licence.attribution`. */
  text: string;
}

export const SYSTEM_ATTRIBUTIONS_HEADING = 'Game systems';

export const SYSTEM_ATTRIBUTIONS_TEXT = 'The game systems that come with Incudo describe rules published under these licences.';

/**
 * The notice each shipped system's licence asks for (ADR 0010, docs/LICENSING.md). A system Incudo ships records its
 * licence in its definition, and the notice is shown as written there; `tools/verify/src/about-attributions.test.ts`
 * holds every shipped system to having one. Only shipped systems: a user's own system is theirs to attribute.
 */
export function systemAttributions(shipped: readonly Pick<GameSystem, 'name' | 'licence'>[]): SystemAttribution[] {
  return shipped.flatMap((system) => {
    const text = system.licence?.attribution?.trim();
    return text ? [{ system: system.name, text }] : [];
  });
}

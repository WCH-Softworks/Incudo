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

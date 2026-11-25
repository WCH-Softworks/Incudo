/**
 * The real-content suite in three parts by subject, one CI job each (`.github/workflows/ci.yml`, the `corpus` matrix).
 *
 * The suite is about six minutes of tests in one job on CI. Split three ways by what each file is about, each job runs
 * its own files in parallel and the run takes as long as the slowest part. Measured (every file timed on its own,
 * against a local checkout, the full suite): the content and the repository ~150 s, characters ~330 s, the sheet ~320 s,
 * of 800 s in all. A failure also says which subject it is in.
 *
 * Every `tools/verify` test file is in exactly one group, and `corpus-groups.test.ts` fails on one that is in none or in
 * two: a new test file is placed here by hand, by what it is about. Locally `npm test` still runs all of them at once.
 *
 * Run as a script, it prints the paths of one group's files for `node --test`:
 * `node --experimental-strip-types tools/verify/src/corpus-groups.ts <group>`.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CorpusGroup {
  readonly label: string;
  /** File names under `tools/verify/src/`, less `.test.ts`. */
  readonly files: readonly string[];
}

export const CORPUS_GROUPS = {
  content: {
    label: 'the content and the repository: loading, converting and reading the corpus, sources, system definitions, formats, and the checks on the repository itself',
    files: [
      'ability-names', 'about-attributions', 'appends-across-sources', 'aurora-constructs', 'ci-workflow',
      'content-browser', 'content-format', 'content-refresh', 'converted-source', 'converter-boundary', 'corpus',
      'corpus-groups', 'corpus-suite', 'desktop-dialogs', 'desktop-slide-focus', 'desktop-start', 'desktop-updater',
      'desktop-window', 'feature-library', 'forbidden-names', 'format-versions', 'hidden-items', 'homebrew-elements',
      'homebrew-source', 'index-walk', 'legendary-content', 'missing-content', 'mobile-build', 'mobile-release',
      'mobile-runtime', 'mobile-zip', 'negation-filter', 'no-local-clones', 'node-platform', 'node-zip', 'open-check',
      'optional-features', 'printings', 'private-saves', 'publications', 'received-files', 'release-check',
      'release-workflow', 'ritual-filter', 'sample-saves', 'schemas', 'source-parts', 'starting-equipment-content',
      'starting-equipment-prose', 'stop-dev-servers', 'support-links', 'switched-off-sources', 'system-guide',
      'system-loading', 'system-new', 'system-overlay', 'system-warnings', 'test-output', 'user-systems', 'workspace',
    ],
  },
  characters: {
    label: 'characters: the samples against Aurora, built and rebuilt, multiclassed, prepared, offered and equipped, and what a save of one holds',
    files: [
      'ability-score-set', 'additions', 'aurora-oracle', 'builder-rebuild', 'campaign-options', 'candidate-overlaps',
      'class-levels', 'class-options', 'decision-order', 'hit-dice', 'imported-sources', 'inventory-editor', 'kind-conversion',
      'inventory-editor-build', 'inventory-groups', 'library', 'listed-with-required', 'multiclass', 'multiclass-flag',
      'multiclass-hit-dice', 'multiclass-option', 'multiclass-split', 'npc-creatures', 'npc-races',
      'optional-feature-offer', 'optional-feature-step', 'own-requirements', 'pc-custom-features', 'phone-aurora-import',
      'pool-slots', 'preparation', 'prepared-counts', 'replaced-features', 'rogue-wizard', 'rogue-wizard-aurora',
      'save-copy', 'self-contained', 'single-class-track', 'soft-requirements', 'starting-equipment',
      'starting-equipment-build',
    ],
  },
  sheet: {
    label: 'the sheet and what it produces: its sections, the print, the PDF and the official form, exports, attacks, play, companions and descriptions',
    files: [
      'alignment-and-personality', 'armour-class', 'attacks', 'cantrip-attacks', 'companions', 'description-embeds',
      'description-pointers', 'freeform-fields', 'held-creatures', 'hidden-reasons', 'html-blocks', 'kind-sheets',
      'official-sheet', 'pc-references', 'pdf-sheet', 'phone-sheet', 'play-state', 'print-layout', 'print-options',
      'proficiency-marks', 'sheet-export', 'sheet-hints', 'sheet-revamp', 'spell-levels', 'stat-block-references',
      'whole-descriptions', 'wild-shape',
    ],
  },
} as const satisfies Record<string, CorpusGroup>;

export type CorpusGroupName = keyof typeof CORPUS_GROUPS;

/** The paths `node --test` is given for one group, relative to the repository root. */
export function corpusGroupPaths(name: string): string[] {
  const group = (CORPUS_GROUPS as Record<string, CorpusGroup>)[name];
  if (!group) throw new Error(`"${name}" is not a corpus group; the groups are ${Object.keys(CORPUS_GROUPS).join(', ')}.`);
  return group.files.map((file) => `tools/verify/src/${file}.test.ts`);
}

// Run as a script (not imported): `import.meta.main` is newer than some Node 22 releases CI may get.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const name = process.argv[2];
  if (!name) throw new Error(`Name a corpus group: ${Object.keys(CORPUS_GROUPS).join(', ')}.`);
  console.log(corpusGroupPaths(name).join('\n'));
}

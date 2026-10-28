/**
 * ADR 0119: an Aurora source converted into one Incudo content source.
 *
 * What the conversion must hold, each named by the perturbation that fails it: the result does not depend on the order
 * the network answers in (ADR 0051's prefetch), every address is asked for once, the parts tree is the walk's own
 * (first mention, failures, the depth limit), a file that cannot be fetched keeps the previous conversion's copy, and
 * what Aurora's app did at run time is written down as files of its own.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkContentBundle, type ContentBundle, type FetchResult, type Fetcher } from '@incudo/core';

import {
  APP_ELEMENTS_URL,
  CONVERTER_VERSION,
  IMPROVEMENT_OPTIONS_URL,
  convertAuroraFile,
  convertAuroraSource,
  type ConvertSourceOptions,
} from './convert-source.ts';

const index = (...files: string[]): string =>
  `<?xml version="1.0"?><index><info><name>Index</name><update version="1.0.0" /></info><files>${files
    .map((file) => `<file name="${file}" url="${file}" />`)
    .join('')}</files></index>`;
const elements = (ids: string[], extra = ''): string =>
  `<?xml version="1.0"?><elements>${ids
    .map((id) => `<element name="${id}" type="Widget" source="Test" id="${id}"><rules /></element>`)
    .join('')}${extra}</elements>`;

/** Three levels, with an id in two files, an append reaching another book, an index named twice, one failing, one too deep. */
const TREE: Record<string, string> = {
  'root.index': index('core.index', 'supplements.index', 'extra.index', 'root-a.xml', 'portrait.png'),
  'core.index': index('phb.index', 'dmg.index', 'core-a.xml'),
  'supplements.index': index('xge.index', 'phb.index', 'broken.index', 'supp-a.xml'),
  'extra.index': index('deep-1.index'),
  'deep-1.index': index('deep-2.index', 'deep-1.xml'),
  'deep-2.index': index('deep-2.xml'),
  'phb.index': index('phb-races.xml', 'phb-classes.xml'),
  'dmg.index': index('dmg-items.xml'),
  'xge.index': index('xge-races.xml', 'xge-appends.xml'),
  'root-a.xml': elements(['ID_ROOT']),
  'core-a.xml': elements(['ID_CORE', 'ID_TWICE']),
  'supp-a.xml': elements(['ID_SUPP']),
  'deep-1.xml': elements(['ID_DEEP_1']),
  'deep-2.xml': elements(['ID_DEEP_2']),
  'phb-races.xml': elements(['ID_ELF', 'ID_DWARF']),
  'phb-classes.xml': elements(['ID_WIZARD']),
  'dmg-items.xml': elements(['ID_SWORD', 'ID_TWICE']),
  'xge-races.xml': elements(['ID_GOBLIN', 'ID_TWICE']),
  'xge-appends.xml': elements([], '<append id="ID_WIZARD"><supports>Extended</supports></append>'),
};

interface Log {
  asked: string[];
  inFlight: number;
  maxIndexesInFlight: number;
  indexesInFlight: number;
}

function fetcher(files: Record<string, string>, delay: (url: string) => number = () => 0, failing: string[] = ['broken.index']): { fetcher: Fetcher; log: Log } {
  const log: Log = { asked: [], inFlight: 0, maxIndexesInFlight: 0, indexesInFlight: 0 };
  return {
    log,
    fetcher: {
      async fetchText(url: string): Promise<FetchResult> {
        log.asked.push(url);
        const isIndex = url.endsWith('.index');
        if (isIndex) log.indexesInFlight++, (log.maxIndexesInFlight = Math.max(log.maxIndexesInFlight, log.indexesInFlight));
        try {
          const ms = delay(url);
          if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
          if (failing.includes(url) || files[url] === undefined) throw new Error('HTTP 404');
          return { url, text: files[url]!, etag: `"${url}"` };
        } finally {
          if (isIndex) log.indexesInFlight--;
        }
      },
    },
  };
}

async function convert(options: Partial<ConvertSourceOptions> & { delay?: (url: string) => number } = {}) {
  const { fetcher: f, log } = fetcher(TREE, options.delay);
  const result = await convertAuroraSource({ fetcher: f, url: 'root.index', sourceId: 'memory://tree', maxDepth: 2, ...options });
  return { ...result, log };
}

const reversing = (url: string): number => 30 - (Object.keys(TREE).indexOf(url) % 10) * 3;

test('the conversion does not depend on the order the network answers in', async () => {
  // Perturbation: applying files or indexes in the order they arrive changes the elements' order or the tree.
  const sequential = await convert({ concurrency: 1 });
  const ahead = await convert({ concurrency: 6, delay: reversing });
  assert.deepEqual(ahead.bundle, sequential.bundle);
  assert.deepEqual(
    sequential.bundle.elements.filter((e) => !e.origin.fileUrl?.startsWith('incudo:')).map((e) => e.id),
    ['ID_ROOT', 'ID_CORE', 'ID_TWICE', 'ID_SUPP', 'ID_ELF', 'ID_DWARF', 'ID_WIZARD', 'ID_SWORD', 'ID_TWICE', 'ID_GOBLIN', 'ID_TWICE', 'ID_DEEP_1'],
  );
  assert.deepEqual(checkContentBundle(sequential.bundle).problems, [], 'it is Incudo content');
});

test('every address is asked for once, and what is too deep or not an elements file never', async () => {
  // Perturbation: dropping the "seen" check asks phb.index twice; dropping the depth limit asks deep-2.index.
  const { log } = await convert({ delay: reversing });
  assert.equal(new Set(log.asked).size, log.asked.length);
  assert.ok(!log.asked.includes('deep-2.index') && !log.asked.includes('portrait.png'));
});

test('indexes named by the same parent are asked for together', async () => {
  // Perturbation: awaiting each index before asking for the next keeps one in flight.
  const { log } = await convert({ delay: () => 5 });
  assert.ok(log.maxIndexesInFlight > 1, `${log.maxIndexesInFlight} in flight`);
});

test('the parts tree marks a repeat, a failure and what is too deep, and the rest is converted', async () => {
  const { bundle } = await convert();
  const parts = bundle.source!.parts!;
  const supplements = parts.children!.find((p) => p.url === 'supplements.index')!;
  assert.equal(supplements.children!.find((p) => p.url === 'phb.index')!.repeated, true);
  assert.match(supplements.children!.find((p) => p.url === 'broken.index')!.failed!, /404/);
  const deep = parts.children!.find((p) => p.url === 'extra.index')!.children![0]!.children!.find((p) => p.url === 'deep-2.index')!;
  assert.equal(deep.tooDeep, true);
  const messages = bundle.source!.diagnostics!.map((d) => d.message);
  assert.ok(messages.some((m) => m.startsWith('Could not load broken.index')));
  assert.ok(messages.some((m) => m.startsWith('Stopped at nesting depth 2')));
  assert.deepEqual(bundle.extensions, [{ id: 'ID_WIZARD', rules: [], supports: ['Extended'], fileUrl: 'xge-appends.xml' }]);
});

test("Aurora's app elements come first and its improvement options last, each a file of its own", async () => {
  const { bundle } = await convert();
  const files = bundle.source!.files!;
  assert.equal(files[0]!.url, APP_ELEMENTS_URL);
  assert.equal(files[0]!.generated, true);
  assert.equal(bundle.elements[0]!.origin.fileUrl, APP_ELEMENTS_URL);
  assert.ok(!files.some((f) => f.url === IMPROVEMENT_OPTIONS_URL), 'no class asks for one here, so there is none');
  assert.deepEqual(bundle.source!.converted, { from: 'aurora', converter: CONVERTER_VERSION });
  const bare = await convert({ withoutGenerated: true });
  assert.ok(!bare.bundle.elements.some((e) => e.origin.fileUrl === APP_ELEMENTS_URL));
});

test('a class that asks for an improvement option gets it, derived after the appends that may declare one', async () => {
  const select = (cls: string, level: number) =>
    `<select type="Class Feature" name="Improvement Option (${cls} ${level})" supports="Improvement Option,${cls},${level}" />`;
  const files: Record<string, string> = {
    'root.index': index('classes.xml'),
    'classes.xml': `<?xml version="1.0"?><elements><element name="Fighter" type="Class" source="Test" id="ID_FIGHTER"><rules>${select('Fighter', 4)}${select('Fighter', 6)}</rules></element>` +
      // An append carrying the tags that say the level 6 option is declared already: no option is made for it.
      `<element name="Own" type="Class Feature" source="Test" id="ID_OWN_OPTION"><rules /></element><append id="ID_OWN_OPTION"><supports>Improvement Option,Fighter,6</supports></append></elements>`,
  };
  const { bundle } = await convertAuroraSource({ fetcher: fetcher(files).fetcher, url: 'root.index', sourceId: 's' });
  const options = bundle.elements.filter((e) => e.origin.fileUrl === IMPROVEMENT_OPTIONS_URL).map((e) => e.id);
  // Perturbation: deriving before the appends makes the level 6 pair as well.
  assert.deepEqual(options.sort(), ['ID_INTERNAL_CLASS_FEATURE_ASI_4_FIGHTER', 'ID_INTERNAL_CLASS_FEATURE_FEAT_4_FIGHTER']);
  assert.equal(bundle.source!.files!.at(-1)!.url, IMPROVEMENT_OPTIONS_URL);
});

test('every address answered with an ETag is recorded, for an update check to ask with', async () => {
  const { bundle } = await convert();
  assert.equal(bundle.source!.etags!['phb-races.xml'], '"phb-races.xml"');
  assert.equal(bundle.source!.etags!['root.index'], '"root.index"');
});

test('a file that cannot be fetched keeps the previous conversion\'s copy, and the top index failing throws', async () => {
  const { bundle: previous } = await convert();
  const { fetcher: f } = fetcher(TREE, undefined, ['broken.index', 'phb-races.xml', 'dmg.index']);
  // Perturbation: not falling back loses ID_ELF and ID_SWORD, and the dmg index's tree.
  const { bundle, report } = await convertAuroraSource({ fetcher: f, url: 'root.index', sourceId: 'memory://tree', maxDepth: 2, previous });
  assert.deepEqual(report.kept.map((k) => k.url).sort(), ['dmg.index', 'phb-races.xml']);
  assert.deepEqual(stripEtags(bundle), stripEtags(previous));
  const { fetcher: down } = fetcher(TREE, undefined, Object.keys(TREE));
  await assert.rejects(convertAuroraSource({ fetcher: down, url: 'root.index', sourceId: 'x', previous: { formatVersion: 1, elements: [] } }), /Could not load root\.index/);
});

function stripEtags(bundle: ContentBundle): ContentBundle {
  return { ...bundle, source: { ...bundle.source!, etags: undefined } };
}

test('one file is converted into a source of its own, read the same with CRLF line endings', () => {
  const xml = `<?xml version="1.0"?>\n<elements>\n<info><name>Blades</name><update version="1.2.0" /></info>\n<element name="Sword" type="Magic Item" source="Homebrew" id="ID_SWORD">\n<description><p>A sword.</p>\n<p>Sharp.</p></description>\n</element>\n<append id="ID_ELSEWHERE"><supports>Homebrew</supports></append>\n</elements>\n`;
  const bundle = convertAuroraFile(xml, { url: 'local:blades.xml', name: 'blades.xml' });
  assert.equal(bundle.source!.name, 'Blades');
  assert.equal(bundle.source!.version, '1.2.0');
  assert.deepEqual(bundle.elements.map((e) => e.id), ['ID_SWORD']);
  assert.equal(bundle.extensions!.length, 1);
  assert.deepEqual(convertAuroraFile(xml.replace(/\n/g, '\r\n'), { url: 'local:blades.xml', name: 'blades.xml' }), bundle);
});

test('an index, or a file with no elements, is refused with a sentence', () => {
  assert.throws(() => convertAuroraFile(index('a.xml'), { url: 'local:pack.xml', name: 'pack.xml' }), /pack\.xml is an index/);
  assert.throws(() => convertAuroraFile('<?xml version="1.0"?><elements />', { url: 'local:none.xml', name: 'none.xml' }), /holds no Aurora elements/);
});

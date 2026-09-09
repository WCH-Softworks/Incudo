import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSETS_PREFIX,
  BundleElementIndex,
  CHARACTER_PATH,
  CONTENT_PATH,
  MANIFEST_PATH,
  collectCharacterContent,
  decodeText,
  packCharacterContainer,
  packContentBundle,
  readCharacterContainer,
  readContentBundle,
  type ContainerFiles,
  type ContainerManifest,
} from './container.ts';
import { createCharacter, setChoice, type Character } from './character.ts';
import { MapElementIndex, type Element, type Rule } from './model.ts';
import { parseRequirements } from './requirements.ts';
import { sha256Hex } from './sha256.ts';

function element(id: string, rules: Rule[] = []): Element {
  return {
    id,
    type: 'Widget',
    name: id,
    source: 'test',
    setters: {},
    rules,
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

/**
 * A corpus shaped like the thing that matters: a chosen element reaching a lot of other
 * elements, plus a large body of content the character never touches.
 */
function corpus(): MapElementIndex {
  const index = new MapElementIndex();
  index.addAll([
    element('CHOSEN', [
      { kind: 'grant', key: 'g1', type: 'Widget', id: 'GRANTED' },
      // Gated far beyond this character's progress — still embedded, see the note in
      // collectCharacterContent about state-independent closures.
      { kind: 'grant', key: 'g2', type: 'Widget', id: 'LATE', level: 17 },
      { kind: 'select', key: 's', type: 'Widget', name: 'Pick', number: 1, default: 'DEFAULTED' },
      {
        kind: 'stat',
        key: 'st',
        name: 'vigour',
        value: { kind: 'number', value: 1 },
        requirements: parseRequirements('ID_REQUIRED'),
      },
    ]),
    element('GRANTED', [{ kind: 'grant', key: 'g', type: 'Widget', id: 'NESTED' }]),
    element('NESTED'),
    element('LATE'),
    element('DEFAULTED'),
    element('ID_REQUIRED'),
    element('DANGLING_TARGET'),
  ]);
  for (let i = 0; i < 500; i++) index.add(element(`UNUSED_${i}`));
  return index;
}

function built(): Character {
  const character = createCharacter('test', 'pc', { name: 'Vigaro', progress: 3 });
  return setChoice(character, 'build/seed', ['CHOSEN']);
}

test('the embedded subset is the transitive closure, and nothing else', () => {
  const content = collectCharacterContent(built(), corpus());

  assert.deepEqual(content.elements.map((e) => e.id), [
    'CHOSEN',
    'DEFAULTED',
    'GRANTED',
    'ID_REQUIRED',
    'LATE',
    'NESTED',
  ]);
  assert.deepEqual(content.unresolved, []);

  // 6 out of 507. The point of ADR 0012 is the subset, not the corpus.
  assert.ok(content.elements.length < 10);
});

test('an id the character reaches but nothing defines is recorded, not dropped', () => {
  const index = corpus();
  const character = setChoice(built(), 'build/extra', ['NO_SUCH_ELEMENT']);
  const content = collectCharacterContent(character, index);

  assert.deepEqual(content.unresolved, ['NO_SUCH_ELEMENT']);
  assert.ok(!content.elements.some((e) => e.id === 'NO_SUCH_ELEMENT'));
});

test('the container is the tree ADR 0012 specifies', () => {
  const character = built();
  const files = packCharacterContainer(character, collectCharacterContent(character, corpus()), {
    assets: new Map([['assets/portrait.png', new Uint8Array([1, 2, 3])]]),
    generator: 'test',
  });

  assert.deepEqual(
    [...files.keys()].sort(),
    ['assets/portrait.png', CHARACTER_PATH, CONTENT_PATH, MANIFEST_PATH].sort(),
  );

  const manifest = JSON.parse(decodeText(files.get(MANIFEST_PATH)!)) as ContainerManifest;
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.kind, 'character');
  assert.equal(manifest.systemId, 'test');
  assert.equal(manifest.characterKind, 'pc');
  assert.equal(manifest.elementCount, 6);
  assert.deepEqual(manifest.assets, ['assets/portrait.png']);

  // The system definition is NOT embedded — it comes from the app (ADR 0012).
  assert.equal(JSON.stringify(files.get(MANIFEST_PATH)).includes('characterKinds'), false);
});

test('integrity covers every entry but the manifest, which cannot checksum itself', () => {
  const character = built();
  const files = packCharacterContainer(character, collectCharacterContent(character, corpus()), {
    assets: new Map([['assets/portrait.png', new Uint8Array([1, 2, 3])]]),
  });
  const manifest = JSON.parse(decodeText(files.get(MANIFEST_PATH)!)) as ContainerManifest;

  assert.deepEqual(Object.keys(manifest.integrity!).sort(), [
    'assets/portrait.png',
    CHARACTER_PATH,
    CONTENT_PATH,
  ]);
  assert.equal(
    manifest.integrity![CHARACTER_PATH],
    `sha256-${sha256Hex(files.get(CHARACTER_PATH)!)}`,
  );
  assert.equal(manifest.integrity![MANIFEST_PATH], undefined);
});

test('packing the same character twice produces the same bytes', () => {
  const character = built();
  const content = collectCharacterContent(character, corpus());
  const a = packCharacterContainer(character, content, { now: '2026-01-01T00:00:00.000Z' });
  const b = packCharacterContainer(character, content, { now: '2026-01-01T00:00:00.000Z' });

  for (const [path, bytes] of a) {
    assert.deepEqual([...bytes], [...b.get(path)!], `${path} is not reproducible`);
  }
});

test('a container round-trips', () => {
  const character = built();
  character.rolls = { 'hp:level:2': 7, 'hp:level:3': 4 };
  character.freeform = { notes: 'Owes money to the Zhentarim.' };
  character.assets = { portrait: 'assets/portrait.png' };

  const files = packCharacterContainer(character, collectCharacterContent(character, corpus()), {
    assets: new Map([[`${ASSETS_PREFIX}portrait.png`, new Uint8Array([137, 80, 78, 71])]]),
  });

  const { container, problems } = readCharacterContainer(files);
  assert.deepEqual(problems, []);
  assert.ok(container);
  assert.deepEqual(container.character, character);
  assert.equal(container.content.elements.length, 6);
  assert.deepEqual([...container.assets.get('assets/portrait.png')!], [137, 80, 78, 71]);
});

test('rolls survive the round trip, because they are inputs', () => {
  const character = { ...built(), rolls: { 'hp:level:2': 7 } };
  const files = packCharacterContainer(character, collectCharacterContent(character, corpus()));
  const { container } = readCharacterContainer(files);
  // A die roll has no formula. If this ever regresses, every character's hit points
  // silently change on load — see ADR 0007.
  assert.deepEqual(container!.character.rolls, { 'hp:level:2': 7 });
});

test('a missing required entry is an error and yields no container', () => {
  const character = built();
  const files = packCharacterContainer(character, collectCharacterContent(character, corpus()));
  files.delete(CONTENT_PATH);

  const { container, problems } = readCharacterContainer(files);
  assert.equal(container, undefined);
  assert.equal(problems[0]?.level, 'error');
  assert.match(problems[0]!.message, /missing/);
});

test('a tampered entry warns but still opens', () => {
  const character = built();
  const files = packCharacterContainer(character, collectCharacterContent(character, corpus()));
  files.set(CHARACTER_PATH, new TextEncoder().encode(JSON.stringify({ ...character, name: 'Edited' })));

  const { container, problems } = readCharacterContainer(files);
  // Refusing to open a save because a byte moved would be choosing the checksum over the
  // character. Warn, and show what was edited.
  assert.ok(container);
  assert.equal(container.character.name, 'Edited');
  assert.equal(problems.length, 1);
  assert.equal(problems[0]!.level, 'warning');
  assert.equal(problems[0]!.path, CHARACTER_PATH);
});

test('a referenced asset that is not in the container warns and keeps its reference', () => {
  const character = { ...built(), assets: { portrait: 'assets/gone.png' } };
  const files = packCharacterContainer(character, collectCharacterContent(character, corpus()));

  const { container, problems } = readCharacterContainer(files);
  assert.equal(container!.character.assets!['portrait'], 'assets/gone.png');
  assert.equal(problems[0]!.level, 'warning');
  assert.match(problems[0]!.message, /placeholder/);
});

test('a content bundle is refused where a character is expected', () => {
  const files: ContainerFiles = packContentBundle([element('A')], { name: 'Bundle' });
  files.set(CHARACTER_PATH, new TextEncoder().encode('{}'));

  const { container, problems } = readCharacterContainer(files);
  assert.equal(container, undefined);
  assert.match(problems.map((p) => p.message).join(' '), /not a character/);
});

test('a .incuset is the same container with the character left out', () => {
  const files = packContentBundle([element('A'), element('B')], {
    name: 'Fixture Content',
    sources: [{ id: 'https://example.invalid/core.index', version: '1.2.3' }],
    now: '2026-01-01T00:00:00.000Z',
  });

  assert.deepEqual([...files.keys()].sort(), [CONTENT_PATH, MANIFEST_PATH]);
  assert.equal(files.has(CHARACTER_PATH), false);

  const { manifest, bundle, problems } = readContentBundle(files);
  assert.deepEqual(problems, []);
  assert.equal(manifest!.kind, 'content');
  assert.equal(manifest!.name, 'Fixture Content');
  assert.equal(manifest!.sources![0]!.version, '1.2.3');
  assert.deepEqual(bundle!.elements.map((e) => e.id), ['A', 'B']);
});

test('a character is refused where a content bundle is expected, and vice versa', () => {
  const character = built();
  const asCharacter = packCharacterContainer(character, collectCharacterContent(character, corpus()));
  assert.match(
    readContentBundle(asCharacter).problems.map((p) => p.message).join(' '),
    /not a content bundle/,
  );
});

test('a bundle index answers the same questions as the corpus index', () => {
  const character = built();
  const content = collectCharacterContent(character, corpus());
  const index = new BundleElementIndex(content.elements);

  assert.equal(index.size, 6);
  assert.equal(index.get('GRANTED')?.name, 'GRANTED');
  assert.equal(index.get('UNUSED_1'), undefined);
  assert.equal(index.byType('Widget').length, 6);
});

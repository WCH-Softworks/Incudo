import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clampProgress,
  collectDeclaredBlocks,
  defaultCharacterKindId,
  renderSheetSection,
  sheetSectionIsEmpty,
  substituteBlockPlaceholders,
  initialProgress,
  progressionStat,
  resolveCharacterKind,
  orderBuildSteps,
  buildStepCycles,
  trackDie,
  trackProgress,
  sheetGroup,
  compareSheetGroups,
  type BuildStepDef,
  type GameSystem,
} from './system.ts';
import { declaredBlocks, type Element } from './model.ts';

/**
 * A fixture with no game in it. The point of ADR 0009 is that the engine cannot name a
 * kind, so the test does not name a real one either — "alpha" and "beta" would work just
 * as well as "pc" and "npc", which is the whole claim.
 */
function fixture(overrides: Partial<GameSystem> = {}): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Widget' }, { name: 'Gadget' }, { name: 'Doohickey' }],
    stats: [
      { name: 'vigour', default: 10 },
      { name: 'grit', default: 1 },
    ],
    characterKinds: [
      {
        id: 'alpha',
        name: 'Alpha',
        default: true,
        progression: { kind: 'level', min: 1, max: 5 },
        elementTypes: ['Widget', 'Gadget'],
        buildSteps: [{ id: 'one', label: 'One', types: ['Widget'] }],
        sheet: { sections: [{ id: 's', label: 'S', stats: ['vigour'] }] },
      },
      {
        id: 'beta',
        name: 'Beta',
        progression: { kind: 'rating', stat: 'threat', min: 0, max: 30 },
        elementTypes: ['Gadget'],
        stats: [{ name: 'threat', default: 0 }, { name: 'grit', default: 99 }],
        buildSteps: [{ id: 'two', label: 'Two', types: ['Gadget'] }],
        sheet: { sections: [{ id: 't', label: 'T', stats: ['threat'] }] },
      },
      {
        id: 'gamma',
        name: 'Gamma',
        extends: 'beta',
        elementTypes: ['+Doohickey', '-Gadget'],
      },
    ],
    ...overrides,
  };
}

test('the default kind is the one marked default, then the first', () => {
  assert.equal(defaultCharacterKindId(fixture()), 'alpha');

  const unmarked = fixture();
  delete unmarked.characterKinds[0]!.default;
  assert.equal(defaultCharacterKindId(unmarked), 'alpha');
});

test('a kind inherits the system stats and may replace one by name', () => {
  const alpha = resolveCharacterKind(fixture(), 'alpha');
  assert.deepEqual(
    alpha.stats.map((s) => s.name),
    ['vigour', 'grit'],
  );

  // "grit" is declared by both. The kind's wins, and it does not appear twice — a kind
  // that could only append could never override an inherited derivation.
  const beta = resolveCharacterKind(fixture(), 'beta');
  assert.deepEqual(
    beta.stats.map((s) => s.name),
    ['vigour', 'grit', 'threat'],
  );
  assert.equal(beta.stats.find((s) => s.name === 'grit')?.default, 99);
});

test('extends is a delta, not a copy', () => {
  const gamma = resolveCharacterKind(fixture(), 'gamma');

  // Inherited wholesale from beta:
  assert.deepEqual(gamma.progression, { kind: 'rating', stat: 'threat', min: 0, max: 30 });
  assert.deepEqual(
    gamma.buildSteps.map((s) => s.id),
    ['two'],
  );
  assert.equal(gamma.stats.find((s) => s.name === 'threat')?.default, 0);

  // Patched: "+" adds, "-" removes, and the parent's list is the starting point.
  assert.deepEqual(gamma.elementTypes, ['Doohickey']);

  // Its own identity survives the merge.
  assert.equal(gamma.id, 'gamma');
  assert.equal(gamma.name, 'Gamma');
});

test('an element type list with no prefix replaces rather than patches', () => {
  const system = fixture();
  system.characterKinds[2]!.elementTypes = ['Widget'];
  assert.deepEqual(resolveCharacterKind(system, 'gamma').elementTypes, ['Widget']);
});

test('a broken extends chain is refused, not half-applied', () => {
  const missing = fixture();
  missing.characterKinds[2]!.extends = 'nope';
  assert.throws(() => resolveCharacterKind(missing, 'gamma'), /does not declare/);

  const cyclic = fixture();
  cyclic.characterKinds[1]!.extends = 'gamma';
  assert.throws(() => resolveCharacterKind(cyclic, 'gamma'), /extends itself/);

  assert.throws(() => resolveCharacterKind(fixture(), 'delta'), /no character kind "delta"/);
});

test('progression: level publishes "level" unless told otherwise', () => {
  assert.equal(progressionStat({ kind: 'level', min: 1, max: 20 }), 'level');
  assert.equal(progressionStat({ kind: 'level', min: 1, max: 20, stat: 'tier' }), 'tier');
  assert.equal(progressionStat({ kind: 'rating', stat: 'challenge' }), 'challenge');
  assert.equal(progressionStat({ kind: 'xp', stat: 'experience' }), 'experience');
  assert.equal(progressionStat({ kind: 'none' }), undefined);
});

test('progression bounds', () => {
  const level = { kind: 'level', min: 1, max: 20 } as const;
  assert.equal(initialProgress(level), 1);
  assert.equal(clampProgress(level, 0), 1);
  assert.equal(clampProgress(level, 99), 20);
  assert.equal(clampProgress(level, 7), 7);

  // An unbounded rating stays whatever it is told; fractional CRs are ordinary numbers.
  const rating = { kind: 'rating', stat: 'challenge' } as const;
  assert.equal(initialProgress(rating), 0);
  assert.equal(clampProgress(rating, 0.25), 0.25);

  // "none" has nowhere to move to, and says so rather than pretending to be level 1.
  assert.equal(initialProgress({ kind: 'none' }), 0);
  assert.equal(clampProgress({ kind: 'none' }, 12), 0);
});

// --- build step order (ADR 0017) --------------------------------------------

function steps(...defs: BuildStepDef[]): BuildStepDef[] {
  return defs;
}

function step(id: string, requires?: string[]): BuildStepDef {
  return { id, label: id, types: [], ...(requires ? { requires } : {}) };
}

test('a step that requires nothing sorts first, and declared order breaks ties', () => {
  const ordered = orderBuildSteps(
    steps(step('race'), step('class'), step('abilities'), step('spells', ['class'])),
  );
  assert.deepEqual(ordered.map((s) => s.id), ['race', 'class', 'abilities', 'spells']);
});

test('a dependency moves a step later however early it was declared', () => {
  const ordered = orderBuildSteps(steps(step('spells', ['class']), step('class')));
  assert.deepEqual(ordered.map((s) => s.id), ['class', 'spells']);
});

test('order is derived from dependencies, not from a number, so a chain resolves', () => {
  const ordered = orderBuildSteps(
    steps(step('c', ['b']), step('b', ['a']), step('a')),
  );
  assert.deepEqual(ordered.map((s) => s.id), ['a', 'b', 'c']);
});

test('a step in a cycle is placed last rather than dropped, and reported', () => {
  const defs = steps(step('a', ['b']), step('b', ['a']), step('free'));
  // Losing a screen silently is a worse failure than showing it in an odd place.
  assert.deepEqual(orderBuildSteps(defs).map((s) => s.id), ['free', 'a', 'b']);
  assert.deepEqual(buildStepCycles(defs), ['a', 'b']);
});

test('a requirement naming no step is ignored by the sort and left to validation', () => {
  const ordered = orderBuildSteps(steps(step('a', ['nonexistent']), step('b')));
  assert.deepEqual(ordered.map((s) => s.id), ['a', 'b']);
  assert.deepEqual(buildStepCycles(ordered), []);
});

test('a well-formed system has no cycles', () => {
  assert.deepEqual(buildStepCycles(steps(step('a'), step('b', ['a']))), []);
});

// --- declared blocks (ADR 0020) --------------------------------------------

function withBlocks(id: string, blocks: Element['spellcasting']): Element {
  return {
    id,
    type: 'Widget',
    name: id,
    source: 'Test',
    setters: {},
    rules: [],
    supports: [],
    spellcasting: blocks,
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

test('a block is a name and some attributes, and a nameless one declares nothing', () => {
  const element = withBlocks('ID_A', [
    { name: 'Runesmith', ability: 'Grit' },
    { name: '', all: true },
  ]);
  assert.deepEqual(declaredBlocks(element), [
    { name: 'Runesmith', attributes: { ability: 'Grit' } },
  ]);
});

test('two declarations of one block name are one block, first attribute winning', () => {
  // The corpus's shape: one declaration carries the ability, and the continuations that
  // extend it carry none. Contributing per declaration would double every number.
  const blocks = collectDeclaredBlocks([
    withBlocks('ID_A', [{ name: 'Runesmith', extend: 'true' }]),
    withBlocks('ID_B', [{ name: 'Runesmith', ability: 'Grit' }]),
  ]);
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], { name: 'Runesmith', attributes: { extend: 'true', ability: 'Grit' } });
});

test('substitution reaches the block name and its attributes, and fails loudly', () => {
  const block = { name: 'Runesmith', attributes: { ability: 'Grit' } };
  assert.equal(substituteBlockPlaceholders('{name}:threshold', block), 'runesmith:threshold');
  assert.equal(substituteBlockPlaceholders('{ability}:modifier', block), 'grit:modifier');
  assert.equal(substituteBlockPlaceholders('plain', block), 'plain');
  // Not "", and not a guess: a key nothing declares would read 0 and publish a wrong number.
  assert.equal(substituteBlockPlaceholders('{focus}:modifier', block), undefined);
});

/** A sheet reader over a plain map of stats and a list of held elements. */
function reader(stats: Record<string, number> = {}, elements: Element[] = []) {
  return { statValue: (key: string) => stats[key.toLowerCase()], elements };
}

test('a perBlock section renders once per block, and skips one it cannot fill', () => {
  const section = { id: 'casting', label: 'Casting', perBlock: true, stats: ['{name}:{ability}'] };
  const rendered = renderSheetSection(
    section,
    [
      { name: 'Runesmith', attributes: { ability: 'Grit' } },
      { name: 'Silent', attributes: {} },
    ],
    reader(),
  );
  assert.deepEqual(rendered, [
    {
      id: 'casting:runesmith',
      label: 'Casting — Runesmith',
      stats: ['runesmith:grit'],
      entries: ['{name}:{ability}'],
      types: [],
      blockName: 'Runesmith',
      printed: [],
    },
  ]);
});

test('an ordinary section renders itself, blocks or no blocks', () => {
  const section = { id: 's', label: 'S', stats: ['vigour'], types: ['Widget'] };
  assert.deepEqual(renderSheetSection(section, [{ name: 'Runesmith', attributes: {} }], reader()), [
    { id: 's', label: 'S', stats: ['vigour'], entries: ['vigour'], types: ['Widget'], printed: [] },
  ]);
});

// ADR 0062. Fails if `showWhen` is ignored (every row comes back), if `{stat}` is not substituted (the
// key read is the literal "{stat}:knack" and every row is dropped), or if a stat nothing publishes is
// shown (it reads undefined, which is not a value).
test('showWhen leaves out a row whose named stat reads zero or nothing, with {stat} standing for the row', () => {
  const stats = { lift: 5, glide: 0, 'crawl:knack': 2, 'hop:knack': 0 };
  const plain = { id: 'moves', label: 'Moves', stats: ['lift', 'glide', 'burrow'], showWhen: '{stat}' };
  assert.deepEqual(renderSheetSection(plain, [], reader(stats))[0]!.stats, ['lift']);
  const knacks = { id: 'knacks', label: 'Knacks', stats: ['crawl', 'hop', 'swing'], showWhen: '{stat}:knack' };
  assert.deepEqual(renderSheetSection(knacks, [], reader(stats))[0]!.stats, ['crawl']);
  const all = { id: 'all', label: 'All', stats: ['lift', 'glide'] };
  assert.deepEqual(renderSheetSection(all, [], reader(stats))[0]!.stats, ['lift', 'glide'], 'no showWhen shows every row');
});

// Fails if the block's own placeholders are not substituted into `showWhen` (the key read is the literal
// "runesmith:dc:{ability}" and every row is dropped).
test('showWhen in a perBlock section reads the key with the row and the block substituted', () => {
  const section = { id: 'c', label: 'C', perBlock: true, stats: ['{name}:dc', '{name}:echo'], showWhen: '{stat}:{ability}' };
  const block = { name: 'Runesmith', attributes: { ability: 'Grit' } };
  const rendered = renderSheetSection(section, [block], reader({ 'runesmith:dc:grit': 13 }));
  assert.deepEqual(rendered[0]!.stats, ['runesmith:dc']);
});

// ADR 0074. Fails if `beside` is not published (a score reads without its modifier), if `{stat}` is not substituted
// (every row reads the literal "{stat}:mod"), if it is not kept aligned with the rows `showWhen` leaves (the second
// row reads the first dropped row's), or if `entries` loses its alignment the same way.
test('beside names a stat per row, with {stat} for the row, aligned with the rows showWhen keeps', () => {
  const section = { id: 'a', label: 'A', stats: ['grit', 'wile', 'nerve'], beside: '{stat}:mod', showWhen: '{stat}' };
  const [rendered] = renderSheetSection(section, [], reader({ grit: 14, wile: 0, nerve: 9 }));
  assert.deepEqual(rendered!.stats, ['grit', 'nerve']);
  assert.deepEqual(rendered!.entries, ['grit', 'nerve']);
  assert.deepEqual(rendered!.beside, ['grit:mod', 'nerve:mod']);
  const plain = renderSheetSection({ id: 'p', label: 'P', stats: ['grit'] }, [], reader({ grit: 14 }))[0]!;
  assert.equal(plain.beside, undefined, 'no beside declared, none published');
});

// ADR 0079. Fails if `mark` is not published, if `{stat}` is not substituted, or if it is not kept aligned with the rows
// `showWhen` keeps (the second row reads the dropped row's mark stat).
test('mark names a stat per row, with {stat} for the row, aligned with the rows showWhen keeps', () => {
  const mark = { stat: '{stat}:knack', per: 'knack', labels: ['handy'] };
  const [rendered] = renderSheetSection({ id: 'm', label: 'M', stats: ['grit', 'wile', 'nerve'], showWhen: '{stat}', mark }, [], reader({ grit: 14, wile: 0, nerve: 9 }));
  assert.deepEqual(rendered!.mark, ['grit:knack', 'nerve:knack']);
  const [block] = renderSheetSection({ id: 'b', label: 'B', perBlock: true, stats: ['{name}:dc'], mark: { ...mark, stat: '{stat}:{ability}' } }, [{ name: 'Runesmith', attributes: { ability: 'Grit' } }], reader());
  assert.deepEqual(block!.mark, ['runesmith:dc:grit']);
  assert.equal(renderSheetSection({ id: 'p', label: 'P', stats: ['grit'] }, [], reader({ grit: 14 }))[0]!.mark, undefined);
});

// Fails if a perBlock section's `beside` does not resolve the block's placeholders, or if `entries` names the
// substituted key rather than the pattern the row came from (a label is looked up by the pattern).
test('beside and entries in a perBlock section resolve the block and keep the pattern', () => {
  const section = { id: 'c', label: 'C', perBlock: true, stats: ['{name}:dc'], beside: '{stat}:{ability}' };
  const [rendered] = renderSheetSection(section, [{ name: 'Runesmith', attributes: { ability: 'Grit' } }], reader());
  assert.deepEqual(rendered!.stats, ['runesmith:dc']);
  assert.deepEqual(rendered!.entries, ['{name}:dc']);
  assert.deepEqual(rendered!.beside, ['runesmith:dc:grit']);
});

// ADR 0062. Fails if printed lines stop reading the held elements (none come back), if the setter is
// matched by exact case (the camel-cased one is lost), if an empty setter is printed, or if the element's
// type is not checked (the scenery's senses appear).
test("printed lines are a held element's setter text as written, per declared entry, ignoring case", () => {
  const held = (id: string, type: string, setters: Record<string, string>): Element =>
    ({
      id,
      type,
      name: id,
      setters: Object.fromEntries(Object.entries(setters).map(([name, value]) => [name, { value }])),
      rules: [],
    }) as unknown as Element;
  const elements = [
    held('ID_OWL', 'Beast', { senses: 'Darkvision 120 ft.; Passive Perception 15', conditionImmunities: 'Charmed', tongue: ' ' }),
    held('ID_ROCK', 'Scenery', { senses: 'none at all' }),
  ];
  const section = {
    id: 'said',
    label: 'Said',
    description: 'As printed.',
    printed: [
      { types: ['Beast'], setter: 'senses', label: 'Senses' },
      { types: ['Beast'], setter: 'conditionimmunities', label: 'Condition Immunities' },
      { types: ['Beast'], setter: 'tongue', label: 'Languages' },
    ],
  };
  const [rendering] = renderSheetSection(section, [], reader({}, elements));
  assert.deepEqual(rendering!.printed, [
    { label: 'Senses', text: 'Darkvision 120 ft.; Passive Perception 15', elementId: 'ID_OWL' },
    { label: 'Condition Immunities', text: 'Charmed', elementId: 'ID_OWL' },
  ]);
  assert.equal(rendering!.description, 'As printed.');
  assert.equal(sheetSectionIsEmpty(rendering!, elements), false);
});

test('a section is empty when it has no row, no listed element and no printed line', () => {
  const section = { id: 'moves', label: 'Moves', stats: ['glide'], showWhen: '{stat}', types: ['Knack'] };
  const [rendering] = renderSheetSection(section, [], reader({ glide: 0 }));
  assert.equal(sheetSectionIsEmpty(rendering!, []), true);
  const knack = { id: 'K', type: 'Knack', name: 'K', setters: {}, rules: [] } as unknown as Element;
  assert.equal(sheetSectionIsEmpty(rendering!, [knack]), false, 'a listed element is something to show');
});

test('the repeatable setter is inherited down an extends chain, and a child may replace it', () => {
  const system = fixture();
  system.characterKinds[1]!.repeatableSetter = 'again';
  assert.equal(resolveCharacterKind(system, 'alpha').repeatableSetter, undefined, 'none unless named');
  assert.equal(resolveCharacterKind(system, 'beta').repeatableSetter, 'again');
  assert.equal(resolveCharacterKind(system, 'gamma').repeatableSetter, 'again', 'inherited');

  system.characterKinds[2]!.repeatableSetter = 'twice';
  assert.equal(resolveCharacterKind(system, 'gamma').repeatableSetter, 'twice', 'replaced');
});

test('candidate notes are inherited down an extends chain, and a child may replace them', () => {
  const system = fixture();
  const note = { types: ['Widget'], setter: 'tier', label: 'Tier {value}' };
  system.characterKinds[1]!.candidateNotes = [note];
  assert.deepEqual(resolveCharacterKind(system, 'alpha').candidateNotes, [], 'none unless declared');
  assert.deepEqual(resolveCharacterKind(system, 'beta').candidateNotes, [note]);
  assert.deepEqual(resolveCharacterKind(system, 'gamma').candidateNotes, [note], 'inherited');

  system.characterKinds[2]!.candidateNotes = [];
  assert.deepEqual(resolveCharacterKind(system, 'gamma').candidateNotes, [], 'replaced, not merged');
});

// ADR 0079. Fails if the count is read from a stat the element did not contribute (a stat that merely shares the name
// reads 9), if the stat is looked up other than as `trackStatKey` names the track (the padded " Tinker " reads none), or
// if a progression with no `trackStatPattern` reads one.
test("a track's count is the stat its pattern names, and only when the track's root contributed it", () => {
  const progression = { kind: 'level' as const, min: 1, max: 20, trackStatPattern: 'rank:{name}' };
  const stats = new Map([
    ['rank:tinker', { value: 3, contributions: [{ value: 3, from: 'TINKER' }] }],
    ['rank:juggler', { value: 9, contributions: [{ value: 9, from: 'SOMETHING_ELSE' }] }],
  ]);
  assert.equal(trackProgress(progression, { id: 'TINKER', name: ' Tinker ' }, stats), 3);
  assert.equal(trackProgress(progression, { id: 'JUGGLER', name: 'Juggler' }, stats), undefined);
  assert.equal(trackProgress(progression, { id: 'NOBODY', name: 'Nobody' }, stats), undefined);
  assert.equal(trackProgress({ kind: 'level', min: 1, max: 20 }, { id: 'TINKER', name: 'Tinker' }, stats), undefined);
  assert.equal(trackProgress({ kind: 'none' }, { id: 'TINKER', name: 'Tinker' }, stats), undefined);
});

// ADR 0079. Fails if an exact label is not tried before the template (level 0 reads "Level 0"), if the setter is matched
// by case (the " Level " setter reads none), if a blank value makes a group, or if groups compare as text (10 before 2)
// or put an element in no group first.
test("a listed element's group is its setter's value, named, and groups order as numbers", () => {
  const def = { setter: 'level', label: 'Level {value}', labels: { '0': 'Cantrip' } };
  const setters = (value: string, name = 'level') => ({ setters: { [name]: { value } } });
  assert.deepEqual(sheetGroup(setters(' 3 '), def), { value: '3', label: 'Level 3' });
  assert.deepEqual(sheetGroup(setters('0'), def), { value: '0', label: 'Cantrip' });
  assert.deepEqual(sheetGroup(setters('2', ' Level '), def), { value: '2', label: 'Level 2' });
  assert.equal(sheetGroup(setters('  '), def), undefined);
  assert.equal(sheetGroup({ setters: {} }, def), undefined);
  const g = (value: string) => ({ value, label: value });
  assert.ok(compareSheetGroups(g('2'), g('10')) < 0);
  assert.ok(compareSheetGroups(g('b'), g('a')) > 0);
  assert.ok(compareSheetGroups(g('9'), undefined) < 0);
  assert.ok(compareSheetGroups(undefined, g('0')) > 0);
  assert.equal(compareSheetGroups(undefined, undefined), 0);
});

// ADR 0079. Fails if the setter is matched by case (`HD` reads none), if a value that is not a die reads as one (`10`,
// `2d6`, `d`), or if a missing setter reads 0 rather than none.
test("a track's die is the face count of the dN its setter names, and nothing else", () => {
  const with_ = (value: string) => ({ setters: { HD: { value } } });
  assert.equal(trackDie(with_('d10'), 'hd'), 10);
  assert.equal(trackDie(with_(' D6 '), ' hd '), 6);
  for (const value of ['10', '2d6', 'd', '', 'd0']) assert.equal(trackDie(with_(value), 'hd'), undefined, value);
  assert.equal(trackDie({ setters: {} }, 'hd'), undefined);
});

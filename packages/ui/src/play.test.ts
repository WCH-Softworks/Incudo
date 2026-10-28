/**
 * Playing a character: what the view keeps track of, and what each edit records — ADR 0084.
 *
 * No game in the fixture: a kind declares a stamina stat with a temporary amount, a section of charge rows drawn once per
 * block (one block's charges come back on a nap), the dice a section writes beside a track, the uses a section lists, a
 * fixed counter, and two rests, the long one including the nap. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, type Character, type PlayDef, type ResolvedCharacterKind, type ResolvedStat } from '@incudo/core';

import { adjustPlay, playPlaces, playView, readUsage, restPlay, setPlayCondition, setPlaySpent, setPlayTemporary, type PlaySource, type PlayView } from './play.ts';
import type { SheetListedElement, SheetSectionView } from './sheet.ts';

const PLAY: PlayDef = {
  rests: [
    { id: 'nap', label: 'Nap', usage: ['{count}/Nap'] },
    { id: 'sleep', label: 'Sleep', includes: ['nap'], usage: ['{count}/Sleep', '{count} per day'] },
  ],
  trackers: [
    { id: 'stamina', stat: 'stamina', temporary: 'Spare Stamina', restores: [{ rest: 'sleep' }] },
    { id: 'tracks', dice: 'identity', label: 'Track Dice', restores: [{ rest: 'sleep', fraction: 0.5, minimum: 1 }] },
    { id: 'charges', rows: 'charges', restores: [{ rest: 'sleep' }], restoresWhen: { stat: '{name}:quick', restores: [{ rest: 'nap' }] } },
    { id: 'uses', uses: ['features'], label: 'Limited Uses' },
    { id: 'woe', label: 'Woe', max: 6, counts: true, restores: [{ rest: 'sleep', amount: 1 }] },
    { id: 'absent', stat: 'nothing' },
  ],
  conditions: { names: ['Dazed', 'Soaked'] },
};

const KIND = { id: 'hero', name: 'Hero', stats: [{ name: 'stamina', label: 'Stamina' }], play: PLAY } as unknown as ResolvedCharacterKind;

const stats = (values: Record<string, number>): Map<string, ResolvedStat> =>
  new Map(Object.entries(values).map(([name, value]) => [name, { name, value, contributions: [] }]));

const listed = (elementId: string, extra: Partial<SheetListedElement>): SheetListedElement => ({ elementId, name: elementId, ...extra });
const section = (id: string, extra: Partial<SheetSectionView>): SheetSectionView => ({ id, label: id, section: id, rows: [], printed: [], elements: [], ...extra });

const SECTIONS: SheetSectionView[] = [
  section('identity', {
    elements: [listed('BRAWLER', { progress: 3, dice: { count: 3, sides: 10 } }), listed('SAGE', { progress: 2, dice: { count: 2, sides: 6 } })],
  }),
  section('charges:slow', { section: 'charges', block: 'Slow', label: 'Charges — Slow', rows: [{ stat: 'slow:charge:1', label: 'Small Charges', value: '4' }, { stat: 'slow:charge:2', label: 'Big Charges', value: '0' }] }),
  section('charges:quick', { section: 'charges', block: 'Quick', label: 'Charges — Quick', rows: [{ stat: 'quick:charge:1', label: 'Small Charges', value: '2' }] }),
  section('features', {
    elements: [
      listed('FURY', { usage: '3/Sleep' }),
      listed('SURGE', { sheetName: 'Surge', usage: '1/nap' }),
      listed('DAILY', { usage: '2 per day' }),
      listed('TURNLY', { usage: '1/Turn' }),
      listed('POOL', { usage: 'Charges' }),
      listed('UNFILLED', { usage: '—/Sleep' }),
    ],
  }),
];

const STATS = stats({ stamina: 30, 'slow:charge:1': 4, 'slow:charge:2': 0, 'quick:charge:1': 2, 'quick:quick': 1 });

function source(character: Character): PlaySource {
  return { character, kind: KIND, derived: { stats: STATS }, sheet: { sections: SECTIONS } };
}

const fresh = (): Character => createCharacter('test', 'hero', { name: 'Tester', progress: 5 });
const view = (character: Character): PlayView => playView(source(character))!;
const tracker = (character: Character, key: string) => view(character).groups.flatMap((g) => g.trackers).find((t) => t.key === key);

test('a kind with no play has nothing to play', () => {
  // Fails if a missing declaration reads as an empty view (a phone would show a Play screen with nothing on it).
  assert.equal(playView({ ...source(fresh()), kind: { ...KIND, play: undefined } }), undefined);
});

test('every maximum is read from the sheet and the stats, and nothing the sheet does not show is tracked', () => {
  // Fails if a row the section shows at zero is tracked (Big Charges), a stat nothing publishes is (absent), a usage that
  // is not a count per rest is ("1/Turn", "Charges", an unfilled "—/Sleep"), or the per-block section is read once.
  const v = view(fresh());
  assert.deepEqual(
    v.groups.map((g) => [g.label, g.trackers.map((t) => `${t.label} ${t.value}/${t.max}`)]),
    [
      ['Stamina', ['Stamina 30/30']],
      ['Track Dice', ['BRAWLER (d10) 3/3', 'SAGE (d6) 2/2']],
      ['Charges — Slow', ['Small Charges 4/4']],
      ['Charges — Quick', ['Small Charges 2/2']],
      ['Limited Uses', ['FURY 3/3', 'Surge 1/1', 'DAILY 2/2']],
      ['Woe', ['Woe 0/6']],
    ],
  );
  assert.deepEqual(v.rests, [{ id: 'nap', label: 'Nap' }, { id: 'sleep', label: 'Sleep' }]);
  assert.deepEqual(v.conditions, { label: 'Conditions', names: [{ name: 'Dazed', on: false }, { name: 'Soaked', on: false }] });
});

test('what gives a tracker back follows includes, and a block publishing the stat is given back by its own rest', () => {
  // Fails without `includes` followed (a nap's uses would not come back on a sleep), or with `restoresWhen` ignored (the
  // quick block's charges would wait for a sleep).
  assert.deepEqual(tracker(fresh(), 'uses/SURGE')?.restoredBy, ['Nap', 'Sleep']);
  assert.deepEqual(tracker(fresh(), 'uses/FURY')?.restoredBy, ['Sleep']);
  assert.deepEqual(tracker(fresh(), 'charges/quick:charge:1')?.restoredBy, ['Nap', 'Sleep']);
  assert.deepEqual(tracker(fresh(), 'charges/slow:charge:1')?.restoredBy, ['Sleep']);
  assert.equal(tracker(fresh(), 'uses/FURY')?.usage, '3/Sleep');
});

test('a usage is read whole against each rest\'s templates, ignoring case and spacing around the count', () => {
  // Fails if a template is matched as a prefix ("3/Sleep later" would read), or case matters ("1/nap" is a nap).
  const rests = PLAY.rests!;
  assert.deepEqual(readUsage('3/Sleep', rests), { count: 3, rest: 'sleep' });
  assert.deepEqual(readUsage(' 1/NAP ', rests), { count: 1, rest: 'nap' });
  assert.equal(readUsage('3/Sleep later', rests), undefined);
  assert.equal(readUsage('1/Turn', rests), undefined);
});

test('spending takes from the temporary amount first, giving back does not, and both stay within the maximum', () => {
  // Fails if the temporary amount is ignored (spent 12), spent after the stat, refilled by healing, or if spending past
  // the maximum records more than it.
  let c = fresh();
  c = setPlayTemporary(c, view(c), 'stamina', 5);
  c = adjustPlay(c, view(c), 'stamina', 12);
  assert.deepEqual(c.play, { spent: { stamina: 7 } });
  assert.equal(tracker(c, 'stamina')?.value, 23);
  c = setPlayTemporary(c, view(c), 'stamina', 4);
  c = adjustPlay(c, view(c), 'stamina', -3);
  assert.deepEqual(c.play, { spent: { stamina: 4 }, temporary: { stamina: 4 } });
  c = adjustPlay(c, view(c), 'stamina', 100);
  assert.deepEqual(c.play, { spent: { stamina: 30 } });
  c = adjustPlay(c, view(c), 'stamina', -100);
  assert.equal(c.play, undefined, 'nothing spent records nothing');
});

test('recording play raises the format to 8, and clearing it leaves the version and drops the field', () => {
  // Fails if the version is not raised (a reader of 7 would drop it silently), or if an empty play is written as {}.
  let c = fresh();
  assert.equal(c.formatVersion, 2);
  c = adjustPlay(c, view(c), 'woe', 1);
  assert.equal(c.formatVersion, 8);
  c = adjustPlay(c, view(c), 'woe', -1);
  assert.equal(c.formatVersion, 8);
  assert.equal('play' in c, false);
});

test('a key the view does not show changes nothing, and is kept when something else is written', () => {
  // Fails if an edit drops recorded keys no tracker shows (a level lost would erase what a higher one had spent).
  let c: Character = { ...fresh(), formatVersion: 8, play: { spent: { 'charges/slow:charge:9': 2 } } };
  assert.equal(adjustPlay(c, view(c), 'charges/slow:charge:9', 1), c);
  assert.equal(adjustPlay(c, view(c), 'nonsense', 1), c);
  c = adjustPlay(c, view(c), 'uses/FURY', 1);
  assert.deepEqual(c.play?.spent, { 'charges/slow:charge:9': 2, 'uses/FURY': 1 });
});

test('a recorded amount above a maximum that fell reads as the maximum, and is not rewritten until an edit', () => {
  // Fails if the view shows more spent than there is (a negative value left), or if reading it writes anything.
  const c: Character = { ...fresh(), formatVersion: 8, play: { spent: { 'uses/SURGE': 5 } } };
  assert.equal(tracker(c, 'uses/SURGE')?.spent, 1);
  assert.equal(tracker(c, 'uses/SURGE')?.value, 0);
  assert.deepEqual(setPlaySpent(c, view(c), 'uses/SURGE', 0).play, undefined);
});

test('a rest gives back what it and every rest it includes give back, and leaves the rest and the conditions alone', () => {
  // Fails if a sleep does not give back a nap's uses (includes), a nap gives back a sleep's, the quick block waits for a
  // sleep, a full restore keeps the temporary amount, or a rest clears a condition.
  let c = fresh();
  for (const [key, n] of [['stamina', 9], ['uses/FURY', 2], ['uses/SURGE', 1], ['charges/slow:charge:1', 3], ['charges/quick:charge:1', 2], ['woe', 3]] as const) {
    c = adjustPlay(c, view(c), key, n);
  }
  c = setPlayTemporary(c, view(c), 'stamina', 6);
  c = setPlayCondition(c, view(c), 'Soaked', true);
  const napped = restPlay(c, view(c), 'nap');
  assert.deepEqual(napped.play, {
    spent: { stamina: 9, 'uses/FURY': 2, 'charges/slow:charge:1': 3, woe: 3 },
    temporary: { stamina: 6 },
    conditions: ['Soaked'],
  });
  const slept = restPlay(c, view(c), 'sleep');
  assert.deepEqual(slept.play, { spent: { woe: 2 }, conditions: ['Soaked'] });
  assert.equal(restPlay(c, view(c), 'nonsense'), c);
});

test('a fraction is a share of the whole group, at least the minimum, given back in the order shown', () => {
  // Fails if the fraction is taken per tracker (BRAWLER would get 1 and SAGE 1, not 2 then 0), rounded up, or the
  // minimum ignored (one die spent of a one-die group would never come back).
  let c = fresh();
  c = adjustPlay(c, view(c), 'tracks/BRAWLER', 3);
  c = adjustPlay(c, view(c), 'tracks/SAGE', 2);
  // Five dice in all: half is 2, given back to BRAWLER first.
  assert.deepEqual(restPlay(c, view(c), 'sleep').play?.spent, { 'tracks/BRAWLER': 1, 'tracks/SAGE': 2 });
  const one = { ...KIND, play: { ...PLAY, trackers: [{ id: 'one', max: 1, restores: [{ rest: 'sleep', fraction: 0.5, minimum: 1 }] }] } } as ResolvedCharacterKind;
  const oneView = (ch: Character) => playView({ ...source(ch), kind: one })!;
  let d = fresh();
  d = adjustPlay(d, oneView(d), 'one', 1);
  assert.equal(restPlay(d, oneView(d), 'sleep').play, undefined);
});

test('a condition is set and cleared by a name the kind declares, and no other', () => {
  // Fails if an undeclared name is recorded, or a condition set twice is recorded twice.
  let c = fresh();
  c = setPlayCondition(c, view(c), 'Dazed', true);
  assert.equal(setPlayCondition(c, view(c), 'Dazed', true), c);
  assert.equal(setPlayCondition(c, view(c), 'Hexed', true), c);
  assert.deepEqual(view(c).conditions?.names, [{ name: 'Dazed', on: true }, { name: 'Soaked', on: false }]);
  c = setPlayCondition(c, view(c), 'Dazed', false);
  assert.equal(c.play, undefined);
});

test('a tracker that counts shows how many there are, and its maximum holds', () => {
  // Fails if a counting tracker shows what is left (6 woe would read 0), or counts past its maximum.
  let c = fresh();
  c = adjustPlay(c, view(c), 'woe', 2);
  assert.equal(tracker(c, 'woe')?.value, 2);
  c = adjustPlay(c, view(c), 'woe', 10);
  assert.equal(tracker(c, 'woe')?.value, 6);
});

test('through the builder, a play edit keeps the derivation and tells its listeners', async () => {
  // Fails if `playEdit` invalidates (the derivation would be a new object), forgets to notify (a screen would not
  // redraw), or if the builder publishes no play for a kind that declares it.
  const { CharacterBuilder } = await import('./use-character-builder.ts');
  const { MapElementIndex } = await import('@incudo/core');
  const system = {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1',
    elementTypes: [{ name: 'Widget' }],
    stats: [{ name: 'stamina', label: 'Stamina', default: 12 }],
    characterKinds: [
      {
        id: 'hero',
        name: 'Hero',
        default: true,
        progression: { kind: 'none' },
        elementTypes: ['Widget'],
        sheet: { sections: [{ id: 'main', label: 'Main', stats: ['stamina'] }] },
        play: { rests: [{ id: 'sleep', label: 'Sleep' }], trackers: [{ id: 'stamina', stat: 'stamina', restores: [{ rest: 'sleep' }] }] },
      },
    ],
  } as const;
  const builder = new CharacterBuilder(createCharacter('test', 'hero', { name: 'T', progress: null }), system as never, new MapElementIndex());
  const before = builder.getState();
  assert.equal(before.play?.groups[0]?.trackers[0]?.value, 12);
  let told = 0;
  builder.subscribe(() => told++);
  builder.adjustPlay('stamina', 5);
  const after = builder.getState();
  assert.equal(told, 1);
  assert.equal(after.derived, before.derived);
  assert.equal(after.play?.groups[0]?.trackers[0]?.value, 7);
  assert.deepEqual(after.character.play, { spent: { stamina: 5 } });
  builder.rest('sleep');
  assert.equal(builder.getState().character.play, undefined);
  builder.adjustPlay('nothing', 1);
  assert.equal(told, 2, 'an edit that changes nothing tells nobody');
});

test('the wording every screen shares', async () => {
  // Fails if a rest's effects list a group with nothing spent (the question would promise what it does not do), or a
  // counting tracker is said to come "back".
  const { playValue, playTemporaryText, playRestNote, restEffects } = await import('./play.ts');
  let c = fresh();
  c = setPlayTemporary(c, view(c), 'stamina', 5);
  c = adjustPlay(c, view(c), 'uses/SURGE', 1);
  const stamina = tracker(c, 'stamina')!;
  assert.equal(playValue(stamina), '30 of 30');
  assert.equal(playTemporaryText(stamina), '+5 Spare Stamina');
  assert.equal(playTemporaryText(tracker(c, 'uses/SURGE')!), undefined);
  assert.equal(playRestNote(tracker(c, 'uses/SURGE')!), 'Back after a Nap or Sleep');
  assert.equal(playRestNote(tracker(c, 'woe')!), 'Goes down after a Sleep');
  assert.deepEqual(restEffects(view(c), 'nap'), ['Limited Uses']);
  assert.deepEqual(restEffects(view(c), 'sleep'), ['Limited Uses']);
});

test('each tracker says where on the sheet it counts, and the places find it there (ADR 0126)', () => {
  // Fails if a tracker loses its place (a stat's, a per-block row's by the drawn section, a listed element's), or one with a
  // fixed maximum is given one, or playPlaces files a tracker under the wrong key.
  const v = view(fresh());
  const at = Object.fromEntries(v.groups.flatMap((g) => g.trackers).map((t) => [t.key, t.at ?? null]));
  assert.deepEqual(at, {
    stamina: { stat: 'stamina' },
    'tracks/BRAWLER': { section: 'identity', element: 'BRAWLER' },
    'tracks/SAGE': { section: 'identity', element: 'SAGE' },
    'charges/slow:charge:1': { section: 'charges:slow', row: 'slow:charge:1' },
    'charges/quick:charge:1': { section: 'charges:quick', row: 'quick:charge:1' },
    'uses/FURY': { section: 'features', element: 'FURY' },
    'uses/SURGE': { section: 'features', element: 'SURGE' },
    'uses/DAILY': { section: 'features', element: 'DAILY' },
    woe: null,
  });
  const places = playPlaces(v);
  assert.equal(places.stat('Stamina')?.key, 'stamina');
  assert.equal(places.row('charges:quick', 'quick:charge:1')?.key, 'charges/quick:charge:1');
  assert.equal(places.row('charges:slow', 'quick:charge:1'), undefined);
  assert.equal(places.element('features', 'SURGE')?.key, 'uses/SURGE');
  assert.deepEqual(places.loose.map((t) => t.key), ['woe']);
  assert.equal(places.all.length, 9);
});

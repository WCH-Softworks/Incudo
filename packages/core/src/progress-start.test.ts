/**
 * A character's progression may start where an element it chose prints it — ADR 0060.
 *
 * No game in the fixture: a Beast prints its "rank", and a keeper's rating is its rank until the user types
 * another, as a creature prints its challenge rating in 5e. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import {
  createCharacter,
  setChoice,
  setProgress,
  type Character,
} from './character.ts';
import { collectCharacterContent } from './container.ts';
import { MapElementIndex, type Element, type Rule, type Setter } from './model.ts';
import { characterProgress, progressCanBePrinted } from './setter-stats.ts';
import { resolveCharacterKind, type GameSystem, type Progression } from './system.ts';

function element(id: string, type: string, setters: Record<string, string> = {}, rules: Rule[] = []): Element {
  const out: Record<string, Setter> = {};
  for (const [key, value] of Object.entries(setters)) out[key] = { value };
  return { id, type, name: id, source: 'test', setters: out, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

function system(progression: Progression, printed = true): GameSystem {
  const stat = progression.kind === 'none' ? 'grade' : (progression.stat ?? 'level');
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Beast' }, { name: 'Charm' }, { name: 'Step' }],
    stats: [{ name: 'bonus', derive: { kind: 'binary', op: '+', left: { kind: 'number', value: 1 }, right: { kind: 'ref', stat } } }],
    characterKinds: [
      {
        id: 'keeper',
        name: 'Keeper',
        default: true,
        progression,
        elementTypes: ['Beast', 'Charm', 'Step'],
        setterStats: printed ? [{ types: ['Beast'], setter: 'rank', stat }] : [],
        buildSteps: [],
        sheet: { sections: [] },
      },
    ],
  };
}

const RATING: Progression = { kind: 'rating', stat: 'grade', min: 0, max: 30 };

const ox = element('OX', 'Beast', { rank: '5' });
const calf = element('CALF', 'Beast', { rank: '1/4' });
const shade = element('SHADE', 'Beast', { rank: '—' });
// A charm grants a beast; what it grants is not what the keeper chose.
const charm = element('CHARM', 'Charm', {}, [{ kind: 'grant', key: 'g', type: 'Beast', id: 'OX' }]);
// A rule gated on the rating: reached only at grade 5 or more.
const gated = element('GATED', 'Charm', {}, [
  { kind: 'stat', key: 's', name: 'seen', value: { kind: 'number', value: 1 }, level: 5 },
]);
const index = new MapElementIndex();
index.addAll([ox, calf, shade, charm, gated]);

function keeper(chosen: string[], progress?: number): Character {
  let character = createCharacter('test', 'keeper', { progress: progress ?? null });
  for (const [n, id] of chosen.entries()) character = setChoice(character, `build/pick${n}`, [id]);
  return character;
}

const value = (derived: ReturnType<typeof deriveCharacter>, name: string): number | undefined =>
  derived.stats.get(name)?.value;

test('with nothing recorded, the progression is what the chosen element prints, and gates read it', () => {
  // Fails if the engine reads `character.progress` alone (grade reads 0, the gated rule never applies).
  const derived = deriveCharacter(keeper(['OX', 'GATED']), system(RATING), index);
  assert.equal(value(derived, 'grade'), 5);
  assert.equal(value(derived, 'bonus'), 6);
  assert.equal(value(derived, 'seen'), 1);
  assert.deepEqual(derived.progress, { value: 5, recorded: false, printed: { stat: 'grade', value: 5, from: 'OX', setter: 'rank' }, notes: [] });
  assert.deepEqual(derived.starts.get('grade'), { stat: 'grade', value: 5, from: 'OX', replaced: false });
});

test('a recorded value replaces the print, and the print is still published', () => {
  // Fails if the print wins over what the user set (grade reads 5).
  const derived = deriveCharacter(keeper(['OX'], 2), system(RATING), index);
  assert.equal(value(derived, 'grade'), 2);
  assert.equal(derived.progress.recorded, true);
  assert.equal(derived.starts.get('grade')?.value, 5);
  assert.equal(derived.starts.get('grade')?.replaced, true);
});

test('a fraction reads as one, and a print that is not a number starts where the progression does, and says so', () => {
  assert.equal(value(deriveCharacter(keeper(['CALF']), system(RATING), index), 'grade'), 0.25);
  const shadow = deriveCharacter(keeper(['SHADE']), system(RATING), index);
  assert.equal(value(shadow, 'grade'), 0);
  assert.equal(shadow.problems.filter((p) => p.code === 'setter-not-a-number').length, 1);
  // A typed value makes the print irrelevant, and its note noise.
  const typed = deriveCharacter(keeper(['SHADE'], 3), system(RATING), index);
  assert.equal(typed.problems.filter((p) => p.code === 'setter-not-a-number').length, 0);
});

test('an element the character was granted and did not choose does not set it', () => {
  // Fails if the print is read from everything the character holds (grade reads 5): a grant may be gated
  // on the very number being read.
  const derived = deriveCharacter(keeper(['CHARM']), system(RATING), index);
  assert.ok(derived.elementIds.has('OX'));
  assert.equal(value(derived, 'grade'), 0);
});

test('a kind that declares no print starts where its progression does, as before', () => {
  const kind = resolveCharacterKind(system(RATING, false), 'keeper');
  assert.equal(progressCanBePrinted(kind), false);
  assert.equal(characterProgress(keeper(['OX']), kind, index).value, 0);
  assert.equal(progressCanBePrinted(resolveCharacterKind(system(RATING), 'keeper')), true);
});

test('what each printed step grants is derived and embedded at the printed step', () => {
  // Fails if `collectCharacterContent` reads `character.progress` (nothing past the start is embedded, and
  // the save reopened with no source reports STEP_2 onwards unresolved).
  const levels: Progression = { kind: 'level', min: 1, max: 5, elementIdPattern: 'STEP_{n}' };
  const steps = [1, 2, 3, 4, 5].map((n) => element(`STEP_${n}`, 'Step'));
  const withSteps = new MapElementIndex();
  withSteps.addAll([ox, element('LAMB', 'Beast', { rank: '3' }), ...steps]);
  const sys = system(levels);
  const character = keeper(['LAMB']);
  const derived = deriveCharacter(character, sys, withSteps);
  assert.deepEqual([...derived.elementIds].filter((id) => id.startsWith('STEP_')).sort(), ['STEP_1', 'STEP_2', 'STEP_3']);
  const content = collectCharacterContent(character, withSteps, { kind: resolveCharacterKind(sys, 'keeper') });
  assert.deepEqual(content.elements.map((e) => e.id).filter((id) => id.startsWith('STEP_')).sort(), ['STEP_1', 'STEP_2', 'STEP_3']);
});

test('forgetting a recorded value raises the character to format 3', () => {
  // Fails if `setProgress(undefined)` leaves the version at 2. That only format 3 may omit it is held by the
  // validator, in tools/verify/src/schemas.test.ts, which reads the schema files.
  const recorded = createCharacter('test', 'keeper', { progress: 4 });
  assert.equal(recorded.formatVersion, 2);
  const cleared = setProgress(recorded, undefined);
  assert.equal(cleared.formatVersion, 3);
  assert.equal('progress' in cleared, false);
  assert.equal(setProgress(cleared, 6).formatVersion, 3, 'nothing downgrades it');
  assert.equal(createCharacter('test', 'keeper', { progress: null }).formatVersion, 3);
});

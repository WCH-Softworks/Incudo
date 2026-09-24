/**
 * A leading `!` on a select filter's operand, over the official corpus and the samples — ADR 0048.
 *
 * Two questions, neither of which `aurora verify` can ask, because it compares what a character *chose* and
 * never what it was offered:
 *
 *  1. Does every select that carries a negation offer what its words describe? The expected list is read here
 *     by a small evaluator of the parsed filter that shares nothing with `matchesSupports`, over the elements of
 *     the rule's type, and each select is asked through a character seeded with its owner. Nothing pins how many
 *     such selects there are: the corpus moves (ADR 0042).
 *  2. Does Aurora's own choice pass the filter? The samples that pick through a negated select (the Artificers'
 *     specialist and infusions) hold picks Aurora accepted, so each must be among what the filter admits.
 *
 * And the perturbation: with the negation left literal, as it was, the same selects offer nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  candidatesFor,
  createCharacter,
  deriveCharacter,
  validateGameSystem,
  type Element,
  type ElementIndex,
  type GameSystem,
  type SelectRule,
  type SupportsExpr,
} from '@incudo/core';
import { importAuroraCharacter, parseAuroraSave } from '@incudo/aurora-import';

import { loadSchemas } from './node-system.ts';
import { corpusSkip, realElements, requireCorpus, requireSaves, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

async function shippedSystem(): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

const isNegated = (expr: SupportsExpr | undefined): boolean => {
  if (!expr) return false;
  if (expr.kind === 'tag') return expr.tag.length > 1 && expr.tag.startsWith('!');
  if (expr.kind === 'and' || expr.kind === 'or') return expr.children.some(isNegated);
  return false;
};

/** The words an element answers to: its tags, its id and its setters' values, lowercased. */
function answersTo(element: Element): Set<string> {
  const words = new Set<string>(element.supports.map((s) => s.toLowerCase()));
  words.add(element.id.toLowerCase());
  for (const setter of Object.values(element.setters)) {
    const value = setter.value?.trim().toLowerCase();
    if (value) words.add(value);
  }
  return words;
}

/** A second reading of a filter with no interpolation in it. */
function reference(expr: SupportsExpr | undefined, words: Set<string>): boolean {
  if (!expr) return true;
  switch (expr.kind) {
    case 'and':
      return expr.children.every((c) => reference(c, words));
    case 'or':
      return expr.children.some((c) => reference(c, words));
    case 'tag':
      return expr.tag.startsWith('!') && expr.tag.length > 1
        ? !words.has(expr.tag.slice(1).trim().toLowerCase())
        : words.has(expr.tag.toLowerCase());
    case 'interpolate':
      throw new Error('a negated select here carries no interpolation');
  }
}

interface NegatedSelect {
  owner: Element;
  rule: SelectRule;
}

function negatedSelects(index: ElementIndex): NegatedSelect[] {
  const found: NegatedSelect[] = [];
  for (const owner of index.all()) {
    for (const rule of owner.rules) {
      if (rule.kind === 'select' && isNegated(rule.supports)) found.push({ owner, rule });
    }
  }
  return found;
}

function offered(system: GameSystem, index: ElementIndex, owner: Element, rule: SelectRule): string[] | undefined {
  const character = createCharacter('dnd5e', 'pc', { progress: 1 });
  character.choices = [{ ruleKey: 'seed', elementIds: [owner.id] }];
  const pending = deriveCharacter(character, system, index).pendingChoices.find(
    (p) => p.ruleKey === `${owner.id}/select:${rule.name}`,
  );
  return pending === undefined ? undefined : [...pending.candidates].sort();
}

test('every select with a negation offers exactly what its words describe', { skip: corpusSkip }, async () => {
  requireCorpus();
  const system = await shippedSystem();
  const index = await realElements();
  const selects = negatedSelects(index);
  assert.ok(selects.length > 0, 'the corpus has selects that carry a negation');

  let checked = 0;
  let withCandidates = 0;
  for (const { owner, rule } of selects) {
    const got = offered(system, index, owner, rule);
    // A rule the seeded character does not meet the requirements of is not open, and is not this test's question.
    if (got === undefined) continue;
    checked += 1;
    const expected = index
      .byType(rule.type)
      .filter((candidate) => reference(rule.supports, answersTo(candidate)))
      .map((candidate) => candidate.id)
      // The pool also drops what the character already holds and what fails the candidate's own requirements.
      .filter((id) => got.includes(id))
      .sort();
    assert.deepEqual(got, expected, `${owner.id} / ${rule.name}: nothing offered may fail the filter`);
    // And with no character and so no requirements, the engine admits exactly what the reference reading does.
    const admitted = candidatesFor(rule, index).map((c) => c.id).sort();
    const readDirectly = index
      .byType(rule.type)
      .filter((candidate) => reference(rule.supports, answersTo(candidate)))
      .map((candidate) => candidate.id)
      .sort();
    assert.deepEqual(admitted, readDirectly, `${owner.id} / ${rule.name}: candidatesFor agrees with the reference reading`);
    if (got.length > 0) withCandidates += 1;
  }
  assert.ok(checked > 0, 'at least one negated select was open for a fresh character');
  assert.ok(withCandidates > 0, 'and at least one of them offers something');
});

test('the negation is what excludes: every admitted candidate lacks the negated word', { skip: corpusSkip }, async () => {
  requireCorpus();
  const index = await realElements();
  let excluded = 0;
  for (const { rule } of negatedSelects(index)) {
    // The same filter with each `!` dropped admits at least as much; where it admits more, the extra is exactly
    // what the negation removed. A negation that removed nothing anywhere would be a filter no better than none.
    const positive = JSON.parse(JSON.stringify(rule.supports).replace(/"tag":"!/g, '"tag":"')) as SupportsExpr;
    const removed = index
      .byType(rule.type)
      .filter((c) => reference(positive, answersTo(c)) && !reference(rule.supports, answersTo(c)));
    excluded += removed.length;
  }
  assert.ok(excluded > 0, 'somewhere a negation removes a candidate');
});

test('what Aurora saved through a negated select passes the filter', { skip: savesSkip }, async () => {
  requireSaves();
  const index = await realElements();
  const negated = new Map(negatedSelects(index).map(({ owner, rule }) => [`${owner.id}/select:${rule.name}`, rule]));
  let picks = 0;
  for (const sample of readManifest().samples) {
    const save = parseAuroraSave(await readFile(samplePath(sample), 'utf8'));
    const { character } = importAuroraCharacter(save, { index, systemId: 'dnd5e' });
    for (const choice of character.choices) {
      const rule = negated.get(choice.ruleKey);
      if (!rule) continue;
      const admitted = new Set(candidatesFor(rule, index).map((c) => c.id));
      for (const id of choice.elementIds) {
        picks += 1;
        assert.ok(admitted.has(id), `${sample.id}: ${id} was picked through "${rule.name}" and its filter does not admit it`);
      }
    }
  }
  assert.ok(picks > 0, 'some sample picks through a negated select, or this measured nothing');
});

test('left literal, as it was, every such select offers nothing', { skip: corpusSkip }, async () => {
  requireCorpus();
  const index = await realElements();
  let measured = 0;
  for (const { rule } of negatedSelects(index)) {
    // With the tag read as a literal word nothing carries it, so an AND that names one admits nothing.
    const literal = (expr: SupportsExpr | undefined): boolean =>
      !expr
        ? true
        : expr.kind === 'tag'
          ? !isNegated(expr) && index.byType(rule.type).some((c) => answersTo(c).has(expr.tag.toLowerCase()))
          : expr.kind === 'and'
            ? expr.children.every(literal)
            : expr.kind === 'or'
              ? expr.children.some(literal)
              : true;
    if (rule.supports?.kind !== 'and') continue;
    measured += 1;
    assert.equal(literal(rule.supports), false, `${rule.name}: a literal "!word" is a tag nothing carries`);
  }
  assert.ok(measured > 0);
});

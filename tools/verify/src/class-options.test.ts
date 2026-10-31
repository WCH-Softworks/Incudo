/**
 * The options a class or subclass feature points at: fighting styles, invocations, metamagic, infusions, maneuvers,
 * totems, disciplines, runes, arcane shots and the like. Found on the 2014 Battle Master, whose Combat Superiority says
 * its maneuvers are "detailed under “Maneuvers” below": each maneuver is an element of its own with its own text, and
 * the options of the feature's `select`s. `packages/ui/src/element-choices.ts` writes a select's options after the
 * element that opens it, each option's text under its name when there are at most 40 of them and they have text; this
 * measures, class by class, what that reaches and what it leaves.
 *
 * Report-only (ADR 0042): nothing here must hold against any corpus.
 *
 * Every class is walked from its `Class` element through what content gives it: its `<grant>`s, and the options of the
 * selects whose type is a subclass or a feature (`Archetype`, `Class Feature`, `Archetype Feature`), each reached element
 * labelled with the class and, below a subclass, the subclass. For every reached element that opens a select of a type
 * other than the character-wide ones (spells, proficiencies, languages and the like are choices, not text the feature
 * points at; feats and subclasses are kept, since a fighting style is a feat in 2024 and a subclass is text), selects
 * offering the same options grouped as `element-choices.ts` groups them, the choice is sorted:
 *
 * - shown with text: its options resolve with no character, at most 40, every one with a description;
 * - names only, over 40: they resolve, more than 40;
 * - names only, no text: they resolve, at most 40, and some have no description (counted);
 * - depends on the character: the filter names a `$(…)` only a character publishes;
 * - offers nothing: the filter resolves and matches no element.
 *
 * Each line also gives the characters the options' text runs to with its embeds in place (what writing every option
 * under the feature would add) and how many options open a choice of their own (a second level under the first). The
 * options are read with no character, as the app's block reads them, so an option's own requirements are not asked: an
 * Epic Boon lists every feat.
 *
 * Then the other way round: reached features whose prose points at options ("detailed below", "the following
 * options", "from among the following") and open no select of their own, each with what else carries the options (its
 * own text after the pointer, an embed, its grants, a select of a character-wide type) or nothing; and elements of the
 * feature types that no select in the corpus offers, no grant names and no description embeds, grouped by their support
 * tags: option text content holds and nothing reaches.
 */

import { test } from 'node:test';

import {
  descriptionEmbeds,
  matchesSupports,
  supportsInterpolations,
  type Element,
  type ElementIndex,
  type SelectRule,
  type SupportsExpr,
} from '@incudo/core';
import { descriptionText, expandDescription } from '@incudo/ui';

import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';

/** Types a class's walk follows into. */
const WALKED = new Set(['Archetype', 'Class Feature', 'Archetype Feature']);

/** Option types that are what a character is built of everywhere, not text a feature points at. */
const CHARACTER_WIDE = new Set([
  'Spell',
  'Proficiency',
  'Language',
  'Ability Score Improvement',
  'Item',
  'Magic Item',
  'Weapon',
  'Armor',
  'Race',
  'Sub Race',
  'Background',
  'Class',
  'Information',
  'List',
  'Level',
  'Option',
]);

const OPTION_CAP = 40;

/**
 * Prose that points at options written elsewhere: "detailed below", "described under", "the following options", "listed
 * below", "of your choice from among the following", "options below". "Of your choice" alone is left out: it is every
 * skill and language a feature offers.
 */
const POINTS_AT_OPTIONS =
  /\b(?:detailed|described|listed|explained|presented)\s+(?:below|under|later|at the end|in the [“"])|\b(?:options?|choices|following|ones)\s+(?:below|above|listed)|\b(?:from|among) the following\b|\bthe following (?:options|choices|benefits|features)\b/i;

function hasText(element: Element): boolean {
  return descriptionText(element.description ?? '').trim() !== '';
}

function optionsOf(rule: SelectRule, elements: ElementIndex): Element[] {
  const found = elements.byType(rule.type).filter(
    (candidate) =>
      !rule.supports ||
      matchesSupports(rule.supports, {
        tags: new Set(candidate.supports.map((tag) => tag.toLowerCase())),
        setterValues: new Set(Object.values(candidate.setters).map((s) => s.value.trim().toLowerCase())),
        id: candidate.id,
        resolve: () => undefined,
      }),
  );
  return [...new Map(found.map((e) => [e.id, e])).values()];
}

interface Reached {
  element: Element;
  /** "Fighter", or "Fighter / Battle Master". */
  label: string;
}

/** Every element a class reaches through grants and feature selects, each labelled once, first reach wins. */
function walkClass(start: Element, elements: ElementIndex): Reached[] {
  const seen = new Map<string, Reached>();
  const queue: Reached[] = [{ element: start, label: start.name }];
  while (queue.length) {
    const { element, label } = queue.shift()!;
    if (seen.has(element.id)) continue;
    seen.set(element.id, { element, label });
    const next = (target: Element | undefined): void => {
      if (!target || seen.has(target.id) || !WALKED.has(target.type)) return;
      queue.push({ element: target, label: target.type === 'Archetype' ? `${start.name} / ${target.name}` : label });
    };
    for (const rule of element.rules) {
      if (rule.kind === 'grant') for (const id of rule.id.split(',')) next(elements.get(id.trim()));
      if (rule.kind === 'select' && WALKED.has(rule.type) && supportsInterpolations(rule.supports).size === 0)
        for (const option of optionsOf(rule, elements)) next(option);
    }
  }
  return [...seen.values()];
}

type Verdict = 'shown with text' | 'names only, over 40' | 'names only, no text' | 'depends on the character' | 'offers nothing';

interface Row {
  label: string;
  feature: Element;
  select: string;
  type: string;
  verdict: Verdict;
  options: number;
  withText: number;
  /** Characters of the options' text with what each embeds put in place (ADR 0069): what writing them all under the feature costs. */
  characters: number;
  /** Options that open a choice of their own (Pact of the Chain's familiar): a second level under the first. */
  nested: number;
  filter: string;
}

/** One name kept; several that differ only in a trailing "(…)" are written without it, as element-choices.ts does. */
function sharedLabel(names: string[]): string {
  const distinct = [...new Set(names)];
  if (distinct.length === 1) return distinct[0]!;
  const stems = new Set(distinct.map(selectName));
  return stems.size === 1 ? [...stems][0]! : distinct.join(', ');
}

function selectName(name: string): string {
  return name.replace(/\s*\([^()]*\)\s*$/, '').trim();
}

test('the options class and subclass features point at, and whether a preview can show their text', { skip: corpusSkip }, async (t) => {
  const elements = await realElements();
  t.diagnostic(corpusProvenance());
  const all = [...elements.all()];

  const rows: Row[] = [];
  const prosesWithout: { label: string; feature: Element; carried: string }[] = [];
  const done = new Set<string>();
  for (const cls of elements.byType('Class').sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source))) {
    for (const { element, label } of walkClass(cls, elements)) {
      if (done.has(element.id)) continue;
      done.add(element.id);
      const selects = element.rules.filter((r): r is SelectRule => r.kind === 'select' && !CHARACTER_WIDE.has(r.type));
      const grouped = new Map<string, SelectRule[]>();
      for (const rule of selects) {
        const key = `${rule.type}\n${selectName(rule.name)}`;
        grouped.set(key, [...(grouped.get(key) ?? []), rule]);
      }
      for (const group of grouped.values()) {
        const rule = group[0]!;
        const filter = describeSupports(rule.supports);
        if (group.some((r) => supportsInterpolations(r.supports).size > 0)) {
          rows.push({ label, feature: element, select: sharedLabel(group.map((r) => r.name)), type: rule.type, verdict: 'depends on the character', options: 0, withText: 0, characters: 0, nested: 0, filter });
          continue;
        }
        const options = [...new Map(group.flatMap((r) => optionsOf(r, elements)).map((e) => [e.id, e])).values()];
        const withText = options.filter(hasText).length;
        const verdict: Verdict = !options.length
          ? 'offers nothing'
          : options.length > OPTION_CAP
            ? 'names only, over 40'
            : withText < options.length
              ? 'names only, no text'
              : 'shown with text';
        rows.push({ label, feature: element, select: sharedLabel(group.map((r) => r.name)), type: rule.type, verdict, options: options.length, withText, characters: options.reduce((n, o) => n + (o.description ? descriptionText(expandDescription(o, elements)).length : 0), 0), nested: options.filter((o) => o.rules.some((r) => r.kind === 'select')).length, filter });
      }
      if (
        !selects.length &&
        (element.type === 'Class Feature' || element.type === 'Archetype Feature') &&
        POINTS_AT_OPTIONS.test(descriptionText(element.description ?? ''))
      ) {
        const html = element.description ?? '';
        const embeds = descriptionEmbeds(html).filter((e) => elements.get(e.id));
        const granted = element.rules
          .filter((r) => r.kind === 'grant')
          .flatMap((r) => r.id.split(',').map((id) => elements.get(id.trim())))
          .filter((e): e is Element => !!e && hasText(e));
        const otherSelects = element.rules.filter((r): r is SelectRule => r.kind === 'select');
        const carried = followedInOwnText(html)
          ? 'its own text'
          : embeds.length
            ? `embeds ${embeds.map((e) => elements.get(e.id)!.name).join(', ')}`
            : granted.length
              ? `grants ${granted.map((e) => e.name).join(', ')}`
              : otherSelects.length
                ? `a select of ${[...new Set(otherSelects.map((r) => r.type))].join(', ')}`
                : 'only the prose';
        prosesWithout.push({ label, feature: element, carried });
      }
    }
  }

  const verdicts: Verdict[] = ['shown with text', 'names only, over 40', 'names only, no text', 'depends on the character', 'offers nothing'];
  t.diagnostic(
    `${rows.length} feature selects in ${new Set(rows.map((r) => r.feature.id)).size} elements reached from ${elements.byType('Class').length} classes: ` +
      verdicts.map((v) => `${v} ${rows.filter((r) => r.verdict === v).length}`).join(', '),
  );
  const byClass = new Map<string, Row[]>();
  for (const row of rows) {
    const cls = row.label.split(' / ')[0]!;
    byClass.set(cls, [...(byClass.get(cls) ?? []), row]);
  }
  for (const [cls, list] of [...byClass].sort((a, b) => a[0].localeCompare(b[0]))) {
    t.diagnostic(`— ${cls}`);
    for (const row of list)
      t.diagnostic(
        `   ${row.verdict}: ${row.label} — ${row.feature.name} (${row.feature.source || 'no book'}) — “${row.select}”, ${row.type}` +
          (row.verdict === 'depends on the character'
            ? `, filter ${row.filter}`
            : `, ${row.options} options, ${row.withText} with text, ${row.characters.toLocaleString('en')} characters${row.nested ? `, ${row.nested} opening a choice of their own` : ''}${row.verdict === 'offers nothing' ? `, filter ${row.filter}` : ''}`),
      );
  }

  t.diagnostic(`${prosesWithout.length} reached features whose prose points at options and open no feature select:`);
  for (const carried of ['its own text', 'embeds', 'grants', 'a select of', 'only the prose']) {
    const list = prosesWithout.filter((p) => p.carried.startsWith(carried));
    t.diagnostic(`— ${carried}: ${list.length}`);
    if (carried !== 'its own text') for (const p of list) t.diagnostic(`   ${p.label} — ${p.feature.name} (${p.feature.source || 'no book'})${p.carried === carried ? '' : `: ${p.carried}`}`);
  }

  // Option text nothing reaches: a feature element no select offers, no grant names and no description embeds.
  const granted = new Set<string>();
  const embedded = new Set<string>();
  const selects: SelectRule[] = [];
  for (const e of all) {
    for (const rule of e.rules) {
      if (rule.kind === 'grant') for (const id of rule.id.split(',')) granted.add(id.trim());
      if (rule.kind === 'select') selects.push(rule);
    }
    for (const embed of descriptionEmbeds(e.description ?? '')) embedded.add(embed.id);
  }
  const offered = new Set<string>();
  const dynamicTypes = new Set<string>();
  for (const rule of selects) {
    if (!WALKED.has(rule.type)) continue;
    if (supportsInterpolations(rule.supports).size > 0) {
      dynamicTypes.add(rule.type);
      continue;
    }
    for (const o of optionsOf(rule, elements)) offered.add(o.id);
  }
  const orphans = all.filter(
    (e) => (e.type === 'Class Feature' || e.type === 'Archetype Feature') && !offered.has(e.id) && !granted.has(e.id) && !embedded.has(e.id),
  );
  const byTag = new Map<string, Element[]>();
  for (const e of orphans) {
    const tag = e.supports.join(', ') || '(no support tags)';
    byTag.set(tag, [...(byTag.get(tag) ?? []), e]);
  }
  t.diagnostic(
    `${orphans.length} Class Feature and Archetype Feature elements no static select offers, no grant names and no description embeds` +
      ` (a select with a $(…) filter of those types exists: ${[...dynamicTypes].join(', ') || 'none'}), by support tags:`,
  );
  for (const [tag, list] of [...byTag].sort((a, b) => b[1].length - a[1].length))
    t.diagnostic(`   ${tag}: ${list.length} — ${list.slice(0, 6).map((e) => `${e.name} (${e.source || 'no book'})`).join('; ')}${list.length > 6 ? '; …' : ''}`);
});

/**
 * Whether what the pointer announces follows it in the same description: a paragraph, list, table or heading after the
 * one that points ("you gain the following benefits:" and then a paragraph per benefit).
 */
function followedInOwnText(html: string): boolean {
  const blocks = html.split(/(?=<(?:p|ul|ol|table|h\d)\b)/i).filter((b) => descriptionText(b).trim() !== '');
  const at = blocks.findIndex((b) => POINTS_AT_OPTIONS.test(descriptionText(b)));
  return at >= 0 && at < blocks.length - 1;
}

/** A filter written back as content writes it, near enough to read. */
function describeSupports(expr: SupportsExpr | undefined): string {
  if (!expr) return '(none)';
  switch (expr.kind) {
    case 'tag':
      return expr.tag;
    case 'interpolate':
      return `$(${expr.key})`;
    case 'not':
      return `!${describeSupports(expr.child)}`;
    case 'and':
      return expr.children.map(describeSupports).join(',');
    case 'or':
      return `(${expr.children.map(describeSupports).join('||')})`;
  }
}

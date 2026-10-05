/**
 * The hidden item families other than Tasha's optional class features, read from content and the samples before
 * deciding how the app offers them.
 *
 * Aurora switches some things on by an item the user equips and that the sheet never lists (`inventory-hidden`). ADR
 * 0072 offered one family that way, the optional class features (`optional-features.test.ts` has their census), and left
 * the rest for a look of their own: the "Additional Feature" items (speeds, senses, feat and multiclass unlockers, weapon
 * mastery, bonus feats, Lycanthropy, the Companion and Familiar Selection items), the "Additional Ability Score
 * Improvement" items, and the hidden 2024 mounts.
 *
 * Reported, from content alone: every hidden item outside that family by category, what its rules are, what names what it
 * grants (an unlocker is only as good as the requirements that read its marker), and whether anything grants, selects or
 * names the item itself. Then the thirty samples: what their bags carry of these. Then each item equipped on a fresh
 * player character, through the builder: what it adds to the character, what stats move, what decisions it opens, what
 * problems it brings, and what lines of the sheet change — which is what the app would show for taking it.
 *
 * Those are reported as `ℹ` lines and assert nothing (ADR 0042). Since ADR 0089 the tests after them hold what 5e
 * declared, through the builder and against any corpus: every hidden item that switches something on, other than the
 * optional class features, is offered by an equip step and no hidden item without rules is; a speed item's speed shows
 * under Other Speeds; the Companion Selection holds a creature that is shown. Items are found by their setters and rules,
 * never by an id; the baseline character is built by name and source.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { parseAuroraSave } from '@incudo/aurora-import';
import { evaluateRequirements, requirementContextFor, setInventoryEntry, type Character, type Element, type RequirementExpr } from '@incudo/core';
import { runOracle } from './aurora-oracle.ts';
import { CharacterBuilder, newCharacterOfKind, sheetDocument, sheetMarkdown, type BuilderState } from '@incudo/ui';

import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

const HIDDEN = 'inventory-hidden';
const OPTIONAL = 'Optional Class Features';

const category = (e: Element): string => e.setters['category']?.value ?? '(none)';
const isHidden = (e: Element): boolean => e.setters[HIDDEN]?.value.trim().toLowerCase() === 'true';
const isFamily = (e: Element): boolean => isHidden(e) && category(e) !== OPTIONAL;

function tally(values: string[], limit = 12): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = sorted.slice(0, limit).map(([v, n]) => `${n} ${v}`);
  if (sorted.length > limit) shown.push(`${sorted.length - limit} more`);
  return shown.join(', ') || 'none';
}

/** Every id an expression names, negated or not. */
function namedIds(expr: RequirementExpr | undefined, into = new Set<string>()): Set<string> {
  if (!expr) return into;
  if (expr.kind === 'not') return namedIds(expr.child, into);
  if (expr.kind === 'and' || expr.kind === 'or') for (const child of expr.children) namedIds(child, into);
  if (expr.kind === 'has') into.add(expr.id);
  return into;
}

/** Every id an element's own requirements, its multiclass block's or any of its rules' requirements name. */
function idsNamedBy(e: Element): Set<string> {
  const ids = namedIds(e.requirements);
  namedIds(e.multiclass?.requirements, ids);
  for (const rule of e.rules) if ('requirements' in rule) namedIds(rule.requirements as RequirementExpr | undefined, ids);
  return ids;
}

/** What an item does, by the kinds of its rules and what they name: the shape a family is read by. */
function shape(e: Element, elements: { get(id: string): Element | undefined }): string {
  if (!e.rules.length) return 'no rules';
  return e.rules
    .map((r) => {
      if (r.kind === 'grant') return `grant ${r.type}${elements.get(r.id) ? '' : ' (undeclared)'}`;
      if (r.kind === 'stat') return `stat ${r.name}`;
      if (r.kind === 'select') return `select ${r.type}${r.requirements ? ' (gated)' : ''}`;
      return r.kind;
    })
    .join(' + ');
}

test('the hidden items outside the optional class features, and what they are', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  const all = [...elements.all()];
  const hidden = all.filter(isHidden);
  const family = hidden.filter(isFamily);
  t.diagnostic(`hidden elements: ${hidden.length}; outside "${OPTIONAL}": ${family.length}, by category ${tally(family.map(category))}`);
  t.diagnostic(`  by type ${tally(family.map((e) => e.type))}; by slot ${tally(family.map((e) => e.setters['slot']?.value ?? '(none)'))}`);
  t.diagnostic(`  own requirements: ${family.filter((e) => e.requirements).length}; support tags: ${family.filter((e) => e.supports.length).length}`);
  for (const cat of [...new Set(family.map(category))].sort()) {
    const items = family.filter((e) => category(e) === cat);
    const everyItem = all.filter((e) => category(e) === cat && e.type === 'Item');
    t.diagnostic(`${cat}: ${items.length} hidden of ${everyItem.length} items of the category; from ${tally(items.map((e) => e.source), 6)}`);
    t.diagnostic(`  saying to equip it to enable it: ${items.filter((e) => /equip(ped)? this item|once equipped/i.test(e.description ?? '')).length}`);
    for (const s of tally(items.map((e) => shape(e, elements)), 50).split(', ')) t.diagnostic(`  ${s}`);
  }

  // An item whose grant is a marker does nothing unless a requirement reads the marker: how many do, of which types.
  const naming = new Map<string, Element[]>();
  for (const e of all) for (const id of idsNamedBy(e)) naming.set(id, [...(naming.get(id) ?? []), e]);
  t.diagnostic('what names what each item grants (a marker nothing reads unlocks nothing):');
  for (const item of family) {
    for (const rule of item.rules) {
      if (rule.kind !== 'grant') continue;
      const readers = (naming.get(rule.id) ?? []).filter((e) => e.id !== item.id);
      if (rule.type !== 'Grants' && !readers.length) continue;
      t.diagnostic(`  ${item.name} (${item.source}) grants ${rule.type} ${rule.id}: named by ${readers.length} (${tally(readers.map((e) => e.type), 6)})`);
    }
  }

  // The speed items move `innate speed:<mode>`. What else in content writes another movement mode, and whether the
  // player character's sheet shows one: a speed nothing shows is a speed the user cannot see they took.
  const modes = ['burrow', 'climb', 'fly', 'swim'];
  const statRules = all.flatMap((e) => e.rules.flatMap((r) => (r.kind === 'stat' ? [{ e, name: r.name }] : [])));
  for (const prefix of ['innate speed', 'speed']) {
    for (const suffix of ['', ':misc']) {
      const names = modes.map((m) => `${prefix}:${m}${suffix}`);
      const writers = statRules.filter((r) => names.includes(r.name));
      t.diagnostic(`  ${prefix}:<mode>${suffix}: ${writers.length} rules on ${new Set(writers.map((w) => w.e.id)).size} elements (${tally(writers.map((w) => w.e.type), 5)})`);
    }
  }
  const system = await loadShippedSystem('dnd5e');
  const pc = system.characterKinds.find((k) => k.id === 'pc')!;
  const shown = new Set((pc.sheet?.sections ?? []).flatMap((s) => s.stats ?? []));
  t.diagnostic(`  the player character's sheet shows: ${modes.map((m) => `speed:${m} ${shown.has(`speed:${m}`) ? 'yes' : 'no'}`).join(', ')}`);

  const ids = new Set(family.map((e) => e.id));
  const grantedBy = all.filter((e) => e.rules.some((r) => r.kind === 'grant' && ids.has(r.id)));
  const namedBy = all.filter((e) => !ids.has(e.id) && [...idsNamedBy(e)].some((id) => ids.has(id)));
  t.diagnostic(`the items themselves: granted by ${grantedBy.length}; named in a requirement by ${namedBy.length} (${tally(namedBy.map((e) => `${e.type}: ${e.name}`), 6)})`);
  const itemSelects = all.flatMap((e) => e.rules.filter((r) => r.kind === 'select' && r.type === 'Item'));
  t.diagnostic(`selects of type Item in the corpus: ${itemSelects.length}`);
});

test('what the samples carry of the hidden families', { skip: savesSkip }, async (t) => {
  const elements = await realElements();
  const rows: string[] = [];
  for (const sample of readManifest().samples) {
    const save = parseAuroraSave(await readFile(samplePath(sample), 'utf8'));
    for (const item of save.equipment) {
      const element = elements.get(item.id);
      if (element && isFamily(element)) rows.push(`${sample.id}: ${element.name} (${category(element)}; ${item.equipped ? 'equipped' : 'carried'})`);
    }
  }
  t.diagnostic(`bag entries in the samples of a hidden family other than "${OPTIONAL}": ${rows.length}`);
  for (const row of rows) t.diagnostic(`  ${row}`);
});

/** A 2014 Human Fighter at the given level, with the options a new character starts with, through the builder. */
async function baseline(level: number): Promise<{ builder: CharacterBuilder; elements: Awaited<ReturnType<typeof realElements>> }> {
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const character: Character = { ...newCharacterOfKind(system, 'pc'), progress: level };
  const builder = new CharacterBuilder(character, system, elements);
  const pick = (stepId: string, name: string): void => {
    const decision = builder.getState().decisions.find((d) => d.stepId === stepId && d.kind === 'pick');
    const id = decision?.candidates.find((c) => elements.get(c)?.name === name && elements.get(c)?.source === 'Player’s Handbook');
    assert.ok(decision && id, `the ${stepId} step offers ${name}`);
    builder.choose(decision.id, [id]);
  };
  pick('race', 'Human');
  pick('class', 'Fighter');
  return { builder, elements };
}

function lines(state: BuilderState): Set<string> {
  return new Set(sheetMarkdown(sheetDocument(state)).split('\n').filter((l) => l.trim()));
}

test('each hidden item equipped on a fresh character: what it gives, opens and shows', { skip: corpusSkip }, async (t) => {
  const system = await loadShippedSystem('dnd5e');
  const { builder, elements } = await baseline(4);
  const before = builder.getState();
  const beforeLines = lines(before);
  const beforeDecisions = new Set(before.decisions.map((d) => d.id));
  const beforeProblems = new Set(before.derived.problems.map((p) => `${p.code}:${p.message}`));
  const family = [...elements.all()].filter(isFamily).sort((a, b) => category(a).localeCompare(category(b)) || a.name.localeCompare(b.name));
  t.diagnostic(`baseline: a 2014 Human Fighter 4, ${before.derived.elementIds.size} elements, ${beforeLines.size} sheet lines`);
  for (const item of family) {
    const character = setInventoryEntry(before.character, { instanceId: 'hidden-item', elementId: item.id, equipped: true });
    const after = new CharacterBuilder(character, system, elements).getState();
    const added = [...after.derived.elementIds].filter((id) => !before.derived.elementIds.has(id) && id !== item.id);
    const lost = [...before.derived.elementIds].filter((id) => !after.derived.elementIds.has(id));
    const value = (state: BuilderState, stat: string): number | undefined => state.derived.stats.get(stat)?.value;
    const moved = [...new Set([...after.derived.stats.keys(), ...before.derived.stats.keys()])].filter((s) => value(after, s) !== value(before, s));
    const opened = after.decisions.filter((d) => !beforeDecisions.has(d.id));
    const problems = after.derived.problems.filter((p) => !beforeProblems.has(`${p.code}:${p.message}`));
    const afterLines = lines(after);
    const shown = [...afterLines].filter((l) => !beforeLines.has(l));
    const gone = [...beforeLines].filter((l) => !afterLines.has(l));
    t.diagnostic(
      `${category(item)} | ${item.name} (${item.source}): +${added.length} elements (${added.map((id) => elements.get(id)?.name ?? id).join(', ') || '—'})` +
        (lost.length ? `, -${lost.length} (${lost.map((id) => elements.get(id)?.name ?? id).join(', ')})` : '') +
        `; stats moved ${moved.length} (${moved.slice(0, 6).map((s) => `${s} ${value(before, s) ?? '∅'}→${value(after, s) ?? '∅'}`).join(', ')})` +
        `; opens ${opened.length ? opened.map((d) => `"${d.label}" of ${d.candidates.length}`).join(', ') : 'nothing'}` +
        `; problems ${problems.length ? problems.map((p) => p.code).join(', ') : 'none'}` +
        `; sheet +${shown.length}/-${gone.length}${shown.length ? ` (${shown.slice(0, 3).map((l) => l.trim().slice(0, 60)).join(' | ')})` : ''}`,
    );
  }
});

test('the feat unlockers: how many feats a character qualifies for with each equipped', { skip: corpusSkip }, async (t) => {
  // A level 1 character with the scores a new one has; the unlocker is asked of every feat whose requirements name its
  // marker, before and after it is equipped.
  const system = await loadShippedSystem('dnd5e');
  const { builder, elements } = await baseline(1);
  const before = builder.getState();
  const feats = elements.byType('Feat');
  const unlockers = [...elements.all()].filter((e) => isFamily(e) && /unlocker/i.test(e.name));
  const holding = (state: BuilderState, among: Element[]) => {
    const context = requirementContextFor(state.derived);
    return among.filter((f) => evaluateRequirements(f.requirements, context)).length;
  };
  for (const item of unlockers) {
    const markers = new Set(item.rules.flatMap((r) => (r.kind === 'grant' ? [r.id] : [])));
    const reading = [...elements.all()].filter((e) => [...namedIds(e.requirements)].some((id) => markers.has(id)));
    const readingFeats = feats.filter((f) => reading.includes(f));
    const character = setInventoryEntry(before.character, { instanceId: 'unlocker', elementId: item.id, equipped: true });
    const after = new CharacterBuilder(character, system, elements).getState();
    t.diagnostic(
      `${item.name} (${item.source}): read by ${reading.length} (${tally(reading.map((e) => e.type), 4)}); ` +
        `of its ${readingFeats.length} feats a 2014 Human Fighter 1 qualifies for ${holding(before, readingFeats)} before and ${holding(after, readingFeats)} after`,
    );
  }
});

test('the multiclass unlocker: what a short score flags with it equipped', { skip: corpusSkip }, async (t) => {
  // Its marker is read where a class's `<multiclass>` block writes `… || <marker>`, which an element's own requirements
  // do not show. A Fighter with every score 3 is asked which classes it may take and which are flagged, before and after.
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const item = [...elements.all()].find((e) => isFamily(e) && /multiclass unlocker/i.test(e.name));
  if (!item) return void t.diagnostic('no multiclass unlocker in this corpus');
  const markers = new Set(item.rules.flatMap((r) => (r.kind === 'grant' ? [r.id] : [])));
  const blocks = elements.byType('Class').filter((c) => [...namedIds(c.multiclass?.requirements)].some((id) => markers.has(id)));
  t.diagnostic(`${item.name}: named in the multiclass requirements of ${blocks.length} of ${elements.byType('Class').length} classes (${tally(blocks.map((c) => c.source), 4)})`);
  const options = (equipped: boolean) => {
    let character: Character = { ...newCharacterOfKind(system, 'pc'), progress: 3 };
    for (const ability of ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']) character = { ...character, baseStats: { ...character.baseStats, [ability]: 3 } };
    if (equipped) character = setInventoryEntry(character, { instanceId: 'unlocker', elementId: item.id, equipped: true });
    const builder = new CharacterBuilder(character, system, elements);
    const fighter = elements.byType('Class').find((c) => c.name === 'Fighter' && c.source === 'Player’s Handbook')!;
    builder.choose('build/class', [fighter.id]);
    return builder.classLevelsFor('levels')!.options;
  };
  for (const equipped of [false, true]) {
    const o = options(equipped);
    t.diagnostic(`  ${equipped ? 'with' : 'without'} it: ${o.filter((x) => x.eligible).length} of ${o.length} classes may be taken, ${o.filter((x) => x.flag).length} flagged, refused ${tally(o.filter((x) => !x.eligible).map((x) => x.unavailable ?? '?'), 4)}`);
  }
});

/** The equip steps the player character declares, by their key. */
function equipSteps(system: Awaited<ReturnType<typeof loadShippedSystem>>): string[] {
  const pc = system.characterKinds.find((k) => k.id === 'pc')!;
  return (pc.buildSteps ?? []).filter((step) => step.equip).map((step) => `build/${step.id}`);
}

test('every hidden switch but the optional class features is offered by an equip step, and nothing without rules is', { skip: corpusSkip }, async () => {
  // Fails if either of ADR 0089's steps is removed (its family is not offered), or if a step offers by "hidden" alone (a
  // mount is offered). The optional class features are left out: their step offers only a class's own (ADR 0081).
  const system = await loadShippedSystem('dnd5e');
  const { builder, elements } = await baseline(4);
  const state = builder.getState();
  const offered = new Map<string, string>();
  for (const key of equipSteps(system)) {
    for (const id of state.decisions.find((d) => d.id === key)?.candidates ?? []) offered.set(id, key);
  }
  const family = [...elements.all()].filter(isFamily);
  const switches = family.filter((e) => e.rules.length > 0);
  assert.ok(switches.length > 0, 'the corpus has hidden switches');
  const missing = switches.filter((e) => !offered.has(e.id)).map((e) => `${e.name} (${category(e)})`);
  assert.deepEqual(missing, [], 'every hidden switch is offered by a step');
  const inert = family.filter((e) => e.rules.length === 0 && offered.has(e.id)).map((e) => e.name);
  assert.deepEqual(inert, [], 'no hidden item without rules is offered');
  const byStep = new Map<string, Set<string>>();
  for (const e of switches) byStep.set(offered.get(e.id)!, new Set([...(byStep.get(offered.get(e.id)!) ?? []), category(e)]));
  for (const [key, categories] of byStep) assert.equal(categories.size, 1, `${key} offers one family: ${[...categories].join(', ')}`);
});

test('a speed item taken from its step shows its speed under Other Speeds, and taken back shows none', { skip: corpusSkip }, async () => {
  // Fails if the player character declares no speed:<mode>, or no section shows it, or the step records a choice.
  const system = await loadShippedSystem('dnd5e');
  const { builder, elements } = await baseline(4);
  const item = [...elements.all()].find(
    (e) => isFamily(e) && e.rules.some((r) => r.kind === 'stat' && r.name === 'innate speed:climb' && r.value.kind === 'ref'),
  );
  assert.ok(item, 'the corpus has an item giving a climbing speed equal to walking');
  const key = equipSteps(system).find((k) => builder.getState().decisions.find((d) => d.id === k)?.candidates.includes(item.id));
  assert.ok(key, 'a step offers it');
  const speeds = () => builder.getState().sheet.sections.find((s) => s.section === 'speeds' || s.id === 'speeds');
  assert.equal(speeds(), undefined, 'a Human shows no other speed');
  builder.choose(key, [item.id]);
  const state = builder.getState();
  assert.deepEqual(state.character.inventory?.map((e) => [e.elementId, e.equipped]), [[item.id, true]]);
  assert.equal(state.character.choices.some((c) => c.ruleKey === key), false);
  const walking = state.derived.stats.get('speed')?.value;
  assert.deepEqual(speeds()?.rows.map((r) => [r.stat, r.value]), [['speed:climb', String(walking)]]);
  builder.choose(key, []);
  assert.equal(speeds(), undefined, 'taken back, no other speed');
  assert.equal(builder.getState().character.inventory, undefined);
});

test('the Companion Selection taken from its step holds the creature chosen, shown as its own stat block', { skip: corpusSkip }, async () => {
  // Fails if the step does not offer it, if its select is not opened, or if the creature is not held and shown (ADR 0073).
  const system = await loadShippedSystem('dnd5e');
  const { builder, elements } = await baseline(4);
  const item = [...elements.all()].find((e) => isFamily(e) && e.rules.some((r) => r.kind === 'select' && r.type === 'Companion' && !r.supports));
  assert.ok(item, 'the corpus has a selection item offering every creature');
  const key = equipSteps(system).find((k) => builder.getState().decisions.find((d) => d.id === k)?.candidates.includes(item.id));
  assert.ok(key, 'a step offers it');
  builder.choose(key, [item.id]);
  const select = builder.getState().decisions.find((d) => d.from === item.id && d.kind === 'select');
  assert.ok(select && select.candidates.length > 0, 'it opens its creature select');
  const creature = select.candidates[0]!;
  builder.choose(select.id, [creature]);
  assert.deepEqual(builder.getState().companions?.creatures.map((c) => c.elementId), [creature]);
  assert.ok(builder.getState().companions!.creatures[0]!.sections.length > 0, 'shown with sections of its own');
  builder.choose(key, []);
  const after = builder.getState();
  assert.equal(after.companions, undefined, 'taken back, no creature');
  assert.equal(after.character.choices.some((c) => c.ruleKey === select.id), false, 'its answer goes with it');
});

test('which samples show another speed now that the sheet declares them', { skip: savesSkip }, async (t) => {
  const elements = await realElements();
  const rows: string[] = [];
  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const speeds = ['speed:burrow', 'speed:climb', 'speed:fly', 'speed:swim'].flatMap((stat) => {
      const value = run.derived.stats.get(stat)?.value ?? 0;
      return value ? [`${stat} ${value}`] : [];
    });
    if (speeds.length) rows.push(`${sample.id}: ${speeds.join(', ')}`);
  }
  t.diagnostic(`samples with another speed: ${rows.length}${rows.length ? `: ${rows.join('; ')}` : ''}`);
});

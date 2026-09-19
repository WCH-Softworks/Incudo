/**
 * Which recorded choice answers a top-level pick — the race, class and background nothing
 * declares a select for.
 *
 * The builder writes an answer under `build/<stepId>`, but an imported Aurora save records the
 * same fact under Aurora's own key (`ID_LEVEL_1/select:Race`), and the importer is frozen. A
 * lookup by key therefore found nothing on exactly the characters that already had a race, so all
 * three picks read as open and blocking, and choosing a race added a *second* Race choice beside
 * the imported one, with both seeding the derivation.
 *
 * So an answer is found by what it holds, the way `firstClassOf` (multiclass.ts) finds a first
 * class: a recorded choice holding an element whose type is one of the step's `types`. The
 * builder's own key is looked at first, so a character this builder wrote is read exactly as
 * before. Nothing here names a game: the types are the step's declaration.
 *
 * `reserved` is for the rule keys a content `select` pool already owns. Such a pool is published
 * as its own pick, so counting its record as a top-level answer too would list it twice and let
 * one write serve two controls. None of the 740 corpus files has a select of Race, Class or
 * Background type, so in 5e it is empty in practice; another system's content may not be.
 */

import {
  getChoice,
  setChoice,
  type BuildStepDef,
  type Character,
  type Choice,
  type ElementId,
  type ElementIndex,
} from '@incudo/core';

/**
 * The rule key a top-level pick is recorded under when the builder writes it.
 *
 * Not an `<element>/select:<name>` key, because no element declares a select for a 5e character's
 * race — Aurora's app asks for it directly. The convention predates this function: the committed
 * fixture save records `"ruleKey": "build/kin"`, and `aurora-import` documents the same shape
 * above `OPTIONS_RULE_KEY`.
 */
export function pickRuleKey(stepId: string): string {
  return `build/${stepId}`;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The steps that are a single top-level pick. Only `required` ones, and never a `perLevel` one:
 * what a level was spent on is `Character.advancement` and belongs to `setProgress` (ADR 0015),
 * not to a choice. Steps that are neither — equipment, spells, details — are left alone rather
 * than given an invented decision, because the bag (ADR 0024) and content's own selects own them.
 * A `multiple` step is answered by a set and is published by `setSteps` in the builder instead;
 * validation refuses `required` beside it, and this keeps a definition that skipped validation
 * from being published as both.
 */
export function topLevelPickSteps(steps: readonly BuildStepDef[]): BuildStepDef[] {
  return steps.filter(
    (step) => step.required && !step.multiple && !step.perLevel && step.types.length > 0,
  );
}

function holdsStepType(choice: Choice, step: BuildStepDef, elements: ElementIndex): boolean {
  return choice.elementIds.some((id) => {
    const type = elements.get(id)?.type;
    return type !== undefined && step.types.includes(type);
  });
}

/**
 * The recorded choice that answers a pick, or undefined while it is open.
 *
 * `build/<stepId>` wins when it holds anything, whatever the elements' types — it is the builder's
 * own record and needs no interpretation. Otherwise the first choice, in the order recorded, that
 * holds an element of one of the step's types.
 */
export function pickAnswerOf(
  character: Character,
  step: BuildStepDef,
  elements: ElementIndex,
  reserved: ReadonlySet<string> = NONE,
): Choice | undefined {
  const own = getChoice(character, pickRuleKey(step.id));
  if (own?.elementIds.length) return own;
  return character.choices.find(
    (choice) => !reserved.has(choice.ruleKey) && holdsStepType(choice, step, elements),
  );
}

/** The top-level pick a rule key is the answer to, if it is one. */
export function pickStepForKey(
  character: Character,
  steps: readonly BuildStepDef[],
  elements: ElementIndex,
  ruleKey: string,
  reserved: ReadonlySet<string> = NONE,
): BuildStepDef | undefined {
  if (reserved.has(ruleKey)) return undefined;
  return topLevelPickSteps(steps).find(
    (step) =>
      ruleKey === pickRuleKey(step.id) ||
      pickAnswerOf(character, step, elements, reserved)?.ruleKey === ruleKey,
  );
}

/**
 * Answer a pick, replacing what answered it before instead of adding beside it.
 *
 * `ruleKey` is written as given — `SettledPick.ruleKey` is the key the answer already lives under,
 * so an imported record is changed where it is and stays keyed as the importer keyed it. Any
 * *other* record that answers the same step is then dropped, and only one made entirely of that
 * step's types: that is what an earlier build of this app left behind, a `build/race` written
 * beside an imported `ID_LEVEL_1/select:Race`, and it is repaired by the first change rather than
 * left to seed a second race.
 */
export function replacePickAnswer(
  character: Character,
  step: BuildStepDef,
  ruleKey: string,
  elementIds: ElementId[],
  elements: ElementIndex,
  reserved: ReadonlySet<string> = NONE,
): Character {
  const next = setChoice(character, ruleKey, elementIds);
  // Clearing a pick leaves whatever else answers it alone: taking an answer back is not a
  // decision about a record this call was never handed.
  if (!elementIds.length) return next;
  const superseded = (choice: Choice): boolean =>
    choice.ruleKey !== ruleKey &&
    !reserved.has(choice.ruleKey) &&
    choice.elementIds.length > 0 &&
    choice.elementIds.every((id) => {
      const type = elements.get(id)?.type;
      return type !== undefined && step.types.includes(type);
    });
  return { ...next, choices: next.choices.filter((choice) => !superseded(choice)) };
}

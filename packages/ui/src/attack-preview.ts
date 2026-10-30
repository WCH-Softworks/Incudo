/**
 * What a preview says about an element that makes an attack, before anyone holds it: its damage, other dice, range and
 * properties as content writes them (core's `statedAttack`). Most weapons carry no description of their own, so without
 * this a weapon's preview read "No description available." and never named its die.
 */

import type { StatedAttack } from '@incudo/core';

/** The preview's lines: "Damage: 1d8 slashing, two-handed 1d10", "Range: 80/320", "Properties: Light, Thrown". */
export function statedAttackLines(stated: StatedAttack | undefined): string[] {
  if (!stated) return [];
  const lines: string[] = [];
  const damage = [
    ...(stated.dice !== undefined ? [stated.damageType ? `${stated.dice} ${stated.damageType}` : stated.dice] : []),
    ...stated.alternatives.map((alternative) => `${alternative.label} ${alternative.dice}`),
  ];
  if (damage.length) lines.push(`Damage: ${damage.join(', ')}`);
  if (stated.range !== undefined) lines.push(`Range: ${stated.range}`);
  if (stated.properties.length) lines.push(`Properties: ${stated.properties.join(', ')}`);
  return lines;
}

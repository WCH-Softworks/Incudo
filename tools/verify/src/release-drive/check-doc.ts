/**
 * docs/RELEASE-CHECK.md read as data: its numbered steps, who checks each, and the readings table. The drive takes its
 * step list and its expected numbers from here, so the written check and the drive cannot drift apart.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../node-system.ts';

export type CheckedBy = 'drive and person' | 'person only';

export interface CheckStep {
  number: number;
  title: string;
  by: CheckedBy;
}

export interface Reading {
  character: string;
  label: string;
  value: string;
}

export interface ReleaseCheckDoc {
  steps: CheckStep[];
  readings: Reading[];
}

export const RELEASE_CHECK_PATH: string = join(repoRoot(), 'docs', 'RELEASE-CHECK.md');

export function readReleaseCheck(text: string = readFileSync(RELEASE_CHECK_PATH, 'utf8')): ReleaseCheckDoc {
  const lines = text.split(/\r?\n/);
  const steps: CheckStep[] = [];
  for (let i = 0; i < lines.length; i++) {
    const heading = /^### (\d+)\. (.+)$/.exec(lines[i]!);
    if (!heading) continue;
    const body = lines.slice(i + 1).find((line) => line.trim() !== '') ?? '';
    const by = /^\*\*(Drive and person|Person only)\.\*\*/.exec(body);
    if (!by) throw new Error(`step ${heading[1]} ("${heading[2]}") does not open with **Drive and person.** or **Person only.**`);
    steps.push({ number: Number(heading[1]), title: heading[2]!, by: by[1]!.toLowerCase() as CheckedBy });
  }

  const start = lines.findIndex((line) => line === '## Readings');
  const readings: Reading[] = [];
  if (start >= 0) {
    for (const line of lines.slice(start + 1)) {
      if (line.startsWith('## ')) break;
      const cells = /^\|(.+)\|$/.exec(line.trim())?.[1]?.split('|').map((cell) => cell.trim());
      if (!cells || cells.length !== 3 || cells[0] === 'Character' || /^-+$/.test(cells[0]!)) continue;
      readings.push({ character: cells[0]!, label: cells[1]!, value: cells[2]! });
    }
  }
  return { steps, readings };
}

/**
 * The rows of a sheet's text export, label to value: every `- Label: value` line, `**` dropped, the first of each label
 * kept (a held creature's rows come after the character's).
 */
export function exportedRows(markdown: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of markdown.split(/\r?\n/)) {
    const row = /^- (.+?): (.+?)\s*$/.exec(line.replace(/\*\*/g, ''));
    if (row && !rows.has(row[1]!)) rows.set(row[1]!, row[2]!);
  }
  return rows;
}

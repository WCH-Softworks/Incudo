/**
 * The sheet document written as Markdown that reads as plain text — ADR 0075.
 *
 * One renderer of `sheetDocument`, beside the Sheet pane: the character's name as the title, its kind under it, each
 * section a heading with one list of what it shows (rows as "Label: value (beside, mark)", listed elements by name, printed
 * lines as "Label: text", in the pane's order), each held creature and each kept element a heading of its own, what the
 * user wrote about the character under its own heading (ADR 0092), and a
 * kept element's text read from its HTML (`htmlToMarkdown`). Nothing but what the document holds, and nothing it holds
 * but the pane's element count, which counts internal elements and says nothing on paper.
 *
 * Every string is escaped where Markdown would misread it (`escapeMarkdown`, `escapeLineStart`), and nowhere else. The
 * result is UTF-8 text with `\n` line ends, ending in a newline.
 */

import { escapeLineStart, escapeMarkdown, htmlToMarkdown } from './html-markdown.ts';
import { listedHead, listedName, listedUsage, PREREQUISITES_UNMET, rowAside, type SheetDocument } from './sheet-document.ts';
import type { SheetListedElement, SheetSectionView } from './sheet.ts';

export function sheetMarkdown(document: SheetDocument): string {
  const blocks: string[] = [];
  const heading = (level: number, text: string): void => void blocks.push(`${'#'.repeat(level)} ${escapeMarkdown(text)}`);
  const paragraph = (text: string): void => {
    const written = text
      .split('\n')
      .map((line) => escapeLineStart(escapeMarkdown(line.trim())))
      .filter(Boolean)
      .join('\n');
    if (written) blocks.push(written);
  };
  const named = (name: string, source?: string): string => (source ? `${name} · ${source}` : name);

  heading(1, document.title);
  paragraph(document.kindName);

  const sections = (list: readonly SheetSectionView[], level: number): void => {
    for (const section of list) {
      heading(level, section.label);
      if (section.description) paragraph(section.description);
      const items = sectionItems(section);
      if (items.length) blocks.push(items.map((item) => `- ${escapeLineStart(item)}`).join('\n'));
    }
  };
  sections(document.sections, 2);

  if (document.companions) {
    heading(2, document.companions.label);
    if (document.companions.description) paragraph(document.companions.description);
    for (const creature of document.companions.creatures) {
      heading(3, named(creature.name, creature.source));
      if (creature.from) paragraph(creature.from);
      for (const note of creature.notes) paragraph(note);
      sections(creature.sections, 4);
    }
  }

  if (document.freeform) {
    heading(2, document.freeform.label);
    for (const group of document.freeform.groups) {
      // A group heads its fields; fields in no group sit under the part's own heading.
      if (group.label !== undefined) heading(3, group.label);
      // One-line fields are a list, "Age: 30"; a multi-line field is a heading over its paragraphs.
      let list: string[] = [];
      const flush = (): void => {
        if (list.length) blocks.push(list.join('\n'));
        list = [];
      };
      for (const entry of group.entries) {
        if (entry.multiline) {
          flush();
          heading(group.label !== undefined ? 4 : 3, entry.label);
          for (const text of entry.text.split(/\n\s*\n/)) paragraph(text);
        } else {
          list.push(`- ${escapeLineStart(`${escapeMarkdown(entry.label)}: ${escapeMarkdown(entry.text.replace(/\s*\n\s*/g, ' '))}`)}`);
        }
      }
      flush();
    }
  }

  if (document.references) {
    heading(2, document.references.label);
    for (const entry of document.references.entries) {
      heading(3, named(entry.name, entry.source));
      const text = entry.html ? htmlToMarkdown(entry.html, { headingLevel: 4 }) : '';
      if (text) blocks.push(text);
      else if (entry.note) paragraph(entry.note);
    }
  }

  return `${blocks.join('\n\n')}\n`;
}

/** One section's list items, escaped: its rows, then the elements it lists, then its printed lines, as the pane draws them. */
function sectionItems(section: SheetSectionView): string[] {
  const e = escapeMarkdown;
  return [
    ...section.rows.map((row) => {
      const aside = rowAside(row);
      return `${e(row.label)}: ${e(row.value)}${aside !== undefined ? ` (${e(aside)})` : ''}`;
    }),
    ...section.elements.map(elementItem),
    ...section.printed.map((line) => `${e(line.label)}: ${e(line.text)}`),
  ];
}

/**
 * A listed element: its name, and when content writes it a sheet line (ADR 0076), the name in bold with what using it
 * takes and its text: "**Rage** (Bonus Action; 3/Long Rest): In battle, …". Each line of the text is its own line of
 * the item, ending in two spaces so a Markdown reader breaks it where a plain-text reader sees it break.
 */
function elementItem(element: SheetListedElement): string {
  const e = escapeMarkdown;
  const usage = listedUsage(element);
  const name = usage !== undefined || element.text !== undefined ? `**${e(listedName(element))}**` : e(listedName(element));
  const head = listedHead(element, name, e);
  const lines = (element.text ?? '')
    .split('\n')
    .map((line) => htmlToMarkdown(line).replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
  return lines.length ? `${head}: ${lines.join('  \n  ')}` : head;
}

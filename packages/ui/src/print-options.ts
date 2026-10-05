/**
 * What goes on a printed sheet, chosen before the platform's print dialog — ADR 0078.
 *
 * "Print sheet…" opens a small step of the app's own: which parts of the sheet print (the character's own sections, the
 * creatures it holds, what the user wrote about it (ADR 0092), what it keeps for reference), whether the pages carry their own numbers, and whether pages after
 * the first carry the character's name. Its Print opens the platform's dialog, unchanged.
 *
 * This is the step's view-model. It reads the sheet document (ADR 0075) and nothing else: never the builder's state and
 * never a kind's id, so a part is offered exactly when the document has it, whatever the game. What it chooses reaches
 * the print rules as classes on the Sheet (the stylesheet hides an omitted part and picks the page rule from the running
 * items) and, for the name, one generated `@page` rule, since a margin box cannot read the page's markup. No second
 * renderer (ADR 0077 decision 1).
 *
 * "Export sheet as PDF…" opens the same step (ADR 0079 decision 1): a PDF is the print, written to a file, so its parts,
 * page numbers and running name are the same choices, and the step offers one more, the paper, which reaches the page as
 * a `@page` size rule and the PDF writer as a size. A print leaves the paper to the platform's dialog, as before.
 *
 * The choices are remembered per user, in `Storage` under `PRINT_OPTIONS_KEY`, written when Print is pressed and never on
 * Cancel. Not per character: a paper preference is no input to a derivation (ADR 0006) and would raise a printed
 * character's format and travel with the file. A remembered omission of a part a sheet does not have is kept for the next
 * sheet that has it, and does nothing here.
 */

import type { PaperSize, Storage } from '@incudo/core';

import type { SheetDocument } from './sheet-document.ts';

/** A part of a sheet, named by the document's own field. */
export type PrintPart = 'sections' | 'companions' | 'freeform' | 'references';

export const PRINT_PARTS: readonly PrintPart[] = ['sections', 'companions', 'freeform', 'references'];

/** The papers a PDF is written on. A print's paper is the platform dialog's. */
export type Paper = 'a4' | 'letter';

export const PAPERS: Readonly<Record<Paper, { label: string; css: string; size: PaperSize }>> = {
  a4: { label: 'A4 (210 × 297 mm)', css: '210mm 297mm', size: { widthInches: 210 / 25.4, heightInches: 297 / 25.4 } },
  letter: { label: 'Letter (8.5 × 11 in)', css: '8.5in 11in', size: { widthInches: 8.5, heightInches: 11 } },
};

/** What the step leads to: the platform's print dialog, or a PDF written with no dialog (ADR 0079). */
export type PrintTarget = 'print' | 'pdf';

const LETTER_REGIONS = new Set(['BZ', 'CA', 'CL', 'CO', 'CR', 'GT', 'MX', 'NI', 'PA', 'PH', 'PR', 'SV', 'US', 'VE']);

/**
 * The paper a first PDF is offered, from the user's languages: Letter where the first language naming a region names one
 * that uses it (the regions CLDR gives Letter), A4 everywhere else and when none names a region. Only a first guess: the
 * choice made in the step is remembered.
 */
export function paperForLocales(locales: readonly string[]): Paper {
  for (const locale of locales) {
    const region = /^[a-z]{2,3}(?:[-_][a-z]{4})?[-_]([a-z]{2})(?:[-_]|$)/i.exec(locale)?.[1]?.toUpperCase();
    if (region) return LETTER_REGIONS.has(region) ? 'letter' : 'a4';
  }
  return 'a4';
}

/** What is chosen. Parts are recorded as left out, so a part a sheet gains later prints unless it was left out before. */
export interface PrintOptions {
  omit: PrintPart[];
  /** "Page N of M" at the foot of every page. */
  pageNumbers: boolean;
  /** The character's name at the head of every page after the first. */
  runningName: boolean;
  /** The paper a PDF is written on; a print does not read it. */
  paper: Paper;
}

/** Every part, page numbers, the name on later pages, and A4 unless the user's languages say otherwise (`paperForLocales`). */
export const DEFAULT_PRINT_OPTIONS: PrintOptions = { omit: [], pageNumbers: true, runningName: true, paper: 'a4' };

/** Where the remembered choices are kept, one record per user. */
export const PRINT_OPTIONS_KEY = 'print/options';

/** What the character's own sections are called in the step: the document names the other two parts, not this one. */
export const OWN_SECTIONS_LABEL = "The character's own sections";

export interface PrintPartChoice {
  part: PrintPart;
  label: string;
  chosen: boolean;
  /** The last part chosen: unticking it would print nothing, so it cannot be. */
  locked: boolean;
}

export interface PrintToggle {
  label: string;
  chosen: boolean;
}

export interface PaperChoice {
  paper: Paper;
  label: string;
  chosen: boolean;
}

export interface PrintOptionsView {
  heading: string;
  lede: string;
  /** What the step's button says: it prints, or it exports. */
  submit: string;
  /** Absent when the sheet has only its own sections: one part that cannot be left out is not a choice. */
  parts?: { label: string; choices: PrintPartChoice[] };
  pageNumbers: PrintToggle;
  runningName: PrintToggle;
  /** Only when the step leads to a PDF: a print's paper is the dialog's. */
  paper?: { label: string; choices: PaperChoice[] };
  /** The options as this sheet reads them: what Print would record and print. */
  options: PrintOptions;
}

/** The parts this document has, in the order it prints them. */
export function printPartsOf(document: SheetDocument): PrintPart[] {
  const parts: PrintPart[] = ['sections'];
  if (document.companions && document.companions.creatures.length > 0) parts.push('companions');
  if (document.freeform && document.freeform.groups.length > 0) parts.push('freeform');
  if (document.references && document.references.entries.length > 0) parts.push('references');
  return parts;
}

function partLabel(document: SheetDocument, part: PrintPart): string {
  if (part === 'companions') return document.companions!.label;
  if (part === 'references') return document.references!.label;
  if (part === 'freeform') return document.freeform!.label;
  return OWN_SECTIONS_LABEL;
}

/**
 * The options as a sheet reads them: at least one of its parts chosen. A remembered set that would leave every part of
 * this sheet out prints its own sections. Omissions of parts it does not have are kept, untouched.
 */
export function normalizePrintOptions(options: PrintOptions, document: SheetDocument): PrintOptions {
  const parts = printPartsOf(document);
  const omit = PRINT_PARTS.filter((part) => options.omit.includes(part));
  const kept = parts.filter((part) => !omit.includes(part));
  return {
    omit: kept.length > 0 ? omit : omit.filter((part) => part !== 'sections'),
    pageNumbers: options.pageNumbers,
    runningName: options.runningName,
    paper: options.paper,
  };
}

export function printOptionsView(document: SheetDocument, options: PrintOptions, target: PrintTarget = 'print'): PrintOptionsView {
  const normal = normalizePrintOptions(options, document);
  const parts = printPartsOf(document);
  const chosen = parts.filter((part) => !normal.omit.includes(part));
  return {
    ...(target === 'pdf'
      ? {
          heading: 'Export sheet as PDF',
          lede: 'Choose what goes on the page and the paper. The file is named in the save dialog that follows.',
          submit: 'Export…',
        }
      : {
          heading: 'Print sheet',
          lede: 'Choose what goes on the page. The printer, paper and copies are chosen in the print dialog that follows.',
          submit: 'Print…',
        }),
    ...(parts.length > 1
      ? {
          parts: {
            label: 'Print',
            choices: parts.map((part) => ({
              part,
              label: partLabel(document, part),
              chosen: chosen.includes(part),
              locked: chosen.length === 1 && chosen[0] === part,
            })),
          },
        }
      : {}),
    pageNumbers: { label: 'Page numbers at the foot of each page', chosen: normal.pageNumbers },
    runningName: { label: "The character's name at the top of each page after the first", chosen: normal.runningName },
    ...(target === 'pdf'
      ? {
          paper: {
            label: 'Paper',
            choices: (Object.keys(PAPERS) as Paper[]).map((paper) => ({ paper, label: PAPERS[paper].label, chosen: normal.paper === paper })),
          },
        }
      : {}),
    options: normal,
  };
}

/** A part chosen or left out. The last chosen part of this sheet stays chosen, and a part it lacks changes nothing. */
export function withPrintPart(options: PrintOptions, document: SheetDocument, part: PrintPart, chosen: boolean): PrintOptions {
  const normal = normalizePrintOptions(options, document);
  if (!printPartsOf(document).includes(part)) return normal;
  const omit = chosen ? normal.omit.filter((p) => p !== part) : [...normal.omit, part];
  const next = { ...normal, omit: PRINT_PARTS.filter((p) => omit.includes(p)) };
  return printPartsOf(document).some((p) => !next.omit.includes(p)) ? next : normal;
}

export function withPageNumbers(options: PrintOptions, pageNumbers: boolean): PrintOptions {
  return { ...options, pageNumbers };
}

export function withRunningName(options: PrintOptions, runningName: boolean): PrintOptions {
  return { ...options, runningName };
}

export function withPaper(options: PrintOptions, paper: Paper): PrintOptions {
  return { ...options, paper };
}

// --- what the Sheet is given ------------------------------------------------------------------

/** The named page the Sheet prints on, for each combination of running items; the default page when there are none. */
export function printPageName(options: Pick<PrintOptions, 'pageNumbers' | 'runningName'>): string | undefined {
  if (options.pageNumbers && options.runningName) return 'sheet-named-numbered';
  if (options.runningName) return 'sheet-named';
  if (options.pageNumbers) return 'sheet-numbered';
  return undefined;
}

export interface PrintRendering {
  /** For the Sheet's root. They mean something only under the print rules. */
  classes: string[];
  /**
   * The `@page` rules the page needs beyond the stylesheet's: the paper's size for a PDF, and one carrying the character's
   * name when it prints on later pages. Absent when neither.
   */
  pageRule?: string;
}

/**
 * What the Sheet is given for a print: a class per omitted part it has (`print-omit-<part>`) and per running item
 * (`print-page-numbers`, `print-running-name`), the name's rule, and for a PDF the paper's size (a print's paper is the
 * dialog's). The stylesheet does the rest.
 */
export function printRendering(options: PrintOptions, document: SheetDocument, target: PrintTarget = 'print'): PrintRendering {
  const normal = normalizePrintOptions(options, document);
  const parts = printPartsOf(document);
  const classes = parts.filter((part) => normal.omit.includes(part)).map((part) => `print-omit-${part}`);
  if (normal.pageNumbers) classes.push('print-page-numbers');
  if (normal.runningName) classes.push('print-running-name');
  const page = printPageName(normal);
  const rules = [
    ...(target === 'pdf' ? [`@page { size: ${PAPERS[normal.paper].css}; }`] : []),
    ...(normal.runningName ? [`@page ${page} { @top-left { content: ${cssString(document.title)}; } }`] : []),
  ];
  return { classes, ...(rules.length ? { pageRule: rules.join('\n') } : {}) };
}

/**
 * Text as a CSS string, double-quoted: a quote and a backslash escaped, and every character below U+0020 or U+007F
 * written as a hexadecimal escape followed by a space, so a line break or a control character in a name cannot end the
 * string or the rule.
 */
export function cssString(text: string): string {
  let out = '"';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === '"' || ch === '\\') out += `\\${ch}`;
    else if (code < 0x20 || code === 0x7f) out += `\\${code.toString(16)} `;
    else out += ch;
  }
  return `${out}"`;
}

// --- remembered ---------------------------------------------------------------------------------

/**
 * Read a stored record, falling back to the default field by field: a field of the wrong shape is the default's, and a
 * part the view-model does not know is not left out. Nothing that does not parse is an error; it is the defaults.
 */
export function parsePrintOptions(text: string | null, defaults: PrintOptions = DEFAULT_PRINT_OPTIONS): PrintOptions {
  let value: unknown;
  try {
    value = text === null ? undefined : JSON.parse(text);
  } catch {
    value = undefined;
  }
  const record = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const omit = Array.isArray(record.omit) ? PRINT_PARTS.filter((part) => (record.omit as unknown[]).includes(part)) : defaults.omit;
  const flag = (field: unknown, fallback: boolean): boolean => (typeof field === 'boolean' ? field : fallback);
  return {
    omit: [...omit],
    pageNumbers: flag(record.pageNumbers, defaults.pageNumbers),
    runningName: flag(record.runningName, defaults.runningName),
    paper: typeof record.paper === 'string' && Object.hasOwn(PAPERS, record.paper) ? (record.paper as Paper) : defaults.paper,
  };
}

/**
 * The remembered choices, or the defaults when nothing is stored or the storage cannot be read. A shell passes defaults
 * with the paper its user's languages suggest (`paperForLocales`).
 */
export async function readPrintOptions(storage: Storage, defaults: PrintOptions = DEFAULT_PRINT_OPTIONS): Promise<PrintOptions> {
  try {
    return parsePrintOptions(await storage.read(PRINT_OPTIONS_KEY), defaults);
  } catch {
    return parsePrintOptions(null, defaults);
  }
}

/**
 * How the step ends, and what is in force after it: Print records what was chosen and returns it; Cancel records nothing
 * and returns what was in force before the step opened. The shell calls this for both answers and prints on the first.
 */
export async function finishPrintStep(
  storage: Storage,
  answer: 'print' | 'cancel',
  chosen: PrintOptions,
  before: PrintOptions,
): Promise<PrintOptions> {
  if (answer === 'cancel') return before;
  try {
    await writePrintOptions(storage, chosen);
  } catch {
    // A preference that could not be written is not a reason not to print.
  }
  return chosen;
}

/** Remember what Print was pressed with. Only Print calls this; Cancel remembers nothing. */
export async function writePrintOptions(storage: Storage, options: PrintOptions): Promise<void> {
  const record: PrintOptions = {
    omit: PRINT_PARTS.filter((part) => options.omit.includes(part)),
    pageNumbers: options.pageNumbers,
    runningName: options.runningName,
    paper: options.paper,
  };
  await storage.write(PRINT_OPTIONS_KEY, JSON.stringify(record));
}

/**
 * "Export sheet as text…": the sheet on screen, written as Markdown to a file the user picks — ADR 0075.
 *
 * Save a copy's sibling (ADR 0038), through the same `FileSaver` port: bytes and a suggested name in, a name or a
 * cancel out. Like a copy it changes nothing: it takes the sheet document and no library, no entry and no character, and
 * its result names the file and nothing else. It needs no content either: the document is already what the pane shows,
 * and it is the same with no source loaded (ADR 0012).
 */

import type { FileSaver, SavedFile } from '@incudo/core';

import { suggestedFileName } from './character-library.ts';
import type { SheetDocument } from './sheet-document.ts';
import { sheetMarkdown } from './sheet-markdown.ts';

export type ExportResult =
  | { status: 'saved'; file: SavedFile }
  /** The user closed the dialog. An answer: nothing was written and nothing is wrong. */
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

export async function exportSheet(saver: FileSaver, document: SheetDocument): Promise<ExportResult> {
  if (!saver.available) {
    return { status: 'failed', message: saver.unavailableReason ?? 'This platform cannot save a file.' };
  }
  try {
    // Written before the dialog opens, as a copy is packed first: nothing is asked of the user for a file that fails.
    const bytes = new TextEncoder().encode(sheetMarkdown(document));
    const file = await saver.save(bytes, {
      suggestedName: suggestedFileName(document.name, 'md'),
      title: "Export this character's sheet as text",
      extensions: ['md'],
      label: 'Text (Markdown)',
    });
    return file ? { status: 'saved', file } : { status: 'cancelled' };
  } catch (error) {
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}

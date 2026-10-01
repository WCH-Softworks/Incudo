/**
 * "Export sheet as text…": the sheet on screen, written as Markdown to a file the user picks — ADR 0075.
 *
 * Save a copy's sibling (ADR 0038), through the same `FileSaver` port: bytes and a suggested name in, a name or a
 * cancel out. Like a copy it changes nothing: it takes the sheet document and no library, no entry and no character, and
 * its result names the file and nothing else. It needs no content either: the document is already what the pane shows,
 * and it is the same with no source loaded (ADR 0012).
 */

import type { FileSaver, PaperSize, PdfWriter, SavedFile } from '@incudo/core';

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

/**
 * "Export sheet as PDF…": the page as it prints now, written as a PDF on the chosen paper, saved to a file the user picks —
 * ADR 0079 decision 2. The shell has already put the print choices on the Sheet (`printRendering(…, 'pdf')`); this asks
 * the platform for the bytes and then for a place, through the same save port as the text export, so a cancel is an
 * answer and nothing is written. The PDF is written before the dialog opens, as the text is: nothing is asked of the user
 * for a file that fails.
 */
export async function exportSheetPdf(writer: PdfWriter, saver: FileSaver, document: SheetDocument, paper: PaperSize): Promise<ExportResult> {
  if (!writer.available) {
    return { status: 'failed', message: writer.unavailableReason ?? 'This platform cannot write a PDF.' };
  }
  if (!saver.available) {
    return { status: 'failed', message: saver.unavailableReason ?? 'This platform cannot save a file.' };
  }
  try {
    const bytes = await writer.write(paper);
    const file = await saver.save(bytes, {
      suggestedName: suggestedFileName(document.name, 'pdf'),
      title: "Export this character's sheet as PDF",
      extensions: ['pdf'],
      label: 'PDF',
    });
    return file ? { status: 'saved', file } : { status: 'cancelled' };
  } catch (error) {
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}

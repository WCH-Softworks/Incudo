/**
 * The book an element names, as the conversion writes it.
 *
 * Aurora writes `source="Internal"` on what its own app generates or keeps behind the scenes: the campaign options,
 * the ability score improvement options, the `ID_INTERNAL_*` markers. It is not a book, and a screen that names an
 * element's book ("Feat — Internal") showed Aurora's word to a user. So the conversion writes no book for it, which
 * is what every screen already does with an element that names none, and what the books a character is offered
 * already did with it (it named no loaded book, so it was always offered).
 */

/** The `source` of an element that names no book. */
export const NO_BOOK = '';

/** `source` as written, `NO_BOOK` for Aurora's `Internal`, and `Unknown` when the attribute is missing. */
export function bookOf(written: string | undefined): string {
  if (written === undefined) return 'Unknown';
  return written.trim().toLowerCase() === 'internal' ? NO_BOOK : written;
}

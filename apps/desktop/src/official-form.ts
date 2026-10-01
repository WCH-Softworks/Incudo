/**
 * The PDF half of "Fill the official sheet…" — ADR 0079 decisions 3 and 5.
 *
 * Bytes in, bytes out, and nothing else: reading a PDF form's fields so `recogniseForm` (`packages/ui`) can say whether
 * it is the form a map describes, and writing `formValues` into a copy of it. pdf-lib lives here because `packages/ui`
 * may not import it (CODE-REUSE-POLICY); what goes in which field, and what was left off, is decided there.
 *
 * The user's copy is never changed: a filled copy is made from its bytes. Every field is cleared first, so a copy the
 * user once typed into fills with this character and nothing of another. The values get appearances drawn in Helvetica
 * (the form's own font), so the file reads the same in every viewer and not only in those that redraw form fields, and
 * stays a form the user can go on editing. A field the map gives a size is written at it; every other keeps the form's
 * automatic size.
 *
 * No Tauri and no DOM in here, so the tests fill a stand-in form with it under `node --test`.
 */

import { PDFButton, PDFCheckBox, PDFDocument, PDFTextField, StandardFonts } from 'pdf-lib';

import type { FormField, FormValues } from '@incudo/ui';

/** The PDF could not be read at all. A sentence for the user. */
export class NotAPdfError extends Error {}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    // `updateMetadata: false`: the filled copy keeps its producer and dates; nothing here claims to have made it.
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new NotAPdfError(`This file could not be read as a PDF. ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A PDF's form fields, by name and type, for `recogniseForm`. */
export async function readFormFields(bytes: Uint8Array): Promise<FormField[]> {
  const document = await load(bytes);
  return document
    .getForm()
    .getFields()
    .map((field) => ({
      name: field.getName(),
      type: field instanceof PDFTextField ? 'text' : field instanceof PDFCheckBox ? 'check' : field instanceof PDFButton ? 'button' : 'other',
    }));
}

/** A copy of `bytes` with every field cleared and `values` written, their appearances drawn. */
export async function fillForm(bytes: Uint8Array, values: FormValues): Promise<Uint8Array> {
  const document = await load(bytes);
  const form = document.getForm();
  for (const field of form.getFields()) {
    if (field instanceof PDFTextField) field.setText(undefined);
    else if (field instanceof PDFCheckBox) field.uncheck();
  }
  for (const [name, text] of Object.entries(values.text)) {
    const field = form.getTextField(name);
    const size = values.fontSizes[name];
    if (size !== undefined) {
      // Most of the 2014 sheet's fields have no default appearance of their own and inherit the form's (`/Helv 0 Tf 0
      // g`, automatic size), which pdf-lib's `setFontSize` refuses; the field is then given the form's font at this size.
      if (field.acroField.getDefaultAppearance()) field.setFontSize(size);
      else field.acroField.setDefaultAppearance(`/Helv ${size} Tf 0 g`);
    }
    field.setText(text);
  }
  for (const name of values.checked) form.getCheckBox(name).check();
  form.updateFieldAppearances(await document.embedFont(StandardFonts.Helvetica));
  return document.save();
}

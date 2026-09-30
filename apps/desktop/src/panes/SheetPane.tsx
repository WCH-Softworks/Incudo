/**
 * The character sheet, rendered from the kind's own declaration.
 *
 * Nothing here names a 5e stat. The sections, their labels and the stats in them come from
 * `kind.sheet` (ADR 0009), which is why the same component renders a monster stat block — and
 * why a system that has never heard of armour class gets a sheet rather than a blank pane.
 *
 * What each section shows, what each row is called and how its value is written are decided in
 * `packages/ui/src/sheet.ts` (ADR 0074), over core's `renderSheetSection` (ADRs 0020, 0062). What
 * the whole page shows, the character's held creatures and what it keeps included, is one document
 * (`sheetDocument`, ADR 0075), which the text export renders too; this draws it and composes nothing.
 *
 * Printing is this pane on paper (ADR 0077): the print rules in styles.css hide what is not the sheet, print the title
 * where the name field is, flow the character's sections and its creatures (`.sheet-flow`) in two columns, and start
 * what it keeps on a page of its own. Nothing here knows a section by name. What the print options step chose (ADR 0078)
 * arrives as classes on the root, which mean something only in print, and as one `@page` rule carrying the name.
 */

import type { CharacterBuilder, PrintRendering, SheetDocument } from '@incudo/ui';
import { ReferenceText } from './References.tsx';
import { Companions, SheetRows } from './Companions.tsx';

export function SheetPane({
  builder,
  document,
  print,
}: {
  builder: CharacterBuilder;
  document: SheetDocument;
  /** What the next print uses: `printRendering` of the choices in force. */
  print: PrintRendering;
}): React.JSX.Element {
  return (
    <main className={['pane', 'sheet', ...print.classes].join(' ')}>
      {print.pageRule && <style>{print.pageRule}</style>}
      {/* The name is edited here, and printed as the document's title: a text box prints at its own width. */}
      <h1 className="sheet-print-title">{document.title}</h1>
      <input
        className="sheet-name"
        type="text"
        value={document.name}
        onChange={(event) => builder.setName(event.target.value)}
      />
      <p className="lede">
        {document.kindName}
        <span className="sheet-element-count"> · {document.elementCount} elements</span>
      </p>

      <div className="sheet-flow">
        {document.sections.map((section) => (
          <section key={section.id} className="sheet-section">
            <h3>{section.label}</h3>
            {section.description && <p className="hint">{section.description}</p>}
            <SheetRows section={section} />
          </section>
        ))}

        {/* Each creature the character holds, as its own stat block (ADR 0073): after the character, before what it keeps. */}
        {document.companions && <Companions view={document.companions} />}
      </div>

      {/* What the character keeps beside it for reference (ADR 0068), after the sheet: text, not the character's own. */}
      {document.references && (
        <section className="sheet-section sheet-references">
          <h3>{document.references.label}</h3>
          {document.references.entries.map((entry) => (
            <article key={entry.elementId}>
              <h4>
                {entry.name}
                {entry.source && <span className="hint"> · {entry.source}</span>}
              </h4>
              <ReferenceText entry={entry} />
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

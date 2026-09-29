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
 */

import type { CharacterBuilder, SheetDocument } from '@incudo/ui';
import { ReferenceText } from './References.tsx';
import { Companions, SheetRows } from './Companions.tsx';

export function SheetPane({
  builder,
  document,
}: {
  builder: CharacterBuilder;
  document: SheetDocument;
}): React.JSX.Element {
  return (
    <main className="pane sheet">
      <input
        className="sheet-name"
        type="text"
        value={document.name}
        onChange={(event) => builder.setName(event.target.value)}
      />
      <p className="lede">
        {document.kindName} · {document.elementCount} elements
      </p>

      {document.sections.map((section) => (
        <section key={section.id} className="sheet-section">
          <h3>{section.label}</h3>
          {section.description && <p className="hint">{section.description}</p>}
          <SheetRows section={section} />
        </section>
      ))}

      {/* Each creature the character holds, as its own stat block (ADR 0073): after the character, before what it keeps. */}
      {document.companions && <Companions view={document.companions} />}

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

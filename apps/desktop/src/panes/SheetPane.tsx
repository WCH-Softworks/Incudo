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
 * A sheet whose kind declares a layout is drawn as a page (`SheetPage`, ADR 0126): a head band, a side column and tabs.
 * One that declares none is the column it always was.
 *
 * Printing is this pane on paper (ADR 0077): the print rules in styles.css hide what is not the sheet, print the title
 * where the name field is, flow the character's sections and its creatures (`.sheet-flow`) in two columns, and start
 * what it keeps on a page of its own. Nothing here knows a section by name. What the print options step chose (ADR 0078)
 * arrives as classes on the root, which mean something only in print, and as one `@page` rule carrying the name.
 */

import type { CharacterBuilder, PlayView, PrintRendering, SheetDocument } from '@incudo/ui';
import { PlayPanel } from './PlayPanel.tsx';
import { Companions, SheetRows } from './Companions.tsx';
import { FreeformSheet } from './Freeform.tsx';
import { SectionHead } from './SheetBits.tsx';
import { SheetPage } from './SheetPage.tsx';
import { SheetDescriptionsPart, SheetReferencesPart } from './SheetParts.tsx';

export function SheetPane({
  builder,
  document,
  print,
  play,
}: {
  builder: CharacterBuilder;
  document: SheetDocument;
  /** What the next print uses: `printRendering` of the choices in force. */
  print: PrintRendering;
  /** What playing the character keeps track of (ADR 0084), when its kind declares any. Not part of the document. */
  play?: PlayView;
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
      <p className="lede">{document.kindName}</p>

      {play && <PlayPanel builder={builder} view={play} />}

      {document.layout === 'page' ? (
        <SheetPage document={document} />
      ) : (
        <SheetColumn document={document} />
      )}
    </main>
  );
}

/** A sheet whose kind declares no layout: its sections in one flow, then what the user wrote, the descriptions and what it keeps. */
function SheetColumn({ document }: { document: SheetDocument }): React.JSX.Element {
  return (
    <>
      <div className="sheet-flow">
        {document.sections.map((section) => (
          <section key={section.id} className="sheet-section">
            <SectionHead section={section} />
            <SheetRows section={section} />
          </section>
        ))}

        {/* Each creature the character holds, as its own stat block (ADR 0073): after the character, before what it keeps. */}
        {document.companions && <Companions view={document.companions} />}
      </div>

      {/* What the user wrote about the character (ADR 0092): after its sections and creatures, before what it keeps. */}
      {document.freeform && <FreeformSheet part={document.freeform} />}

      {/* The whole descriptions of what the describing sections list (ADR 0114): after what the user wrote, before what it keeps. */}
      {document.descriptions && <SheetDescriptionsPart part={document.descriptions} />}

      {/* What the character keeps beside it for reference (ADR 0068), after the sheet: text, not the character's own. */}
      {document.references && <SheetReferencesPart part={document.references} />}
    </>
  );
}

/**
 * The creatures a character holds, each as its own stat block — ADR 0073.
 *
 * Renders the sheet document's creatures (`packages/ui/src/sheet-document.ts`, from `companions.ts`) and computes
 * nothing: which sections show, their rows, labels and values, and what gave each creature are decided there, against
 * the creature's own scope.
 */

import { PREREQUISITES_UNMET, type SheetDocument, type SheetSectionView } from '@incudo/ui';

/**
 * A section's rows, listed elements and printed lines, as `packages/ui/src/sheet.ts` decided them (ADR 0074). Shared by
 * the character's Sheet and each creature's stat block, which are built by the same function. Elements before printed
 * lines, so an NPC's Creature section names the creature before its size, type and alignment.
 */
export function SheetRows({ section }: { section: SheetSectionView }): React.JSX.Element {
  return (
    <>
      {section.rows.length > 0 && (
        <dl>
          {section.rows.map((row) => (
            <div key={row.stat}>
              <dt>{row.label}</dt>
              <dd>
                {row.value}
                {row.beside !== undefined && <span className="sheet-beside"> ({row.beside})</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {section.elements.length > 0 && (
        <ul className="sheet-elements">
          {section.elements.map((element) => (
            <li key={element.elementId}>
              {element.name}
              {element.prerequisitesUnmet && <span className="hint"> ({PREREQUISITES_UNMET})</span>}
            </li>
          ))}
        </ul>
      )}
      {section.printed.length > 0 && (
        <dl className="sheet-printed">
          {section.printed.map((line, index) => (
            <div key={`${line.elementId}:${index}`}>
              <dt>{line.label}</dt>
              <dd>{line.text}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

export function Companions({ view }: { view: NonNullable<SheetDocument['companions']> }): React.JSX.Element {
  return (
    <section className="sheet-section sheet-companions">
      <h3>{view.label}</h3>
      {view.description && <p className="hint">{view.description}</p>}
      {view.creatures.map((creature) => (
        <article key={creature.elementId} className="sheet-companion">
          <h4>
            {creature.name}
            {creature.source && <span className="hint"> · {creature.source}</span>}
          </h4>
          {creature.from && <p className="hint">{creature.from}</p>}
          {creature.notes.map((note) => (
            <p key={note} className="hint">
              {note}
            </p>
          ))}
          {creature.sections.map((section) => (
            <div key={section.id} className="sheet-companion-section">
              <h5>{section.label}</h5>
              {section.description && <p className="hint">{section.description}</p>}
              <SheetRows section={section} />
            </div>
          ))}
        </article>
      ))}
    </section>
  );
}

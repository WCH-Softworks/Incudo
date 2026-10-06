/**
 * The creatures a character holds, each as its own stat block — ADR 0073.
 *
 * Renders the sheet document's creatures (`packages/ui/src/sheet-document.ts`, from `companions.ts`) and computes
 * nothing: which sections show, their rows, labels and values, and what gave each creature are decided there, against
 * the creature's own scope.
 */

import { useMemo } from 'react';

import { attackAside, listedAside, listedName, listedUsage, PREREQUISITES_UNMET, rowAside, type SheetDocument, type SheetListedElement, type SheetSectionView } from '@incudo/ui';

import { sanitizeDescriptionHtml } from '../sanitize-html.ts';

/**
 * A section's rows, attacks (ADR 0093), listed elements and printed lines, as `packages/ui/src/sheet.ts` decided them (ADR 0074). Shared by
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
                {rowAside(row) !== undefined && <span className="sheet-beside"> ({rowAside(row)})</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {section.attacks && (
        <ul className="sheet-elements sheet-attacks">
          {section.attacks.map((attack) => (
            <li key={attack.instanceId}>
              <strong>{attack.name}</strong>
              {`: ${attack.bonus}, ${attack.damage}`}
              {attackAside(attack) !== undefined && <span className="sheet-beside"> ({attackAside(attack)})</span>}
            </li>
          ))}
        </ul>
      )}
      {section.elements.length > 0 && (
        <ul className="sheet-elements">
          {section.elements.map((element) => (
            <ListedElement key={element.elementId} element={element} />
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

/**
 * A listed element: its name, and what content writes for it on a sheet when it writes anything (ADR 0076), "Rage
 * (Bonus Action; 3/Long Rest): …", as `packages/ui` chose and filled it. The text is sanitized as every description is,
 * and keeps the line breaks content wrote.
 */
function ListedElement({ element }: { element: SheetListedElement }): React.JSX.Element {
  const usage = listedUsage(element);
  const aside = listedAside(element);
  const html = useMemo(() => (element.text ? sanitizeDescriptionHtml(element.text) : ''), [element.text]);
  const name = listedName(element);
  return (
    <li>
      {usage !== undefined || html ? <strong>{name}</strong> : name}
      {aside !== undefined && <span className="sheet-beside"> ({aside})</span>}
      {element.prerequisitesUnmet && <span className="hint"> ({PREREQUISITES_UNMET})</span>}
      {usage !== undefined && <span className="sheet-usage"> ({usage})</span>}
      {html && (
        <>
          {': '}
          <span className="sheet-text" dangerouslySetInnerHTML={{ __html: html }} />
        </>
      )}
    </li>
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

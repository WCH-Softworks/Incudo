/**
 * The creatures a character holds, each as its own stat block — ADR 0073.
 *
 * Renders the sheet document's creatures (`packages/ui/src/sheet-document.ts`, from `companions.ts`) and computes
 * nothing: which sections show, their rows, labels and values, and what gave each creature are decided there, against
 * the creature's own scope.
 */

import { useMemo } from 'react';

import {
  ALSO_LABEL,
  alsoText,
  attackAside,
  attackWarnings,
  bagEntryAside,
  bagEntryName,
  listedAside,
  listedName,
  listedParts,
  listedUsage,
  MONEY_LABEL,
  PREREQUISITES_UNMET,
  purseText,
  rowAside,
  type SheetDocument,
  type SheetListedElement,
  type SheetSectionView,
} from '@incudo/ui';

import { sanitizeDescriptionHtml } from '../sanitize-html.ts';
import { RowValue, SectionHead } from './SheetBits.tsx';
import { ElementPlay, PlayContext, RowPlay } from './PlayInPlace.tsx';

/**
 * A section's rows, attacks (ADR 0093), listed elements and printed lines, as `packages/ui/src/sheet.ts` decided them (ADR 0074). Shared by
 * the character's Sheet and each creature's stat block, which are built by the same function. Elements before printed
 * lines, so an NPC's Creature section names the creature before its size, type and alignment.
 */
export function SheetRows({ section }: { section: SheetSectionView }): React.JSX.Element {
  const { entries, also } = listedParts(section);
  const alsoLine = alsoText(also);
  return (
    <>
      {section.rows.length > 0 && (
        <dl>
          {section.rows.map((row) => (
            <div key={row.stat}>
              <dt>{row.label}</dt>
              <dd>
                <RowValue row={row} />
                <RowPlay section={section.id} stat={row.stat} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {section.attacks && (
        <ul className="sheet-elements sheet-attacks">
          {section.attacks.map((attack, index) => (
            // An unarmed strike has no bag entry and a spell row no entry either (ADRs 0110, 0111).
            <li key={attack.instanceId ?? attack.elementId ?? `row-${index}`}>
              <strong>{attack.name}</strong>
              {`: ${attack.bonus}, ${attack.damage}`}
              {attackAside(attack) !== undefined && <span className="sheet-beside"> ({attackAside(attack)})</span>}
              {attackWarnings(attack).map((warning) => (
                <span key={warning} className="sheet-warning">
                  {warning}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {entries.length > 0 && (
        <ul className="sheet-elements">
          {entries.map((element) => (
            <ListedElement key={element.elementId} element={element} section={section.id} />
          ))}
        </ul>
      )}
      {section.bag && (
        <ul className="sheet-elements sheet-bag">
          {section.bag.map((entry) => (
            <li key={entry.instanceId}>
              {bagEntryName(entry)}
              {bagEntryAside(entry) !== undefined && <span className="sheet-beside"> ({bagEntryAside(entry)})</span>}
            </li>
          ))}
        </ul>
      )}
      {section.purse && (
        <dl className="sheet-purse">
          <div>
            <dt>{MONEY_LABEL}</dt>
            <dd>{purseText(section.purse)}</dd>
          </div>
        </dl>
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
      {/* What the section lists with nothing to say, named once (ADR 0126). */}
      {alsoLine !== undefined && (
        <p className="sheet-also">
          {ALSO_LABEL}: {alsoLine}
        </p>
      )}
    </>
  );
}

/**
 * A listed element: its name, and what content writes for it on a sheet when it writes anything (ADR 0076), "Rage
 * (Bonus Action; 3/Long Rest): …", as `packages/ui` chose and filled it. The text is sanitized as every description is,
 * and keeps the line breaks content wrote.
 */
export function ListedElement({ element, className, section }: { element: SheetListedElement; className?: string; section?: string }): React.JSX.Element {
  const usage = listedUsage(element);
  const aside = listedAside(element);
  const html = useMemo(() => (element.text ? sanitizeDescriptionHtml(element.text) : ''), [element.text]);
  const name = listedName(element);
  return (
    <li {...(className ? { className } : {})}>
      {usage !== undefined || html ? <strong>{name}</strong> : name}
      {aside !== undefined && <span className="sheet-beside"> ({aside})</span>}
      {element.prerequisitesUnmet && <span className="hint"> ({PREREQUISITES_UNMET})</span>}
      {usage !== undefined && <span className="sheet-usage"> ({usage})</span>}
      {/* What its uses spend, drawn on it on a laid-out sheet (ADR 0126). */}
      {section !== undefined && <ElementPlay section={section} element={element.elementId} />}
      {html && (
        <>
          {': '}
          <span className="sheet-text" dangerouslySetInnerHTML={{ __html: html }} />
        </>
      )}
      {/* The sheet's own line under it, not content's (ADR 0112). */}
      {element.note !== undefined && <div className="sheet-note">{element.note}</div>}
    </li>
  );
}

export function Companions({ view }: { view: NonNullable<SheetDocument['companions']> }): React.JSX.Element {
  // A creature's stat block spends nothing of its holder's: its sections' ids are its own (ADR 0126).
  return (
    <PlayContext.Provider value={null}>
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
              <SectionHead section={section} level={5} />
              <SheetRows section={section} />
            </div>
          ))}
        </article>
      ))}
    </section>
    </PlayContext.Provider>
  );
}

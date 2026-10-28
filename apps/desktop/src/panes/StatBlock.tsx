/**
 * A sheet laid out as a stat block — ADR 0126 decision 7: one column read as a printed stat block reads, and the play
 * column beside it.
 *
 * The head sections are its first lines (what the creature is, in italics; then armour class, hit points, speed as lines);
 * the ability scores are a table in the shape the creature opens in (`SheetStatBlock.wide`, from its book), which the
 * reader may switch and nothing records (the maintainer's call); every other section of rows is one labelled line; and
 * what a section lists is drawn under its heading, "Name: text". Nothing here knows a section by name: the head is the
 * sections placed there, and the table is the document's.
 */

import { useId, useState } from 'react';

import { listedAside, listedName, rowAside, type SheetDocument, type SheetSectionView } from '@incudo/ui';

import { ListedElement } from './Companions.tsx';
import { PlayContext, PlayStrip, type PlayHere } from './PlayInPlace.tsx';
import { MarkDots, RowValue, SectionHead } from './SheetBits.tsx';
import { DocumentPart } from './SheetPage.tsx';

export function StatBlock({ document, play }: { document: SheetDocument; play?: PlayHere }): React.JSX.Element {
  const block = document.statBlock;
  const [wide, setWide] = useState<boolean | undefined>(undefined);
  const shape = wide ?? block?.wide ?? false;
  const name = useId();
  const head = document.sections.filter((s) => s.place === 'head');
  const inTable = new Set(block ? [block.abilities, ...(block.saves ? [block.saves] : [])] : []);
  const rest = document.sections.filter((s) => s.place !== 'head');
  return (
    <PlayContext.Provider value={play ?? null}>
      <div className="stat-block-page">
        <div className="stat-block">
          {head.map((section) => (
            <HeadLines key={section.id} section={section} />
          ))}
          {rest.map((section) => {
            const id = section.section ?? section.id;
            if (block && id === block.abilities) {
              return (
                <div key={section.id} className="stat-block-abilities">
                  <fieldset className="stat-block-shape">
                    <legend>Ability table</legend>
                    <label>
                      <input type="radio" name={name} checked={shape} onChange={() => setWide(true)} /> Score, modifier and save
                    </label>
                    <label>
                      <input type="radio" name={name} checked={!shape} onChange={() => setWide(false)} /> Score and modifier
                    </label>
                  </fieldset>
                  <AbilityTable block={block} wide={shape} />
                </div>
              );
            }
            // In the wide shape every save is in the table; in the other, the shown ones are a line of their own.
            if (block && inTable.has(id) && shape) return null;
            return <BlockSection key={section.id} section={section} />;
          })}
          {(['companions', 'freeform', 'descriptions', 'references'] as const)
            .filter((part) => document[part] !== undefined)
            .map((part) => (
              <DocumentPart key={part} document={document} part={part} />
            ))}
        </div>
        {play && (
          <aside className="stat-block-play">
            <PlayStrip here={play} tileStats={new Set(play.places.all.flatMap(({ tracker }) => (tracker.temporary && tracker.at && 'stat' in tracker.at ? [tracker.at.stat] : [])))} headSections={[]} />
          </aside>
        )}
      </div>
    </PlayContext.Provider>
  );
}

/** A head section as a stat block's first lines: what it lists and prints in italics, its rows each a line. */
function HeadLines({ section }: { section: SheetSectionView }): React.JSX.Element {
  const first = [...section.elements.map((e) => listedName(e)), ...section.printed.map((p) => p.text)];
  return (
    <div className="stat-block-head">
      {first.length > 0 && <p className="stat-block-first">{first.join(', ')}</p>}
      {section.rows.map((row) => (
        <p key={row.stat} className="stat-block-line">
          <strong>{row.label}</strong> <RowValue row={row} />
        </p>
      ))}
    </div>
  );
}

/** The ability scores: each with its modifier and save in its column (the 2024 shape), or score and modifier only. */
function AbilityTable({ block, wide }: { block: NonNullable<SheetDocument['statBlock']>; wide: boolean }): React.JSX.Element {
  return (
    <table className={wide ? 'stat-block-table wide' : 'stat-block-table'}>
      <thead>
        <tr>
          {block.table.map(({ ability }) => (
            <th key={ability.stat} scope="col">
              {ability.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          {block.table.map(({ ability }) => (
            <td key={ability.stat}>
              {ability.value}
              {ability.beside !== undefined && <span className="sheet-beside"> ({ability.beside})</span>}
            </td>
          ))}
        </tr>
        {wide && (
          <tr className="stat-block-saves">
            {block.table.map(({ ability, save }) => (
              <td key={ability.stat}>
                <span className="hint">Save </span>
                {/* A save the creature is not proficient in is its modifier, as printed. */}
                {save ? (
                  <>
                    {save.value}
                    {save.mark && <MarkDots mark={save.mark} />}
                  </>
                ) : (
                  (ability.beside ?? '—')
                )}
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** A section of a stat block: its rows as one labelled line, its printed lines each labelled, then what it lists. */
function BlockSection({ section }: { section: SheetSectionView }): React.JSX.Element {
  const listsOnly = section.rows.length === 0 && section.printed.length === 0;
  return (
    <section className={listsOnly ? 'stat-block-section listing' : 'stat-block-section'}>
      {section.rows.length > 0 && (
        <p className="stat-block-line">
          <strong>{section.label}</strong>{' '}
          {section.rows.length === 1 ? (
            <RowValue row={section.rows[0]!} />
          ) : (
            section.rows.map((row, at) => (
              <span key={row.stat}>
                {at > 0 && ', '}
                {row.label} {row.value}
                {row.mark && <MarkDots mark={row.mark} />}
                {rowAside({ ...row, mark: undefined }) !== undefined && <span className="sheet-beside"> ({rowAside({ ...row, mark: undefined })})</span>}
              </span>
            ))
          )}
        </p>
      )}
      {section.printed.map((line, at) => (
        <p key={`${line.elementId}:${at}`} className="stat-block-line">
          <strong>{line.label}</strong> {line.text}
        </p>
      ))}
      {section.elements.length > 0 &&
        (listsOnly ? (
          <>
            <SectionHead section={section} />
            <ul className="sheet-elements">
              {section.elements.map((element) => (
                <ListedElement key={element.elementId} element={element} section={section.id} />
              ))}
            </ul>
          </>
        ) : (
          <p className="stat-block-line">
            {section.elements.map((e) => listedName(e) + (listedAside(e) !== undefined ? ` (${listedAside(e)})` : '')).join(', ')}
          </p>
        ))}
    </section>
  );
}

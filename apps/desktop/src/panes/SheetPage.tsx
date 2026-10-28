/**
 * A sheet laid out as a page — ADR 0126: a head band, a side column always shown, and a main column in tabs.
 *
 * Where each section goes is the document's (`SheetSectionView.place`, `.tab`, `SheetDocument.tabs`), declared by the
 * system; nothing here knows a section by name. Every tab's sections are drawn, and the ones not chosen are hidden on
 * screen only, so a print shows the whole sheet in order (decision 9) and a search finds what the open tab holds.
 *
 * A row's mark is drawn as dots on screen, one for each multiple, with its word kept for print and for a screen reader
 * (decision 10). A section's explanation is behind an "i" beside its label, not on the page (decision 2).
 */

import { useMemo, useState } from 'react';

import {
  listedAside,
  listedName,
  listedParts,
  rowAside,
  type SheetDocument,
  type SheetListedElement,
  type SheetRow,
  type SheetSectionView,

} from '@incudo/ui';
import type { SheetTabDef } from '@incudo/core';

import { RowValue, SectionHead } from './SheetBits.tsx';
import { PlayContext, PlayStrip, type PlayHere } from './PlayInPlace.tsx';
import { Companions, ListedElement, SheetRows } from './Companions.tsx';
import { FreeformSheet } from './Freeform.tsx';
import { SheetDescriptionsPart, SheetReferencesPart } from './SheetParts.tsx';

/** A section's rows as tiles, each row's partner from the section drawn under it on a line of its own. */
function Tiles({ section, under, play }: { section: SheetSectionView; under?: SheetSectionView; play?: PlayHere }): React.JSX.Element {
  return (
    <>
      <div className="sheet-tiles">
        {section.rows.map((row, at) => {
          const partner = under?.rows[at];
          // A stat a tracker spends shows what is left of it, "5 of 7" (ADR 0126 decision 8).
          const spent = play?.places.stat(row.stat);
          return (
            <div key={row.stat} className="sheet-tile">
              <span className="sheet-tile-label">{row.label}</span>
              {spent ? (
                <span className="sheet-tile-value">
                  {spent.value}
                  <span className="sheet-tile-of"> of {spent.max}</span>
                </span>
              ) : (
                <span className="sheet-tile-value">{row.value}</span>
              )}
              {rowAside(row) !== undefined && <span className="sheet-tile-aside">{rowAside(row)}</span>}
              {partner && (
                <span className="sheet-tile-under" aria-label={`${under!.label}: ${partner.label} ${partner.value}${partner.mark ? ` (${partner.mark.label})` : ''}`}>
                  <RowValue row={partner} />
                </span>
              )}
            </div>
          );
        })}
      </div>
      {under && <p className="sheet-tile-legend">Below each: {under.label}</p>}
    </>
  );
}

/** A section's listed elements as one line, "High Elf · Wizard 1 (1d6) · Sage": who the character is, in the head band. */
function HeadLine({ section }: { section: SheetSectionView }): React.JSX.Element {
  return (
    <p className="sheet-head-line">
      {section.elements.map((element, at) => (
        <span key={element.elementId}>
          {at > 0 && ' · '}
          <strong>{listedName(element)}</strong>
          {listedAside(element) !== undefined && <span className="sheet-beside"> ({listedAside(element)})</span>}
        </span>
      ))}
    </p>
  );
}

/**
 * A section's elements as cards, grouped by what gave them (`SheetListedElement.from`) in the order they come, what has
 * nothing to say on the "Also" line after them.
 */
function Cards({ section }: { section: SheetSectionView }): React.JSX.Element {
  const { entries, also } = listedParts(section);
  const groups = useMemo(() => {
    const out: Array<{ key: string; label?: string; entries: SheetListedElement[] }> = [];
    for (const entry of entries) {
      const key = entry.from?.elementId ?? '';
      let group = out.find((g) => g.key === key);
      if (!group) out.push((group = { key, ...(entry.from ? { label: entry.from.name } : {}), entries: [] }));
      group.entries.push(entry);
    }
    return out;
  }, [entries]);
  return (
    <>
      {groups.map((group) => (
        <div key={group.key} className="sheet-card-group">
          {group.label !== undefined && groups.length > 1 && <h4 className="sheet-card-group-head">{group.label}</h4>}
          <ul className="sheet-cards">
            {group.entries.map((element) => (
              <ListedElement key={element.elementId} element={element} className="sheet-card" section={section.id} />
            ))}
          </ul>
        </div>
      ))}
      {also.length > 0 && (
        <p className="sheet-also">
          Also: {also.map((element) => listedName(element)).join(', ')}
        </p>
      )}
    </>
  );
}

/** One section of the page, drawn by what it holds. */
function PageSection({ section, under }: { section: SheetSectionView; under?: SheetSectionView }): React.JSX.Element {
  const cards = section.also === true;
  return (
    <section className={`sheet-section sheet-place-${section.place ?? 'main'}`}>
      <SectionHead section={section} />
      {section.tiles ? (
        <>
          <Tiles section={section} {...(under ? { under } : {})} />
          <SheetRows section={{ ...section, rows: [] }} />
        </>
      ) : cards ? (
        <>
          <SheetRows section={{ ...section, elements: [] }} />
          <Cards section={section} />
        </>
      ) : (
        <SheetRows section={section} />
      )}
    </section>
  );
}

/** Whether a tab holds anything: a section, or a part of the document it names. */
function tabParts(document: SheetDocument, tab: SheetTabDef): Array<NonNullable<SheetTabDef['parts']>[number]> {
  return (tab.parts ?? []).filter((part) => document[part] !== undefined);
}

export function SheetPage({ document, play }: { document: SheetDocument; play?: PlayHere }): React.JSX.Element {
  const tabs = document.tabs ?? [];
  const head = document.sections.filter((s) => s.place === 'head');
  // A section drawn under another is drawn there, not on its own.
  const drawnUnder = new Map<string, SheetSectionView>();
  for (const s of document.sections) {
    if (s.under !== undefined && document.sections.some((t) => (t.section ?? t.id) === s.under && t.tiles)) drawnUnder.set(s.under, s);
  }
  const shown = (s: SheetSectionView): boolean => !(s.under !== undefined && drawnUnder.get(s.under) === s);
  const side = document.sections.filter((s) => s.place === 'side' && shown(s));
  const inTab = (tab: SheetTabDef) => document.sections.filter((s) => s.place === 'main' && s.tab === tab.id && shown(s));
  const filled = tabs.filter((tab) => inTab(tab).length > 0 || tabParts(document, tab).length > 0);
  const placedParts = new Set(tabs.flatMap((tab) => tab.parts ?? []));
  const [chosen, choose] = useState<string | undefined>(undefined);
  const open = filled.find((tab) => tab.id === chosen)?.id ?? filled[0]?.id;

  const tileStats = new Set(head.filter((s) => s.tiles).flatMap((s) => s.rows.map((r) => r.stat.toLowerCase())));
  return (
    <PlayContext.Provider value={play ?? null}>
    <div className="sheet-page">
      <div className="sheet-head">
        {head.map((section) =>
          section.tiles ? (
            <div key={section.id} className="sheet-head-tiles">
              <Tiles section={section} {...(play ? { play } : {})} />
            </div>
          ) : section.elements.length > 0 && section.rows.length === 0 ? (
            <HeadLine key={section.id} section={section} />
          ) : (
            <PageSection key={section.id} section={section} />
          ),
        )}
      </div>
      {play && <PlayStrip here={play} tileStats={tileStats} headSections={head.map((s) => s.id)} />}
      <div className="sheet-body">
        <aside className="sheet-side">
          {side.map((section) => (
            <PageSection key={section.id} section={section} {...(drawnUnder.has(section.section ?? section.id) ? { under: drawnUnder.get(section.section ?? section.id)! } : {})} />
          ))}
        </aside>
        <div className="sheet-main">
          {filled.length > 1 && (
            <div className="sheet-tabs" role="tablist">
              {filled.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={tab.id === open}
                  className={tab.id === open ? 'sheet-tab on' : 'sheet-tab'}
                  onClick={() => choose(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
          {filled.map((tab) => (
            <div key={tab.id} role="tabpanel" className={tab.id === open ? 'sheet-tab-panel' : 'sheet-tab-panel sheet-tab-hidden'}>
              <h2 className="sheet-tab-label">{tab.label}</h2>
              {inTab(tab).map((section) => (
                <PageSection key={section.id} section={section} />
              ))}
              {tabParts(document, tab).map((part) => (
                <DocumentPart key={part} document={document} part={part} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {/* A part no tab names is drawn after the page, as on a sheet with no layout. */}
      {(['companions', 'freeform', 'descriptions', 'references'] as const)
        .filter((part) => !placedParts.has(part) && document[part] !== undefined)
        .map((part) => (
          <DocumentPart key={part} document={document} part={part} />
        ))}
    </div>
    </PlayContext.Provider>
  );
}

/** A part of the document that is not a section. */
export function DocumentPart({ document, part }: { document: SheetDocument; part: NonNullable<SheetTabDef['parts']>[number] }): React.JSX.Element | null {
  switch (part) {
    case 'companions':
      return document.companions ? <Companions view={document.companions} /> : null;
    case 'freeform':
      return document.freeform ? <FreeformSheet part={document.freeform} /> : null;
    case 'descriptions':
      return document.descriptions ? <SheetDescriptionsPart part={document.descriptions} /> : null;
    default:
      return document.references ? <SheetReferencesPart part={document.references} /> : null;
  }
}

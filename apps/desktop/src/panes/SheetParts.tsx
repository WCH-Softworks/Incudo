/**
 * The parts of a sheet that are not sections — ADRs 0068 and 0114: the whole descriptions of what the describing
 * sections list, and what the character keeps beside it for reference. A laid-out sheet puts each in the tab that names
 * it (ADR 0126); a sheet with no layout draws them after its sections.
 */

import type { SheetDocument } from '@incudo/ui';

import { DescriptionText, ReferenceText } from './References.tsx';

export function SheetDescriptionsPart({ part }: { part: NonNullable<SheetDocument['descriptions']> }): React.JSX.Element {
  return (
    <section className="sheet-section sheet-descriptions">
      <h3>{part.label}</h3>
      {part.groups.map((group) => (
        <div key={group.label} className="sheet-description-group">
          <h4>{group.label}</h4>
          {group.entries.map((entry) => (
            <article key={entry.elementId}>
              <h5>{entry.name}</h5>
              <DescriptionText html={entry.html} />
            </article>
          ))}
        </div>
      ))}
    </section>
  );
}

export function SheetReferencesPart({ part }: { part: NonNullable<SheetDocument['references']> }): React.JSX.Element {
  return (
    <section className="sheet-section sheet-references">
      <h3>{part.label}</h3>
      {part.entries.map((entry) => (
        <article key={entry.elementId}>
          <h4>
            {entry.name}
            {entry.source && <span className="hint"> · {entry.source}</span>}
          </h4>
          <ReferenceText entry={entry} />
        </article>
      ))}
    </section>
  );
}

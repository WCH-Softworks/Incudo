/**
 * The character sheet, rendered from the kind's own declaration.
 *
 * Nothing here names a 5e stat. The sections, their labels and the stats in them come from
 * `kind.sheet` (ADR 0009), which is why the same component renders a monster stat block — and
 * why a system that has never heard of armour class gets a sheet rather than a blank pane.
 *
 * What each section shows, what each row is called and how its value is written are decided in
 * `packages/ui/src/sheet.ts` (ADR 0074), over core's `renderSheetSection` (ADRs 0020, 0062); this
 * draws `BuilderState.sheet` and computes nothing.
 */

import type { BuilderState, CharacterBuilder } from '@incudo/ui';
import { ReferenceText } from './References.tsx';
import { Companions, SheetRows } from './Companions.tsx';

export function SheetPane({
  builder,
  state,
}: {
  builder: CharacterBuilder;
  state: BuilderState;
}): React.JSX.Element {
  const { sheet } = state;
  return (
    <main className="pane sheet">
      <input
        className="sheet-name"
        type="text"
        value={state.character.name}
        onChange={(event) => builder.setName(event.target.value)}
      />
      <p className="lede">
        {sheet.kindName} · {sheet.elementCount} elements
      </p>

      {sheet.sections.map((section) => (
        <section key={section.id} className="sheet-section">
          <h3>{section.label}</h3>
          {section.description && <p className="hint">{section.description}</p>}
          <SheetRows section={section} />
        </section>
      ))}

      {/* Each creature the character holds, as its own stat block (ADR 0073): after the character, before what it keeps. */}
      {state.companions && <Companions view={state.companions} />}

      {/* What the character keeps beside it for reference (ADR 0068), after the sheet: text, not the character's own. */}
      {state.references.rows.length > 0 && (
        <section className="sheet-section sheet-references">
          <h3>{state.references.label}</h3>
          {state.references.rows.map((row) => (
            <article key={row.elementId}>
              <h4>
                {row.name}
                {row.source && <span className="hint"> · {row.source}</span>}
              </h4>
              <ReferenceText row={row} />
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

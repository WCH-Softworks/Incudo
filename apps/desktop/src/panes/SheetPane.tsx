/**
 * The character sheet, rendered from the kind's own declaration.
 *
 * Nothing here names a 5e stat. The sections, their labels and the stats in them come from
 * `kind.sheet` (ADR 0009), which is why the same component renders a monster stat block — and
 * why a system that has never heard of armour class gets a sheet rather than a blank pane.
 *
 * `perBlock` sections are the one piece of cleverness, and they are ADR 0020's: a section can
 * name `{name}:spellcasting:dc`, which no system definition can spell out because the key comes
 * from content. It expands to one rendering per block the character's elements declare. Which
 * rows a section shows (`showWhen`) and the text it prints from a held element (`printed`) are
 * decided in core as well (ADR 0062); this renders what comes back.
 */

import type { BuilderState, CharacterBuilder } from '@incudo/ui';
import {
  collectDeclaredBlocks,
  renderSheetSection,
  sheetSectionIsEmpty,
  type ResolvedStat,
  type SheetReader,
} from '@incudo/core';

export function SheetPane({
  builder,
  state,
}: {
  builder: CharacterBuilder;
  state: BuilderState;
}): React.JSX.Element {
  const { derived, kind } = state;
  const blocks = collectDeclaredBlocks(derived.elements);
  const reader: SheetReader = {
    statValue: (key) => derived.stats.get(key.toLowerCase())?.value,
    elements: derived.elements,
  };

  const valueOf = (key: string): string => {
    const stat: ResolvedStat | undefined = derived.stats.get(key.toLowerCase());
    if (!stat) return '—';
    return stat.text ?? String(stat.value);
  };
  const labelOf = (key: string): string =>
    kind.stats.find((s) => s.name.toLowerCase() === key.toLowerCase())?.label ?? key;

  return (
    <main className="pane sheet">
      <input
        className="sheet-name"
        type="text"
        value={state.character.name}
        onChange={(event) => builder.setName(event.target.value)}
      />
      <p className="lede">
        {kind.name} · {derived.elements.length} elements
      </p>

      {kind.sheet.sections
        .flatMap((section) => renderSheetSection(section, blocks, reader))
        .map((rendering) => {
          if (sheetSectionIsEmpty(rendering, derived.elements)) return null;
          const elements = derived.elements.filter((e) => rendering.types.includes(e.type));

          return (
            <section key={rendering.id} className="sheet-section">
              <h3>{rendering.label}</h3>
              {rendering.description && <p className="hint">{rendering.description}</p>}
              {rendering.stats.length > 0 && (
                <dl>
                  {rendering.stats.map((key) => (
                    <div key={key}>
                      <dt>{rendering.blockName ? key : labelOf(key)}</dt>
                      <dd>{valueOf(key)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {rendering.printed.length > 0 && (
                <dl className="sheet-printed">
                  {rendering.printed.map((line, index) => (
                    <div key={`${line.elementId}:${index}`}>
                      <dt>{line.label}</dt>
                      <dd>{line.text}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {elements.length > 0 && (
                <ul className="sheet-elements">
                  {elements.map((element) => (
                    <li key={element.id}>{element.name}</li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
    </main>
  );
}

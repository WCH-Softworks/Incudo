/**
 * The character sheet, rendered from the kind's own declaration.
 *
 * Nothing here names a 5e stat. The sections, their labels and the stats in them come from
 * `kind.sheet` (ADR 0009), which is why the same component renders a monster stat block — and
 * why a system that has never heard of armour class gets a sheet rather than a blank pane.
 *
 * `perBlock` sections are the one piece of cleverness, and they are ADR 0020's: a section can
 * name `{name}:spellcasting:dc`, which no system definition can spell out because the key comes
 * from content. It expands to one rendering per block the character's elements declare.
 */

import type { BuilderState, CharacterBuilder } from '@incudo/ui';
import { collectDeclaredBlocks, substituteBlockPlaceholders, type ResolvedStat } from '@incudo/core';

export function SheetPane({
  builder,
  state,
}: {
  builder: CharacterBuilder;
  state: BuilderState;
}): React.JSX.Element {
  const { derived, kind } = state;
  const blocks = collectDeclaredBlocks(derived.elements);

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

      {kind.sheet.sections.map((section) => {
        const stats = section.stats ?? [];
        if (!stats.length) return null;

        if (section.perBlock) {
          return blocks.map((block) => (
            <section key={`${section.id}:${block.name}`} className="sheet-section">
              <h3>
                {section.label} — {block.name}
              </h3>
              <dl>
                {stats.map((pattern) => {
                  const key = substituteBlockPlaceholders(pattern, block);
                  if (key === undefined) return null;
                  return (
                    <div key={pattern}>
                      <dt>{key}</dt>
                      <dd>{valueOf(key)}</dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ));
        }

        return (
          <section key={section.id} className="sheet-section">
            <h3>{section.label}</h3>
            <dl>
              {stats.map((key) => (
                <div key={key}>
                  <dt>{labelOf(key)}</dt>
                  <dd>{valueOf(key)}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </main>
  );
}

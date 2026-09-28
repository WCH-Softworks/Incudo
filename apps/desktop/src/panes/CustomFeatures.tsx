/**
 * Features the user writes for this character — ADR 0063.
 *
 * A name, an optional description, where it is listed (ADR 0065: a DM's legendary action), and lines that each add to
 * a number or set it. What every line is doing (set, replaced by a typed value, overruled by an earlier feature, only
 * addable) and what each list is called is worked out in `packages/ui/src/custom-features.ts`; this renders it and
 * writes what is typed. Nothing here names a stat or a type.
 */

import type { BuilderState, CharacterBuilder, CustomFeatureView } from '@incudo/ui';
import { customLineOnStat, newCustomStatLine } from '@incudo/ui';
import type { CustomStatLine } from '@incudo/core';

export function CustomFeatures({
  state,
  builder,
}: {
  state: BuilderState;
  builder: CharacterBuilder;
}): React.JSX.Element {
  const { customFeatures } = state;
  return (
    <>
      <p className="hint">
        A feature of your own for this character, listed on its sheet. Each line adds to a number or sets it; a
        feature can also be only a name and a description. A number typed in the entry steps replaces what a feature
        sets. Features are saved with the character.
      </p>
      {customFeatures.features.map((feature) => (
        <Feature key={feature.id} feature={feature} state={state} builder={builder} />
      ))}
      <button type="button" onClick={() => builder.addCustomFeature('New feature')}>
        Add a feature
      </button>
    </>
  );
}

function Feature({
  feature,
  state,
  builder,
}: {
  feature: CustomFeatureView;
  state: BuilderState;
  builder: CharacterBuilder;
}): React.JSX.Element {
  const { stats, types } = state.customFeatures;
  const lines: CustomStatLine[] = feature.lines.map(({ stat, mode, value }) => ({ stat, mode, value }));
  const write = (next: CustomStatLine[]) => builder.updateCustomFeature(feature.id, { stats: next });
  const change = (at: number, line: CustomStatLine) => write(lines.map((l, i) => (i === at ? line : l)));
  const settable = (stat: string) => stats.find((s) => s.stat === stat)?.settable ?? false;

  const addLine = () => {
    const line = newCustomStatLine(stats, state.derived);
    if (line) write([...lines, line]);
  };

  return (
    <div className="settled custom-feature">
      <label className="custom-feature-name">
        Name
        <input
          type="text"
          value={feature.name}
          onChange={(event) => builder.updateCustomFeature(feature.id, { name: event.target.value })}
        />
      </label>
      {(types.length > 1 || feature.typeNote) && (
        <label className="custom-feature-type">
          Listed under
          <select
            value={feature.type}
            onChange={(event) => builder.updateCustomFeature(feature.id, { type: event.target.value })}
          >
            {feature.typeNote && <option value={feature.type}>{feature.typeLabel}</option>}
            {types.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {feature.typeNote && <p className="hint">{feature.typeNote}</p>}
      <label className="custom-feature-description">
        Description
        <textarea
          rows={2}
          value={feature.description}
          placeholder="Optional. Why this character has it."
          onChange={(event) => builder.updateCustomFeature(feature.id, { description: event.target.value })}
        />
      </label>

      {feature.lines.length > 0 && (
        <ul className="custom-lines">
          {feature.lines.map((line, at) => (
            <li key={at} className={line.status === 'applied' ? '' : 'not-applied'}>
              <div className="custom-line">
                <select
                  aria-label="Stat"
                  value={line.stat}
                  onChange={(event) => change(at, customLineOnStat(lines[at]!, event.target.value, stats, state.derived))}
                >
                  {line.status === 'unknown' && <option value={line.stat}>{line.label}</option>}
                  {/* Grouped as the sheet groups them: two stats may share a label (an ability and its save). */}
                  {[...new Set(stats.map((s) => s.group))].map((group) => (
                    <optgroup key={group} label={group}>
                      {stats
                        .filter((s) => s.group === group)
                        .map((s) => (
                          <option key={s.stat} value={s.stat}>
                            {s.label}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
                <select
                  aria-label="How"
                  value={line.mode}
                  onChange={(event) => change(at, { ...lines[at]!, mode: event.target.value === 'set' ? 'set' : 'add' })}
                >
                  <option value="add">adds</option>
                  <option value="set" disabled={!settable(line.stat)}>
                    sets it to
                  </option>
                </select>
                <input
                  type="number"
                  aria-label="Value"
                  value={line.value}
                  onChange={(event) => {
                    if (event.target.value === '') return;
                    change(at, { ...lines[at]!, value: Number(event.target.value) });
                  }}
                />
                <button type="button" className="link" onClick={() => write(lines.filter((_, i) => i !== at))}>
                  Remove
                </button>
              </div>
              {line.note && <p className="hint">{line.note}</p>}
            </li>
          ))}
        </ul>
      )}

      <div className="decision-head">
        <button type="button" className="link" onClick={addLine} disabled={!stats.length}>
          Add a line
        </button>
        <button type="button" className="link" onClick={() => builder.removeCustomFeature(feature.id)}>
          Remove feature
        </button>
      </div>
    </div>
  );
}


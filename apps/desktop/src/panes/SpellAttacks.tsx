/**
 * The spell attack rows and what content does not say about them — ADR 0111: the die, the damage type, the save's
 * ability, the class a spell is cast as. What is offered and what each row reads are `packages/ui/src/spell-attacks.ts`'s;
 * this renders them and decides nothing.
 */

import { useState } from 'react';

import type { SpellAttackChoice } from '@incudo/core';
import { DIE_NONE, DIE_UNCHOSEN, dieLabel, givenBlockLabel, type CharacterBuilder, type SpellAttacksState } from '@incudo/ui';

export function SpellAttacksEditor({ state, builder }: { state: SpellAttacksState; builder: CharacterBuilder }): React.JSX.Element {
  const [refused, setRefused] = useState<{ id: string; message: string } | undefined>();
  const write = (id: string, choice: SpellAttackChoice): void => {
    const message = builder.setSpellAttack(id, choice);
    setRefused(message === undefined ? undefined : { id, message });
  };
  return (
    <>
      <p className="hint">{state.description}</p>
      <ul className="spell-attacks">
        {state.rows.map((row) => {
          const first = row.choice.sides?.[0];
          const dieValue = row.choice.sides === undefined ? '' : first === undefined ? 'none' : String(first);
          return (
            <li key={row.elementId}>
              <div>{row.line}</div>
              {!row.stated && (
                <>
                  <label>
                    Die{' '}
                    <select
                      value={dieValue}
                      onChange={(event) => {
                        const v = event.target.value;
                        const { sides: _sides, ...rest } = row.choice;
                        write(row.elementId, v === '' ? rest : { ...rest, sides: v === 'none' ? [] : [Number(v)] });
                      }}
                    >
                      <option value="">{DIE_UNCHOSEN}</option>
                      <option value="none">{DIE_NONE}</option>
                      {state.sides.map((s) => (
                        <option key={s} value={String(s)}>{dieLabel(s)}</option>
                      ))}
                    </select>
                  </label>{' '}
                  {first !== undefined && (
                    <label>
                      or{' '}
                      <select
                        value={row.choice.sides?.[1] !== undefined ? String(row.choice.sides[1]) : ''}
                        onChange={(event) => {
                          const v = event.target.value;
                          write(row.elementId, { ...row.choice, sides: v === '' ? [first] : [first, Number(v)] });
                        }}
                      >
                        <option value="">no other die</option>
                        {state.sides.map((s) => (
                          <option key={s} value={String(s)}>{dieLabel(s)}</option>
                        ))}
                      </select>
                    </label>
                  )}{' '}
                  {state.damageTypes.length > 0 && (
                    <label>
                      Damage type{' '}
                      <select
                        value={row.choice.damageType ?? ''}
                        onChange={(event) => {
                          const { damageType: _type, ...rest } = row.choice;
                          write(row.elementId, event.target.value === '' ? rest : { ...rest, damageType: event.target.value });
                        }}
                      >
                        <option value="">{DIE_UNCHOSEN}</option>
                        {state.damageTypes.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}{' '}
              {row.kind === 'save' && state.abilities.length > 0 && (
                <label>
                  Saving throw{' '}
                  <select
                    value={row.choice.ability ?? ''}
                    onChange={(event) => {
                      const { ability: _ability, ...rest } = row.choice;
                      write(row.elementId, event.target.value === '' ? rest : { ...rest, ability: event.target.value });
                    }}
                  >
                    <option value="">{DIE_UNCHOSEN}</option>
                    {state.abilities.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </label>
              )}{' '}
              {state.blocks.length > 0 && (
                <label>
                  Cast as{' '}
                  <select
                    value={row.choice.block ?? ''}
                    onChange={(event) => {
                      const { block: _block, ...rest } = row.choice;
                      write(row.elementId, event.target.value === '' ? rest : { ...rest, block: event.target.value });
                    }}
                  >
                    <option value="">{givenBlockLabel(row)}</option>
                    {state.blocks.map((b) => (
                      <option key={b.key} value={b.key}>{b.name}</option>
                    ))}
                  </select>
                </label>
              )}
              {refused?.id === row.elementId && <p className="hint">{refused.message}</p>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

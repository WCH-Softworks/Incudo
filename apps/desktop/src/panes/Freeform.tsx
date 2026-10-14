/**
 * The text a user writes about a character — ADR 0092.
 *
 * Which fields there are, how they are grouped and what each holds is `packages/ui/src/freeform.ts`'s; the sheet's part
 * is the document's (`SheetDocument.freeform`). This renders both and decides nothing. A field is written as it is typed,
 * and no rule reads it, so a keystroke re-derives nothing.
 */

import type { CharacterBuilder, FreeformState, SheetFreeform } from '@incudo/ui';

/** The editor, on Build: every field the kind declares, written or not. */
export function FreeformEditor({ state, builder }: { state: FreeformState; builder: CharacterBuilder }): React.JSX.Element {
  return (
    <>
      {state.description && <p className="hint">{state.description}</p>}
      {state.groups.map((group, index) => (
        <fieldset key={group.label ?? `group-${index}`} className="freeform-group">
          {group.label && <legend>{group.label}</legend>}
          {group.fields.map((field) => (
            <label key={field.key} className={field.multiline ? 'freeform-field multiline' : 'freeform-field'}>
              <span>{field.label}</span>
              {field.multiline ? (
                <textarea rows={3} value={field.value || field.suggested || ''} onChange={(event) => builder.setFreeform(field.key, event.target.value)} />
              ) : (
                <input type="text" value={field.value || field.suggested || ''} onChange={(event) => builder.setFreeform(field.key, event.target.value)} />
              )}
            </label>
          ))}
        </fieldset>
      ))}
    </>
  );
}

/** The sheet's part: what is written, under the kind's label and groups. */
export function FreeformSheet({ part }: { part: SheetFreeform }): React.JSX.Element {
  return (
    <section className="sheet-section sheet-freeform">
      <h3>{part.label}</h3>
      {part.groups.map((group, index) => (
        <div key={group.label ?? `group-${index}`} className="sheet-freeform-group">
          {group.label && <h4>{group.label}</h4>}
          {/* Not a list of terms: print keeps a `dl` whole, and a backstory may run past a page. */}
          {group.entries.map((entry) => (
            <div key={entry.key} className={entry.multiline ? 'freeform-entry multiline' : 'freeform-entry'}>
              <span className="freeform-label">{entry.label}</span>
              <span className="freeform-text">{entry.text}</span>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

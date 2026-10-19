/**
 * The elements of one homebrew source, written in the app — ADR 0108.
 *
 * Renders `packages/ui/src/homebrew.ts` and computes nothing: what may be written, what a line says, what stops a save
 * and the element a draft becomes are all decided there. The body is read when the editor opens and written by the
 * shell, which then reloads the sources so the new element is offered at once.
 */

import { useEffect, useState } from 'react';
import type { ConfiguredSource, HomebrewBundle } from '@incudo/content';
import type { ElementIndex, GameSystem } from '@incudo/core';
import {
  HOMEBREW_HINT,
  homebrewDraftOf,
  homebrewDraftProblems,
  homebrewGrantOptions,
  homebrewLineText,
  homebrewRows,
  homebrewSetterSuggestions,
  homebrewStats,
  homebrewTagSuggestions,
  homebrewTagsFromText,
  homebrewTagsText,
  homebrewTypes,
  newHomebrewDraft,
  removeHomebrewElement,
  saveHomebrewDraft,
  type HomebrewDraft,
  type HomebrewLine,
} from '@incudo/ui';

import { ArmedButton } from './ArmedButton.tsx';

export interface HomebrewActions {
  read: (id: string) => Promise<{ status: 'ready'; bundle: HomebrewBundle } | { status: 'unreadable'; reason: string }>;
  save: (id: string, bundle: HomebrewBundle) => Promise<void>;
}

export function HomebrewEditor({
  source,
  system,
  index,
  busy,
  actions,
}: {
  source: ConfiguredSource;
  system: GameSystem;
  /** Everything loaded: what a line may give, and the ids a new element must not take. */
  index: ElementIndex;
  busy: boolean;
  actions: HomebrewActions;
}): React.JSX.Element {
  const [bundle, setBundle] = useState<HomebrewBundle | null>(null);
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const [draft, setDraft] = useState<HomebrewDraft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const types = homebrewTypes(system);
  const [newType, setNewType] = useState(types[0]?.type ?? '');
  const context = { system, index, sourceName: source.name };

  useEffect(() => {
    let live = true;
    void actions.read(source.id).then((read) => {
      if (!live) return;
      if (read.status === 'ready') setBundle(read.bundle);
      else setUnreadable(read.reason);
    });
    return () => {
      live = false;
    };
  }, [source.id]);

  async function write(next: HomebrewBundle): Promise<boolean> {
    setFailure(null);
    try {
      await actions.save(source.id, next);
      setBundle(next);
      return true;
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async function saveDraft(): Promise<void> {
    if (!bundle || !draft) return;
    const saved = saveHomebrewDraft(bundle, draft, context);
    if ('problems' in saved) return setProblems(saved.problems);
    if (await write(saved.bundle)) {
      setDraft(null);
      setProblems([]);
    }
  }

  if (unreadable) return <div className="problem error">{unreadable}</div>;
  if (!bundle) return <p className="hint">Reading…</p>;
  const rows = homebrewRows(bundle, context);

  return (
    <section className="homebrew">
      <p className="hint">{HOMEBREW_HINT}</p>
      {rows.length === 0 && <p className="card-meta">Nothing written yet.</p>}
      {rows.length > 0 && (
        <ul className="homebrew-list">
          {rows.map((row) => (
            <li key={row.id}>
              <span>
                <strong>{row.name}</strong> <span className="card-meta">{row.type}</span>
                {row.summary && <span className="card-meta"> · {row.summary}</span>}
                {row.locked && <span className="card-meta"> · {row.locked}</span>}
              </span>
              <span className="row">
                <button
                  type="button"
                  disabled={busy || !!row.locked || draft !== null}
                  onClick={() => {
                    const element = bundle.elements.find((e) => e.id === row.id)!;
                    const opened = homebrewDraftOf(element);
                    if ('draft' in opened) setDraft(opened.draft);
                    setProblems([]);
                  }}
                >
                  Edit
                </button>
                <ArmedButton
                  label="Remove"
                  armedLabel={`Remove ${row.name}`}
                  disabled={busy || draft !== null}
                  onConfirm={() => void write(removeHomebrewElement(bundle, row.id))}
                />
              </span>
            </li>
          ))}
        </ul>
      )}

      {draft === null ? (
        <div className="row">
          <select value={newType} aria-label="Type of the new entry" onChange={(event) => setNewType(event.target.value)}>
            {types.map((t) => (
              <option key={t.type} value={t.type}>
                {t.type}
              </option>
            ))}
          </select>
          <button type="button" disabled={busy || !newType} onClick={() => setDraft(newHomebrewDraft(newType))}>
            New element
          </button>
        </div>
      ) : (
        <DraftForm
          draft={draft}
          context={context}
          types={types.map((t) => t.type)}
          problems={problems}
          busy={busy}
          onChange={(next) => {
            setDraft(next);
            if (problems.length) setProblems(homebrewDraftProblems(next, context));
          }}
          onSave={() => void saveDraft()}
          onCancel={() => {
            setDraft(null);
            setProblems([]);
          }}
        />
      )}
      {failure && <div className="problem error">{failure}</div>}
    </section>
  );
}

function DraftForm({
  draft,
  context,
  types,
  problems,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  draft: HomebrewDraft;
  context: { system: GameSystem; index: ElementIndex };
  types: string[];
  problems: string[];
  busy: boolean;
  onChange: (draft: HomebrewDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [search, setSearch] = useState<string | null>(null);
  const [tagText, setTagText] = useState(homebrewTagsText(draft.tags));
  const stats = homebrewStats(context.system);
  const groups = [...new Set(stats.map((s) => s.group))];
  const setterNames = homebrewSetterSuggestions(context.index, draft.type);
  const tagNames = homebrewTagSuggestions(context.index, draft.type).filter((t) => !draft.tags.includes(t));
  const setLine = (at: number, line: HomebrewLine) => onChange({ ...draft, lines: draft.lines.map((l, i) => (i === at ? line : l)) });
  const setTags = (text: string) => {
    setTagText(text);
    onChange({ ...draft, tags: homebrewTagsFromText(text) });
  };
  const listId = `setter-names-${draft.id ?? 'new'}`;

  return (
    <form
      className="homebrew-draft"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <h4>{draft.id ? `Editing ${draft.name || 'an entry'}` : `A new ${draft.type}`}</h4>
      <div className="row">
        <label>
          Type{' '}
          {/* The type a new element is minted with is in its id; an element already saved keeps it. */}
          <select value={draft.type} disabled={draft.id !== undefined} onChange={(event) => onChange({ ...draft, type: event.target.value })}>
            {types.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name <input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
        </label>
      </div>
      <label className="homebrew-description">
        Description
        <textarea
          rows={4}
          value={draft.description}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
        />
      </label>
      <p className="hint">A blank line starts a new paragraph.</p>

      <h5>What it does</h5>
      {draft.lines.length === 0 && <p className="card-meta">Nothing yet: it is text only.</p>}
      <ul className="homebrew-lines">
        {draft.lines.map((line, at) => (
          <li key={at} className="row">
            {line.kind === 'add' ? (
              <>
                Adds
                <input
                  type="number"
                  step={1}
                  aria-label="Amount"
                  value={Number.isFinite(line.value) ? line.value : ''}
                  onChange={(event) => setLine(at, { ...line, value: event.target.value === '' ? Number.NaN : Number(event.target.value) })}
                />
                to
                <select aria-label="Number it adds to" value={line.stat} onChange={(event) => setLine(at, { ...line, stat: event.target.value })}>
                  <option value="">Choose…</option>
                  {groups.map((group) => (
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
              </>
            ) : (
              <span>{homebrewLineText(line, context)}</span>
            )}
            <button
              type="button"
              className="linklike"
              onClick={() => onChange({ ...draft, lines: draft.lines.filter((_, i) => i !== at) })}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <button type="button" onClick={() => onChange({ ...draft, lines: [...draft.lines, { kind: 'add', stat: '', value: 1 }] })}>
          Add to a number
        </button>
        <button type="button" onClick={() => setSearch('')} disabled={search !== null}>
          Give an element
        </button>
      </div>
      {search !== null && (
        <div className="homebrew-search">
          <div className="row">
            <input
              autoFocus
              value={search}
              placeholder="Search loaded content by name"
              aria-label="Element to give"
              // Enter here searches; it does not save the element.
              onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button type="button" className="linklike" onClick={() => setSearch(null)}>
              Cancel
            </button>
          </div>
          <ul>
            {homebrewGrantOptions(context, search, 12).map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  className="linklike"
                  onClick={() => {
                    onChange({ ...draft, lines: [...draft.lines, { kind: 'grant', id: option.id }] });
                    setSearch(null);
                  }}
                >
                  {option.name}
                </button>{' '}
                <span className="card-meta">{option.type}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h5>Setters</h5>
      <p className="hint">Values content reads by name, such as a spell's level and school. Names used by loaded {draft.type} entries are suggested.</p>
      <datalist id={listId}>
        {setterNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <ul className="homebrew-lines">
        {draft.setters.map((setter, at) => (
          <li key={at} className="row">
            <input
              list={listId}
              aria-label="Setter name"
              placeholder="name"
              value={setter.name}
              onChange={(event) =>
                onChange({ ...draft, setters: draft.setters.map((s, i) => (i === at ? { ...s, name: event.target.value } : s)) })
              }
            />
            <input
              aria-label="Setter value"
              placeholder="value"
              value={setter.value}
              onChange={(event) =>
                onChange({ ...draft, setters: draft.setters.map((s, i) => (i === at ? { ...s, value: event.target.value } : s)) })
              }
            />
            <button
              type="button"
              className="linklike"
              onClick={() => onChange({ ...draft, setters: draft.setters.filter((_, i) => i !== at) })}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <button type="button" onClick={() => onChange({ ...draft, setters: [...draft.setters, { name: '', value: '' }] })}>
          Add a setter
        </button>
      </div>

      <h5>Tags</h5>
      <p className="hint">What choices find it by, separated by commas: a spell tagged with a class is on that class's list.</p>
      <input className="homebrew-tags" aria-label="Tags" value={tagText} onChange={(event) => setTags(event.target.value)} />
      {tagNames.length > 0 && (
        <p className="card-meta">
          Used by loaded {draft.type} elements:{' '}
          {tagNames.map((tag, at) => (
            <span key={tag}>
              {at > 0 && ', '}
              <button type="button" className="linklike" onClick={() => setTags(homebrewTagsText([...draft.tags, tag]))}>
                {tag}
              </button>
            </span>
          ))}
        </p>
      )}

      {problems.length > 0 && (
        <div className="problem warning">
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="row">
        <button type="submit" disabled={busy}>
          Save
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

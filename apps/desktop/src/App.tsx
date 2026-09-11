/**
 * The desktop shell.
 *
 * Windows, panes and navigation — and nothing else. Every number on screen comes from
 * `deriveCharacter`, every outstanding decision from `CharacterBuilder`. If a bug is "the app
 * computed the wrong AC" it must be fixable in `packages/`, which is the test
 * docs/CODE-REUSE-POLICY.md sets for this file.
 *
 * There is no wizard and no Back button, because ADR 0017 says the screen is the wrong unit: the
 * builder publishes one flat, always-current list of what is outstanding, and this renders it.
 * The panes below are *views of one builder*, not steps — switching to the sheet and back does
 * not advance or rewind anything.
 */

import { useCallback, useEffect, useState } from 'react';
import { MapElementIndex, type Character, type ElementIndex, type GameSystem } from '@incudo/core';

import { loadCharacter, loadShippedSystem, saveCharacter } from './boot.ts';
import { DesktopStorage } from './platform.ts';
import { useBuilder } from './use-builder.ts';
import { SourcesPane } from './panes/SourcesPane.tsx';
import { BuilderPane } from './panes/BuilderPane.tsx';
import { SheetPane } from './panes/SheetPane.tsx';
import type { LoadedContent } from './content.ts';

type Pane = 'sources' | 'build' | 'sheet';

const EMPTY_INDEX: ElementIndex = new MapElementIndex();
const storage = new DesktopStorage();

export function App(): React.JSX.Element {
  const [system, setSystem] = useState<GameSystem | null>(null);
  const [systemErrors, setSystemErrors] = useState<string[]>([]);
  const [character, setCharacter] = useState<Character | null>(null);

  useEffect(() => {
    const result = loadShippedSystem();
    if (!result.ok) {
      setSystemErrors(result.errors.map((e) => `${e.path}: ${e.message}`));
      return;
    }
    setSystem(result.system);
    void loadCharacter(result.system, (key) => storage.read(key)).then(setCharacter);
  }, []);

  if (systemErrors.length) {
    return (
      <main className="fatal">
        <h1>The shipped system definition does not validate.</h1>
        <p>
          A broken build rather than a broken character. The app refuses a system rather than
          loading half of one — ADR 0011.
        </p>
        <ul>
          {systemErrors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      </main>
    );
  }

  if (!system || !character) return <main className="fatal">Loading the system definition…</main>;

  // Keyed on the character's id so the builder is constructed once with a real character rather
  // than with a placeholder that storage later replaces.
  return <Shell key={character.id} system={system} initial={character} />;
}

function Shell({
  system,
  initial,
}: {
  system: GameSystem;
  initial: Character;
}): React.JSX.Element {
  const [content, setContent] = useState<LoadedContent | null>(null);
  const [pane, setPane] = useState<Pane>('sources');
  const elements = content?.elements ?? EMPTY_INDEX;

  const { builder, state } = useBuilder(initial, system, elements);

  // Persist whatever the builder currently holds. An input the user typed is never re-derived
  // (ADR 0006), so the character is the only thing worth writing.
  useEffect(() => {
    void saveCharacter(state.character, (key, value) => storage.write(key, value));
  }, [state.character]);

  const onLoaded = useCallback((loaded: LoadedContent) => {
    setContent(loaded);
    setPane('build');
  }, []);

  const panes: Array<[Pane, string]> = [
    ['sources', 'Sources'],
    ['build', 'Build'],
    ['sheet', 'Sheet'],
  ];

  return (
    <div className="app">
      <header>
        <h1>Incudo</h1>
        <nav>
          {panes.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={pane === id ? 'on' : ''}
              onClick={() => setPane(id)}
            >
              {label}
              {id === 'build' && state.decisions.length > 0 && (
                <span className="badge">{state.decisions.length}</span>
              )}
            </button>
          ))}
        </nav>
        <span className="status">
          {system.name}
          {' · '}
          {content
            ? `${content.elementCount.toLocaleString()} elements from ${content.fileCount} files`
            : 'no content loaded'}
        </span>
      </header>

      {pane === 'sources' && <SourcesPane content={content} onLoaded={onLoaded} />}
      {pane === 'build' && (
        <BuilderPane
          builder={builder}
          state={state}
          elements={elements}
          hasContent={content !== null}
        />
      )}
      {pane === 'sheet' && <SheetPane state={state} />}
    </div>
  );
}

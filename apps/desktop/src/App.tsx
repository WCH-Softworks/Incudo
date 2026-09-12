/**
 * The desktop shell.
 *
 * Windows, panes and navigation — and nothing else. Every number on screen comes from
 * `deriveCharacter`, every outstanding decision from `CharacterBuilder`, and every fact about
 * the library from `CharacterLibrary`. If a bug is "the app computed the wrong AC" it must be
 * fixable in `packages/`, which is the test docs/CODE-REUSE-POLICY.md sets for this file.
 *
 * **It opens on the library** (ADR 0027). It used to open on Sources, with an index URL in a
 * text box, doing nothing at all until 238 files had come down over the network — which had
 * the app's own first screen contradicting ADR 0012, the decision that a save carries its
 * content and opens with nothing configured.
 *
 * There is no wizard and no Back button, because ADR 0017 says the screen is the wrong unit:
 * the builder publishes one flat, always-current list of what is outstanding, and this renders
 * it. The panes are *views of one builder*, not steps.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayeredElementIndex,
  MapElementIndex,
  type Character,
  type ElementIndex,
  type GameSystem,
  type LibraryEntryRef,
} from '@incudo/core';
import {
  SourceProfile,
  checkSourceForUpdates,
  evictSourceCache,
  writeVersionStamp,
  type ConfiguredSource,
  type SourceMode,
  type UpdateStatus,
} from '@incudo/content';
import { CharacterLibrary, type LibraryEntry } from '@incudo/ui';

import { loadCharacter, loadShippedSystem, newCharacter, saveCharacter } from './boot.ts';
import { createDesktopPlatform } from './platform.ts';
import { useBuilder } from './use-builder.ts';
import { useLibrary } from './use-library.ts';
import { LibraryPane } from './panes/LibraryPane.tsx';
import { SourcesPane, type SourcesActions } from './panes/SourcesPane.tsx';
import { BuilderPane } from './panes/BuilderPane.tsx';
import { SheetPane } from './panes/SheetPane.tsx';
import { loadSources, type LoadProgress, type LoadedContent } from './content.ts';

type Pane = 'library' | 'build' | 'sheet' | 'sources';

const EMPTY_INDEX: ElementIndex = new MapElementIndex();

/** Built once. Nothing else in the app asks whether it is running in Tauri. */
const platform = createDesktopPlatform();

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
    void loadCharacter(result.system, (key) => platform.storage.read(key)).then(setCharacter);
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

  return <Shell system={system} initial={character} />;
}

function Shell({ system, initial }: { system: GameSystem; initial: Character }): React.JSX.Element {
  const [pane, setPane] = useState<Pane>('library');
  const [content, setContent] = useState<LoadedContent | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [updates, setUpdates] = useState<Record<string, UpdateStatus>>({});
  const [sources, setSources] = useState<readonly ConfiguredSource[]>([]);
  const profile = useRef<SourceProfile | null>(null);

  /** The character being edited, and where it came from in the library (if anywhere). */
  const [working, setWorking] = useState<{
    character: Character;
    /** The save's own embedded content, when this character was opened from a file. */
    embedded?: ElementIndex;
    entry?: LibraryEntryRef;
    /** What the manifest said when it was read — the conflict check compares this. */
    readAt?: string;
  }>({ character: initial });
  const [saveNote, setSaveNote] = useState<string | null>(null);

  const library = useMemo(() => new CharacterLibrary(platform.characters), []);
  const libraryState = useLibrary(library);

  // The profile, then the library. Neither needs the other, and the library deliberately
  // does not wait for content: ADR 0012 is what lets the first screen render with nothing
  // configured, so making it depend on a source load would quietly undo the whole point.
  //
  // The content load is started afterwards and never awaited. Ordering, not politeness — the
  // library has to be on screen before the network is touched, or the app is back to being a
  // toll gate with a nicer front door. Warm, it is half a second; cold it is twenty, and the
  // library is usable throughout either.
  useEffect(() => {
    void (async () => {
      const loaded = await SourceProfile.load(platform.storage);
      profile.current = loaded;
      setSources([...loaded.sources]);
      library.setProfile(loaded.sources);
      await library.restore();
      if (loaded.enabled.length) void reloadRef.current?.();
    })();
  }, [library]);

  /**
   * What the builder resolves elements through.
   *
   * The save's own content first and loaded sources behind it (see `LayeredElementIndex`):
   * nothing the character already has is silently replaced by a newer upstream copy, and
   * material it does not have is still offered. A real refresh is a thing the user asks for.
   */
  const elements = useMemo(() => {
    const layers = [working.embedded, content?.elements].filter(Boolean) as ElementIndex[];
    if (layers.length === 0) return EMPTY_INDEX;
    return layers.length === 1 ? layers[0]! : new LayeredElementIndex(layers);
  }, [working.embedded, content]);

  const { builder, state } = useBuilder(working.character, system, elements);

  // The draft, not the library. ADR 0027: a builder that wrote a zip into the user's folder on
  // every keystroke would be slow and a poor neighbour to a folder under version control, so
  // the library is explicit-save and this is the autosave that stops work being lost.
  useEffect(() => {
    void saveCharacter(state.character, (key, value) => platform.storage.write(key, value));
  }, [state.character]);

  const persist = useCallback(async (): Promise<void> => {
    const current = profile.current;
    if (!current) return;
    await current.save();
    setSources([...current.sources]);
    library.setProfile(current.sources);
  }, [library]);

  const reload = useCallback(async (): Promise<void> => {
    const current = profile.current;
    if (!current) return;
    setBusy(true);
    setProgress(null);
    try {
      const loaded = await loadSources(current.enabled, platform, setProgress);
      setContent(loaded);
      for (const source of loaded.sources) {
        if (source.failed) continue;
        current.update(source.id, {
          version: source.version,
          fileCount: source.fileCount,
          elementCount: source.elementCount,
          lastLoadedAt: new Date().toISOString(),
        });
      }
      await persist();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [persist]);

  // The startup effect runs once, before `reload` has been declared; a ref is how it reaches
  // the current one without listing it as a dependency and re-running on every render.
  const reloadRef = useRef<typeof reload | null>(null);
  reloadRef.current = reload;

  const actions: SourcesActions = useMemo(
    () => ({
      add: async (url, mode) => {
        const current = profile.current;
        if (!current) return;
        current.add(url, { mode });
        await persist();
        await reload();
      },
      remove: async (id) => {
        // ADR 0028: this changes no character. A save that embeds this source's content keeps
        // working forever, which is the trade ADR 0012 bought.
        profile.current?.remove(id);
        await persist();
        await reload();
      },
      rename: async (id, name) => {
        profile.current?.update(id, { name });
        await persist();
      },
      setEnabled: async (id, enabled) => {
        profile.current?.update(id, { enabled });
        await persist();
        await reload();
      },
      setMode: async (id, mode) => {
        profile.current?.update(id, { mode });
        await persist();
      },
      checkForUpdates: async (id) => {
        const source = profile.current?.find(id);
        if (!source) return;
        const status = await checkSourceForUpdates(source, platform);
        setUpdates((previous) => ({ ...previous, [id]: status }));
      },
      refresh: async (id) => {
        // ADR 0029: evict this source's cache and nothing else's, then fetch it again.
        setBusy(true);
        try {
          await evictSourceCache(platform.storage, id);
          await writeVersionStamp(platform.storage, id, undefined);
        } finally {
          setBusy(false);
        }
        setUpdates((previous) => {
          const next = { ...previous };
          delete next[id];
          return next;
        });
        await reload();
      },
      reload,
    }),
    [persist, reload],
  );

  const openFromLibrary = useCallback(
    async (entry: LibraryEntry) => {
      const opened = await library.open(entry.name);
      if (!opened) return;
      setWorking({
        character: opened.character,
        embedded: opened.elements,
        entry: { name: entry.name, form: entry.form },
        readAt: entry.updatedAt,
      });
      setSaveNote(
        opened.problems.length
          ? `Opened with ${opened.problems.length} problem(s): ${opened.problems
              .map((problem) => `${problem.path ?? ''} ${problem.message}`.trim())
              .join(' · ')}`
          : null,
      );
      setPane('build');
    },
    [library],
  );

  const startNew = useCallback(() => {
    setWorking({ character: newCharacter(system) });
    setSaveNote(null);
    setPane('build');
  }, [system]);

  const saveToLibrary = useCallback(async () => {
    const result = await library.save(state.character, system, elements, {
      entry: working.entry,
      expectUpdatedAt: working.entry ? working.readAt : undefined,
      generator: 'incudo-desktop',
    });
    if (!result.ok) {
      setSaveNote(result.message);
      return;
    }
    setWorking((previous) => ({ ...previous, entry: result.entry, readAt: state.character.updatedAt }));
    setSaveNote(`Saved to ${result.entry.name}.`);
  }, [library, state.character, system, elements, working.entry, working.readAt]);

  const panes: Array<[Pane, string]> = [
    ['library', 'Characters'],
    ['build', 'Build'],
    ['sheet', 'Sheet'],
    ['sources', 'Sources'],
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
              {id === 'library' && libraryState.entries.length > 0 && (
                <span className="badge">{libraryState.entries.length}</span>
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

      {pane === 'library' && (
        <LibraryPane
          state={libraryState}
          shell={platform.shell}
          onChooseFolder={() => void library.chooseLocation()}
          onRefresh={() => void library.refresh()}
          onOpen={(entry) => void openFromLibrary(entry)}
          onNew={startNew}
          onRemove={(entry) => void library.remove({ name: entry.name, form: entry.form })}
        />
      )}
      {pane === 'build' && (
        <>
          <div className="pane-bar">
            <span className="status">
              {working.entry ? (
                <>
                  Editing <code>{working.entry.name}</code>
                </>
              ) : (
                'Not saved to your library yet'
              )}
            </span>
            <button
              type="button"
              onClick={() => void saveToLibrary()}
              disabled={libraryState.status !== 'ready'}
            >
              Save to library
            </button>
            {saveNote && <span className="status">{saveNote}</span>}
          </div>
          <BuilderPane
            builder={builder}
            state={state}
            elements={elements}
            hasContent={content !== null || working.embedded !== undefined}
          />
        </>
      )}
      {pane === 'sheet' && <SheetPane state={state} />}
      {pane === 'sources' && (
        <SourcesPane
          sources={sources}
          content={content}
          progress={progress}
          busy={busy}
          updates={updates}
          actions={actions}
          shell={platform.shell}
        />
      )}
    </div>
  );
}

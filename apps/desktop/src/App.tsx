/**
 * The desktop shell.
 *
 * Windows, panes and navigation — and nothing else. Every number on screen comes from
 * `deriveCharacter`, every outstanding decision from `CharacterBuilder`, and every fact about
 * the library from `CharacterLibrary`. If a bug is "the app computed the wrong AC" it must be
 * fixable in `packages/`, which is the test docs/CODE-REUSE-POLICY.md sets for this file.
 *
 * **It opens on a launcher, then the library** (ADR 0031, amending ADR 0027). Before that it
 * opened on Sources, with an index URL in a text box, doing nothing at all until 238 files had
 * come down over the network — the app's own first screen contradicting ADR 0012, the decision
 * that a save carries its content and opens with nothing configured. ADR 0027 replaced it with
 * the library; what was still missing is that nobody ever picked a *system*, so the header
 * announced "Dungeons & Dragons 5th Edition" to a user who had chosen nothing and two shipped
 * definitions were one hardcoded import. The launcher asks, and the answer scopes the library.
 * It is not a toll gate on content: picking a system leads to the library, never to "now add a
 * source".
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
  type ContainerFiles,
  type ElementIndex,
  type GameSystem,
  type LibraryEntryRef,
} from '@incudo/core';
import {
  SourceProfile,
  checkSourceForUpdates,
  refreshSource,
  sourcesForSystem,
  unassignedSources,
  type ConfiguredSource,
  type RefreshReport,
  type SourceMode,
  type UpdateStatus,
} from '@incudo/content';
import {
  CharacterLibrary,
  COMMANDS,
  UserSystemStore,
  describeCommand,
  importAuroraSavesIntoLibrary,
  importBlock,
  resolveCommands,
  saveCopy,
  type AuroraImportReport,
  type Destination,
  type LibraryEntry,
} from '@incudo/ui';

import {
  loadCharacter,
  loadShippedSystems,
  newCharacter,
  readChosenSystem,
  saveCharacter,
  schemas,
  writeChosenSystem,
  type SystemFailure,
} from './boot.ts';
import { createDesktopPlatform } from './platform.ts';
import { useBuilder } from './use-builder.ts';
import { useLibrary } from './use-library.ts';
import { useCommandHost, type CommandBinder, type CommandHandlers } from './use-commands.ts';
import { LauncherPane, type SystemSummary } from './panes/LauncherPane.tsx';
import { LibraryPane } from './panes/LibraryPane.tsx';
import { SourcesPane, type SourcesActions } from './panes/SourcesPane.tsx';
import { BuilderPane } from './panes/BuilderPane.tsx';
import { SheetPane } from './panes/SheetPane.tsx';
import { SettingsPane } from './panes/SettingsPane.tsx';
import { loadSources, type LoadProgress, type LoadedContent } from './content.ts';

type Pane = Destination;

const EMPTY_INDEX: ElementIndex = new MapElementIndex();

/** Built once. Nothing else in the app asks whether it is running in Tauri. */
const platform = createDesktopPlatform();

interface Booted {
  /** Shipped and user-authored together, in that order. */
  systems: GameSystem[];
  failures: SystemFailure[];
  /** Which of them the user added themselves, and can therefore remove. */
  mine: Set<string>;
  /** What the user picked last time, if that system still exists. */
  remembered: GameSystem | null;
}

export function App(): React.JSX.Element {
  const [booted, setBooted] = useState<Booted | null>(null);
  /** The system in play. Null means the launcher is on screen. */
  const [system, setSystem] = useState<GameSystem | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  /** Set while the user is deliberately changing systems, so the launcher can say "current". */
  const [changing, setChanging] = useState(false);
  /**
   * The menu and the keyboard (ADR 0037). Here, above `Shell`, because a window has one menu
   * and a `Shell` is per system: it is rebuilt on every switch and the menu should not be.
   */
  const commands = useCommandHost(platform.commands);

  const reboot = useCallback(async (): Promise<Booted> => {
    const shipped = loadShippedSystems();
    // ADR 0011's other half. A user definition is revalidated on every load rather than trusted
    // from when it was added, because Incudo's schema moves under a file written months ago.
    const store = new UserSystemStore(platform.storage, schemas, shipped.systems.map((s) => s.id));
    const user = await store.load();
    const rememberedId = await readChosenSystem((key) => platform.storage.read(key));
    const systems = [...shipped.systems, ...user.systems];
    return {
      systems,
      failures: [...shipped.failures, ...user.failures],
      mine: new Set(user.systems.map((s) => s.id)),
      remembered: systems.find((s) => s.id === rememberedId) ?? null,
    };
  }, []);

  useEffect(() => {
    void (async () => {
      const next = await reboot();
      setBooted(next);
      if (next.remembered) {
        setSystem(next.remembered);
        setCharacter(await loadCharacter(next.remembered, (key) => platform.storage.read(key)));
      }
    })();
  }, [reboot]);

  /**
   * Switch systems, character first.
   *
   * The order is the whole of this function and it was wrong the first time. Setting the system
   * before awaiting the character leaves one render where `system` is the new one and
   * `character` is still the old one, and `Shell` mounts on that pair: `useBuilder` calls
   * `resolveCharacterKind(cairn, 'pc')` and the app dies with **System "cairn" has no character
   * kind "pc"**. Found by switching systems in the running app; no test had it, because every
   * test builds one system's character against that system.
   *
   * So the character is loaded first and both go into one render. React batches the three
   * setters, and the pair is never mismatched.
   */
  const choose = useCallback(async (picked: GameSystem): Promise<void> => {
    await writeChosenSystem(picked.id, (key, value) => platform.storage.write(key, value));
    const next = await loadCharacter(picked, (key) => platform.storage.read(key));
    setCharacter(next);
    setSystem(picked);
    setChanging(false);
  }, []);

  if (!booted) return <main className="fatal">Loading the system definitions…</main>;

  // Every shipped definition broken is the only remaining fatal case, and it is a broken build
  // rather than a broken character — the app refuses a system rather than loading half of one
  // (ADR 0011). One broken definition among several is not fatal and the launcher says which.
  if (booted.systems.length === 0) {
    return (
      <main className="fatal">
        <h1>No system definition could be loaded.</h1>
        <ul>
          {booted.failures.flatMap((failure) =>
            failure.errors.map((error) => (
              <li key={`${failure.id}${error.path}${error.message}`}>
                {failure.id} — {error.path}: {error.message}
              </li>
            )),
          )}
        </ul>
      </main>
    );
  }

  if (!system || !character || changing) {
    return (
      <Launcher
        booted={booted}
        current={changing && system ? system.id : undefined}
        onChoose={(picked) => void choose(picked)}
        onChanged={(next) => {
          setBooted(next);
          // The system in play may have just been removed. Back to the launcher, deliberately
          // and visibly, rather than leaving a Shell bound to a definition that is gone.
          if (system && !next.systems.some((s) => s.id === system.id)) setSystem(null);
        }}
        reboot={reboot}
      />
    );
  }

  return (
    <Shell
      key={system.id}
      system={system}
      initial={character}
      commands={commands}
      onChangeSystem={() => setChanging(true)}
      nameOfSystem={(id) => booted.systems.find((known) => known.id === id)?.name ?? id}
    />
  );
}

/**
 * The launcher, with the facts each system can be judged on.
 *
 * It reads the profile and scans the library itself rather than being handed them, because it
 * runs *before* a `Shell` exists — and a `Shell` is per-system by construction (it is keyed on
 * the system id, so switching rebuilds every piece of per-system state rather than leaving a
 * stale builder behind).
 */
function Launcher({
  booted,
  current,
  onChoose,
  onChanged,
  reboot,
}: {
  booted: Booted;
  current?: string;
  onChoose: (system: GameSystem) => void;
  onChanged: (booted: Booted) => void;
  reboot: () => Promise<Booted>;
}): React.JSX.Element {
  const [summaries, setSummaries] = useState<Record<string, SystemSummary>>({});
  const [location, setLocation] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addProblem, setAddProblem] = useState<
    { message: string; errors?: { path: string; message: string }[] } | undefined
  >();

  const store = useMemo(
    () =>
      new UserSystemStore(
        platform.storage,
        schemas,
        // Only the *shipped* ids are reserved. A user system may of course be replaced by
        // another file with the same id — that is what editing your own definition means.
        loadShippedSystems().systems.map((s) => s.id),
      ),
    [],
  );

  const addSystem = useCallback(async (): Promise<void> => {
    setAddProblem(undefined);
    setAdding(true);
    try {
      const picked = await platform.files.pick({
        title: 'Add a game system',
        extensions: ['json'],
        label: 'System definition',
        multiple: false,
      });
      // Cancelling is an answer, and leaves the screen exactly as it was.
      if (!picked.length) return;
      const result = await store.add(picked[0]!);
      if (!result.ok) {
        setAddProblem({ message: result.message, errors: result.errors });
        return;
      }
      onChanged(await reboot());
    } catch (error) {
      setAddProblem({ message: error instanceof Error ? error.message : String(error) });
    } finally {
      setAdding(false);
    }
  }, [store, onChanged, reboot]);

  const removeSystem = useCallback(
    async (system: GameSystem): Promise<void> => {
      // Removing a definition removes no character. A save records its system by id and keeps
      // every element it uses (ADR 0012), so the characters stay on disk and reappear the day
      // the definition comes back — they are simply not listed while nothing can read them.
      await store.remove(system.id);
      onChanged(await reboot());
    },
    [store, onChanged, reboot],
  );

  useEffect(() => {
    void (async () => {
      const profile = await SourceProfile.load(platform.storage);
      const next: Record<string, SystemSummary> = {};
      for (const system of booted.systems) {
        const forSystem = sourcesForSystem(profile.sources, system.id);
        next[system.id] = {
          sources: forSystem.length,
          enabled: forSystem.filter((s) => s.enabled).length,
          mine: booted.mine.has(system.id),
        };
      }

      // The library is scanned once, here, and counted per system. Reading every container in
      // full to show a number is the cost ADR 0027 already names and deliberately does not
      // optimise; nine saves is imperceptible and the manifest-only fast path does not exist.
      const library = new CharacterLibrary(platform.characters);
      await library.restore();
      setLocation(library.getState().location);
      if (library.getState().status === 'ready') {
        const counts = new Map<string, number>();
        for (const entry of library.getState().entries) {
          if (!entry.systemId) continue;
          counts.set(entry.systemId, (counts.get(entry.systemId) ?? 0) + 1);
        }
        for (const system of booted.systems) {
          next[system.id] = { ...next[system.id]!, characters: counts.get(system.id) ?? 0 };
        }
      }
      setSummaries(next);
    })();
  }, [booted]);

  return (
    <LauncherPane
      systems={booted.systems}
      failures={booted.failures}
      summaries={summaries}
      current={current}
      onChoose={onChoose}
      onAddSystem={() => void addSystem()}
      onRemoveSystem={(system) => void removeSystem(system)}
      adding={adding}
      addProblem={addProblem}
      onDismissAddProblem={() => setAddProblem(undefined)}
      canAdd={platform.files.available}
      cannotAddReason={platform.files.unavailableReason}
      libraryLocation={location}
    />
  );
}

function Shell({
  system,
  initial,
  commands,
  onChangeSystem,
  nameOfSystem,
}: {
  system: GameSystem;
  initial: Character;
  commands: CommandBinder;
  onChangeSystem: () => void;
  /**
   * A system's name, for saying which one holds something. A system id is the format's key and
   * never shown; one no loaded definition declares (removed, or failed to validate) falls back
   * to its id, since that is still the only thing that names it.
   */
  nameOfSystem: (id: string) => string;
}): React.JSX.Element {
  const [pane, setPane] = useState<Pane>('library');
  const [content, setContent] = useState<LoadedContent | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [updates, setUpdates] = useState<Record<string, UpdateStatus>>({});
  /** What the last refresh of each source did, or why it could not (ADR 0050). */
  const [refreshes, setRefreshes] = useState<Record<string, RefreshReport | { failed: string }>>({});
  const [sources, setSources] = useState<readonly ConfiguredSource[]>([]);
  const profile = useRef<SourceProfile | null>(null);

  /** The character being edited, and where it came from in the library (if anywhere). */
  const [working, setWorking] = useState<{
    character: Character;
    /** The save's own embedded content, when this character was opened from a file. */
    embedded?: ElementIndex;
    /**
     * The save's asset files, when it was opened from one. Held so the next Save and any copy
     * write the portrait back out: a character records only where it is, not what it holds.
     */
    assets?: ContainerFiles;
    entry?: LibraryEntryRef;
    /** What the manifest said when it was read — the conflict check compares this. */
    readAt?: string;
    /**
     * `character.name` as of the last successful save (or the open that gave us `entry`).
     * `LibraryEntryRef.name` is never derived from this — a character renamed to something else still
     * lives in `aelin.incu` (ADR 0027) — so this is the one place that remembers what the name
     * *was*, which is what lets the next save notice it changed and ask about the file too.
     * Always set together with `entry`; undefined exactly when `entry` is.
     */
    savedName?: string;
  }>({ character: initial });
  const [saveNote, setSaveNote] = useState<string | null>(null);
  /** A save in flight. A second one would race the first on `working.readAt`. */
  const [saving, setSaving] = useState(false);
  /** A copy being written: a dialog is open, or bytes are going to disk. */
  const [copying, setCopying] = useState(false);
  /** A save whose character name no longer matches the file it would write to. */
  const [renamePrompt, setRenamePrompt] = useState<{ from: string; to: string } | null>(null);

  /** The Aurora import: what it is doing, and what it did. Cleared by the user, not a timer. */
  const [importing, setImporting] = useState(false);
  const [importReports, setImportReports] = useState<AuroraImportReport[] | null>(null);

  const library = useMemo(() => new CharacterLibrary(platform.characters), []);
  const libraryState = useLibrary(library);

  // ADR 0031: the library folder holds characters of every system and this one shows one
  // system's. Set before the scan, so the first render is already filtered rather than
  // flashing every character in the folder and then removing most of them.
  library.setSystem(system.id);

  /**
   * Whether the first-run "where do you keep your characters?" dialog has been waved away.
   *
   * Here rather than inside `LibraryPane` because that pane unmounts when you switch tabs, and
   * a question you have already declined should not come back because you looked at Sources.
   * Session-lived on purpose: it is not a preference worth persisting, and the answer next
   * launch is usually different.
   */
  const [askDismissed, setAskDismissed] = useState(false);

  const chooseFolder = useCallback(async (): Promise<void> => {
    // Declining the OS picker counts as an answer: do not ask again this session.
    setAskDismissed(true);
    await library.chooseLocation();
  }, [library]);

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
      // The *whole* profile, not this system's slice: a character records the sources it was
      // built against by id, and comparing those against a filtered list would report every
      // source of another system as `missing` (ADR 0028).
      library.setProfile(loaded.sources);
      await library.restore();
      if (sourcesForSystem(loaded.sources, system.id).some((s) => s.enabled)) {
        void reloadRef.current?.();
      }
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
      // Only this system's, and only the enabled ones. Loading everything would put a Cairn
      // index into a D&D character's candidate lists — and, worse, into the content a save
      // embeds, where it would be frozen forever (ADR 0012).
      const forSystem = sourcesForSystem(current.sources, system.id).filter((s) => s.enabled);
      const loaded = await loadSources(forSystem, platform, setProgress);
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
      add: async (url, mode, options = {}) => {
        const current = profile.current;
        if (!current) return;
        // A source is keyed on its URL, so adding one another system already holds would
        // retag it in place and quietly take it away from that system. Refused, and said.
        const existing = current.find(url);
        if (existing?.systemId !== undefined && existing.systemId !== system.id) {
          throw new Error(
            // A source is keyed on its URL (ADR 0031), which is why it can only have one system.
            `That address is already added under ${nameOfSystem(existing.systemId)}, and a ` +
              `source can only belong to one system at a time.`,
          );
        }
        // Tagged with the system it is being added under — ADR 0031. Nothing in an index says
        // what game it is for, so this is the only moment the answer is known, and for a
        // source picked from the system's own suggestions the user said it by picking it.
        current.add(url, { mode, systemId: system.id, ...options });
        await persist();
        await reload();
      },
      assignToSystem: async (id) => {
        profile.current?.update(id, { systemId: system.id });
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
        // Busy while it runs: under Tauri it asks every cached file (ADR 0050), which takes seconds.
        setBusy(true);
        try {
          const status = await checkSourceForUpdates(source, platform);
          setUpdates((previous) => ({ ...previous, [id]: status }));
        } finally {
          setBusy(false);
        }
      },
      refresh: async (id) => {
        // ADR 0050, amending 0029: fetch network first and keep what cannot be reached, rather than
        // evicting everything and hoping the network is there to refill it.
        const source = profile.current?.find(id);
        if (!source) return;
        setBusy(true);
        try {
          const report = await refreshSource(source, platform);
          setRefreshes((previous) => ({ ...previous, [id]: report }));
        } catch (error) {
          setRefreshes((previous) => ({
            ...previous,
            [id]: { failed: error instanceof Error ? error.message : String(error) },
          }));
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

  /** The profile, split the way ADR 0031 splits it: mine, nobody's, and everyone else's. */
  const mySources = useMemo(() => sourcesForSystem(sources, system.id), [sources, system.id]);
  const untagged = useMemo(() => unassignedSources(sources), [sources]);
  const otherSources = useMemo(
    () => sources.filter((s) => s.systemId !== undefined && s.systemId !== system.id),
    [sources, system.id],
  );

  /**
   * Why the import button cannot be pressed, in a sentence, or undefined.
   *
   * The middle one is the interesting case and it is not a bug: opening a character needs
   * no content at all (ADR 0012), and importing one genuinely does, because a `.dnd5e`
   * names Aurora's element ids and says nothing about what they mean. That asymmetry gets
   * said out loud rather than left as a greyed-out button.
   */
  const contentLoaded = content !== null && content.elementCount > 0;
  const importBlockedBecause = useMemo((): string | undefined => {
    // Which reason applies is `importBlock`'s to say, so this sentence and the Import menu
    // item cannot disagree about whether importing is possible. The sentences are this pane's.
    const reason = importBlock({
      pickerAvailable: platform.files.available,
      library: libraryState.status,
      contentLoaded,
    });
    switch (reason) {
      case 'no-picker':
        return platform.files.unavailableReason;
      case 'no-library':
        return 'Choose a library folder first — an imported character has to land somewhere.';
      case 'no-content':
        return (
          'Importing needs a content source loaded: an Aurora save records element ids and ' +
          'nothing about what they mean. Add one under Sources. (Opening a character you have ' +
          'already imported needs none.)'
        );
      default:
        return undefined;
    }
  }, [libraryState.status, contentLoaded]);

  /**
   * Pick `.dnd5e` files and write each one into the library.
   *
   * Everything between the picker and the folder is `importAuroraSavesIntoLibrary` in
   * `packages/ui` — the parse, the overlay of the elements Aurora generates at runtime, the
   * `extraIds` that keep `aurora verify` meaningful, and the packing. None of that is here,
   * because none of it is a fact about a window (CODE-REUSE-POLICY rule 2).
   */
  const importFromAurora = useCallback(async () => {
    if (!content) return;
    setImporting(true);
    try {
      const picked = await platform.files.pick({
        title: 'Import Aurora characters',
        extensions: ['dnd5e'],
        label: 'Aurora character',
        multiple: true,
      });
      // Cancelling is an answer. It leaves whatever report was on screen alone.
      if (!picked.length) return;
      setImportReports(
        await importAuroraSavesIntoLibrary(library, picked, {
          system,
          elements: content.elements,
          generator: 'incudo-desktop (aurora import)',
        }),
      );
    } catch (error) {
      // The picker itself failing — a permission lapsed, a file vanished between the dialog
      // and the read. One report with no file name, rather than a swallowed exception.
      setImportReports([
        {
          file: 'the file you picked',
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          unresolved: [],
          assetCount: 0,
          diagnostics: [],
        },
      ]);
    } finally {
      setImporting(false);
    }
  }, [library, system, content]);

  const openFromLibrary = useCallback(
    async (entry: LibraryEntry) => {
      const opened = await library.open(entry.name);
      if (!opened) return;
      setWorking({
        character: opened.character,
        embedded: opened.elements,
        assets: opened.assets,
        entry: { name: entry.name, form: entry.form },
        readAt: entry.updatedAt,
        savedName: opened.character.name,
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

  /**
   * Write the character to `entry`, or — with `entry` left `undefined` — to a freshly chosen
   * filename derived from the character's *current* name: a first save, or a rename the user
   * just confirmed. Either way `working` ends up pointing at whichever file now holds it.
   */
  const performSave = useCallback(
    async (entry: LibraryEntryRef | undefined): Promise<void> => {
      const previousEntry = working.entry;
      setSaving(true);
      let result: Awaited<ReturnType<typeof library.save>>;
      try {
        result = await library.save(state.character, system, elements, {
          entry,
          form: entry?.form ?? previousEntry?.form,
          expectUpdatedAt: entry ? working.readAt : undefined,
          assets: working.assets,
          generator: 'incudo-desktop',
        });
      } finally {
        setSaving(false);
      }
      if (!result.ok) {
        setSaveNote(result.message);
        return;
      }
      // A rename save lands under a brand new name before the old file is touched — removing
      // it only once the new one is confirmed written, so a crash in between leaves a harmless
      // duplicate rather than losing the character.
      if (previousEntry && entry === undefined && previousEntry.name !== result.entry.name) {
        await library.remove(previousEntry);
      }
      setWorking((previous) => ({
        ...previous,
        entry: result.entry,
        readAt: state.character.updatedAt,
        savedName: state.character.name,
      }));
      setSaveNote(`Saved to ${result.entry.name}.`);
    },
    [library, state.character, system, elements, working.entry, working.readAt, working.assets],
  );

  /**
   * Write the character as it is now to a file the user picks, and change nothing else.
   *
   * **This does not touch `working`.** `entry`, `readAt` and `savedName` are what the next Save
   * writes to and compares against, and a copy leaves the file being edited exactly where it was —
   * which is why there is no `setWorking` in here, and why `saveCopy` takes no library and returns no
   * entry. The one thing it changes is the note printed beside the buttons.
   */
  const copyToFile = useCallback(async (): Promise<void> => {
    setCopying(true);
    try {
      const result = await saveCopy(platform.saver, platform.zip, state.character, system, elements, {
        profile: sources,
        assets: working.assets,
        generator: 'incudo-desktop',
      });
      if (result.status === 'saved') setSaveNote(`Saved a copy as ${result.file.name}.`);
      else if (result.status === 'failed') setSaveNote(`Could not save a copy. ${result.message}`);
      // Cancelled: an answer. The note that was on screen stays.
    } finally {
      setCopying(false);
    }
  }, [state.character, system, elements, sources, working.assets]);

  /**
   * Save, unless the character was renamed since the last save. `LibraryEntryRef.name` never
   * follows `character.name` (ADR 0027) — "a character renamed to something else still lives in
   * aelin.incu" — so without this a rename would save silently under the old filename, with
   * nothing on screen to say the two had drifted apart.
   */
  const saveToLibrary = useCallback(async () => {
    if (
      working.entry &&
      working.savedName !== undefined &&
      working.savedName !== state.character.name
    ) {
      setRenamePrompt({ from: working.savedName, to: state.character.name });
      return;
    }
    await performSave(working.entry);
  }, [working.entry, working.savedName, state.character.name, performSave]);

  /** The rename prompt's two real answers: a fresh file under the new name, or keep the old one. */
  const resolveRename = useCallback(
    async (renameFile: boolean) => {
      setRenamePrompt(null);
      await performSave(renameFile ? undefined : working.entry);
    },
    [performSave, working.entry],
  );

  // The menu, the shortcuts and the nav below are one list (ADR 0037). "Modal" is whatever
  // dialog is open: nothing behind it should react to a shortcut.
  const modal =
    renamePrompt !== null ||
    (pane === 'library' && libraryState.status === 'no-location' && !askDismissed);
  const resolved = resolveCommands({
    workspace: true,
    pane,
    modal,
    library: libraryState.status,
    libraryBusy: libraryState.busy,
    contentBusy: busy,
    hasEnabledSource: mySources.some((source) => source.enabled),
    contentLoaded,
    pickerAvailable: platform.files.available,
    importing,
    saving,
    saverAvailable: platform.saver.available,
    copying,
  });

  const handlers: CommandHandlers = {
    'new-character': startNew,
    'save-character': () => void saveToLibrary(),
    'save-copy': () => void copyToFile(),
    'import-aurora': () => void importFromAurora(),
    'choose-library-folder': () => void chooseFolder(),
    'refresh-library': () => void library.refresh(),
    'reload-sources': () => void reload(),
    'change-system': onChangeSystem,
  };
  for (const command of COMMANDS) {
    if (command.destination) handlers[command.id] = () => setPane(command.destination!);
  }

  // Every render, deliberately: the handlers close over the current character and pane, and
  // `update` is a ref write plus a menu sync that sends only the flags that changed.
  useEffect(() => {
    commands.update(resolved, handlers);
  });
  useEffect(() => () => commands.release(), [commands]);

  const navigation = COMMANDS.filter((command) => command.destination);

  return (
    <div className="app">
      <header>
        <h1>Incudo</h1>
        <nav>
          {navigation.map((command) => {
            const id = command.destination!;
            return (
              <button
                key={id}
                type="button"
                className={pane === id ? 'on' : ''}
                onClick={() => setPane(id)}
                title={describeCommand(command.id, commands.os)}
              >
                {command.label}
                {id === 'build' && state.decisions.length > 0 && (
                  <span className="badge">{state.decisions.length}</span>
                )}
                {id === 'library' && libraryState.entries.length > 0 && (
                  <span className="badge">{libraryState.entries.length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <span className="status">
          {/*
            The system is a *choice* now, so it is a control rather than a label. It used to
            read "Dungeons & Dragons 5th Edition" to a user who had never been asked — ADR 0031.
          */}
          <button type="button" className="system-switch" onClick={onChangeSystem} title="Change system">
            {system.name}
          </button>
          {' · '}
          {content
            ? `${content.elementCount.toLocaleString()} elements from ${content.fileCount} files`
            : mySources.length === 0
              ? 'no sources for this system'
              : 'no content loaded'}
        </span>
      </header>

      {pane === 'library' && (
        <LibraryPane
          state={libraryState}
          systemName={system.name}
          nameOfSystem={nameOfSystem}
          needsSource={!mySources.some((source) => source.enabled)}
          onOpenSources={() => setPane('sources')}
          onChangeSystem={onChangeSystem}
          shell={platform.shell}
          onChooseFolder={() => void chooseFolder()}
          onRefresh={() => void library.refresh()}
          onOpen={(entry) => void openFromLibrary(entry)}
          onNew={startNew}
          onRemove={(entry) => void library.remove({ name: entry.name, form: entry.form })}
          onOpenSettings={() => setPane('settings')}
          onImport={() => void importFromAurora()}
          onDismissImport={() => setImportReports(null)}
          importing={importing}
          importBlockedBecause={importBlockedBecause}
          importReports={importReports}
          askForFolder={libraryState.status === 'no-location' && !askDismissed}
          onDismissAsk={() => setAskDismissed(true)}
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
              title={describeCommand('save-character', commands.os)}
            >
              Save to library
            </button>
            <button
              type="button"
              onClick={() => void copyToFile()}
              disabled={!platform.saver.available || copying}
              title={
                platform.saver.available
                  ? describeCommand('save-copy', commands.os)
                  : platform.saver.unavailableReason
              }
            >
              Save a copy…
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
      {pane === 'sheet' && <SheetPane builder={builder} state={state} />}
      {pane === 'settings' && (
        <SettingsPane
          location={libraryState.location}
          unavailableReason={
            libraryState.status === 'unavailable' ? libraryState.unavailableReason : undefined
          }
          entryCount={libraryState.entries.length}
          onChooseFolder={() => void chooseFolder()}
          shell={platform.shell}
        />
      )}
      {pane === 'sources' && (
        <SourcesPane
          system={system}
          sources={mySources}
          unassigned={untagged}
          others={otherSources}
          nameOfSystem={nameOfSystem}
          content={content}
          progress={progress}
          busy={busy}
          updates={updates}
          refreshes={refreshes}
          actions={actions}
          shell={platform.shell}
        />
      )}
      <RenameFileDialog
        prompt={renamePrompt}
        onRenameFile={() => void resolveRename(true)}
        onKeepFilename={() => void resolveRename(false)}
        onDismiss={() => setRenamePrompt(null)}
      />
    </div>
  );
}

/**
 * "You renamed the character — rename the file too?", asked once per save that needs it.
 *
 * Declining is a real answer, not a dodge: `LibraryEntryRef.name` is deliberately never
 * derived from `character.name` (ADR 0027), so keeping the old filename is a legitimate
 * choice, not a state to nag the user out of on every later save. Only *this* save is asked
 * about; saving again with the same drift asks again, the same way a re-save always might.
 */
function RenameFileDialog({
  prompt,
  onRenameFile,
  onKeepFilename,
  onDismiss,
}: {
  prompt: { from: string; to: string } | null;
  onRenameFile: () => void;
  onKeepFilename: () => void;
  onDismiss: () => void;
}): React.JSX.Element | null {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (prompt && !dialog.open) dialog.showModal();
    if (!prompt && dialog.open) dialog.close();
  }, [prompt]);

  return (
    <dialog ref={ref} className="ask" onClose={onDismiss} onCancel={onDismiss}>
      {prompt && (
        <>
          <h2>Rename the file too?</h2>
          <p className="lede">
            This character is now called <strong>{prompt.to}</strong>, saved under a file named
            after <strong>{prompt.from}</strong>.
          </p>
          <p className="hint">
            Incudo never renames a file on its own — only when you ask, here.
          </p>
          <div className="row">
            <button type="button" className="on" onClick={onRenameFile}>
              Rename the file
            </button>
            <button type="button" onClick={onKeepFilename}>
              Keep the old filename
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

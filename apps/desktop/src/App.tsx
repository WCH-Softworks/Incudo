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
  BundleElementIndex,
  LayeredElementIndex,
  MapElementIndex,
  systemLineage,
  type ElementIndex,
  type GameSystem,
  type LibraryEntryRef,
} from '@incudo/core';
import {
  SourceProfile,
  checkSourceForUpdates,
  revealSourceFile,
  sourceParts,
  refreshSource,
  removeSource,
  createHomebrewSource,
  readHomebrew,
  writeHomebrew,
  sourcesForSystem,
  unassignedSources,
  refreshSourceRefs,
  type ComposeOptions,
  type ConfiguredSource,
  type RefreshReport,
  type UpdateStatus,
} from '@incudo/content';
import {
  CharacterLibrary,
  COMMANDS,
  characterKindChoices,
  characterOpenProblem,
  describeKindAndProgress,
  libraryEntryReferences,
  libraryEntryProgress,
  UserSystemStore,
  systemAttributions,
  systemCatalog,
  overlayView,
  copiedFromNote,
  newSystemChoices,
  newSystemFile,
  newSystemSavedNote,
  type NewSystemStart,
  type SystemProblem,
  addContentFiles,
  describeCommand,
  exportSheet,
  exportSheetPdf,
  finishPrintStep,
  contentChanges,
  refreshDocuments,
  refreshedElements,
  refreshNotice,
  refreshReview,
  formValues,
  keepFormCopy,
  officialSheetFileName,
  officialSheetResult,
  officialSheetView,
  readFormCopy,
  recogniseForm,
  removeFormCopy,
  importAuroraSavesIntoLibrary,
  importBlock,
  DEFAULT_PRINT_OPTIONS,
  PAPERS,
  paperForLocales,
  printOptionsView,
  DEFAULT_BUILD_PREFERENCES,
  readBuildPreferences,
  writeBuildPreferences,
  type BuildPreferences,
  printRendering,
  readPrintOptions,
  resolveCommands,
  saveCopy,
  sheetDocument,
  withPageNumbers,
  withPaper,
  withPrintPart,
  withRunningName,
  writeDraftOrigin,
  editState,
  isEnabled,
  openOutcome,
  replacePrompt,
  NOTHING_STARTED,
  UNSAVED_CHANGES,
  type Replacement,
  type ReplacePrompt,
  type AuroraImportReport,
  type ContentFileResult,
  type Destination,
  type LibraryEntry,
  type PrintOptions,
  type PrintTarget,
  type FormMap,
  type WorkingCharacter,
  type SystemCatalog,
  FeatureLibrary,
  SourceLoads,
  sourcesLoadKey,
  contentLoadFailedNote,
  buildTabs,
  nextBuildTab,
  shownTab,
} from '@incudo/ui';

import {
  loadDraft,
  loadShippedForms,
  loadShippedSystems,
  newCharacter,
  readChosenSystem,
  saveCharacter,
  schemas,
  featureLibrarySchema,
  writeChosenSystem,
  type LoadedDraft,
} from './boot.ts';
import { auroraConverter } from '@incudo/aurora-import';

import { createDesktopPlatform } from './platform.ts';

/** The form maps shipped beside the systems (ADR 0079), read once. */
const SHIPPED_FORMS: FormMap[] = loadShippedForms();
/** The starting equipment shipped beside the systems (ADR 0087), checked against the system each names, read once. */
import { useBuilder } from './use-builder.ts';
import { useLibrary } from './use-library.ts';
import { useCommandHost, type CommandBinder, type CommandHandlers } from './use-commands.ts';
import { LauncherPane, type SystemSummary } from './panes/LauncherPane.tsx';
import { LibraryPane } from './panes/LibraryPane.tsx';
import { SourcesPane, type SourcesActions } from './panes/SourcesPane.tsx';
import { BuilderPane, type StartOptionsAsk } from './panes/BuilderPane.tsx';
import { SheetPane } from './panes/SheetPane.tsx';
import { PrintOptionsDialog } from './panes/PrintOptions.tsx';
import { OfficialSheetDialog } from './panes/OfficialSheet.tsx';
import { RefreshDialog, RefreshLine } from './panes/ContentRefresh.tsx';
import { SettingsPane } from './panes/SettingsPane.tsx';
import { ContentLoading } from './panes/ContentLoading.tsx';
import { BrowsePane, NEW_BROWSE_VIEW, type BrowseView } from './panes/BrowsePane.tsx';
import { loadSources, type LoadProgress, type LoadedContent } from '@incudo/content';

type Pane = Destination;

const EMPTY_INDEX: ElementIndex = new MapElementIndex();

/** Built once. Nothing else in the app asks whether it is running in Tauri. */
const platform = createDesktopPlatform();

/**
 * What the content package is handed: the platform's network and storage, the files sources are kept as, and Aurora's
 * converter, the one place the app hands content Aurora's (ADR 0119).
 */
const contentPlatform: ComposeOptions = {
  fetcher: platform.fetcher,
  storage: platform.storage,
  files: platform.sources,
  converter: auroraConverter,
  now: () => new Date().toISOString(),
};

/**
 * Every system, shipped and the user's, read by the one loader (ADR 0107) and labelled by where it came from: the
 * `origins` say which the user added and may remove.
 */
interface Booted extends SystemCatalog {
  /** What the user picked last time, if that system still exists. */
  remembered: GameSystem | null;
}

export function App(): React.JSX.Element {
  const [booted, setBooted] = useState<Booted | null>(null);
  /** The system in play. Null means the launcher is on screen. */
  const [system, setSystem] = useState<GameSystem | null>(null);
  /** The draft the shell starts from, with what was kept beside it (ADR 0066). */
  const [character, setCharacter] = useState<LoadedDraft | null>(null);
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
    // An overlay is applied to its parent as the parent is on this load (ADR 0102), so the shipped systems are its bases.
    const store = new UserSystemStore(platform.storage, schemas, [], shipped.systems);
    const catalog = systemCatalog(shipped, await store.load());
    const rememberedId = await readChosenSystem((key) => platform.storage.read(key));
    return { ...catalog, remembered: catalog.systems.find((s) => s.id === rememberedId) ?? null };
  }, []);

  useEffect(() => {
    void (async () => {
      const next = await reboot();
      setBooted(next);
      if (next.remembered) {
        setSystem(next.remembered);
        setCharacter(await loadDraft(next.remembered, platform.storage));
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
    const next = await loadDraft(picked, platform.storage);
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
    { message: string; problems?: SystemProblem[] } | undefined
  >();
  // "New system…" (ADR 0104): a file being saved, why the form refused, and where the last one went.
  const [creating, setCreating] = useState(false);
  const [newProblem, setNewProblem] = useState<string | undefined>();
  const [newNote, setNewNote] = useState<string | undefined>();

  const store = useMemo(
    () =>
      new UserSystemStore(
        platform.storage,
        schemas,
        // Only the *shipped* ids are reserved. A user system may of course be replaced by
        // another file with the same id — that is what editing your own definition means.
        // They are also what an overlay may be built on (ADR 0102).
        [],
        loadShippedSystems().systems,
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
        setAddProblem({ message: result.message, problems: result.problems });
        return;
      }
      onChanged(await reboot());
    } catch (error) {
      setAddProblem({ message: error instanceof Error ? error.message : String(error) });
    } finally {
      setAdding(false);
    }
  }, [store, onChanged, reboot]);

  /**
   * Write a new system's file where the user chooses, then add exactly those bytes (ADR 0104 decision 2): the same
   * validation as any added file, and the user has the file to edit. A cancelled save adds nothing.
   */
  const createSystem = useCallback(
    async (start: NewSystemStart, name: string): Promise<boolean> => {
      setNewProblem(undefined);
      setNewNote(undefined);
      setAddProblem(undefined);
      // Every id in use, a definition that failed to load included: its stored copy would be replaced too.
      const file = newSystemFile(start, name, [...booted.systems.map((s) => s.id), ...booted.failures.map((f) => f.id)]);
      if (!file.ok) {
        setNewProblem(file.message);
        return false;
      }
      setCreating(true);
      try {
        const bytes = new TextEncoder().encode(file.text);
        const saved = await platform.saver.save(bytes, {
          suggestedName: file.fileName,
          title: 'Save the new system',
          extensions: ['json'],
          label: 'System definition',
        });
        if (!saved) return false;
        const result = await store.add({ name: saved.name, bytes });
        if (!result.ok) {
          setAddProblem({ message: result.message, problems: result.problems });
          return false;
        }
        setNewNote(newSystemSavedNote(file.name, saved.name));
        onChanged(await reboot());
        return true;
      } catch (error) {
        setNewProblem(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        setCreating(false);
      }
    },
    [booted, store, onChanged, reboot],
  );

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

  // The starts a new system may take: the starter, and changes to or a copy of each shipped system (ADR 0104).
  const newChoices = useMemo(() => newSystemChoices(loadShippedSystems().systems), []);

  useEffect(() => {
    void (async () => {
      const profile = await SourceProfile.load(platform.storage);
      const next: Record<string, SystemSummary> = {};
      for (const system of booted.systems) {
        const forSystem = sourcesForSystem(profile.sources, systemLineage(system));
        next[system.id] = {
          sources: forSystem.length,
          enabled: forSystem.filter((s) => s.enabled).length,
          origin: booted.origins[system.id] ?? 'shipped',
          ...(booted.overlays[system.id] ? { overlay: overlayView(system, booted.overlays[system.id]!) } : {}),
          ...(booted.warnings[system.id] ? { warnings: booted.warnings[system.id] } : {}),
          ...(system.copiedFrom !== undefined
            ? { copiedFrom: copiedFromNote(system, (id) => booted.systems.find((known) => known.id === id)?.name) }
            : {}),
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
      newChoices={newChoices}
      onNewSystem={createSystem}
      creating={creating}
      newProblem={newProblem}
      newNote={newNote}
      onDismissNewNote={() => setNewNote(undefined)}
      canSave={platform.saver.available}
      cannotSaveReason={platform.saver.unavailableReason}
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
  initial: LoadedDraft;
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
  // Help > About Incudo: Settings, scrolled to its About section once it is drawn.
  const [showAbout, setShowAbout] = useState(false);
  const aboutShown = useCallback(() => setShowAbout(false), []);
  const [content, setContent] = useState<LoadedContent | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [updates, setUpdates] = useState<Record<string, UpdateStatus>>({});
  /** What the last refresh of each source did, or why it could not (ADR 0050). */
  const [refreshes, setRefreshes] = useState<Record<string, RefreshReport | { failed: string }>>({});
  /** What the last files added as sources did, one line each (ADR 0056). Cleared by the user. */
  const [fileResults, setFileResults] = useState<ContentFileResult[] | null>(null);
  const [sources, setSources] = useState<readonly ConfiguredSource[]>([]);
  /** Why the last load threw rather than returning, if it did: `loadSources` catches per source, so this is rare. */
  const [loadFailure, setLoadFailure] = useState<string | undefined>(undefined);
  // Until the first load ends there is nothing to offer from, as there is nothing during one: Build and Browse show the
  // load's progress in its place, and a new character's options dialog waits for it (or it would offer only the
  // defaults, named by their ids). A load that threw has ended too, or the panes would wait for ever.
  const contentLoading = busy || (content === null && sources.length > 0 && loadFailure === undefined);
  const loadFailedNote = contentLoadFailedNote(content?.sources ?? [], content?.elementCount ?? 0, loadFailure);
  const profile = useRef<SourceProfile | null>(null);

  /**
   * The character being edited, and where it came from in the library (if anywhere). What each
   * field is for is on `WorkingCharacter` (`packages/ui`), since all of it but the character is
   * kept beside the draft too (ADR 0066).
   */
  const [working, setWorking] = useState<WorkingCharacter>(() => {
    const { setAside: _setAside, ...held } = initial;
    return held;
  });
  const [saveNote, setSaveNote] = useState<string | null>(null);
  /** The file the last Save wrote, said on the bar only while nothing has changed since (ADR 0120). */
  const [savedTo, setSavedTo] = useState<string | null>(null);
  /** What would replace unsaved changes, waiting on the user's answer (ADR 0120). */
  const [replacing, setReplacing] = useState<{ replacement: Replacement; run: () => void } | null>(null);
  /**
   * Why a character could not be opened: the draft set aside at boot, or a library file, because this system does not
   * declare its kind. Said on the library, where the user is left, and cleared by the user.
   */
  const [libraryNotice, setLibraryNotice] = useState<string | undefined>(initial.setAside);
  /** A save in flight. A second one would race the first on `working.readAt`. */
  const [saving, setSaving] = useState(false);
  /** A copy being written: a dialog is open, or bytes are going to disk. */
  const [copying, setCopying] = useState(false);
  /**
   * A sheet being exported as text, and what the Sheet's bar says about the last one (ADR 0075), with the character it is
   * about: it is said only while that character is on screen, so opening or starting another does not carry it over.
   */
  const [exporting, setExporting] = useState(false);
  const [exportNoteFor, setExportNoteFor] = useState<{ characterId: string; text: string } | null>(null);
  /** A save whose character name no longer matches the file it would write to. */
  const [renamePrompt, setRenamePrompt] = useState<{ from: string; to: string } | null>(null);
  // What the next print uses (ADR 0078): the remembered choices, until the print options step records new ones.
  const [printOptions, setPrintOptions] = useState<PrintOptions>(DEFAULT_PRINT_OPTIONS);
  // The step's own choices while it is open; `null` while it is closed.
  const [printDraft, setPrintDraft] = useState<PrintOptions | null>(null);
  // Set by the step's Print: the platform's dialog opens once the Sheet carries the choices and the step has closed.
  const [printRequested, setPrintRequested] = useState(false);
  // Where the step leads (ADR 0079): the print dialog, or a PDF written with no dialog. A PDF's paper is on the page only
  // while it is written, so a later print is the dialog's paper again.
  const [printTarget, setPrintTarget] = useState<PrintTarget>('print');
  // Set by the step's Export: the PDF is written once the Sheet carries the choices and the paper, and the step has closed.
  const [pdfRequested, setPdfRequested] = useState(false);
  // "Fill the official sheet…" (ADR 0079 decision 3): the step, which copy is kept, why a copy or a fill was refused,
  // and whether a copy is being read or a sheet filled. `null` kept while the step is closed or none is kept.
  const [officialOpen, setOfficialOpen] = useState(false);
  const [officialKept, setOfficialKept] = useState<{ name: string } | null>(null);
  const [officialProblem, setOfficialProblem] = useState<string | undefined>(undefined);
  const [officialBusy, setOfficialBusy] = useState(false);
  // A content refresh (ADR 0082): the review open, and the offer set aside for this character's content as it is now.
  const [refreshOpen, setRefreshOpen] = useState(false);
  // The campaign options' dialog (ADR 0123): opened by New character, and by Change… beside the options on Build. It is
  // asked of one character: a New character whose kind asks nothing must not leave it waiting for the next one opened.
  const [startOptionsFor, setStartOptionsFor] = useState<{ ask: StartOptionsAsk; characterId: string } | null>(null);
  const [refreshDismissed, setRefreshDismissed] = useState(false);

  /** The Aurora import: what it is doing, and what it did. Cleared by the user, not a timer. */
  const [importing, setImporting] = useState(false);
  const [importReports, setImportReports] = useState<AuroraImportReport[] | null>(null);

  const library = useMemo(() => new CharacterLibrary(platform.characters), []);
  const libraryState = useLibrary(library);
  // The user's own features, kept beside the characters (ADR 0106). Read again whenever Build opens or the folder
  // changes: another device may have written it.
  const featureLibrary = useMemo(() => new FeatureLibrary(platform.characters, featureLibrarySchema), []);
  useEffect(() => {
    if (pane === 'build') void featureLibrary.load();
  }, [pane, libraryState.location, featureLibrary]);

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

  /** The Browse pane's search, here for the same reason: that pane unmounts when another is shown. */
  const [browseView, setBrowseView] = useState<BrowseView>(NEW_BROWSE_VIEW);

  /**
   * The kinds this system lets you start, default first, and which one New character makes. Kept
   * here rather than in the library pane so the New character command makes the same kind the
   * button beside the chooser would. `Shell` is keyed on the system, so a switch starts it afresh.
   */
  const kinds = useMemo(() => characterKindChoices(system), [system]);
  const [newKind, setNewKind] = useState<string | undefined>(() => kinds[0]?.id);

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
      if (sourcesForSystem(loaded.sources, systemLineage(system)).some((s) => s.enabled)) {
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

  // How this user likes the Build pane (ADR 0115): read once, written on every change, never in a character.
  const [buildPreferences, setBuildPreferences] = useState<BuildPreferences>(DEFAULT_BUILD_PREFERENCES);
  useEffect(() => {
    void readBuildPreferences(platform.storage).then(setBuildPreferences);
  }, []);
  const changeBuildPreferences = useCallback((change: Partial<BuildPreferences>) => {
    setBuildPreferences((before) => {
      const next = { ...before, ...change };
      void writeBuildPreferences(platform.storage, next);
      return next;
    });
  }, []);

  const { builder, state } = useBuilder(
    working.character,
    system,
    elements,
    buildPreferences.showAdvanced,
  );

  const characterId = state.character.id;
  const setExportNote = useCallback((text: string) => setExportNoteFor({ characterId, text }), [characterId]);
  const exportNote = exportNoteFor?.characterId === characterId ? exportNoteFor.text : null;
  const startOptionsAsk = startOptionsFor?.characterId === characterId ? startOptionsFor.ask : null;
  const setStartOptionsAsk = useCallback(
    (ask: StartOptionsAsk | null) => setStartOptionsFor(ask ? { ask, characterId } : null),
    [characterId],
  );

  // Whether a character has been started, and whether it has changes its library file does not (ADR 0120).
  const edit = useMemo(() => editState(working, state.character, system), [working, state.character, system]);

  // What the open character carries against what its sources load now (ADR 0082). Only with both: listing and opening
  // never reach for content, and with no source loaded there is nothing to compare with.
  const changes = useMemo(
    () => (working.embedded && content ? contentChanges(working.embedded, content.elements) : null),
    [working.embedded, content],
  );
  const notice = changes ? refreshNotice(changes) : undefined;
  // "Not now" lasts until the character's content or the sources change.
  useEffect(() => setRefreshDismissed(false), [working.embedded, content]);
  // What the Sheet shows, as one value: the pane draws it and the text export writes it (ADR 0075).
  const document = useMemo(() => sheetDocument(state), [state]);

  // The draft, not the library. ADR 0027: a builder that wrote a zip into the user's folder on
  // every keystroke would be slow and a poor neighbour to a folder under version control, so
  // the library is explicit-save and this is the autosave that stops work being lost.
  useEffect(() => {
    void saveCharacter(state.character, (key, value) => platform.storage.write(key, value));
  }, [state.character]);

  // The rest of the draft: the file the character came from and the content it brought (ADR 0066).
  // Only when `working` changes, which is an open, a new character or a save, never a keystroke:
  // without it a reload with no source enabled showed the character without its embedded content,
  // and the next Save wrote a second file that embedded none of it.
  useEffect(() => {
    const { character, ...origin } = working;
    void writeDraftOrigin(platform.storage, character.id, origin);
  }, [working]);

  const persist = useCallback(async (): Promise<void> => {
    const current = profile.current;
    if (!current) return;
    await current.save();
    setSources([...current.sources]);
    library.setProfile(current.sources);
  }, [library]);

  // Two quick switches start two reloads, and the earlier is often the slower: only a reload whose sources are still the
  // ones switched on when it ends publishes, and only it, or the last one running, says the pane is idle.
  const sourceLoads = useRef(new SourceLoads()).current;

  const reload = useCallback(async (): Promise<void> => {
    const current = profile.current;
    if (!current) return;
    // Only this system's, and only the enabled ones. Loading everything would put a Cairn
    // index into a D&D character's candidate lists — and, worse, into the content a save
    // embeds, where it would be frozen forever (ADR 0012).
    const enabledNow = () => sourcesForSystem(current.sources, systemLineage(system)).filter((s) => s.enabled);
    const ofSystem = sourcesForSystem(current.sources, systemLineage(system));
    const forSystem = enabledNow();
    const key = sourcesLoadKey(forSystem);
    const isCurrent = () => sourcesLoadKey(enabledNow()) === key;
    const end = sourceLoads.begin(system.id);
    setBusy(true);
    setProgress(null);
    let loaded: LoadedContent | undefined;
    let published = false;
    let thrown: string | undefined;
    try {
      // The ones switched off are not loaded; what each declared at its last load names it on a line that misses it.
      loaded = await loadSources(forSystem, contentPlatform, (progress) => isCurrent() && setProgress(progress), {
        switchedOff: ofSystem.filter((s) => !s.enabled),
      });
    } catch (error) {
      // Kept for Build and Browse, and still thrown: whoever asked for the load says it too.
      thrown = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      if (isCurrent()) setLoadFailure(thrown);
      const { publish, idle } = end(isCurrent());
      if (publish && loaded) {
        published = true;
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
      }
      if (idle) {
        setBusy(false);
        setProgress(null);
      }
    }
    if (published) await persist();
  }, [persist]);

  // The startup effect runs once, before `reload` has been declared; a ref is how it reaches
  // the current one without listing it as a dependency and re-running on every render.
  const reloadRef = useRef<typeof reload | null>(null);
  reloadRef.current = reload;

  const actions: SourcesActions = useMemo(
    () => ({
      add: async (url, options = {}) => {
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
        // Written as `download`: the setting is retired and does nothing either way (ADR 0100), but profiles and saves
        // carry it.
        current.add(url, { mode: 'download', systemId: system.id, ...options });
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
        // working forever, which is the trade ADR 0012 bought. A file source's copy goes with it (ADR 0056).
        const current = profile.current;
        if (!current) return;
        await removeSource(current, contentPlatform, id);
        await persist();
        await reload();
      },
      readParts: async (url) => {
        // From the source's file, converting it first when it has none: the parts are its conversion's (ADR 0055, 0119).
        const configured = profile.current?.find(url) ?? {
          id: url,
          url,
          name: url,
          enabled: false,
          mode: 'download' as const,
          addedAt: '',
        };
        return sourceParts(configured, contentPlatform);
      },
      setExcluded: async (id, excluded) => {
        profile.current?.update(id, { excluded: excluded.length ? excluded : undefined });
        await persist();
        await reload();
      },
      addFiles: async (files) => {
        const current = profile.current;
        if (!current || !files.length) return;
        setBusy(true);
        let results: ContentFileResult[];
        try {
          // Tagged with the system in view, as a URL is (ADR 0031), and added last, so its definitions are used (ADR 0054).
          results = await addContentFiles(files, current, contentPlatform, { systemId: system.id, nameOfSystem });
        } finally {
          setBusy(false);
        }
        setFileResults(results);
        if (results.some((result) => result.added)) {
          await persist();
          await reload();
        }
      },
      // ADR 0108: a homebrew source is made empty under the system in view, added last, and loaded at once.
      createHomebrew: async (name) => {
        const current = profile.current;
        if (!current) return;
        await createHomebrewSource(current, platform.storage, { name, systemId: system.id });
        await persist();
        await reload();
      },
      homebrew: {
        read: (id) => readHomebrew(platform.storage, id),
        // Written, then reloaded, so what was written is offered and found in Browse at once.
        save: async (id, bundle) => {
          await writeHomebrew(platform.storage, id, bundle);
          await reload();
        },
      },
      pickFiles: async () => {
        const picked = await platform.files.pick({
          title: 'Add Aurora content files',
          extensions: ['xml'],
          label: 'Aurora content file',
          multiple: true,
        });
        // Cancelling is an answer, and leaves the last report where it was.
        if (picked.length) await actionsRef.current?.addFiles(picked);
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
      showFile: async (id) => {
        const source = profile.current?.find(id);
        return source ? revealSourceFile(source, contentPlatform) : false;
      },
      move: async (id, direction) => {
        // ADR 0054: the order is which source is used when two define the same id, the later one. Moved among this
        // system's sources only, and reloaded only when the order of the enabled ones changed, which is all a load reads.
        const current = profile.current;
        if (!current) return;
        const loadOrder = (): string =>
          sourcesForSystem(current.sources, systemLineage(system))
            .filter((s) => s.enabled)
            .map((s) => s.id)
            .join('\n');
        const before = loadOrder();
        if (!current.move(id, direction, (s) => s.systemId !== undefined && systemLineage(system).includes(s.systemId))) return;
        await persist();
        if (loadOrder() !== before) await reload();
      },
      checkForUpdates: async (id) => {
        const source = profile.current?.find(id);
        if (!source) return;
        // Busy while it runs: under Tauri it asks every cached file (ADR 0050), which takes seconds.
        setBusy(true);
        try {
          const status = await checkSourceForUpdates(source, contentPlatform);
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
          const report = await refreshSource(source, contentPlatform);
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
  // `pickFiles` hands its files to `addFiles`, and a drop listener set up once reaches the current actions the same way.
  const actionsRef = useRef<SourcesActions | null>(null);
  actionsRef.current = actions;

  // A file dropped on the window while the Sources pane is shown is added as a source (ADR 0056); anywhere else it is
  // ignored, rather than added somewhere the user was not looking.
  const [dropHover, setDropHover] = useState(false);
  useEffect(() => {
    if (pane !== 'sources' || !platform.drops.available) return;
    const stop = platform.drops.listen((dropped) => {
      if (dropped instanceof Error) {
        setFileResults([{ name: 'the dropped file', failed: dropped.message }]);
        return;
      }
      void actionsRef.current?.addFiles(dropped);
    }, setDropHover);
    return () => {
      stop();
      setDropHover(false);
    };
  }, [pane]);

  /** The profile, split the way ADR 0031 splits it: mine, nobody's, and everyone else's. */
  // An overlay loads its parent's sources as well as its own (ADR 0102): they are this system's to show, not another's.
  const mySources = useMemo(() => sourcesForSystem(sources, systemLineage(system)), [sources, system]);
  const untagged = useMemo(() => unassignedSources(sources), [sources]);
  const otherSources = useMemo(
    () => sources.filter((s) => s.systemId !== undefined && !systemLineage(system).includes(s.systemId)),
    [sources, system],
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
          'Importing needs a content source loaded: an Aurora save names what the character took, ' +
          'and only content says what each of those is. Add one under Sources. (Opening a character you have ' +
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

  /**
   * Run `run` now, or ask first when it would replace unsaved changes (ADR 0120). The draft (ADR 0066) keeps only the
   * character on screen, so what replaces it is gone from there too: nothing but the library file is left.
   */
  const unlessUnsaved = useCallback(
    (replacement: Replacement, run: () => void): void => {
      if (edit.unsaved) setReplacing({ replacement, run });
      else run();
    },
    [edit.unsaved],
  );

  const readFromLibrary = useCallback(
    async (entry: LibraryEntry) => {
      const opened = await library.open(entry.name);
      if (!opened) return;
      // A kind this system does not declare, or a file that does not derive, would throw in the builder and blank the window.
      const missing = characterOpenProblem(system, opened.character, opened.elements, schemas);
      setLibraryNotice(missing);
      if (missing) return;
      setWorking({
        character: opened.character,
        embedded: opened.elements,
        assets: opened.assets,
        entry: { name: entry.name, form: entry.form },
        readAt: entry.updatedAt,
        savedName: opened.character.name,
        baseline: opened.character,
      });
      setSavedTo(null);
      setSaveNote(
        opened.problems.length
          ? `Opened with ${opened.problems.length} problem(s): ${opened.problems
              .map((problem) => `${problem.path ?? ''} ${problem.message}`.trim())
              .join(' · ')}`
          : null,
      );
      setPane('build');
    },
    [library, system],
  );

  /**
   * Open on a library card. The character on screen with unsaved changes is shown, not read again: reading it put the
   * file over the edits without a word, under a bar still saying "Saved to …" (ADR 0120). Another character asks first.
   */
  const openFromLibrary = useCallback(
    (entry: LibraryEntry) => {
      const outcome = openOutcome(working, edit, entry);
      if (outcome === 'show') setPane('build');
      else if (outcome === 'ask') setReplacing({ replacement: { kind: 'open', name: entry.title }, run: () => void readFromLibrary(entry) });
      else void readFromLibrary(entry);
    },
    [working, edit, readFromLibrary],
  );

  const startNew = useCallback(() => {
    unlessUnsaved({ kind: 'new' }, () => {
      const character = newCharacter(system, newKind);
      setWorking({ character, baseline: character });
      setSaveNote(null);
      setSavedTo(null);
      setPane('build');
      // What shapes every other offer is asked first (ADR 0123); a kind that asks nothing opens no dialog.
      setStartOptionsFor({ ask: 'new', characterId: character.id });
    });
  }, [system, newKind, unlessUnsaved]);

  const changeSystem = useCallback(() => unlessUnsaved({ kind: 'system' }, onChangeSystem), [unlessUnsaved, onChangeSystem]);

  /**
   * Write the character to `entry`, or — with `entry` left `undefined` — to a freshly chosen
   * filename derived from the character's *current* name: a first save, or a rename the user
   * just confirmed. Either way `working` ends up pointing at whichever file now holds it.
   */
  const performSave = useCallback(
    async (entry: LibraryEntryRef | undefined): Promise<boolean> => {
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
        setSavedTo(null);
        setSaveNote(result.message);
        return false;
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
        baseline: state.character,
      }));
      setSaveNote(null);
      setSavedTo(result.entry.name);
      return true;
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
   * Write the sheet on screen as text to a file the user picks. Like a copy it changes nothing: the document is what the
   * Sheet pane is drawing, and nothing here touches `working`.
   */
  const exportToFile = useCallback(async (): Promise<void> => {
    setExporting(true);
    try {
      const result = await exportSheet(platform.saver, document);
      if (result.status === 'saved') setExportNote(`Exported the sheet as ${result.file.name}.`);
      else if (result.status === 'failed') setExportNote(`Could not export the sheet. ${result.message}`);
      // Cancelled: an answer. The note that was on screen stays.
    } finally {
      setExporting(false);
    }
  }, [document, setExportNote]);

  /**
   * "Print sheet…" opens the print options step (ADR 0078), with the remembered choices read afresh; its Print then opens
   * the platform's own dialog. Nothing here decides what the step offers: `printOptionsView` does.
   */
  const openPrintStep = useCallback((target: PrintTarget): void => {
    // A first PDF's paper is the one the user's languages suggest; after that, the one last chosen (ADR 0079).
    const defaults = { ...DEFAULT_PRINT_OPTIONS, paper: paperForLocales(navigator.languages ?? [navigator.language]) };
    void readPrintOptions(platform.storage, defaults).then((remembered) => {
      setPrintTarget(target);
      setPrintOptions(remembered);
      setPrintDraft(remembered);
    });
  }, []);
  const printSheet = useCallback((): void => openPrintStep('print'), [openPrintStep]);
  /** "Export sheet as PDF…": the same step, with a paper, leading to a PDF written with no dialog (ADR 0079). */
  const exportPdfStep = useCallback((): void => openPrintStep('pdf'), [openPrintStep]);

  /** The step's two answers. Print records the choices and prints; Cancel records nothing and prints nothing. */
  const finishPrint = useCallback(
    async (answer: 'print' | 'cancel'): Promise<void> => {
      if (printDraft === null) return;
      const next = await finishPrintStep(platform.storage, answer, printDraft, printOptions);
      setPrintOptions(next);
      setPrintDraft(null);
      if (answer === 'cancel') setPrintTarget('print');
      else if (printTarget === 'pdf') setPdfRequested(true);
      else setPrintRequested(true);
    },
    [printDraft, printOptions, printTarget],
  );

  // The platform's dialog, after the render that closed the step and put the choices on the Sheet: the step's own close
  // runs in a child's effect, before this one. `window.print()` in both builds (ADR 0077): Tauri documents it for every
  // platform, and wry's own `print()` on Windows is this call.
  useEffect(() => {
    if (!printRequested) return;
    setPrintRequested(false);
    window.print();
  }, [printRequested]);

  // The PDF, after the render that closed the step and put the choices and the paper on the Sheet, as the print dialog
  // waits for (ADR 0079). Written first, then saved where the user says; the paper's rule comes off the page afterwards.
  useEffect(() => {
    if (!pdfRequested) return;
    setPdfRequested(false);
    setExporting(true);
    void exportSheetPdf(platform.pdf, platform.saver, document, PAPERS[printOptions.paper].size)
      .then((result) => {
        if (result.status === 'saved') setExportNote(`Exported the sheet as ${result.file.name}.`);
        else if (result.status === 'failed') setExportNote(`Could not export the sheet as PDF. ${result.message}`);
        // Cancelled: an answer. The note that was on screen stays.
      })
      .finally(() => {
        setExporting(false);
        setPrintTarget('print');
      });
  }, [pdfRequested, document, printOptions.paper, setExportNote]);

  // The form this character's kind fills, if its system ships one (ADR 0079 decision 5): the 5e player character's.
  const formMap = useMemo(
    () => SHIPPED_FORMS.find((map) => systemLineage(system).includes(map.system) && map.kinds.includes(state.character.kind)),
    [system, state.character.kind],
  );

  const openOfficialSheet = useCallback((): void => {
    if (!formMap) return;
    setOfficialProblem(undefined);
    void readFormCopy(platform.storage, formMap.id).then((kept) => {
      setOfficialKept(kept ? { name: kept.name } : null);
      setOfficialOpen(true);
    });
  }, [formMap]);

  /** The user's copy, chosen in the platform's picker, kept only once it is recognised as the form by its fields. */
  const chooseOfficialCopy = useCallback(async (): Promise<void> => {
    if (!formMap) return;
    if (!platform.files.available) {
      setOfficialProblem(platform.files.unavailableReason ?? 'This platform cannot open a file.');
      return;
    }
    setOfficialBusy(true);
    try {
      const [picked] = await platform.files.pick({ title: 'Choose your copy of the official sheet', extensions: ['pdf'], label: 'PDF', multiple: false });
      if (!picked) return;
      const { readFormFields } = await import('./official-form.ts');
      const recognised = recogniseForm(await readFormFields(picked.bytes), formMap);
      if (!recognised.ok) {
        setOfficialProblem(recognised.reason);
        return;
      }
      await keepFormCopy(platform.storage, formMap.id, { name: picked.name, bytes: picked.bytes });
      setOfficialKept({ name: picked.name });
      setOfficialProblem(undefined);
    } catch (error) {
      setOfficialProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setOfficialBusy(false);
    }
  }, [formMap]);

  const removeOfficialCopy = useCallback(async (): Promise<void> => {
    if (!formMap) return;
    await removeFormCopy(platform.storage, formMap.id);
    setOfficialKept(null);
    setOfficialProblem(undefined);
  }, [formMap]);

  /**
   * Fill a copy of the kept form from the sheet on screen and save it where the user says. The kept copy is recognised
   * again first, as a user's system is revalidated on every load: what was kept is not trusted for ever.
   */
  const fillOfficialSheet = useCallback(async (): Promise<void> => {
    if (!formMap) return;
    setOfficialBusy(true);
    setExporting(true);
    try {
      const kept = await readFormCopy(platform.storage, formMap.id);
      if (!kept) {
        setOfficialKept(null);
        setOfficialProblem("Incudo's copy of the sheet is gone. Choose your copy again.");
        return;
      }
      const { fillForm, readFormFields } = await import('./official-form.ts');
      const recognised = recogniseForm(await readFormFields(kept.bytes), formMap);
      if (!recognised.ok) {
        setOfficialProblem(recognised.reason);
        return;
      }
      const values = formValues(document, formMap);
      const bytes = await fillForm(kept.bytes, values);
      const file = await platform.saver.save(bytes, {
        suggestedName: officialSheetFileName(document.name),
        title: 'Save the filled official sheet',
        extensions: ['pdf'],
        label: 'PDF',
      });
      if (!file) return;
      setExportNote(officialSheetResult(file.name, values));
      setOfficialOpen(false);
    } catch (error) {
      setOfficialProblem(`Could not fill the sheet. ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setOfficialBusy(false);
      setExporting(false);
    }
  }, [formMap, document, setExportNote]);

  const officialView = useMemo(
    () => (officialOpen && formMap ? officialSheetView(formMap, officialKept, officialProblem) : null),
    [officialOpen, formMap, officialKept, officialProblem],
  );

  // The review: the Sheet built twice, asked only while it is open (ADR 0082 decision 2).
  const review = useMemo(() => {
    if (!refreshOpen || !changes || !working.embedded || !content) return null;
    const { before, after } = refreshDocuments(state.character, system, working.embedded, content.elements);
    return refreshReview(before, after, changes);
  }, [refreshOpen, changes, working.embedded, content, state.character, system]);

  /**
   * Take up the sources' definitions (ADR 0082 decision 3): every copy they define replaced, every other kept, the
   * character's recorded sources brought up to the profile and nothing else of it touched. Handed over as `working`, as an
   * open is, so the draft keeps it (ADR 0066); the file changes on Save.
   */
  const applyRefresh = useCallback((): void => {
    if (!working.embedded || !content) return;
    const character = state.character.sources
      ? { ...state.character, sources: refreshSourceRefs(state.character.sources, mySources) }
      : state.character;
    setWorking({ ...working, character, embedded: new BundleElementIndex(refreshedElements(working.embedded, content.elements)) });
    setRefreshOpen(false);
    setSaveNote('Refreshed against your sources. Save to keep it in the file.');
  }, [working, content, state.character, mySources]);

  const printView = useMemo(
    () => (printDraft === null ? null : printOptionsView(document, printDraft, printTarget)),
    [document, printDraft, printTarget],
  );
  const printing = useMemo(() => printRendering(printOptions, document, printTarget), [printOptions, document, printTarget]);

  // While the Sheet prints, the page is titled with the character, so a print dialog's header and the name "Save as PDF"
  // suggests read the character rather than the app (ADR 0077 decision 3). Put back afterwards. `window.document`, since
  // `document` here is the sheet's.
  const printTitle = document.title;
  useEffect(() => {
    if (pane !== 'sheet') return;
    let before: string | undefined;
    const onBefore = (): void => {
      before = window.document.title;
      window.document.title = printTitle;
    };
    const onAfter = (): void => {
      if (before !== undefined) window.document.title = before;
      before = undefined;
    };
    window.addEventListener('beforeprint', onBefore);
    window.addEventListener('afterprint', onAfter);
    return () => {
      onAfter();
      window.removeEventListener('beforeprint', onBefore);
      window.removeEventListener('afterprint', onAfter);
    };
  }, [pane, printTitle]);

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

  /**
   * Save first only where a Save would not ask about the file's name: that question is the rename prompt's, and a
   * character renamed since its last Save is saved from the bar, where it is asked.
   */
  const canSaveFirst =
    libraryState.status === 'ready' && !(working.entry && working.savedName !== undefined && working.savedName !== state.character.name);
  const prompt: ReplacePrompt | null = replacing ? replacePrompt(replacing.replacement, state.character.name, canSaveFirst) : null;

  /** The question's three answers: save then carry on, carry on and lose the changes, or carry on editing. */
  const resolveReplace = useCallback(
    async (answer: 'save' | 'discard' | 'keep') => {
      const pending = replacing;
      setReplacing(null);
      if (!pending || answer === 'keep') return;
      // A Save that fails says why on the bar and leaves the character on screen.
      if (answer === 'save' && !(await performSave(working.entry))) {
        setPane('build');
        return;
      }
      pending.run();
    },
    [replacing, performSave, working.entry],
  );

  // The menu, the shortcuts and the nav below are one list (ADR 0037). "Modal" is whatever
  // dialog is open: nothing behind it should react to a shortcut.
  // A load that ended with sources switched on and nothing loaded: Build and Browse say so rather than offering from
  // nothing (a new character's options would read as ids). A character carrying its own content still builds from it.
  const loadLeftNothing =
    !contentLoading && mySources.some((source) => source.enabled) && !contentLoaded && working.embedded === undefined;

  const modal =
    renamePrompt !== null ||
    replacing !== null ||
    printDraft !== null ||
    officialOpen ||
    refreshOpen ||
    (startOptionsAsk !== null && pane === 'build' && state.startOptions.length > 0 && !contentLoading && !loadLeftNothing) ||
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
    exporting,
    pdfAvailable: platform.pdf.available,
    formAvailable: formMap !== undefined,
    contentUpdates: notice !== undefined,
    started: edit.started,
  });

  const handlers: CommandHandlers = {
    'new-character': startNew,
    // Through the tabs this character has (ADR 0124): Spells only when it has spells.
    'switch-build-tab': () => {
      const tabs = buildTabs(state);
      changeBuildPreferences({ tab: nextBuildTab(shownTab(buildPreferences.tab, tabs), tabs) });
    },
    'save-character': () => void saveToLibrary(),
    'save-copy': () => void copyToFile(),
    'export-sheet': () => void exportToFile(),
    'print-sheet': printSheet,
    'export-sheet-pdf': exportPdfStep,
    'fill-official-sheet': openOfficialSheet,
    'review-content-updates': () => setRefreshOpen(true),
    'import-aurora': () => void importFromAurora(),
    'choose-library-folder': () => void chooseFolder(),
    'refresh-library': () => void library.refresh(),
    'reload-sources': () => void reload(),
    'change-system': changeSystem,
    'about': () => {
      setPane('settings');
      setShowAbout(true);
    },
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
                {id === 'build' && edit.started && state.decisions.length > 0 && (
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
          <button type="button" className="system-switch" onClick={changeSystem} title="Change system">
            {system.name}
          </button>
          {' · '}
          {content
            ? `${content.sources.length} ${content.sources.length === 1 ? 'source' : 'sources'} loaded`
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
          onChangeSystem={changeSystem}
          shell={platform.shell}
          onChooseFolder={() => void chooseFolder()}
          onRefresh={() => void library.refresh()}
          onOpen={openFromLibrary}
          onNew={startNew}
          kinds={kinds}
          newKind={newKind}
          onNewKind={setNewKind}
          describeKind={(entry) => describeKindAndProgress(system, entry.kind, libraryEntryProgress(system, entry))}
          describeReferences={(entry) => libraryEntryReferences(system, entry)}
          onRemove={(entry) => void library.remove({ name: entry.name, form: entry.form })}
          onOpenSettings={() => setPane('settings')}
          onImport={() => void importFromAurora()}
          onDismissImport={() => setImportReports(null)}
          importing={importing}
          importBlockedBecause={importBlockedBecause}
          importReports={importReports}
          askForFolder={libraryState.status === 'no-location' && !askDismissed}
          onDismissAsk={() => setAskDismissed(true)}
          notice={libraryNotice}
          onDismissNotice={() => setLibraryNotice(undefined)}
        />
      )}
      {(pane === 'build' || pane === 'sheet') && !edit.started && (
        <NothingStarted
          onNew={startNew}
          canStart={isEnabled(resolved, 'new-character')}
          onCharacters={() => setPane('library')}
        />
      )}
      {pane === 'build' && edit.started && (contentLoading || loadLeftNothing) && (
        <ContentLoading
          pane="build"
          progress={progress}
          startOptionsWaiting={startOptionsAsk === 'new'}
          {...(loadLeftNothing ? { failed: { note: loadFailedNote } } : {})}
          onOpenSources={() => setPane('sources')}
        />
      )}
      {pane === 'build' && edit.started && !contentLoading && !loadLeftNothing && (
        <>
          <div className="pane-bar">
            <span className="status">
              {working.entry ? (
                <>
                  Editing <code>{working.entry.name}</code>
                  {edit.unsaved && <strong className="unsaved"> · {UNSAVED_CHANGES}</strong>}
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
            {savedTo && !edit.unsaved && <span className="status">Saved to {savedTo}.</span>}
            {saveNote && <span className="status">{saveNote}</span>}
          </div>
          {notice && !refreshDismissed && (
            <RefreshLine notice={notice} onReview={() => setRefreshOpen(true)} onDismiss={() => setRefreshDismissed(true)} />
          )}
          <BuilderPane
            builder={builder}
            state={state}
            featureLibrary={featureLibrary}
            elements={elements}
            hasContent={contentLoaded || working.embedded !== undefined}
            loadFailure={loadFailedNote}
            preferences={buildPreferences}
            onPreferences={changeBuildPreferences}
            startOptions={startOptionsAsk}
            onStartOptions={setStartOptionsAsk}
          />
        </>
      )}
      {pane === 'sheet' && edit.started && (
        <>
          <div className="pane-bar">
            <span className="status">
              {platform.pdf.available
                ? 'Print this page, or write it to a PDF or a Markdown (.md) text file.'
                : 'Print this page, or write it to a Markdown (.md) text file.'}
            </span>
            <button type="button" onClick={printSheet} title={describeCommand('print-sheet', commands.os)}>
              Print sheet…
            </button>
            <button
              type="button"
              onClick={() => void exportToFile()}
              disabled={!platform.saver.available || exporting}
              title={
                platform.saver.available
                  ? describeCommand('export-sheet', commands.os)
                  : platform.saver.unavailableReason
              }
            >
              Export sheet as text…
            </button>
            {platform.pdf.available && (
              <button
                type="button"
                onClick={exportPdfStep}
                disabled={!platform.saver.available || exporting}
                title={describeCommand('export-sheet-pdf', commands.os)}
              >
                Export sheet as PDF…
              </button>
            )}
            {formMap && (
              <button
                type="button"
                onClick={openOfficialSheet}
                disabled={!platform.saver.available || exporting}
                title={describeCommand('fill-official-sheet', commands.os)}
              >
                Fill the official sheet…
              </button>
            )}
            {exportNote && <span className="status">{exportNote}</span>}
          </div>
          {notice && !refreshDismissed && (
            <RefreshLine notice={notice} onReview={() => setRefreshOpen(true)} onDismiss={() => setRefreshDismissed(true)} />
          )}
          <SheetPane builder={builder} document={document} print={printing} {...(state.play ? { play: state.play } : {})} />
        </>
      )}
      {pane === 'browse' && (contentLoading || loadLeftNothing) && (
        <ContentLoading
          pane="browse"
          progress={progress}
          {...(loadLeftNothing ? { failed: { note: loadFailedNote } } : {})}
          onOpenSources={() => setPane('sources')}
        />
      )}
      {pane === 'browse' && !contentLoading && !loadLeftNothing && (
        // What the sources loaded and nothing else: not `elements`, which puts an open save's own
        // content in front, and not the character's offered view. ADR 0053, decision 1.
        <BrowsePane
          elements={content?.elements ?? null}
          system={system}
          sources={mySources}
          failure={loadFailedNote}
          view={browseView}
          onView={setBrowseView}
          onOpenSources={() => setPane('sources')}
        />
      )}
      {pane === 'settings' && (
        <SettingsPane
          location={libraryState.location}
          unavailableReason={
            libraryState.status === 'unavailable' ? libraryState.unavailableReason : undefined
          }
          entryCount={libraryState.entries.length}
          onChooseFolder={() => void chooseFolder()}
          shell={platform.shell}
          version={__INCUDO_VERSION__}
          attributions={systemAttributions(loadShippedSystems().systems)}
          showAbout={showAbout}
          onAboutShown={aboutShown}
          onOpenLink={(url) =>
            void platform.links.open(url).catch((error: unknown) => console.error('The link could not be opened.', url, error))
          }
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
          filesAvailable={platform.files.available}
          filesUnavailableReason={platform.files.unavailableReason}
          dropHover={dropHover}
          fileResults={fileResults}
          onDismissFileResults={() => setFileResults(null)}
        />
      )}
      <RefreshDialog review={review} onRefresh={applyRefresh} onClose={() => setRefreshOpen(false)} />
      <OfficialSheetDialog
        view={officialView}
        busy={officialBusy}
        onChoose={() => void chooseOfficialCopy()}
        onRemove={() => void removeOfficialCopy()}
        onFill={() => void fillOfficialSheet()}
        onClose={() => setOfficialOpen(false)}
      />
      <PrintOptionsDialog
        view={printView}
        onPart={(part, chosen) => setPrintDraft((draft) => draft && withPrintPart(draft, document, part, chosen))}
        onPageNumbers={(chosen) => setPrintDraft((draft) => draft && withPageNumbers(draft, chosen))}
        onRunningName={(chosen) => setPrintDraft((draft) => draft && withRunningName(draft, chosen))}
        onPaper={(paper) => setPrintDraft((draft) => draft && withPaper(draft, paper))}
        onPrint={() => void finishPrint('print')}
        onCancel={() => void finishPrint('cancel')}
      />
      <ReplaceDialog
        prompt={prompt}
        onSave={() => void resolveReplace('save')}
        onDiscard={() => void resolveReplace('discard')}
        onKeep={() => void resolveReplace('keep')}
      />
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
 * Build and the Sheet before any character is started (ADR 0120). The app has a blank character only because the builder
 * needs one; its open decisions were counted on the Build tab before the user had chosen to build anything.
 */
function NothingStarted({
  onNew,
  canStart,
  onCharacters,
}: {
  onNew: () => void;
  canStart: boolean;
  onCharacters: () => void;
}): React.JSX.Element {
  return (
    <main className="pane">
      <h2>{NOTHING_STARTED.title}</h2>
      <p className="lede">{NOTHING_STARTED.text}</p>
      <div className="row">
        {canStart && (
          <button type="button" className="on" onClick={onNew}>
            New character
          </button>
        )}
        <button type="button" onClick={onCharacters}>
          Go to Characters
        </button>
      </div>
    </main>
  );
}

/**
 * "Save your changes first?", asked before a new character, another one opened or a change of system replaces unsaved
 * changes (ADR 0120). Escape keeps editing, the answer that loses nothing.
 */
function ReplaceDialog({
  prompt,
  onSave,
  onDiscard,
  onKeep,
}: {
  prompt: ReplacePrompt | null;
  onSave: () => void;
  onDiscard: () => void;
  onKeep: () => void;
}): React.JSX.Element | null {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (prompt && !dialog.open) dialog.showModal();
    if (!prompt && dialog.open) dialog.close();
  }, [prompt]);

  return (
    <dialog ref={ref} className="ask" onCancel={onKeep}>
      {prompt && (
        <>
          <h2>{prompt.title}</h2>
          <p className="lede">{prompt.lede}</p>
          <div className="row">
            {prompt.save && (
              <button type="button" className="on" onClick={onSave}>
                {prompt.save}
              </button>
            )}
            <button type="button" onClick={onDiscard}>
              {prompt.discard}
            </button>
            <button type="button" onClick={onKeep} autoFocus={!prompt.save}>
              {prompt.keep}
            </button>
          </div>
        </>
      )}
    </dialog>
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

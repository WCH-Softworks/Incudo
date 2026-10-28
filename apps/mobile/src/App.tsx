/**
 * The phone app: a library, a sheet, playing it, building one, and importing an Aurora save — ROADMAP Phase 6, ADRs
 * 0083, 0084, 0086 and 0101.
 *
 * Screens on a native stack (React Navigation), so Android's back gesture and button do what a user expects. What a
 * screen shows comes from `packages/ui`: `CharacterLibrary` lists and adds characters, `CharacterBuilder` and
 * `sheetDocument` make the sheet, the builder's `play` is what playing it keeps track of, and `ContentSources` is the
 * content a build loads. Nothing here derives anything, and opening a character reaches for no content source (ADR
 * 0012): the file carries what it needs; only the Build screen asks for content. A play edit is written back to the
 * library file at once (`CharacterLibrary.record`), as a pencil mark on a paper sheet is; a build edit is saved with Save.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer, createNavigationContainerRef, useFocusEffect } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { strToU8 } from 'fflate';
import { useColorScheme } from 'react-native';

import { auroraConverter } from '@incudo/aurora-import';
import { sha256Hex, type Character, type FileSaver, type GameSystem } from '@incudo/core';
import {
  CharacterBuilder,
  CharacterLibrary,
  FeatureLibrary,
  ContentSources,
  characterKindChoices,
  characterKindMissing,
  describeKindAndProgress,
  exportEntry,
  importReceivedSaves,
  importedView,
  libraryEntryProgress,
  receiveFiles,
  receivedView,
  saveImportLine,
  saveImportStep,
  sheetDocument,
  sheetMarkdown,
  type LibraryEntry,
  type ReceivedFile,
  type ReceivedView,
  type SaveImportPhase,
  type SheetDocument,
} from '@incudo/ui';

import { featureLibrarySchema, loadShippedSystems } from './boot.ts';
import { BuildScreen } from './BuildScreen.tsx';
import { ContentScreen } from './ContentScreen.tsx';
import { PlatformContext, usePlatform, type Platform, type Screens } from './context.ts';
import { Button } from './controls.tsx';
import {
  MobileCharacterStore,
  MobileConnection,
  MobileFetcher,
  MobileSourceFiles,
  MobileFilePicker,
  MobileFolderSaver,
  MobileShareInbox,
  MobileShareSaver,
  MobileStorage,
} from './platform.ts';
import { PlayPanel } from './PlayPanel.tsx';
import { SheetView } from './SheetView.tsx';
import { usePalette } from './theme.ts';
import { createMobileZipCodec } from './zip.ts';

const Stack = createNativeStackNavigator<Screens>();
const navigationRef = createNavigationContainerRef<Screens>();

/** Show what was received, wherever the user is, with Open and Import as the view offers them (ADRs 0099, 0101). */
const PresentReceived = createContext<(view: ReceivedView) => void>(() => undefined);

export function App() {
  const scheme = useColorScheme();
  const platform = useMemo<Platform>(() => {
    const zip = createMobileZipCodec();
    const systems = loadShippedSystems().systems;
    const store = new MobileCharacterStore(zip);
    const storage = new MobileStorage();
    return {
      library: new CharacterLibrary(store),
      features: new FeatureLibrary(store, featureLibrarySchema),
      picker: new MobileFilePicker(),
      inbox: new MobileShareInbox(),
      connection: new MobileConnection(),
      folderSaver: new MobileFolderSaver(),
      shareSaver: new MobileShareSaver(),
      zip,
      systems,
      sources: new ContentSources({ fetcher: new MobileFetcher(), storage, files: new MobileSourceFiles(), converter: auroraConverter }, systems),
      storage,
    };
  }, []);

  // In development, how long each content load took, to compare with ADRs 0085 and 0086's measurements.
  useEffect(() => {
    if (!__DEV__) return;
    let started: number | undefined;
    return platform.sources.subscribe(() => {
      const state = platform.sources.getState();
      if (state.loading && started === undefined) started = Date.now();
      else if (!state.loading && started !== undefined) {
        const counts = Object.entries(state.loaded).map(([id, loaded]) => `${id} ${loaded.elementCount} elements`).join(', ');
        console.log(`[incudo] content loaded in ${Date.now() - started} ms: ${counts || 'nothing'}${state.message ? `; ${state.message}` : ''}`);
        started = undefined;
      }
    });
  }, [platform]);

  // An Aurora save is imported on a tap (ADR 0101): first whatever the import needs is asked, one question at a time
  // (`saveImportStep`), then its game's content is loaded (the same load a Build screen makes and shares) and it is
  // imported. A line over the screen says what it waits on meanwhile.
  const [importing, setImporting] = useState<{ saves: ReceivedFile[]; phase: SaveImportPhase } | null>(null);
  const importSaves = useCallback(
    async (saves: ReceivedFile[], game?: string): Promise<void> => {
      const { sources, systems, library, connection } = platform;
      await sources.restore();
      const step = saveImportStep(saves, { systems, sources: sources.getState().sources, connection: await connection.current() }, game);
      const toContent = { text: 'Content', onPress: () => navigationRef.isReady() && navigationRef.navigate('Content') };
      switch (step.kind) {
        case 'choose-game':
          Alert.alert(step.title, step.message, [
            { text: 'Cancel', style: 'cancel' },
            ...step.choices.map((choice) => ({ text: choice.label, onPress: () => void importSaves(saves, choice.systemId) })),
          ]);
          return;
        case 'switched-off':
        case 'no-source':
          Alert.alert(step.title, step.message, [{ text: 'Close', style: 'cancel' }, toContent]);
          return;
        case 'needs-source':
          Alert.alert(step.title, step.message, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: step.confirm,
              onPress: () =>
                void (async () => {
                  setImporting({ saves, phase: 'loading' });
                  try {
                    await sources.add(step.systemId, step.suggestion);
                  } catch {
                    // Said in the sources' message; the import then finds no content and says so.
                  }
                  setImporting(null);
                  await importSaves(saves, game);
                })(),
            },
          ]);
          return;
        case 'ready':
          break;
      }
      setImporting({ saves, phase: 'loading' });
      const started = Date.now();
      const outcomes = await importReceivedSaves(
        {
          library,
          systems,
          load: async (systemId) => (await sources.load(systemId)).elements,
          onPhase: (phase) => setImporting({ saves, phase }),
        },
        saves,
        game,
      );
      setImporting(null);
      if (__DEV__) console.log(`[incudo] imported ${saves.length} save(s) in ${Date.now() - started} ms, content load included: ${outcomes.map((outcome) => outcome.message).join(' | ')}`);
      const view = importedView(outcomes);
      const open = view.open;
      // Open is offered beside the notes too: an alert closes when a button is pressed, and the notes are read first.
      const openButton = open ? [{ text: 'Open', onPress: () => navigationRef.isReady() && navigationRef.navigate('Sheet', open) }] : [];
      const showNotes = (): void =>
        Alert.alert('Notes from the import', view.notes.join('\n\n'), [{ text: 'Close', style: 'cancel' }, ...openButton]);
      Alert.alert(view.title, view.lines.join('\n\n'), [
        { text: 'Close', style: 'cancel' },
        ...(view.notes.length ? [{ text: 'Notes', onPress: showNotes }] : []),
        ...openButton,
      ]);
    },
    [platform],
  );

  const presentReceived = useCallback(
    (view: ReceivedView): void => {
      const open = view.open;
      const saves = view.saves;
      Alert.alert(view.title, view.lines.join('\n\n'), [
        { text: 'Close', style: 'cancel' },
        ...(open ? [{ text: 'Open', onPress: () => navigationRef.isReady() && navigationRef.navigate('Sheet', open) }] : []),
        ...(saves ? [{ text: saves.label, onPress: () => void importSaves(saves.files) }] : []),
      ]);
    },
    [importSaves],
  );

  // A file shared to the app or opened with it (ADR 0099), wherever the user is: added as a picked one is and said in an
  // alert, so no screen is replaced under them (an unsaved build stays where it was). Open goes to the one it added.
  useEffect(
    () =>
      platform.inbox.listen((files) => {
        void receiveFiles(platform.library, platform.zip, files).then((outcomes) => {
          if (__DEV__) console.log(`[incudo] received ${files.length} file(s): ${outcomes.map((outcome) => outcome.message).join(' | ')}`);
          presentReceived(receivedView(outcomes));
        });
      }),
    [platform, presentReceived],
  );

  return (
    <SafeAreaProvider>
      <PlatformContext.Provider value={platform}>
        <PresentReceived.Provider value={presentReceived}>
        <NavigationContainer ref={navigationRef} theme={scheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack.Navigator>
            <Stack.Screen name="Library" component={LibraryScreen} options={{ title: 'Characters' }} />
            <Stack.Screen name="Sheet" component={SheetScreen} options={({ route }) => ({ title: route.params.title })} />
            <Stack.Screen name="Build" component={BuildScreen} options={({ route }) => ({ title: route.params.title })} />
            <Stack.Screen name="NewCharacter" component={NewCharacterScreen} options={{ title: 'New character' }} />
            <Stack.Screen name="Content" component={ContentScreen} options={{ title: 'Content' }} />
          </Stack.Navigator>
        </NavigationContainer>
        {importing ? <ImportLine saves={importing.saves} phase={importing.phase} /> : null}
        </PresentReceived.Provider>
        <StatusBar style="auto" />
      </PlatformContext.Provider>
    </SafeAreaProvider>
  );
}

/** The line over the screen while an import runs: its words `saveImportLine`'s, its progress the content load's. */
function ImportLine({ saves, phase }: { saves: ReceivedFile[]; phase: SaveImportPhase }) {
  const { sources } = usePlatform();
  const palette = usePalette();
  const content = useSyncExternalStore(sources.subscribe, sources.getState);
  return (
    <View style={[styles.importLine, { backgroundColor: palette.surface }]} accessibilityLiveRegion="polite">
      <ActivityIndicator color={palette.accent} />
      <Text style={[styles.body, { color: palette.text, flex: 1 }]}>{saveImportLine(saves, phase, content.loading?.progress)}</Text>
    </View>
  );
}

// --- the library ------------------------------------------------------------------------------------------------

function LibraryScreen({ navigation }: NativeStackScreenProps<Screens, 'Library'>) {
  const { library, picker, zip, systems } = usePlatform();
  const presentReceived = useContext(PresentReceived);
  const palette = usePalette();
  const state = useSyncExternalStore(library.subscribe, library.getState);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void library.restore();
  }, [library]);

  useEffect(() => {
    navigation.setOptions({ headerRight: () => <Button label="Content" kind="link" onPress={() => navigation.navigate('Content')} /> });
  }, [navigation]);

  // A character saved from the Build screen comes back listed.
  useFocusEffect(
    useCallback(() => {
      if (library.getState().status === 'ready') void library.refresh();
    }, [library]),
  );

  // A picked file is received as a shared one is (ADR 0099), so the two ways in answer alike; an Aurora save is offered
  // for import in the same alert a share shows (ADR 0101).
  const addFile = async (): Promise<void> => {
    setMessage(null);
    try {
      const picked = await picker.pick({ title: 'Add a character' });
      if (!picked.length) return;
      const view = receivedView(await receiveFiles(library, zip, picked));
      if (view.saves) presentReceived(view);
      else setMessage(view.lines.join('\n'));
    } catch (error) {
      setMessage(`Could not add the file: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.screen}>
      <Pressable
        onPress={() => void addFile()}
        style={({ pressed }) => [styles.button, { backgroundColor: palette.accent, opacity: pressed ? 0.7 : 1 }]}
        accessibilityRole="button"
      >
        <Text style={[styles.buttonText, { color: palette.background }]}>Add a character file…</Text>
      </Pressable>
      <Button label="New character" onPress={() => navigation.navigate('NewCharacter')} />
      {message ? <Text style={[styles.body, { color: palette.muted }]}>{message}</Text> : null}
      {state.busy ? <ActivityIndicator color={palette.accent} /> : null}
      {state.problems.map((problem) => (
        <Text key={problem} style={[styles.body, { color: palette.danger }]}>
          {problem}
        </Text>
      ))}
      {state.status === 'ready' && !state.entries.length ? (
        <Text style={[styles.body, { color: palette.muted }]}>
          No characters on this device yet. Add a .incu file saved from Incudo on a computer, or an Aurora save, from wherever you keep it.
        </Text>
      ) : null}
      {state.entries.map((entry) => (
        <Pressable
          key={entry.name}
          disabled={entry.broken}
          onPress={() => navigation.navigate('Sheet', { name: entry.name, title: entry.title })}
          style={({ pressed }) => [styles.card, { backgroundColor: palette.surface, opacity: pressed ? 0.7 : 1 }]}
          accessibilityRole="button"
        >
          <Text style={[styles.cardTitle, { color: palette.text }]}>{entry.title}</Text>
          <Text style={[styles.body, { color: palette.muted }]}>{cardLine(entry, systems)}</Text>
          {entry.broken ? (
            <Text style={[styles.body, { color: palette.danger }]}>
              This file does not open: {entry.problems.map((problem) => problem.message).join(' ') || 'it is not a character.'}
            </Text>
          ) : null}
        </Pressable>
      ))}
      {state.location ? <Text style={[styles.small, { color: palette.muted }]}>Kept in {state.location}.</Text> : null}
    </ScrollView>
  );
}

// --- a new character ---------------------------------------------------------------------------------------------

/** Every kind of every game the app has, as the desktop's chooser offers them (`characterKindChoices`). */
function NewCharacterScreen({ navigation }: NativeStackScreenProps<Screens, 'NewCharacter'>) {
  const { systems } = usePlatform();
  const palette = usePalette();
  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.screen}>
      {systems.map((system) => (
        <View key={system.id} style={{ gap: 8 }}>
          <Text style={[styles.cardTitle, { color: palette.text }]} accessibilityRole="header">
            {system.name}
          </Text>
          {characterKindChoices(system).map((kind) => (
            <Pressable
              key={kind.id}
              onPress={() => navigation.replace('Build', { systemId: system.id, kindId: kind.id, title: kind.name })}
              style={({ pressed }) => [styles.card, { backgroundColor: palette.surface, opacity: pressed ? 0.7 : 1 }]}
              accessibilityRole="button"
            >
              <Text style={[styles.cardTitle, { color: palette.text }]}>{kind.name}</Text>
              {kind.description ? <Text style={[styles.body, { color: palette.muted }]}>{kind.description}</Text> : null}
            </Pressable>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

/** "Player Character · Level 5", or what the card can say when the character's system is not one this app has. */
function cardLine(entry: LibraryEntry, systems: readonly GameSystem[]): string {
  const system = systems.find((candidate) => candidate.id === entry.systemId);
  if (!system) return entry.systemId ? `For a game this app does not have (${entry.systemId})` : entry.name;
  return describeKindAndProgress(system, entry.kind, libraryEntryProgress(system, entry)) || system.name;
}

// --- the sheet --------------------------------------------------------------------------------------------------

type Opened = { builder: CharacterBuilder; readAt?: string } | { error: string };

function SheetScreen({ route, navigation }: NativeStackScreenProps<Screens, 'Sheet'>) {
  const { library, systems, folderSaver, shareSaver, zip } = usePlatform();
  const palette = usePalette();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const name = route.params.name;

  // The file as it is in the library, unchanged (`exportEntry`): to a folder the user picks, or to the share sheet.
  const chooseExport = useCallback((): void => {
    const send = async (saver: FileSaver, saving: boolean): Promise<void> => {
      setMessage(null);
      const result = await exportEntry(saver, zip, library, name);
      if (result.status === 'failed') setMessage({ text: `Could not export the character: ${result.message}`, failed: true });
      // The share sheet says nothing of what was chosen, so only a save to a folder reports where the file went.
      else if (result.status === 'saved' && saving) setMessage({ text: `Saved as "${result.file.name}".`, failed: false });
    };
    Alert.alert('Export this character', 'Its .incu file, as it is in this app.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Share…', onPress: () => void send(shareSaver, false) },
      { text: 'Save to a folder…', onPress: () => void send(folderSaver, true) },
    ]);
  }, [library, zip, folderSaver, shareSaver, name]);

  const header = useMemo(
    () => ({ chooseExport, edit: () => navigation.navigate('Build', { name, title: route.params.title }) }),
    [chooseExport, navigation, name, route.params.title],
  );

  // Opened each time the screen is shown, so a character saved from the Build screen reads as saved (ADR 0086).
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void (async () => {
        const result = await openSheet(library, systems, name);
        if (live) setOpened(result);
      })();
      return () => {
        live = false;
      };
    }, [library, systems, name]),
  );

  if (!opened) {
    return (
      <View style={[styles.centred, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }
  if ('error' in opened) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background, flex: 1 }]}>
        <Text style={[styles.body, { color: palette.danger }]}>{opened.error}</Text>
      </View>
    );
  }
  return (
    <OpenedSheet
      // A file opened again (after an edit was saved) is a new character for the play writer, expecting its new `updated`.
      key={opened.readAt ?? ''}
      builder={opened.builder}
      readAt={opened.readAt}
      name={name}
      message={message}
      setMessage={setMessage}
      header={header}
      navigation={navigation}
    />
  );
}

/** An opened character: its sheet, and playing it when its kind has anything to play. */
function OpenedSheet({
  builder,
  readAt,
  name,
  message,
  setMessage,
  header,
  navigation,
}: {
  builder: CharacterBuilder;
  readAt?: string;
  name: string;
  message: { text: string; failed: boolean } | null;
  setMessage: (message: { text: string; failed: boolean } | null) => void;
  header: { chooseExport: () => void; edit: () => void };
  navigation: NativeStackScreenProps<Screens, 'Sheet'>['navigation'];
}) {
  const { library } = usePlatform();
  const palette = usePalette();
  const state = useSyncExternalStore(builder.subscribe, builder.getState);
  const [tab, setTab] = useState<'sheet' | 'play'>('sheet');
  // A play edit makes a new state and leaves the sheet's parts as they were, so the document is made again only when
  // one of them moves.
  const { sheet, companions, references, freeform, descriptions } = state;
  const characterName = state.character.name;
  const document = useMemo<SheetDocument>(
    () => sheetDocument({ character: { name: characterName }, sheet, references, freeform, descriptions, ...(companions ? { companions } : {}) }),
    [sheet, companions, references, freeform, descriptions, characterName],
  );
  const settle = useRecorder(library, name, state.character, readAt, (text) => setMessage({ text, failed: true }));

  // Edit waits for any play edit still being written, so the Build screen opens the file as it is (ADR 0086).
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable onPress={() => void settle().then(header.edit)} accessibilityRole="button" hitSlop={12}>
            <Text style={[styles.headerAction, { color: palette.accent }]}>Edit</Text>
          </Pressable>
          <Pressable onPress={header.chooseExport} accessibilityRole="button" hitSlop={12}>
            <Text style={[styles.headerAction, { color: palette.accent }]}>Export</Text>
          </Pressable>
        </View>
      ),
    });
  }, [navigation, settle, header, palette.accent]);

  const play = state.play;
  return (
    <ScrollView style={{ backgroundColor: palette.background }} keyboardShouldPersistTaps="handled">
      {play ? (
        <View style={styles.tabs} accessibilityRole="tablist">
          {(['sheet', 'play'] as const).map((id) => (
            <Pressable
              key={id}
              onPress={() => setTab(id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === id }}
              style={[styles.tab, { borderColor: palette.accent, backgroundColor: tab === id ? palette.accent : palette.background }]}
            >
              <Text style={[styles.tabText, { color: tab === id ? palette.background : palette.accent }]}>{id === 'sheet' ? 'Sheet' : 'Play'}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {message ? (
        <Text style={[styles.body, styles.notice, { color: message.failed ? palette.danger : palette.muted }]}>{message.text}</Text>
      ) : null}
      {play && tab === 'play' ? (
        <PlayPanel
          view={play}
          actions={{ adjust: builder.adjustPlay, setTemporary: builder.setPlayTemporary, setCondition: builder.setPlayCondition, rest: builder.rest }}
        />
      ) : (
        <SheetView document={document} />
      )}
    </ScrollView>
  );
}

/**
 * Write each play edit back to the library file (ADR 0084): half a second after the last one, and at once when the
 * screen is left. Writes run one after another, each expecting the `updated` the one before it wrote, so a file changed
 * elsewhere meanwhile is refused (ADR 0027) and nothing more is written until the character is opened again.
 */
function useRecorder(
  library: CharacterLibrary,
  name: string,
  character: Character,
  readAt: string | undefined,
  fail: (text: string) => void,
): () => Promise<void> {
  const opened = useRef(character);
  const expected = useRef(readAt);
  const pending = useRef<Character | null>(null);
  const stopped = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const failRef = useRef(fail);
  failRef.current = fail;

  const [flush] = useState(() => (): void => {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (!next || stopped.current) return;
    queue.current = queue.current.then(async () => {
      if (stopped.current) return;
      const result = await library.record(name, next, expected.current);
      if (result.ok) {
        expected.current = result.updatedAt;
        if (__DEV__) console.log(`[incudo] play ${name}: ${JSON.stringify(next.play ?? {})}`);
      } else {
        stopped.current = true;
        failRef.current(`Could not save what changed in play: ${result.message} Open the character again to keep playing.`);
      }
    });
  });

  useEffect(() => {
    if (character === opened.current) return;
    pending.current = character;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
  }, [character, flush]);

  // Leaving the screen writes what is still waiting.
  useEffect(() => flush, [flush]);

  // Write what is waiting now, and resolve once every write has landed.
  const [settle] = useState(() => async (): Promise<void> => {
    flush();
    await queue.current;
  });
  return settle;
}

/**
 * A library entry's sheet, from its file and nothing else: the character, its embedded content and the system it names.
 * The same three steps the desktop takes and `self-contained.test.ts` holds, with no source anywhere.
 */
async function openSheet(library: CharacterLibrary, systems: readonly GameSystem[], name: string): Promise<Opened> {
  try {
    const opened = await library.open(name);
    if (!opened) return { error: `"${name}" did not open as a character.` };
    const system = systems.find((candidate) => candidate.id === opened.character.systemId);
    if (!system) return { error: `This character is for a game this app does not have (${opened.character.systemId}).` };
    // A kind the game no longer declares would throw in the builder with an internal message.
    const missing = characterKindMissing(system, opened.character);
    if (missing) return { error: missing };
    const builder = new CharacterBuilder(opened.character, system, opened.elements);
    const document = sheetDocument(builder.getState());
    if (__DEV__) {
      // A checksum of the sheet as the text export writes it, to compare with the desktop's for the same file (ADR 0083).
      const markdown = sheetMarkdown(document);
      console.log(`[incudo] sheet ${name}: ${markdown.length} characters, sha256 ${sha256Hex(strToU8(markdown))}`);
    }
    return { builder, ...(opened.entry.updatedAt !== undefined ? { readAt: opened.entry.updatedAt } : {}) };
  } catch (error) {
    return { error: `"${name}" could not be opened: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 12 },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  button: { borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  card: { borderRadius: 8, padding: 14, gap: 4 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13 },
  headerAction: { fontSize: 16, fontWeight: '600' },
  headerActions: { flexDirection: 'row', gap: 20 },
  notice: { paddingHorizontal: 16, paddingTop: 12 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  tab: { flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  tabText: { fontSize: 15, fontWeight: '600' },
  importLine: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 24,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    elevation: 4,
  },
});

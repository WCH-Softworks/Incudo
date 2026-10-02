/**
 * The phone app: a library, a sheet, and playing it — ROADMAP Phase 6's first two items, ADRs 0083 and 0084.
 *
 * Two screens on a native stack (React Navigation), so Android's back gesture and button do what a user expects. What a
 * screen shows comes from `packages/ui`: `CharacterLibrary` lists and adds characters, `CharacterBuilder` and
 * `sheetDocument` make the sheet, and the builder's `play` is what playing it keeps track of. Nothing here derives
 * anything, and opening a character reaches for no content source (ADR 0012): the file carries what it needs. A play
 * edit is written back to the library file at once (`CharacterLibrary.record`), as a pencil mark on a paper sheet is.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { strToU8 } from 'fflate';
import { useColorScheme } from 'react-native';

import { sha256Hex, type Character, type FileSaver, type GameSystem } from '@incudo/core';
import {
  CharacterBuilder,
  CharacterLibrary,
  describeKindAndProgress,
  exportEntry,
  libraryEntryProgress,
  sheetDocument,
  sheetMarkdown,
  type LibraryEntry,
  type SheetDocument,
} from '@incudo/ui';

import { loadShippedSystems } from './boot.ts';
import { MobileCharacterStore, MobileFilePicker, MobileFolderSaver, MobileShareSaver } from './platform.ts';
import { PlayPanel } from './PlayPanel.tsx';
import { SheetView } from './SheetView.tsx';
import { usePalette } from './theme.ts';
import { createMobileZipCodec } from './zip.ts';

type Screens = {
  Library: undefined;
  Sheet: { name: string; title: string };
};

const Stack = createNativeStackNavigator<Screens>();

interface Platform {
  library: CharacterLibrary;
  picker: MobileFilePicker;
  /** Where "Export" can send a file: a folder the user picks, or the share sheet. */
  folderSaver: FileSaver;
  shareSaver: FileSaver;
  zip: ReturnType<typeof createMobileZipCodec>;
  systems: GameSystem[];
}

const PlatformContext = createContext<Platform | null>(null);

function usePlatform(): Platform {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error('No platform: App renders the screens inside its provider.');
  return platform;
}

export function App() {
  const scheme = useColorScheme();
  const platform = useMemo<Platform>(() => {
    const zip = createMobileZipCodec();
    return {
      library: new CharacterLibrary(new MobileCharacterStore(zip)),
      picker: new MobileFilePicker(),
      folderSaver: new MobileFolderSaver(),
      shareSaver: new MobileShareSaver(),
      zip,
      systems: loadShippedSystems().systems,
    };
  }, []);

  return (
    <SafeAreaProvider>
      <PlatformContext.Provider value={platform}>
        <NavigationContainer theme={scheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack.Navigator>
            <Stack.Screen name="Library" component={LibraryScreen} options={{ title: 'Characters' }} />
            <Stack.Screen name="Sheet" component={SheetScreen} options={({ route }) => ({ title: route.params.title })} />
          </Stack.Navigator>
        </NavigationContainer>
        <StatusBar style="auto" />
      </PlatformContext.Provider>
    </SafeAreaProvider>
  );
}

// --- the library ------------------------------------------------------------------------------------------------

function LibraryScreen({ navigation }: NativeStackScreenProps<Screens, 'Library'>) {
  const { library, picker, zip, systems } = usePlatform();
  const palette = usePalette();
  const state = useSyncExternalStore(library.subscribe, library.getState);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void library.restore();
  }, [library]);

  const addFile = async (): Promise<void> => {
    setMessage(null);
    try {
      const picked = await picker.pick({ title: 'Add a character' });
      for (const file of picked) {
        if (!/\.incu$/i.test(file.name)) {
          setMessage(`"${file.name}" is not an Incudo character file (.incu).`);
          continue;
        }
        const added = await library.add(await zip.unzip(file.bytes), file.name);
        setMessage(added.ok ? `Added "${added.entry.name}".` : added.message);
      }
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
      {message ? <Text style={[styles.body, { color: palette.muted }]}>{message}</Text> : null}
      {state.busy ? <ActivityIndicator color={palette.accent} /> : null}
      {state.problems.map((problem) => (
        <Text key={problem} style={[styles.body, { color: palette.danger }]}>
          {problem}
        </Text>
      ))}
      {state.status === 'ready' && !state.entries.length ? (
        <Text style={[styles.body, { color: palette.muted }]}>
          No characters on this device yet. Add a .incu file saved from Incudo on a computer, from wherever you keep it.
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
  useEffect(() => {
    const send = async (saver: FileSaver, saving: boolean): Promise<void> => {
      setMessage(null);
      const result = await exportEntry(saver, zip, library, name);
      if (result.status === 'failed') setMessage({ text: `Could not export the character: ${result.message}`, failed: true });
      // The share sheet says nothing of what was chosen, so only a save to a folder reports where the file went.
      else if (result.status === 'saved' && saving) setMessage({ text: `Saved as "${result.file.name}".`, failed: false });
    };
    const choose = (): void =>
      Alert.alert('Export this character', 'Its .incu file, as it is in this app.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Share…', onPress: () => void send(shareSaver, false) },
        { text: 'Save to a folder…', onPress: () => void send(folderSaver, true) },
      ]);
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={choose} accessibilityRole="button" hitSlop={12}>
          <Text style={[styles.headerAction, { color: palette.accent }]}>Export</Text>
        </Pressable>
      ),
    });
  }, [navigation, library, zip, folderSaver, shareSaver, name, palette.accent]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const result = await openSheet(library, systems, name);
      if (live) setOpened(result);
    })();
    return () => {
      live = false;
    };
  }, [library, systems, name]);

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
  return <OpenedSheet builder={opened.builder} readAt={opened.readAt} name={name} message={message} setMessage={setMessage} />;
}

/** An opened character: its sheet, and playing it when its kind has anything to play. */
function OpenedSheet({
  builder,
  readAt,
  name,
  message,
  setMessage,
}: {
  builder: CharacterBuilder;
  readAt?: string;
  name: string;
  message: { text: string; failed: boolean } | null;
  setMessage: (message: { text: string; failed: boolean } | null) => void;
}) {
  const { library } = usePlatform();
  const palette = usePalette();
  const state = useSyncExternalStore(builder.subscribe, builder.getState);
  const [tab, setTab] = useState<'sheet' | 'play'>('sheet');
  // A play edit makes a new state and leaves the sheet's parts as they were, so the document is made again only when
  // one of them moves.
  const { sheet, companions, references } = state;
  const characterName = state.character.name;
  const document = useMemo<SheetDocument>(
    () => sheetDocument({ character: { name: characterName }, sheet, references, ...(companions ? { companions } : {}) }),
    [sheet, companions, references, characterName],
  );
  useRecorder(library, name, state.character, readAt, (text) => setMessage({ text, failed: true }));

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
function useRecorder(library: CharacterLibrary, name: string, character: Character, readAt: string | undefined, fail: (text: string) => void): void {
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
  notice: { paddingHorizontal: 16, paddingTop: 12 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  tab: { flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  tabText: { fontSize: 15, fontWeight: '600' },
});

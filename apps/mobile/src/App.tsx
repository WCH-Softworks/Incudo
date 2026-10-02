/**
 * The phone app: a library and a read-only sheet — ROADMAP Phase 6's first two items, ADR 0083.
 *
 * Two screens on a native stack (React Navigation), so Android's back gesture and button do what a user expects. What a
 * screen shows comes from `packages/ui`: `CharacterLibrary` lists and adds characters, `CharacterBuilder` and
 * `sheetDocument` make the sheet. Nothing here derives anything, and opening a character reaches for no content source
 * (ADR 0012): the file carries what it needs.
 */

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { strToU8 } from 'fflate';
import { useColorScheme } from 'react-native';

import { sha256Hex, type GameSystem } from '@incudo/core';
import {
  CharacterBuilder,
  CharacterLibrary,
  describeKindAndProgress,
  libraryEntryProgress,
  sheetDocument,
  sheetMarkdown,
  type LibraryEntry,
  type SheetDocument,
} from '@incudo/ui';

import { loadShippedSystems } from './boot.ts';
import { MobileCharacterStore, MobileFilePicker } from './platform.ts';
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

type Opened = { document: SheetDocument } | { error: string };

function SheetScreen({ route }: NativeStackScreenProps<Screens, 'Sheet'>) {
  const { library, systems } = usePlatform();
  const palette = usePalette();
  const [opened, setOpened] = useState<Opened | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const result = await openSheet(library, systems, route.params.name);
      if (live) setOpened(result);
    })();
    return () => {
      live = false;
    };
  }, [library, systems, route.params.name]);

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
    <ScrollView style={{ backgroundColor: palette.background }}>
      <SheetView document={opened.document} />
    </ScrollView>
  );
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
    const document = sheetDocument(new CharacterBuilder(opened.character, system, opened.elements).getState());
    if (__DEV__) {
      // A checksum of the sheet as the text export writes it, to compare with the desktop's for the same file (ADR 0083).
      const markdown = sheetMarkdown(document);
      console.log(`[incudo] sheet ${name}: ${markdown.length} characters, sha256 ${sha256Hex(strToU8(markdown))}`);
    }
    return { document };
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
});

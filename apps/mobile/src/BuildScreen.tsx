/**
 * Building a new character, or editing one from the library, on a phone — ADR 0086.
 *
 * The screen holds three things and decides none of them: the character it started from (a library file, opened as the
 * sheet opens one, or `newCharacterOfKind`), the content its system's sources load (`ContentSources`, asked for here and
 * nowhere earlier, so the app's start never waits on content), and the save session (`edit-session.ts`). The build itself
 * is `BuildView`. Save writes the whole file through `CharacterLibrary.save` (the file's embedded content changes with a
 * build, so play's `record` will not do); leaving with something unsaved asks.
 *
 * The builder is made again when content arrives or changes, from the character as it stands, never as it was opened:
 * the desktop's `use-builder.ts` records the edit that losing this cost once.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { LayeredElementIndex, MapElementIndex, type Character, type ElementIndex, type GameSystem } from '@incudo/core';
import { CharacterBuilder, beginEdit, hasUnsavedChanges, newCharacterOfKind, saveEdit, type EditSession } from '@incudo/ui';

import { BuildView } from './BuildView.tsx';
import { Body, Button } from './controls.tsx';
import { usePlatform, type Screens } from './context.ts';
import { usePalette } from './theme.ts';

const EMPTY = new MapElementIndex();

interface Start {
  character: Character;
  system: GameSystem;
  /** The file's own content, in front of what the sources load (ADR 0012): nothing it carries is silently replaced. */
  embedded?: ElementIndex;
  session: EditSession;
}

export function BuildScreen({ route, navigation }: NativeStackScreenProps<Screens, 'Build'>) {
  const { library, systems, sources } = usePlatform();
  const palette = usePalette();
  const params = route.params;
  const [start, setStart] = useState<Start | { error: string } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const opened = await openForBuild(library, systems, params);
      if (live) setStart(opened);
    })();
    return () => {
      live = false;
    };
    // The parameters are fixed for a screen's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!start) {
    return (
      <View style={[styles.centred, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }
  if ('error' in start) {
    return (
      <View style={[styles.page, { backgroundColor: palette.background }]}>
        <Body tone="danger">{start.error}</Body>
      </View>
    );
  }
  return <Building start={start} navigation={navigation} sources={sources} />;
}

function Building({
  start,
  navigation,
  sources,
}: {
  start: Start;
  navigation: NativeStackScreenProps<Screens, 'Build'>['navigation'];
  sources: ReturnType<typeof usePlatform>['sources'];
}) {
  const { library } = usePlatform();
  const palette = usePalette();
  const content = useSyncExternalStore(sources.subscribe, sources.getState);
  const systemId = start.system.id;

  // Content is asked for here, once the screen is open, and again when this system's sources are switched on or off
  // (the Content screen is a tap away); a load already made for the same sources is handed back at once.
  const enabled = content.sources
    .filter((source) => source.systemId === systemId && source.enabled)
    .map((source) => source.id)
    .join(' ');
  useEffect(() => {
    void (async () => {
      await sources.restore();
      if (sources.hasEnabled(systemId)) await sources.load(systemId).catch(() => undefined);
    })();
  }, [sources, systemId, enabled]);

  const loaded = content.loaded[systemId];
  const elements = useMemo<ElementIndex>(() => {
    const layers = [start.embedded, loaded?.elements].filter((layer): layer is ElementIndex => layer !== undefined);
    if (!layers.length) return EMPTY;
    return layers.length === 1 ? layers[0]! : new LayeredElementIndex(layers);
  }, [start.embedded, loaded]);

  // Made again when the elements change, from the character as it now stands.
  const current = useRef(start.character);
  const builder = useMemo(() => new CharacterBuilder(current.current, start.system, elements), [elements, start.system]);
  const state = useSyncExternalStore(builder.subscribe, builder.getState);
  useEffect(() => {
    current.current = state.character;
  }, [state.character]);

  const [session, setSession] = useState(start.session);
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const unsaved = hasUnsavedChanges(session, state.character);

  // What the header and the leave prompt act on, as it is when they act.
  const latest = useRef({ session, state, elements, unsaved });
  latest.current = { session, state, elements, unsaved };

  // The Save in progress, so leaving waits for it rather than asking to save what is being saved.
  const pending = useRef<Promise<boolean> | undefined>(undefined);
  const save = (): Promise<boolean> => {
    if (pending.current) return pending.current;
    const running = write().finally(() => {
      pending.current = undefined;
    });
    pending.current = running;
    return running;
  };
  const write = async (): Promise<boolean> => {
    const { session: now, state: at, elements: with_ } = latest.current;
    setSaving(true);
    try {
      // Packing holds the JavaScript thread for most of a second; one frame first lets the header say "Saving…".
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const result = await saveEdit(library, now, at.character, start.system, with_, 'incudo-mobile');
      if (!result.ok) {
        setNote({ text: result.message, failed: true });
        return false;
      }
      setSession(result.session);
      latest.current = { ...latest.current, session: result.session, unsaved: false };
      setNote({ text: `Saved as "${result.entry.name}".`, failed: false });
      return true;
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    navigation.setOptions({
      title: state.character.name || 'New character',
      headerRight: () => <Button label={saving ? 'Saving…' : 'Save'} kind="link" disabled={saving || (!unsaved && !!session.entry)} onPress={() => void save()} />,
    });
    // `save` reads `latest`, so it need not be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, state.character.name, unsaved, saving, session.entry]);

  // Leaving with something unsaved asks: Save, Discard, or stay.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (pending.current) {
          // Leaving during a Save waits for it, then tries again: gone if it saved, asked as below if it did not.
          event.preventDefault();
          void pending.current.then(() => navigation.dispatch(event.data.action));
          return;
        }
        if (!latest.current.unsaved) return;
        event.preventDefault();
        Alert.alert('Save this character?', 'It has changes that are not saved to its file.', [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(event.data.action) },
          { text: 'Save', onPress: () => void save().then((saved) => saved && navigation.dispatch(event.data.action)) },
        ]);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigation],
  );

  const loading = content.loading?.systemId === systemId ? content.loading : undefined;
  return (
    <ScrollView style={{ backgroundColor: palette.background }} keyboardShouldPersistTaps="handled">
      {note ? (
        <View style={styles.notice}>
          <Body tone={note.failed ? 'danger' : 'muted'}>{note.text}</Body>
        </View>
      ) : null}
      {loading ? (
        <View style={[styles.notice, styles.loading]}>
          <ActivityIndicator color={palette.accent} />
          <Body tone="muted">
            Loading content{loading.progress ? ` (${loading.progress.loaded} of ${loading.progress.total})` : ''}…
          </Body>
        </View>
      ) : null}
      {!loading && !sources.hasEnabled(systemId) ? (
        <View style={styles.notice}>
          <Body tone="muted">No content source is switched on for {start.system.name}. Choosing anything needs one.</Body>
          <Button label="Content…" onPress={() => navigation.navigate('Content')} />
        </View>
      ) : null}
      {content.message ? (
        <View style={styles.notice}>
          <Body tone="danger">{content.message}</Body>
        </View>
      ) : null}
      <BuildView builder={builder} state={state} elements={elements} hasContent={loaded !== undefined || loading !== undefined} />
    </ScrollView>
  );
}

/** The character a Build screen starts from: a library file, opened as the sheet opens one, or a new one of a kind. */
async function openForBuild(
  library: ReturnType<typeof usePlatform>['library'],
  systems: readonly GameSystem[],
  params: Screens['Build'],
): Promise<Start | { error: string }> {
  try {
    if ('kindId' in params) {
      const system = systems.find((candidate) => candidate.id === params.systemId);
      if (!system) return { error: `This app does not have the game ${params.systemId}.` };
      const character = newCharacterOfKind(system, params.kindId);
      return { character, system, session: beginEdit(character) };
    }
    const opened = await library.open(params.name);
    if (!opened) return { error: `"${params.name}" did not open as a character.` };
    const system = systems.find((candidate) => candidate.id === opened.character.systemId);
    if (!system) return { error: `This character is for a game this app does not have (${opened.character.systemId}).` };
    return {
      character: opened.character,
      system,
      embedded: opened.elements,
      session: beginEdit(opened.character, {
        entry: { name: opened.entry.name, form: opened.entry.form },
        ...(opened.entry.updatedAt !== undefined ? { readAt: opened.entry.updatedAt } : {}),
        assets: opened.assets,
      }),
    };
  } catch (error) {
    return { error: `The character could not be opened: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const styles = StyleSheet.create({
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  page: { flex: 1, padding: 16 },
  notice: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

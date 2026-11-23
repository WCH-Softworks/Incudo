/**
 * The content a phone builds with — ADR 0086. Per game: its suggested sources, added with one tap and downloaded in
 * full and converted into Incudo's own content, kept as a file (ADR 0119); each added source switched on or off,
 * refreshed, or removed with its file. On a metered connection, adding or refreshing a source asks first and says what it
 * downloads (ADR 0100, `fetchPrompt`).
 *
 * Since ADR 0132, what the desktop's Sources pane says and does too: an Aurora file the user picks added as a source of
 * its own (ADR 0056), a source's parts switched off (ADR 0055), a check for updates (ADR 0050), moving a source (ADR
 * 0054), and each source's notes from the last load: what it refers to that nothing enabled has and which switched-off
 * source had it (ADRs 0052, 0090), and what it defines that another source does too (ADR 0054). Every sentence is
 * `source-notes.ts`'s, the desktop's words.
 *
 * A renderer of `ContentSources` (`packages/ui`). Reading or playing a character never needs any of this (ADR 0012).
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import {
  fileSourceName,
  isFileSource,
  isHomebrewSource,
  type ConfiguredSource,
  type IndexTreeNode,
  type LoadedSource,
  type RefreshReport,
  type UpdateStatus,
} from '@incudo/content';
import type { SuggestedSource } from '@incudo/core';
import {
  PARTS_HINT,
  addSourceNote,
  describeContentFiles,
  fetchPrompt,
  missingNote,
  partMeta,
  partsLoadingLine,
  partsOffNote,
  partsView,
  refreshNote,
  sourceOverlapNote,
  togglePart,
  updateNote,
  type FetchAction,
  type PartView,
} from '@incudo/ui';

import { Body, Button, Card, Heading, Row } from './controls.tsx';
import { usePlatform } from './context.ts';
import { usePalette } from './theme.ts';

export function ContentScreen() {
  const { sources, systems, connection, picker } = usePlatform();
  const palette = usePalette();
  const state = useSyncExternalStore(sources.subscribe, sources.getState);
  const [working, setWorking] = useState(false);
  const busy = working || !!state.busy;
  /** The source whose parts are being chosen, if any: one at a time. */
  const [choosing, setChoosing] = useState<string | undefined>();
  const nameOf = (id: string): string => state.sources.find((source) => source.id === id)?.name ?? id;

  // Each game's switched-on sources are loaded when the screen opens: the notes on a source's line (what it misses, which
  // switched-off source had it, what another also defines) are a load's findings (ADR 0132). The load reads the
  // converted files on the phone, and is the one a Build screen then uses.
  useEffect(() => {
    void sources.restore().then(() => {
      for (const system of systems) if (sources.hasEnabled(system.id)) void sources.load(system.id).catch(() => undefined);
    });
  }, [sources, systems]);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setWorking(true);
    try {
      await work();
    } catch {
      // `ContentSources` says what went wrong in its state's `message`.
    } finally {
      setWorking(false);
    }
  };

  const add = async (systemId: string, suggestion: SuggestedSource): Promise<void> => {
    const note = addSourceNote(await connection.current());
    Alert.alert(`Add ${suggestion.name}?`, note, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Add', onPress: () => void run(() => sources.add(systemId, suggestion)) },
    ]);
  };

  // The system's picker offers every file; what is not an Aurora elements file is refused on its own line.
  const addFiles = (systemId: string): void =>
    void run(async () => {
      const files = await picker.pick({ multiple: true });
      if (files.length) await sources.addFiles(systemId, files);
    });

  // Asked first on a metered connection, and only when the action downloads something (ADR 0100).
  const confirmFetch = async (action: FetchAction, work: () => Promise<void>): Promise<void> => {
    const prompt = fetchPrompt(action, await connection.current());
    if (!prompt) return run(work);
    Alert.alert(prompt.title, prompt.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: prompt.confirm, onPress: () => void run(work) },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.page}>
      <Body tone="muted">Building or editing a character offers choices from content. Opening, reading and playing one never needs any.</Body>
      {state.loading ? (
        <Row>
          <ActivityIndicator color={palette.accent} />
          <Body tone="muted">
            Loading{state.loading.progress ? ` ${state.loading.progress.loaded} of ${state.loading.progress.total}` : ''}…
          </Body>
        </Row>
      ) : null}
      {state.message ? <Body tone="danger">{state.message}</Body> : null}
      {state.files ? (
        <Card>
          <Body>{describeContentFiles(state.files)}</Body>
          {state.files
            .filter((result) => result.failed)
            .map((result) => (
              <Body key={result.name} tone="danger">
                {result.name}: {result.failed}
              </Body>
            ))}
        </Card>
      ) : null}
      {systems.map((system) => {
        const configured = sources.sourcesFor(system.id);
        const suggested = sources.suggestionsFor(system.id);
        const loaded = state.loaded[system.id];
        return (
          <View key={system.id} style={styles.system}>
            <Heading>{system.name}</Heading>
            {!configured.length && !suggested.length ? <Body tone="muted">No source is suggested for this game.</Body> : null}
            {suggested.map((suggestion) => (
              <Card key={suggestion.url}>
                <Text style={[styles.name, { color: palette.text }]}>{suggestion.name}</Text>
                {suggestion.description ? <Body tone="muted">{suggestion.description}</Body> : null}
                <Button label="Add" kind="primary" disabled={busy} onPress={() => void add(system.id, suggestion)} />
              </Card>
            ))}
            {configured.map((source, index) => (
              <SourceCard
                key={source.id}
                source={source}
                loaded={loaded?.sources.find((row) => row.id === source.id)}
                update={state.updates[source.id]}
                refreshed={state.refreshes[source.id]}
                first={index === 0}
                last={index === configured.length - 1}
                nameOf={nameOf}
                busy={busy}
                choosing={choosing === source.id}
                onChoose={(on) => setChoosing(on ? source.id : undefined)}
                readParts={() => sources.readParts(source.id)}
                onParts={(excluded) => {
                  setChoosing(undefined);
                  void run(() => sources.setExcluded(source.id, excluded));
                }}
                onCheck={() => void run(() => sources.checkForUpdates(source.id))}
                onMove={(direction) => void run(() => sources.move(source.id, direction))}
                onEnabled={(on) => void run(() => sources.setEnabled(source.id, on))}
                onRefresh={() => void confirmFetch({ kind: 'refresh', source }, () => sources.refresh(source.id))}
                onRemove={() =>
                  Alert.alert(`Remove ${source.name}?`, 'Its file is deleted from this device. Characters keep the content they use.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => void run(() => sources.remove(source.id)) },
                  ])
                }
              />
            ))}
            <Button label="Add an Aurora file…" disabled={busy} onPress={() => addFiles(system.id)} />
          </View>
        );
      })}
    </ScrollView>
  );
}

function SourceCard({
  source,
  loaded,
  update,
  refreshed,
  first,
  last,
  nameOf,
  busy,
  choosing,
  onChoose,
  readParts,
  onParts,
  onCheck,
  onMove,
  onEnabled,
  onRefresh,
  onRemove,
}: {
  source: ConfiguredSource;
  /** This source in the system's last load, if there was one this session. */
  loaded: LoadedSource | undefined;
  update: UpdateStatus | undefined;
  refreshed: RefreshReport | { failed: string } | undefined;
  first: boolean;
  last: boolean;
  nameOf: (id: string) => string;
  busy: boolean;
  choosing: boolean;
  onChoose: (on: boolean) => void;
  readParts: () => Promise<IndexTreeNode>;
  onParts: (excluded: string[]) => void;
  onCheck: () => void;
  onMove: (direction: 'up' | 'down') => void;
  onEnabled: (on: boolean) => void;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const palette = usePalette();
  const count = loaded && !loaded.failed ? loaded.elementCount : source.elementCount;
  // A file the user added, or a homebrew source, has nothing upstream: no update check, no refresh, no parts.
  const local = isFileSource(source) || isHomebrewSource(source);
  const missing = loaded?.missing ? missingNote(loaded.missing, loaded.switchedOff, nameOf) : undefined;
  const partsOff = partsOffNote(source.excluded);
  const refresh = refreshed ? refreshNote(refreshed) : undefined;
  const meta = [
    count !== undefined ? `${count.toLocaleString()} entries` : 'not loaded yet',
    source.version ? `version ${source.version}` : undefined,
    loaded?.failed ? 'did not load' : undefined,
  ];
  return (
    <Card>
      <Row>
        <Text style={[styles.name, { color: palette.text, flex: 1 }]}>{source.name}</Text>
        <Switch value={source.enabled} disabled={busy} onValueChange={onEnabled} accessibilityLabel={`Use ${source.name}`} />
      </Row>
      {isFileSource(source) ? <Body tone="muted">A copy of {fileSourceName(source)}. Add a file with the same name to replace it.</Body> : null}
      <Body tone="muted">{meta.filter(Boolean).join(' · ')}</Body>
      {loaded?.failed ? <Body tone="danger">{loaded.failed}</Body> : null}
      {partsOff ? <Body tone="muted">{partsOff}</Body> : null}
      {missing ? (
        <>
          <Expandable summary={missing.summary} items={[...missing.references, ...missing.additions]} />
          {missing.switchedOff.map((other) => (
            <Expandable key={other.sourceId} summary={other.sentence} items={other.ids} />
          ))}
        </>
      ) : null}
      {loaded?.overlaps?.map((overlap) => {
        const note = sourceOverlapNote(overlap, nameOf(overlap.sourceId));
        return <Expandable key={overlap.sourceId} summary={note.summary} items={note.differ} />;
      })}
      {update ? <Body>{updateNote(update)}</Body> : null}
      {refresh ? (
        <Expandable
          summary={refresh.keptSummary ? `${refresh.summary} ${refresh.keptSummary}.` : refresh.summary}
          items={refresh.kept.map((file) => `${file.url}: ${file.reason}`)}
        />
      ) : null}
      {choosing ? <PartsChooser read={readParts} excluded={source.excluded ?? []} busy={busy} onConfirm={onParts} onCancel={() => onChoose(false)} /> : null}
      {!local ? (
        <Row>
          <Button label="Check for updates" disabled={busy} onPress={onCheck} />
          <Button label="Refresh" disabled={busy} onPress={onRefresh} />
          {!choosing ? <Button label="Choose parts" disabled={busy} onPress={() => onChoose(true)} /> : null}
        </Row>
      ) : null}
      <Row>
        {!(first && last) ? <Button label="Move up" kind="link" disabled={busy || first} onPress={() => onMove('up')} /> : null}
        {!(first && last) ? <Button label="Move down" kind="link" disabled={busy || last} onPress={() => onMove('down')} /> : null}
        <Button label="Remove" kind="link" disabled={busy} onPress={onRemove} />
      </Row>
    </Card>
  );
}

/** A sentence, and the list it is about behind "Show which", closed at first: a source can miss hundreds of things. */
function Expandable({ summary, items }: { summary: string; items: readonly string[] }) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.note}>
      <Body>{summary}</Body>
      {items.length ? <Button label={open ? 'Hide' : 'Show which'} kind="link" onPress={() => setOpen(!open)} /> : null}
      {open
        ? items.map((item) => (
            <Text key={item} style={[styles.item, { color: palette.muted }]} selectable>
              {item}
            </Text>
          ))
        : null}
    </View>
  );
}

/**
 * Choosing a source's parts — ADR 0055. The tree is read from the source's conversion, and what is on, what cannot load
 * because a part above it is off, and how many files will load are `partsView`'s; this keeps the list being edited until
 * it is confirmed.
 */
function PartsChooser({
  read,
  excluded: initial,
  busy,
  onConfirm,
  onCancel,
}: {
  read: () => Promise<IndexTreeNode>;
  excluded: readonly string[];
  busy: boolean;
  onConfirm: (excluded: string[]) => void;
  onCancel: () => void;
}) {
  const [tree, setTree] = useState<IndexTreeNode | { failed: string } | null>(null);
  const [excluded, setExcluded] = useState<string[]>([...initial]);

  useEffect(() => {
    let current = true;
    read().then(
      (value) => current && setTree(value),
      (error: unknown) => current && setTree({ failed: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      current = false;
    };
    // Read once, when the chooser opens: `read` is a new function on every render of the screen.
  }, []);

  if (tree === null) return <Body tone="muted">Reading the parts…</Body>;
  if ('failed' in tree) {
    return (
      <View style={styles.note}>
        <Body tone="danger">Could not read the parts of that source: {tree.failed}</Body>
        <Button label="Close" onPress={onCancel} />
      </View>
    );
  }
  const view = partsView(tree, excluded);
  const toggle = (url: string): void => setExcluded((previous) => togglePart(previous, url));
  return (
    <View style={styles.note}>
      <Heading>Parts of {view.name}</Heading>
      <Body tone="muted">{PARTS_HINT}</Body>
      <Body>{partsLoadingLine(view.filesLoading, view.files)}</Body>
      {view.parts.map((part) => (
        <PartRow key={part.key} part={part} depth={0} onToggle={toggle} />
      ))}
      <Row>
        <Button label="Use these parts" kind="primary" disabled={busy} onPress={() => onConfirm(view.excluded)} />
        <Button label="Switch everything on" disabled={!excluded.length} onPress={() => setExcluded([])} />
        <Button label="Cancel" kind="link" onPress={onCancel} />
      </Row>
    </View>
  );
}

function PartRow({ part, depth, onToggle }: { part: PartView; depth: number; onToggle: (url: string) => void }) {
  const palette = usePalette();
  // Groups start open so the books are in view; books start closed, since some list sixty files.
  const [open, setOpen] = useState(depth === 0);
  const meta = partMeta(part);
  const folds = part.children.length > 0;
  return (
    <View style={{ marginLeft: depth * 14, gap: 4 }}>
      <Row style={styles.part}>
        <Switch value={part.on} disabled={!part.reachable} onValueChange={() => onToggle(part.url)} accessibilityLabel={part.label} />
        <Pressable style={styles.partText} disabled={!folds} onPress={() => setOpen(!open)} {...(folds ? { accessibilityRole: 'button' as const } : {})}>
          <Text style={[styles.partLabel, { color: part.reachable ? palette.text : palette.muted }]}>
            {folds ? `${open ? '▾' : '▸'} ` : ''}
            {part.label}
          </Text>
          {meta.length ? <Text style={[styles.item, { color: part.failed ? palette.danger : palette.muted }]}>{meta.join(' · ')}</Text> : null}
        </Pressable>
      </Row>
      {open ? part.children.map((child) => <PartRow key={child.key} part={child} depth={depth + 1} onToggle={onToggle} />) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  system: { gap: 10 },
  name: { fontSize: 17, fontWeight: '600' },
  note: { gap: 4 },
  item: { fontSize: 13, lineHeight: 18 },
  part: { flexWrap: 'nowrap' },
  partText: { flex: 1 },
  partLabel: { fontSize: 15 },
});

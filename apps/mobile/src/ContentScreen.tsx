/**
 * The content a phone builds with — ADR 0086. Per game: its suggested sources, added with one tap and downloaded in
 * full and converted into Incudo's own content, kept as a file (ADR 0119); each added source switched on or off,
 * refreshed, or removed with its file. On a metered connection, adding or refreshing a source asks first and says what it
 * downloads (ADR 0100, `fetchPrompt`).
 *
 * A renderer of `ContentSources` (`packages/ui`). Reading or playing a character never needs any of this (ADR 0012).
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import type { ConfiguredSource } from '@incudo/content';
import type { SuggestedSource } from '@incudo/core';
import { addSourceNote, fetchPrompt, type FetchAction } from '@incudo/ui';

import { Body, Button, Card, Heading, Row } from './controls.tsx';
import { usePlatform } from './context.ts';
import { usePalette } from './theme.ts';

export function ContentScreen() {
  const { sources, systems, connection } = usePlatform();
  const palette = usePalette();
  const state = useSyncExternalStore(sources.subscribe, sources.getState);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void sources.restore();
  }, [sources]);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await work();
    } catch {
      // `ContentSources` says what went wrong in its state's `message`.
    } finally {
      setBusy(false);
    }
  };

  const add = async (systemId: string, suggestion: SuggestedSource): Promise<void> => {
    const note = addSourceNote(await connection.current());
    Alert.alert(`Add ${suggestion.name}?`, note, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Add', onPress: () => void run(() => sources.add(systemId, suggestion)) },
    ]);
  };

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
            {configured.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                elements={loaded?.sources.find((row) => row.id === source.id)?.elementCount}
                busy={busy}
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
          </View>
        );
      })}
    </ScrollView>
  );
}

function SourceCard({
  source,
  elements,
  busy,
  onEnabled,
  onRefresh,
  onRemove,
}: {
  source: ConfiguredSource;
  elements: number | undefined;
  busy: boolean;
  onEnabled: (on: boolean) => void;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const palette = usePalette();
  const count = elements ?? source.elementCount;
  return (
    <Card>
      <Row>
        <Text style={[styles.name, { color: palette.text, flex: 1 }]}>{source.name}</Text>
        <Switch value={source.enabled} disabled={busy} onValueChange={onEnabled} accessibilityLabel={`Use ${source.name}`} />
      </Row>
      <Body tone="muted">
        {[count !== undefined ? `${count.toLocaleString()} entries` : 'not loaded yet', source.version ? `version ${source.version}` : undefined]
          .filter(Boolean)
          .join(' · ')}
      </Body>
      <Row>
        <Button label="Refresh" disabled={busy} onPress={onRefresh} />
        <Button label="Remove" kind="link" disabled={busy} onPress={onRemove} />
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  system: { gap: 10 },
  name: { fontSize: 17, fontWeight: '600' },
});

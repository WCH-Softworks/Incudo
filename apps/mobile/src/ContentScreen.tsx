/**
 * The content a phone builds with — ADR 0086. Per game: its suggested sources, added with one tap and downloaded in
 * full, kept converted or as files (ADR 0085, the user's choice of speed against space); each added source switched on
 * or off, refreshed, kept the other way, or removed with what it kept on the device.
 *
 * A renderer of `ContentSources` (`packages/ui`). Reading or playing a character never needs any of this (ADR 0012).
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { keepsConverted, type ConfiguredSource } from '@incudo/content';
import type { SuggestedSource } from '@incudo/core';

import { Body, Button, Card, Heading, Row } from './controls.tsx';
import { usePlatform } from './context.ts';
import { usePalette } from './theme.ts';

const KEEP_NOTE =
  'Converted keeps what was downloaded in Incudo\'s own form, which loads quickly and takes somewhat more space (about 20 MB for AuroraLegacy). ' +
  'Files keeps the files as they came (about 15 MB), and reads them again every time content loads.';

export function ContentScreen() {
  const { sources, systems } = usePlatform();
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

  const add = (systemId: string, suggestion: SuggestedSource): void =>
    Alert.alert(`Add ${suggestion.name}?`, `It is downloaded in full now.\n\n${KEEP_NOTE}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Files', onPress: () => void run(() => sources.add(systemId, suggestion, 'files')) },
      { text: 'Converted', onPress: () => void run(() => sources.add(systemId, suggestion, 'converted')) },
    ]);

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
                <Button label="Add" kind="primary" disabled={busy} onPress={() => add(system.id, suggestion)} />
              </Card>
            ))}
            {configured.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                elements={loaded?.sources.find((row) => row.id === source.id)?.elementCount}
                busy={busy}
                onEnabled={(on) => void run(() => sources.setEnabled(source.id, on))}
                onKeep={() =>
                  void run(() => sources.setKeep(source.id, keepsConverted(source) ? 'files' : 'converted'))
                }
                onRefresh={() => void run(() => sources.refresh(source.id))}
                onRemove={() =>
                  Alert.alert(`Remove ${source.name}?`, 'What it downloaded is deleted from this device. Characters keep the content they use.', [
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
  onKeep,
  onRefresh,
  onRemove,
}: {
  source: ConfiguredSource;
  elements: number | undefined;
  busy: boolean;
  onEnabled: (on: boolean) => void;
  onKeep: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const palette = usePalette();
  const converted = keepsConverted(source);
  const count = elements ?? source.elementCount;
  return (
    <Card>
      <Row>
        <Text style={[styles.name, { color: palette.text, flex: 1 }]}>{source.name}</Text>
        <Switch value={source.enabled} disabled={busy} onValueChange={onEnabled} accessibilityLabel={`Use ${source.name}`} />
      </Row>
      <Body tone="muted">
        {[count !== undefined ? `${count.toLocaleString()} elements` : 'not loaded yet', converted ? 'kept converted' : 'kept as files', source.version ? `version ${source.version}` : undefined]
          .filter(Boolean)
          .join(' · ')}
      </Body>
      <Row>
        <Button label="Refresh" disabled={busy} onPress={onRefresh} />
        <Button label={converted ? 'Keep as files' : 'Keep converted'} disabled={busy} onPress={onKeep} />
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

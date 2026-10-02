/**
 * Playing a character on the phone — ADR 0084.
 *
 * A renderer of `PlayView` (`packages/ui/src/play.ts`): every tracker, its value and what a rest does to it are worded
 * there (`playValue`, `playTemporaryText`, `playRestNote`, `restEffects`), and every tap is one of the builder's play
 * methods. This lays them out and computes nothing.
 */

import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { playRestNote, playTemporaryText, playValue, restEffects, type PlayTracker, type PlayView } from '@incudo/ui';

import { usePalette, type Palette } from './theme.ts';

/** What a tap does: the builder's play methods. */
export interface PlayActions {
  adjust: (key: string, delta: number) => void;
  setTemporary: (key: string, value: number) => void;
  setCondition: (name: string, on: boolean) => void;
  rest: (restId: string) => void;
}

export function PlayPanel({ view, actions }: { view: PlayView; actions: PlayActions }) {
  const palette = usePalette();
  const askRest = (rest: { id: string; label: string }): void => {
    const effects = restEffects(view, rest.id);
    Alert.alert(`Take a ${rest.label}?`, effects.length ? `Gives back: ${effects.join(', ')}.` : 'Nothing spent comes back on it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: rest.label, onPress: () => actions.rest(rest.id) },
    ]);
  };

  return (
    <View style={styles.page}>
      {view.groups.map((group) => (
        <View key={group.id} style={[styles.group, { borderColor: palette.border }]}>
          <Text style={[styles.h2, { color: palette.text }]} accessibilityRole="header">
            {group.label}
          </Text>
          {group.trackers.map((tracker) =>
            tracker.temporary ? (
              <Pool key={tracker.key} tracker={tracker} actions={actions} palette={palette} named={group.trackers.length > 1} />
            ) : (
              <Counter key={tracker.key} tracker={tracker} actions={actions} palette={palette} named={group.trackers.length > 1 || tracker.label !== group.label} />
            ),
          )}
        </View>
      ))}

      {view.conditions ? (
        <View style={[styles.group, { borderColor: palette.border }]}>
          <Text style={[styles.h2, { color: palette.text }]} accessibilityRole="header">
            {view.conditions.label}
          </Text>
          <View style={styles.chips}>
            {view.conditions.names.map(({ name, on }) => (
              <Pressable
                key={name}
                onPress={() => actions.setCondition(name, !on)}
                accessibilityRole="switch"
                accessibilityState={{ checked: on }}
                style={[styles.chip, { borderColor: on ? palette.accent : palette.border, backgroundColor: on ? palette.accent : palette.surface }]}
              >
                <Text style={{ color: on ? palette.background : palette.text, fontSize: 14 }}>{name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {view.rests.length ? (
        <View style={styles.rests}>
          {view.rests.map((rest) => (
            <Button key={rest.id} label={rest.label} onPress={() => askRest(rest)} palette={palette} wide />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A tracker spent one at a time: a slot, a use, a point, a die, or a count. */
function Counter({ tracker, actions, palette, named }: { tracker: PlayTracker; actions: PlayActions; palette: Palette; named: boolean }) {
  // For a tracker that counts, + adds one; for one that is spent, + gives one back and − spends one.
  const down = tracker.counts ? tracker.spent > 0 : tracker.spent < tracker.max;
  const up = tracker.counts ? tracker.spent < tracker.max : tracker.spent > 0;
  const note = playRestNote(tracker);
  return (
    <View style={styles.tracker}>
      <View style={styles.trackerText}>
        {named ? <Text style={[styles.body, { color: palette.text }]}>{tracker.label}</Text> : null}
        <Text style={[styles.value, { color: palette.text }]} accessibilityLabel={`${tracker.label}: ${playValue(tracker)}`}>
          {playValue(tracker)}
        </Text>
        {note ? <Text style={[styles.small, { color: palette.muted }]}>{note}</Text> : null}
      </View>
      <Button label="−" onPress={() => actions.adjust(tracker.key, tracker.counts ? -1 : 1)} disabled={!down} palette={palette} hint={tracker.counts ? `One fewer ${tracker.label}` : `Spend one ${tracker.label}`} />
      <Button label="+" onPress={() => actions.adjust(tracker.key, tracker.counts ? 1 : -1)} disabled={!up} palette={palette} hint={tracker.counts ? `One more ${tracker.label}` : `Get one ${tracker.label} back`} />
    </View>
  );
}

/** A tracker spent in amounts the player types, with a temporary amount spent first: hit points. */
function Pool({ tracker, actions, palette, named }: { tracker: PlayTracker; actions: PlayActions; palette: Palette; named: boolean }) {
  const [typed, setTyped] = useState('');
  const amount = Number.parseInt(typed, 10);
  const ready = Number.isFinite(amount) && amount > 0;
  const temporary = playTemporaryText(tracker);
  const note = playRestNote(tracker);
  const apply = (run: (n: number) => void): void => {
    if (!ready) return;
    run(amount);
    setTyped('');
  };
  return (
    <View style={styles.pool}>
      {named ? <Text style={[styles.body, { color: palette.text }]}>{tracker.label}</Text> : null}
      <Text style={[styles.big, { color: palette.text }]} accessibilityLabel={`${tracker.label}: ${playValue(tracker)}`}>
        {playValue(tracker)}
      </Text>
      {temporary ? <Text style={[styles.body, { color: palette.accent }]}>{temporary}</Text> : null}
      {note ? <Text style={[styles.small, { color: palette.muted }]}>{note}</Text> : null}
      <View style={styles.poolRow}>
        <TextInput
          value={typed}
          onChangeText={(text) => setTyped(text.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          placeholder="Amount"
          placeholderTextColor={palette.muted}
          accessibilityLabel="Amount"
          style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
        />
        <Button label="Lose" onPress={() => apply((n) => actions.adjust(tracker.key, n))} disabled={!ready} palette={palette} />
        <Button label="Regain" onPress={() => apply((n) => actions.adjust(tracker.key, -n))} disabled={!ready} palette={palette} />
      </View>
      {tracker.temporary ? (
        <View style={styles.poolRow}>
          <Button label={`Set ${tracker.temporary.label}`} onPress={() => apply((n) => actions.setTemporary(tracker.key, n))} disabled={!ready} palette={palette} wide />
          {tracker.temporary.value > 0 ? <Button label="Clear" onPress={() => actions.setTemporary(tracker.key, 0)} palette={palette} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled = false,
  palette,
  wide = false,
  hint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  palette: Palette;
  wide?: boolean;
  hint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={hint ?? label}
      accessibilityState={{ disabled }}
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        wide ? styles.wide : null,
        { borderColor: palette.border, backgroundColor: palette.surface, opacity: disabled ? 0.35 : pressed ? 0.6 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, { color: palette.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  group: { gap: 8, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  h2: { fontSize: 19, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13 },
  value: { fontSize: 17, fontWeight: '600' },
  big: { fontSize: 28, fontWeight: '700' },
  tracker: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trackerText: { flex: 1, gap: 2 },
  pool: { gap: 6 },
  poolRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minWidth: 80, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 17 },
  button: { minWidth: 44, minHeight: 44, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  wide: { flexGrow: 1 },
  buttonText: { fontSize: 17, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  rests: { flexDirection: 'row', gap: 10, paddingTop: 8 },
});

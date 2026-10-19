/**
 * Choosing one element from a list on a phone: the whole screen, a search box, every option (never cut off, since
 * someone new to the game has no name to type), and each option's own text a tap away.
 *
 * What the desktop's `CandidatePicker` is, without hover: the matching and ranking are `searchCandidates`, an option's
 * label is the caller's (`candidateLabel`), and its text is `expandDescription` read into blocks by `htmlToBlocks`, as the
 * sheet reads content's HTML (ADR 0083). It computes nothing.
 */

import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ElementId, ElementIndex } from '@incudo/core';
import { expandDescription, htmlToBlocks, offerGroupLine, searchCandidates, type OfferGroup } from '@incudo/ui';

import { Button } from './controls.tsx';
import { RichText } from './RichText.tsx';
import { usePalette } from './theme.ts';

export interface PickerRequest {
  title: string;
  options: readonly ElementId[];
  onPick: (id: ElementId) => void;
  /** The option chosen now, marked in the list. */
  current?: ElementId;
  /** Labels that say more than the element's own, for some options (a class's unmet minimum). */
  labels?: ReadonlyMap<ElementId, string>;
  /** A line under some options, worded by the view-model: what one would give that the character already has. */
  notes?: ReadonlyMap<ElementId, string>;
  /** A line under an option offered all the same: what it lacks of a prerequisite the kind makes soft (ADR 0124). */
  warnings?: ReadonlyMap<ElementId, string>;
  /** False when the options are not elements (a written feature's stats), so there is no text to show. */
  details?: boolean;
  /**
   * The options in groups, shown first; choosing one shows its options, with a way back (ADR 0117: the add list's
   * categories). `options` is still the whole list.
   */
  groups?: readonly OfferGroup[];
}

export function Picker({
  request,
  elements,
  labelOf,
  onClose,
}: {
  request: PickerRequest | null;
  elements: ElementIndex;
  labelOf: (id: ElementId) => string;
  onClose: () => void;
}) {
  return (
    <Modal visible={request !== null} animationType="slide" onRequestClose={onClose}>
      {request ? <PickerBody request={request} elements={elements} labelOf={labelOf} onClose={onClose} /> : null}
    </Modal>
  );
}

function PickerBody({
  request,
  elements,
  labelOf,
  onClose,
}: {
  request: PickerRequest;
  elements: ElementIndex;
  labelOf: (id: ElementId) => string;
  onClose: () => void;
}) {
  const palette = usePalette();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ElementId | null>(null);
  const [group, setGroup] = useState<OfferGroup | null>(null);
  const shown = group?.options ?? request.options;
  const options = useMemo(
    () => shown.map((id) => ({ id, label: request.labels?.get(id) ?? labelOf(id) })),
    [shown, request.labels, labelOf],
  );

  if (request.groups?.length && group === null) {
    return (
      <SafeAreaView style={[styles.page, { backgroundColor: palette.background }]}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: palette.text }]} numberOfLines={2} accessibilityRole="header">
            {request.title}
          </Text>
          <Button label="Close" kind="link" onPress={onClose} />
        </View>
        <FlatList
          data={request.groups}
          keyExtractor={(entry) => entry.label}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.option, { borderColor: palette.border, opacity: pressed ? 0.6 : 1 }]}
              onPress={() => {
                setQuery('');
                setGroup(item);
              }}
              accessibilityRole="button"
            >
              <Text style={[styles.label, { color: palette.text }]}>{offerGroupLine(item)} ›</Text>
            </Pressable>
          )}
        />
      </SafeAreaView>
    );
  }
  const { matches } = searchCandidates(options, query);

  return (
    <SafeAreaView style={[styles.page, { backgroundColor: palette.background }]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={2} accessibilityRole="header">
          {request.title}
        </Text>
        <Button label="Close" kind="link" onPress={onClose} />
      </View>
      {group ? <Button label={`‹ All groups (${group.label})`} kind="link" onPress={() => setGroup(null)} /> : null}
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={`Search ${options.length} option${options.length === 1 ? '' : 's'}…`}
        placeholderTextColor={palette.muted}
        autoCorrect={false}
        style={[styles.search, { color: palette.text, borderColor: palette.border }]}
      />
      <FlatList
        data={matches}
        keyExtractor={(option) => String(option.id)}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={[styles.empty, { color: palette.muted }]}>No options match “{query}”.</Text>}
        renderItem={({ item }) => (
          <View style={[styles.option, { borderColor: palette.border }]}>
            <View style={styles.optionHead}>
              <Pressable
                style={({ pressed }) => [styles.choose, { opacity: pressed ? 0.6 : 1 }]}
                onPress={() => {
                  request.onPick(item.id);
                  onClose();
                }}
                accessibilityRole="button"
              >
                <Text style={[styles.label, { color: palette.text }, item.id === request.current && { fontWeight: '700' }]}>
                  {item.label}
                  {item.id === request.current ? ' (chosen)' : ''}
                </Text>
                {request.notes?.has(item.id) ? (
                  <Text style={[styles.note, { color: palette.muted }]}>{request.notes.get(item.id)}</Text>
                ) : null}
                {request.warnings?.has(item.id) ? (
                  <Text style={[styles.note, { color: palette.text }]}>{request.warnings.get(item.id)}</Text>
                ) : null}
              </Pressable>
              {request.details === false ? null : (
                <Button label={open === item.id ? 'Hide' : 'Details'} kind="link" onPress={() => setOpen(open === item.id ? null : item.id)} />
              )}
            </View>
            {open === item.id ? <Details id={item.id} elements={elements} /> : null}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

/** One element's own text, with what it embeds shown in place (ADR 0069). */
export function Details({ id, elements }: { id: ElementId; elements: ElementIndex }) {
  const palette = usePalette();
  const element = elements.get(id);
  const blocks = useMemo(() => (element?.description ? htmlToBlocks(expandDescription(element, elements)) : []), [element, elements]);
  if (!blocks.length) return <Text style={{ color: palette.muted }}>No description available.</Text>;
  return (
    <View style={styles.details}>
      <RichText blocks={blocks} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12 },
  title: { flex: 1, fontSize: 19, fontWeight: '700' },
  search: { borderWidth: 1, borderRadius: 8, marginHorizontal: 16, marginVertical: 12, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16 },
  option: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 10 },
  optionHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  choose: { flex: 1, paddingVertical: 4 },
  label: { fontSize: 16 },
  note: { fontSize: 13, paddingTop: 2 },
  empty: { padding: 16, fontSize: 15 },
  details: { paddingTop: 8 },
});

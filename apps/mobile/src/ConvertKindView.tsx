/**
 * "Change to Legendary Creature?" on a phone (ADR 0134): the desktop's `ConvertKind.tsx` as a full-screen sheet, opened
 * from the Build screen. It renders `convertUnticking` and computes nothing; every sentence is the ui package's. Cancel,
 * and the back gesture, change nothing. The button hands the converted character to the Build screen, where it is an
 * unsaved edit until Save.
 */

import { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Character, ElementId, ElementIndex, GameSystem, StatKey } from '@incudo/core';
import {
  CONVERSION_ADDITIONS_HEADING,
  CONVERSION_COPIES_HEADING,
  CONVERSION_UNSAVED_NOTE,
  conversionPrompt,
  conversionTarget,
  convertUnticking,
  copyLine,
  kindConversionTargets,
} from '@incudo/ui';

import { Body, Button, Heading, Row } from './controls.tsx';
import { usePalette } from './theme.ts';

export function ConvertKindView({
  open,
  character,
  system,
  elements,
  onConvert,
  onClose,
}: {
  open: boolean;
  character: Character;
  system: GameSystem;
  elements: ElementIndex;
  onConvert: (converted: Character) => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const targets = useMemo(() => kindConversionTargets(system, character.kind), [system, character.kind]);
  const [chosen, setTo] = useState<string | undefined>(undefined);
  const to = conversionTarget(targets, chosen);
  const [skipCopies, setSkipCopies] = useState<StatKey[]>([]);
  const [skipAdditions, setSkipAdditions] = useState<ElementId[]>([]);
  useEffect(() => {
    if (!open) return;
    setTo(targets[0]?.id);
    setSkipCopies([]);
    setSkipAdditions([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const conversion = useMemo(
    () => (open && to ? convertUnticking(character, system, to, elements, { copies: skipCopies, additions: skipAdditions }) : undefined),
    [open, to, character, system, elements, skipCopies, skipAdditions],
  );
  const prompt = conversion ? conversionPrompt(conversion, character.name) : undefined;
  const toggle = <T,>(list: T[], item: T, ticked: boolean): T[] => (ticked ? list.filter((x) => x !== item) : [...list, item]);

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.page, { backgroundColor: palette.background }]}>
        {conversion && prompt ? (
          <ScrollView contentContainerStyle={styles.content}>
            <Heading>{prompt.title}</Heading>
            {targets.length > 1 ? (
              <Row>
                {targets.map((target) => (
                  <Button key={target.id} label={target.name} kind={target.id === to ? 'primary' : 'plain'} onPress={() => setTo(target.id)} />
                ))}
              </Row>
            ) : null}
            <Body>{prompt.lead}</Body>
            {conversion.lost.map((group) => (
              <View key={group.heading} style={styles.group}>
                <Text style={[styles.heading, { color: palette.text }]}>{group.heading}</Text>
                {group.lines.map((line, i) => (
                  <Body key={i} tone="muted">
                    {line}
                  </Body>
                ))}
              </View>
            ))}
            {conversion.copies.length ? (
              <View style={styles.group}>
                <Text style={[styles.heading, { color: palette.text }]}>{CONVERSION_COPIES_HEADING}</Text>
                {conversion.copies.map((copy) => (
                  <Row key={copy.stat}>
                    <Text style={[styles.option, { color: palette.text }]}>{copyLine(copy)}</Text>
                    <Switch value={copy.copied} onValueChange={(on) => setSkipCopies((list) => toggle(list, copy.stat, on))} accessibilityLabel={copy.label} />
                  </Row>
                ))}
              </View>
            ) : null}
            {conversion.additions.length ? (
              <View style={styles.group}>
                <Text style={[styles.heading, { color: palette.text }]}>{CONVERSION_ADDITIONS_HEADING}</Text>
                {conversion.additions.map((addition) => (
                  <Row key={addition.elementId}>
                    <Text style={[styles.option, { color: palette.text }]}>
                      {addition.name} ({addition.from})
                    </Text>
                    <Switch
                      value={addition.added}
                      onValueChange={(on) => setSkipAdditions((list) => toggle(list, addition.elementId, on))}
                      accessibilityLabel={addition.name}
                    />
                  </Row>
                ))}
              </View>
            ) : null}
            {conversion.changed.length ? (
              <View style={styles.group}>
                <Text style={[styles.heading, { color: palette.text }]}>Changed</Text>
                {conversion.changed.map((line, i) => (
                  <Body key={i} tone="muted">
                    {line}
                  </Body>
                ))}
              </View>
            ) : null}
            <Body tone="muted">{CONVERSION_UNSAVED_NOTE}</Body>
            <Row>
              <Button label={prompt.confirm} kind="primary" onPress={() => onConvert(conversion.character)} />
              <Button label="Cancel" onPress={onClose} />
            </Row>
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 16, gap: 10 },
  group: { gap: 4 },
  heading: { fontSize: 15, fontWeight: '600' },
  option: { flex: 1, fontSize: 15 },
});

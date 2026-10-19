/**
 * The sets a system asks when a character is started (ADR 0123), on a phone: campaign options, which shape what everything
 * after them offers. Opened by a new character's Build screen once its content has loaded, ticked as the step's `initial`
 * wrote it, and again from the options' line among the choices made. The desktop's `StartOptions.tsx`, as a full-screen
 * sheet: it renders `BuilderState.startOptions`, every sentence is `build-view.ts`'s, and its button writes each set whole
 * through `chooseAtStart`. Cancel, and the back gesture, change nothing.
 */

import { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ElementId } from '@incudo/core';
import {
  START_OPTIONS_BEGIN,
  START_OPTIONS_HINT,
  START_OPTIONS_SAVE,
  type CharacterBuilder,
  type StartOptionsQuestion,
} from '@incudo/ui';

import { Body, Button, Heading, Row } from './controls.tsx';
import { usePalette } from './theme.ts';

export function StartOptionsView({
  open,
  beginning,
  questions,
  builder,
  labelOf,
  onClose,
}: {
  open: boolean;
  /** Opened for a new character, so its button starts the build rather than closing an edit. */
  beginning: boolean;
  questions: readonly StartOptionsQuestion[];
  builder: CharacterBuilder;
  labelOf: (id: ElementId) => string;
  onClose: () => void;
}) {
  const palette = usePalette();
  const [draft, setDraft] = useState<Record<string, ElementId[]>>({});
  useEffect(() => {
    // Read once as it opens: a repaint behind it must not untick what the user ticked.
    if (open) setDraft(Object.fromEntries(questions.map((question) => [question.stepId, [...question.chosen]])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (stepId: string, id: ElementId, chosen: boolean): void =>
    setDraft((current) => {
      const held = (current[stepId] ?? []).filter((other) => other !== id);
      return { ...current, [stepId]: chosen ? [...held, id] : held };
    });

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.page, { backgroundColor: palette.background }]}>
        <ScrollView contentContainerStyle={styles.content}>
          {questions.map((question) => (
            <View key={question.stepId} style={styles.question}>
              <Heading>{question.label}</Heading>
              {question.description ? <Body tone="muted">{question.description}</Body> : null}
              {question.candidates.map((id) => (
                <Row key={id}>
                  <Text style={[styles.option, { color: palette.text }]}>{labelOf(id)}</Text>
                  <Switch
                    value={(draft[question.stepId] ?? []).includes(id)}
                    onValueChange={(chosen) => toggle(question.stepId, id, chosen)}
                    accessibilityLabel={labelOf(id)}
                  />
                </Row>
              ))}
            </View>
          ))}
          <Body tone="muted">{START_OPTIONS_HINT}</Body>
          <Row>
            <Button
              label={beginning ? START_OPTIONS_BEGIN : START_OPTIONS_SAVE}
              kind="primary"
              onPress={() => {
                for (const question of questions) builder.chooseAtStart(question.stepId, draft[question.stepId] ?? []);
                onClose();
              }}
            />
            <Button label="Cancel" onPress={onClose} />
          </Row>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 16, gap: 10 },
  question: { gap: 6 },
  option: { flex: 1, fontSize: 15 },
});

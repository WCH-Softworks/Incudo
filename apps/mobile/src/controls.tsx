/**
 * The few controls the phone's build screens share: a button, a section heading, a tag, a line of small text. Layout
 * only; what any of them says is handed to it.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { usePalette } from './theme.ts';

export function Button({
  label,
  onPress,
  disabled,
  kind = 'plain',
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** `primary` filled, `plain` outlined, `link` text only. */
  kind?: 'primary' | 'plain' | 'link';
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  const filled = kind === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={kind === 'link' ? 8 : 0}
      style={({ pressed }) => [
        kind === 'link' ? styles.link : styles.button,
        kind === 'plain' && { borderColor: palette.accent, borderWidth: 1 },
        filled && { backgroundColor: palette.accent },
        { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        style,
      ]}
    >
      <Text style={[styles.buttonText, { color: filled ? palette.background : palette.accent }]}>{label}</Text>
    </Pressable>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  const palette = usePalette();
  return (
    <Text style={[styles.heading, { color: palette.text }]} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Body({ children, tone = 'text' }: { children: ReactNode; tone?: 'text' | 'muted' | 'danger' }) {
  const palette = usePalette();
  return <Text style={[styles.body, { color: palette[tone] }]}>{children}</Text>;
}

export function Tag({ label }: { label: string }) {
  const palette = usePalette();
  return (
    <View style={[styles.tag, { borderColor: palette.border }]}>
      <Text style={[styles.tagText, { color: palette.muted }]}>{label}</Text>
    </View>
  );
}

/** A card: something on screen that is one thing, a decision or a source. */
export function Card({ children }: { children: ReactNode }) {
  const palette = usePalette();
  return <View style={[styles.card, { backgroundColor: palette.surface }]}>{children}</View>;
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export const styles = StyleSheet.create({
  button: { borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center' },
  link: { paddingVertical: 4 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  heading: { fontSize: 19, fontWeight: '700', marginTop: 8 },
  body: { fontSize: 15, lineHeight: 21 },
  tag: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 },
  tagText: { fontSize: 12 },
  card: { borderRadius: 8, padding: 12, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
});

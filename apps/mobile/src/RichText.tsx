/**
 * Draws content's text from `htmlToBlocks` (`packages/ui`) — ADR 0083. Computes nothing: what is a paragraph, a list
 * item or a table cell, and what is bold, was decided there, the same way the text export decides it.
 */

import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { TextBlock, TextRun } from '@incudo/ui';

import { usePalette } from './theme.ts';

export function Runs({ runs }: { runs: readonly TextRun[] }) {
  const palette = usePalette();
  return (
    <>
      {runs.map((run, at) => (
        <Text
          key={at}
          style={[
            run.bold ? styles.bold : null,
            run.italic ? styles.italic : null,
            run.href ? { color: palette.accent, textDecorationLine: 'underline' } : null,
          ]}
          {...(run.href ? { onPress: () => void Linking.openURL(run.href!), accessibilityRole: 'link' as const } : {})}
        >
          {run.text}
        </Text>
      ))}
    </>
  );
}

export function RichText({ blocks }: { blocks: readonly TextBlock[] }) {
  const palette = usePalette();
  const text = { color: palette.text };
  return (
    <View style={styles.blocks}>
      {blocks.map((block, at) => {
        switch (block.kind) {
          case 'paragraph':
            return (
              <Text key={at} style={[styles.body, text]} selectable>
                {block.lines.map((line, n) => (
                  <Text key={n}>
                    {n > 0 ? '\n' : ''}
                    <Runs runs={line} />
                  </Text>
                ))}
              </Text>
            );
          case 'heading':
            return (
              <Text key={at} style={[styles.heading, text, block.level >= 5 ? styles.minorHeading : null]} accessibilityRole="header">
                <Runs runs={block.runs} />
              </Text>
            );
          case 'list':
            return (
              <View key={at}>
                {block.items.map((item, n) => (
                  <View key={n} style={[styles.item, { paddingLeft: 16 * item.depth }]}>
                    <Text style={[styles.body, text, styles.marker]}>{item.marker === '-' ? '•' : item.marker}</Text>
                    <Text style={[styles.body, text, styles.itemText]} selectable>
                      <Runs runs={item.runs} />
                    </Text>
                  </View>
                ))}
              </View>
            );
          case 'table':
            return (
              <ScrollView key={at} horizontal style={[styles.table, { borderColor: palette.border }]}>
                <View>
                  {block.rows.map((row, r) => (
                    <View key={r} style={[styles.row, r === 0 ? { backgroundColor: palette.surface } : null]}>
                      {row.map((cell, c) => (
                        <Text key={c} style={[styles.cell, text, r === 0 ? styles.bold : null]}>
                          <Runs runs={cell} />
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            );
          case 'rule':
            return <View key={at} style={[styles.rule, { backgroundColor: palette.border }]} />;
          case 'quote':
            return (
              <View key={at} style={[styles.quote, { borderColor: palette.border }]}>
                <RichText blocks={block.blocks} />
              </View>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  blocks: { gap: 8 },
  body: { fontSize: 15, lineHeight: 21 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  heading: { fontSize: 16, fontWeight: '700', marginTop: 4 },
  minorHeading: { fontSize: 14, textTransform: 'uppercase' },
  item: { flexDirection: 'row', gap: 6 },
  marker: { minWidth: 18 },
  itemText: { flex: 1 },
  table: { borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row' },
  cell: { minWidth: 56, maxWidth: 220, paddingHorizontal: 6, paddingVertical: 4, fontSize: 14 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  quote: { borderLeftWidth: 3, paddingLeft: 10 },
});

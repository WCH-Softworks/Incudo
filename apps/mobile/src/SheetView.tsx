/**
 * The sheet document (`packages/ui/src/sheet-document.ts`) drawn for a phone — ADR 0083.
 *
 * Another renderer of the one document, as ADR 0075 meant a print layout or a PDF to be: the Sheet pane, the text export
 * and this read the same value, and every sentence and every wording of a row or a listed element comes from the
 * document's own helpers (`rowAside`, `attackAside`, `listedName`, `listedAside`, `listedUsage`, `PREREQUISITES_UNMET`). Content's
 * HTML is read by `htmlToBlocks`/`htmlToRuns`, never shown as markup. This computes nothing but layout.
 */

import { StyleSheet, Text, View } from 'react-native';

import {
  htmlToBlocks,
  htmlToRuns,
  listedAside,
  listedName,
  listedUsage,
  PREREQUISITES_UNMET,
  rowAside,
  attackAside,
  attackWarnings,
  bagEntryAside,
  bagEntryName,
  MONEY_LABEL,
  purseText,
  type SheetDocument,
  type SheetListedElement,
  type SheetSectionView,
} from '@incudo/ui';

import { RichText, Runs } from './RichText.tsx';
import { usePalette, type Palette } from './theme.ts';

export function SheetView({ document }: { document: SheetDocument }) {
  const palette = usePalette();
  return (
    <View style={styles.page}>
      <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
        {document.title}
      </Text>
      <Text style={[styles.lede, { color: palette.muted }]}>{document.kindName}</Text>

      {document.sections.map((section) => (
        <Section key={section.id} section={section} level={2} palette={palette} />
      ))}

      {document.companions ? (
        <View style={styles.part}>
          <Heading text={document.companions.label} level={2} palette={palette} />
          {document.companions.description ? <Muted text={document.companions.description} palette={palette} /> : null}
          {document.companions.creatures.map((creature) => (
            <View key={creature.elementId} style={styles.creature}>
              <Heading text={creature.source ? `${creature.name} · ${creature.source}` : creature.name} level={3} palette={palette} />
              {creature.from ? <Muted text={creature.from} palette={palette} /> : null}
              {creature.notes.map((note, at) => (
                <Muted key={at} text={note} palette={palette} />
              ))}
              {creature.sections.map((section) => (
                <Section key={section.id} section={section} level={4} palette={palette} />
              ))}
            </View>
          ))}
        </View>
      ) : null}

      {/* What the user wrote about the character (ADR 0092): after the creatures, before what it keeps. */}
      {document.freeform ? (
        <View style={styles.part}>
          <Heading text={document.freeform.label} level={2} palette={palette} />
          {document.freeform.groups.map((group, at) => (
            <View key={group.label ?? at} style={[styles.section, { borderColor: palette.border }]}>
              {group.label !== undefined ? <Heading text={group.label} level={3} palette={palette} /> : null}
              {group.entries.map((entry) =>
                entry.multiline ? (
                  <View key={entry.key} style={styles.listed}>
                    <Text style={[styles.body, styles.bold, { color: palette.text }]}>{entry.label}</Text>
                    <Text style={[styles.body, { color: palette.text }]} selectable>
                      {entry.text}
                    </Text>
                  </View>
                ) : (
                  <Text key={entry.key} style={[styles.body, { color: palette.text }]} selectable>
                    <Text style={styles.bold}>{entry.label}: </Text>
                    {entry.text}
                  </Text>
                ),
              )}
            </View>
          ))}
        </View>
      ) : null}

      {document.descriptions ? (
        <View style={styles.part}>
          <Heading text={document.descriptions.label} level={2} palette={palette} />
          {document.descriptions.groups.map((group) => (
            <View key={group.label}>
              <Heading text={group.label} level={3} palette={palette} />
              {group.entries.map((entry) => (
                <View key={entry.elementId} style={styles.reference}>
                  <Heading text={entry.name} level={4} palette={palette} />
                  <RichText blocks={htmlToBlocks(entry.html, { headingLevel: 5 })} />
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}

      {document.references ? (
        <View style={styles.part}>
          <Heading text={document.references.label} level={2} palette={palette} />
          {document.references.entries.map((entry) => (
            <View key={entry.elementId} style={styles.reference}>
              <Heading text={entry.source ? `${entry.name} · ${entry.source}` : entry.name} level={3} palette={palette} />
              {entry.html ? <RichText blocks={htmlToBlocks(entry.html)} /> : entry.note ? <Muted text={entry.note} palette={palette} /> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Section({ section, level, palette }: { section: SheetSectionView; level: number; palette: Palette }) {
  const text = { color: palette.text };
  return (
    <View style={[styles.section, { borderColor: palette.border }]}>
      <Heading text={section.label} level={level} palette={palette} />
      {section.description ? <Muted text={section.description} palette={palette} /> : null}
      {section.rows.map((row) => {
        const aside = rowAside(row);
        return (
          <View key={row.stat} style={styles.row}>
            <Text style={[styles.rowLabel, text]}>{row.label}</Text>
            <Text style={[styles.rowValue, text]} selectable>
              {row.value}
              {aside !== undefined ? <Text style={{ color: palette.muted }}>{` (${aside})`}</Text> : null}
            </Text>
          </View>
        );
      })}
      {(section.attacks ?? []).map((attack, index) => (
        <Text key={attack.instanceId ?? attack.elementId ?? `row-${index}`} style={[styles.body, text]} selectable>
          <Text style={styles.bold}>{attack.name}</Text>
          {`: ${attack.bonus}, ${attack.damage}`}
          {attackAside(attack) !== undefined ? <Text style={{ color: palette.muted }}>{` (${attackAside(attack)})`}</Text> : null}
          {attackWarnings(attack).map((warning) => (
            <Text key={warning} style={{ color: palette.danger }}>{` ${warning}.`}</Text>
          ))}
        </Text>
      ))}
      {section.elements.map((element) => (
        <Listed key={element.elementId} element={element} palette={palette} />
      ))}
      {(section.bag ?? []).map((entry) => (
        <Text key={entry.instanceId} style={[styles.body, text]} selectable>
          {bagEntryName(entry)}
          {bagEntryAside(entry) !== undefined ? <Text style={{ color: palette.muted }}>{` (${bagEntryAside(entry)})`}</Text> : null}
        </Text>
      ))}
      {section.purse ? (
        <View style={styles.row}>
          <Text style={[styles.rowLabel, text]}>{MONEY_LABEL}</Text>
          <Text style={[styles.rowValue, text]} selectable>
            {purseText(section.purse)}
          </Text>
        </View>
      ) : null}
      {section.printed.map((line, at) => (
        <Text key={`${line.elementId}-${at}`} style={[styles.body, text]} selectable>
          <Text style={styles.bold}>{line.label}: </Text>
          {line.text}
        </Text>
      ))}
    </View>
  );
}

/** A listed element: its head as `listedHead` words it, and its sheet text one line per line content wrote. */
function Listed({ element, palette }: { element: SheetListedElement; palette: Palette }) {
  const aside = listedAside(element);
  const usage = listedUsage(element);
  const lines = (element.text ?? '').split('\n').map(htmlToRuns).filter((runs) => runs.length);
  const emphasised = usage !== undefined || lines.length > 0;
  return (
    <View style={styles.listed}>
      <Text style={[styles.body, { color: palette.text }]} selectable>
        <Text style={emphasised ? styles.bold : null}>{listedName(element)}</Text>
        {aside !== undefined ? ` (${aside})` : ''}
        {element.prerequisitesUnmet ? <Text style={{ color: palette.danger }}>{` (${PREREQUISITES_UNMET})`}</Text> : null}
        {usage !== undefined ? <Text style={{ color: palette.muted }}>{` (${usage})`}</Text> : null}
      </Text>
      {lines.map((runs, at) => (
        <Text key={at} style={[styles.body, styles.listedText, { color: palette.text }]} selectable>
          <Runs runs={runs} />
        </Text>
      ))}
      {element.note !== undefined ? (
        <Text style={[styles.body, styles.listedText, { color: palette.muted }]} selectable>
          {element.note}
        </Text>
      ) : null}
    </View>
  );
}

function Heading({ text, level, palette }: { text: string; level: number; palette: Palette }) {
  return (
    <Text style={[level <= 2 ? styles.h2 : level === 3 ? styles.h3 : styles.h4, { color: palette.text }]} accessibilityRole="header">
      {text}
    </Text>
  );
}

function Muted({ text, palette }: { text: string; palette: Palette }) {
  return <Text style={[styles.body, { color: palette.muted }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  title: { fontSize: 26, fontWeight: '700' },
  lede: { fontSize: 15, marginTop: -8 },
  part: { gap: 10 },
  section: { gap: 6, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  creature: { gap: 8 },
  reference: { gap: 8 },
  h2: { fontSize: 19, fontWeight: '700' },
  h3: { fontSize: 17, fontWeight: '700' },
  h4: { fontSize: 15, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  bold: { fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowLabel: { fontSize: 15, flexShrink: 1 },
  rowValue: { fontSize: 15, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  listed: { gap: 2 },
  listedText: { paddingLeft: 12 },
});

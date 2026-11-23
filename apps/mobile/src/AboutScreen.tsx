/**
 * About Incudo on the phone — ADR 0132, decision 8. The desktop's About section (Settings) in a screen of its own: what
 * Incudo is, its version, where its code is, the notice each shipped system's licence asks for, word for word
 * (`systemAttributions`, docs/LICENSING.md), what it does with data, and the one support link the phone shows.
 *
 * Reached from the Characters screen's foot, never from a screen that shows content, a character or a sheet (ADR 0010).
 * Every sentence is `packages/ui/src/about.ts`'s; this computes nothing.
 */

import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ABOUT_SUMMARY,
  PHONE_SUPPORT_LINKS,
  PRIVACY_LINK,
  PRIVACY_TEXT,
  SOURCE_LINK,
  SUPPORT_TEXT,
  SYSTEM_ATTRIBUTIONS_HEADING,
  SYSTEM_ATTRIBUTIONS_TEXT,
  aboutVersionLine,
  systemAttributions,
  type AboutLink,
} from '@incudo/ui';

import appConfig from '../app.json';
import { Body, Heading, styles as shared } from './controls.tsx';
import { usePlatform } from './context.ts';
import { usePalette } from './theme.ts';

export function AboutScreen() {
  const { systems } = usePlatform();
  const palette = usePalette();
  const attributions = systemAttributions(systems);

  const link = (target: AboutLink) => (
    <View key={target.url} style={styles.link}>
      <Text style={[shared.body, { color: palette.muted }]}>{target.label}</Text>
      <Text
        style={[shared.body, { color: palette.accent }]}
        accessibilityRole="link"
        onPress={() => void Linking.openURL(target.url)}
      >
        {target.text}
      </Text>
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.page}>
      <Heading>Incudo</Heading>
      <Body tone="muted">{aboutVersionLine(appConfig.expo.version)}</Body>
      <Body>{ABOUT_SUMMARY}</Body>
      {link(SOURCE_LINK)}

      {attributions.length ? (
        <View style={styles.section}>
          <Heading>{SYSTEM_ATTRIBUTIONS_HEADING}</Heading>
          <Body tone="muted">{SYSTEM_ATTRIBUTIONS_TEXT}</Body>
          {attributions.map((attribution) => (
            <View key={attribution.system} style={styles.attribution}>
              <Text style={[shared.body, styles.system, { color: palette.text }]}>{attribution.system}</Text>
              <Body>{attribution.text}</Body>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Heading>{PRIVACY_LINK.label}</Heading>
        <Body>{PRIVACY_TEXT}</Body>
        {link(PRIVACY_LINK)}
      </View>

      {PHONE_SUPPORT_LINKS.length ? (
        <View style={styles.section}>
          <Heading>Support</Heading>
          <Body>{SUPPORT_TEXT}</Body>
          {PHONE_SUPPORT_LINKS.map(link)}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  section: { gap: 8, marginTop: 12 },
  link: { gap: 2 },
  attribution: { gap: 4 },
  system: { fontWeight: '600' },
});

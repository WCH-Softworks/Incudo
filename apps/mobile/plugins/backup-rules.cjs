/**
 * What Android's backup takes of the app: the character library and the settings, never a source — ADR 0132,
 * decision 5.
 *
 * Expo writes `android:allowBackup="true"` and no rules, so Auto Backup would take the whole app folder: the converted
 * sources too (about 20 MB for AuroraLegacy, ADR 0085), against a 25 MB quota past which nothing at all is backed up. A
 * source is fetched again; a character is not. With `include` rules Android backs up only what is named, so the sources,
 * the cache and anything a library writes elsewhere stay out.
 *
 * - `library/` is `Paths.document` + `library` (`platform.ts`): the characters and the feature library (ADR 0106).
 * - `SQLite/` is where `expo-sqlite` keeps `incudo.db`: the source profile and the preferences (ADR 0083). Content's own
 *   cache is not there since ADR 0119 (`sources/`, a folder of files).
 *
 * Two files, because Android reads one or the other: `dataExtractionRules` from API 31 (cloud backup and device-to-device
 * transfer alike), `fullBackupContent` below it. `tools/verify/src/mobile-release.test.ts` holds both to the same list.
 */

const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

/** The folders backed up, under the app's files directory. Nothing else is. */
const INCLUDED = ['library/', 'SQLite/'];

const includes = (indent) => INCLUDED.map((folder) => `${indent}<include domain="file" path="${folder}" />`).join('\n');

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by apps/mobile/plugins/backup-rules.cjs (ADR 0132). -->
<data-extraction-rules>
  <cloud-backup>
${includes('    ')}
  </cloud-backup>
  <device-transfer>
${includes('    ')}
  </device-transfer>
</data-extraction-rules>
`;

const FULL_BACKUP_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by apps/mobile/plugins/backup-rules.cjs (ADR 0132). -->
<full-backup-content>
${includes('  ')}
</full-backup-content>
`;

function withBackupRules(config) {
  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const folder = path.join(modConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'incudo_data_extraction_rules.xml'), DATA_EXTRACTION_RULES);
      fs.writeFileSync(path.join(folder, 'incudo_backup_rules.xml'), FULL_BACKUP_CONTENT);
      return modConfig;
    },
  ]);
  return withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (!application) throw new Error('backup-rules: the manifest has no <application>');
    application.$['android:allowBackup'] = 'true';
    application.$['android:dataExtractionRules'] = '@xml/incudo_data_extraction_rules';
    application.$['android:fullBackupContent'] = '@xml/incudo_backup_rules';
    return modConfig;
  });
}

module.exports = withBackupRules;
module.exports.INCLUDED = INCLUDED;
module.exports.DATA_EXTRACTION_RULES = DATA_EXTRACTION_RULES;
module.exports.FULL_BACKUP_CONTENT = FULL_BACKUP_CONTENT;

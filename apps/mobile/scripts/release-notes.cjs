/**
 * The release notes a tag's upload carries — ADR 0135, decisions 2 and 7.
 *
 * fastlane reads them from `play/metadata/<language>/changelogs/<version code>.txt` and, finding none, uploads an empty
 * text without a word. So the release workflow runs this before anything is built: the tag's file must exist in every
 * language folder, hold some text, and fit Play's limit of 500 characters. `tools/verify/src/mobile-release.test.ts`
 * holds every committed file to the same limit.
 *
 * Run from anywhere with a tag: `node apps/mobile/scripts/release-notes.cjs mobile-v1.0.1-rc.1`.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseTag, versionCode } = require('./release-version.cjs');

/** Play's limit on one language's release notes. */
const LIMIT = 500;

const METADATA = path.join(__dirname, '..', 'play', 'metadata');

/** Every language folder under the metadata. */
function languages(metadata = METADATA) {
  return fs
    .readdirSync(metadata, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

/** Sentences for what is wrong with one notes text; empty when it is fine. */
function noteProblems(text, where) {
  const trimmed = text.trim();
  if (trimmed === '') return [`${where} is empty`];
  // Play counts characters, not bytes; a string's length counts UTF-16 units, so count code points.
  const length = [...trimmed].length;
  if (length > LIMIT) return [`${where} is ${length} characters, and Play takes ${LIMIT}`];
  return [];
}

/** Sentences for what keeps a tag's notes from uploading; empty when they will. */
function tagProblems(tag, metadata = METADATA) {
  const { version, candidate } = parseTag(tag);
  const code = versionCode(version, candidate);
  const found = languages(metadata);
  if (found.length === 0) return [`No language folder under ${path.relative(process.cwd(), metadata)}`];
  const out = [];
  for (const language of found) {
    const file = path.join(metadata, language, 'changelogs', `${code}.txt`);
    const where = path.relative(process.cwd(), file);
    if (!fs.existsSync(file)) out.push(`${where} is missing: write the release notes for ${tag} there`);
    else out.push(...noteProblems(fs.readFileSync(file, 'utf8'), where));
  }
  return out;
}

module.exports = { LIMIT, METADATA, languages, noteProblems, tagProblems };

if (require.main === module) {
  try {
    const found = tagProblems(process.argv[2] ?? '');
    for (const line of found) process.stdout.write(`::error::${line}\n`);
    process.exit(found.length === 0 ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

/**
 * The release notes a tag's upload carries, and the store listing's text — ADR 0135, decisions 2 and 7.
 *
 * fastlane reads the notes from `play/metadata/<language>/changelogs/<version code>.txt` and, finding none, uploads an
 * empty text without a word. So the release workflow runs this before anything is built: the tag's file must exist in
 * every language folder, hold some text, and fit Play's limit of 500 characters. `tools/verify/src/mobile-release.test.ts`
 * holds every committed file to the same limit.
 *
 * The listing's text sits beside them, `play/metadata/<language>/{title,short_description,full_description}.txt`, and
 * `--listing` holds it to Play's limits: 30, 80 and 4000 characters, none empty. A listing is uploaded only when a run is
 * asked to (the `listing` input of the release and promote workflows), and that run checks it first; the test holds the
 * committed files to the same limits.
 *
 * Run from anywhere with a tag, `node apps/mobile/scripts/release-notes.cjs mobile-v1.0.1-rc.1`, or with `--listing`.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseTag, versionCode } = require('./release-version.cjs');

/** Play's limit on one language's release notes. */
const LIMIT = 500;

/** Play's limits on one language's listing text, by the file fastlane reads it from. */
const LISTING_LIMITS = { title: 30, short_description: 80, full_description: 4000 };

const METADATA = path.join(__dirname, '..', 'play', 'metadata');

/** Every language folder under the metadata. */
function languages(metadata = METADATA) {
  return fs
    .readdirSync(metadata, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

/** Sentences for what is wrong with one text Play limits; empty when it is fine. */
function textProblems(text, where, limit) {
  const trimmed = text.trim();
  if (trimmed === '') return [`${where} is empty`];
  // Play counts characters, not bytes; a string's length counts UTF-16 units, so count code points.
  const length = [...trimmed].length;
  if (length > limit) return [`${where} is ${length} characters, and Play takes ${limit}`];
  return [];
}

/** Sentences for what is wrong with one notes text; empty when it is fine. */
function noteProblems(text, where) {
  return textProblems(text, where, LIMIT);
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

/** Sentences for what keeps the listing's text from uploading; empty when it will. */
function listingProblems(metadata = METADATA) {
  const found = languages(metadata);
  if (found.length === 0) return [`No language folder under ${path.relative(process.cwd(), metadata)}`];
  const out = [];
  for (const language of found) {
    for (const [name, limit] of Object.entries(LISTING_LIMITS)) {
      const file = path.join(metadata, language, `${name}.txt`);
      const where = path.relative(process.cwd(), file);
      if (!fs.existsSync(file)) out.push(`${where} is missing: the listing needs it`);
      else out.push(...textProblems(fs.readFileSync(file, 'utf8'), where, limit));
    }
  }
  return out;
}

module.exports = { LIMIT, LISTING_LIMITS, METADATA, languages, noteProblems, listingProblems, tagProblems };

if (require.main === module) {
  try {
    const arg = process.argv[2] ?? '';
    const found = arg === '--listing' ? listingProblems() : tagProblems(arg);
    for (const line of found) process.stdout.write(`::error::${line}\n`);
    process.exit(found.length === 0 ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

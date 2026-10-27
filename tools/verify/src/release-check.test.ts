/**
 * The drive half of docs/RELEASE-CHECK.md: an installed release candidate, driven through the written check step for step.
 *
 * It runs only when `INCUDO_INSTALLED_APP` names an installed `incudo-desktop.exe` (in `.env.local`, never committed);
 * unset it skips and says how to run it, and named and missing it fails (`real-data.ts`). It never runs in CI: a runner
 * has no installed build and no screen. The first test, which reads the written check itself, always runs.
 *
 * The app is started on a scratch WebView2 profile and a scratch library in a new folder under the system's temporary
 * folder, with the debug port open. The page is driven over that port (`release-drive/cdp.ts`); the native file
 * dialogs and the menu by window messages (`release-drive/win32.ps1`), so no keyboard, mouse or focus is needed. Numbers
 * are read by what they are (a text export's row label, a source line's words), never by where they sit on screen, so
 * the check survives the Sheet being laid out again. The steps and the expected readings are read from the written
 * check (`release-drive/check-doc.ts`), and `report.md` in the run folder says what each step saw.
 */

import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { release, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { absentCommands, menuModel } from '@incudo/ui';

import { RECORDED_BUDGET } from './corpus.ts';
import { repoRoot } from './node-system.ts';
import { installedAppSkip, requireInstalledApp } from './real-data.ts';
import { Page, waitForTarget } from './release-drive/cdp.ts';
import { exportedRows, readReleaseCheck, type CheckStep } from './release-drive/check-doc.ts';
import { samplePath, samplesWhere } from './sample-saves.ts';

type Diagnostic = { diagnostic(message: string): void };

test('the written release check names its steps, who checks each, and the readings the drive holds it to', () => {
  const doc = readReleaseCheck();
  const titles = doc.steps.map((step) => step.title.toLowerCase());
  // The shape ROADMAP Phase 9 gives the check, in its order.
  const wanted = ['install', 'first launch', 'choose a system', 'suggested source', 'build', 'save', 'export', 'print',
    'reopen', 'import', 'browse', 'menus', 'switching system', 'uninstall'];
  let at = -1;
  for (const word of wanted) {
    const found = titles.findIndex((title, index) => index > at && title.includes(word));
    assert.ok(found > at, `the written check has no step about "${word}" after step ${at + 1}`);
    at = found;
  }
  assert.deepEqual(doc.steps.map((step) => step.number), doc.steps.map((_, index) => index + 1), 'steps are numbered 1, 2, 3…');
  for (const step of ['install', 'uninstall']) {
    assert.equal(doc.steps.find((s) => s.title.toLowerCase() === step)?.by, 'person only', `${step} is the person's`);
  }
  assert.ok(doc.readings.length >= 8, 'the readings table holds the built character\'s numbers');
  for (const label of ['Armor Class', 'Hit Points', 'Speed', 'Spell Save DC']) {
    assert.ok(doc.readings.some((reading) => reading.label === label), `the readings table reads ${label}`);
  }
  assert.equal(new Set(doc.readings.map((reading) => reading.character)).size, 1, 'one built character');
});

test('an exported sheet is read by its rows\' labels', () => {
  const rows = exportedRows('# Name\n\n## Combat\n\n- Armor Class: 12\n- **Fire Bolt**: +4, — (range 120 feet)\n\n### Owl\n\n- Armor Class: 11\n');
  assert.equal(rows.get('Armor Class'), '12', 'the character\'s row, not its creature\'s');
  assert.equal(rows.get('Fire Bolt'), '+4, — (range 120 feet)');
});

// --- the drive ---------------------------------------------------------------------------------

/** What the page needs for every step, installed after each load of the page. */
const PAGE_HELPERS = String.raw`
window.H = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  async until(fn, ms, what) {
    const end = Date.now() + ms;
    for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out waiting for ' + what); await H.sleep(200); }
  },
  buttons: () => [...document.querySelectorAll('button')],
  btn: (t) => H.buttons().find((b) => b.textContent.startsWith(t)),
  async press(t) { const b = H.btn(t); if (!b) throw new Error('no button "' + t + '" among: ' + H.buttons().map((b) => b.textContent).slice(0, 30).join(' | ')); b.click(); await H.sleep(700); },
  main: () => document.querySelector('main')?.innerText ?? '',
  header: () => document.querySelector('header')?.innerText.replace(/\n/g, ' ') ?? '',
  dialog: () => document.querySelector('dialog[open]'),
  open: () => [...document.querySelectorAll('ul.decisions > li')].map((l) => ({ label: l.querySelector('.label')?.textContent ?? '?', tag: l.querySelector('.tag')?.textContent ?? '' })),
  card: (label) => [...document.querySelectorAll('ul.decisions > li')].find((l) => l.querySelector('.label')?.textContent.startsWith(label)),
  async pick(label, text) {
    const li = H.card(label); if (!li) throw new Error('no decision "' + label + '" among: ' + H.open().map((o) => o.label).join(' | '));
    const rows = [...li.querySelectorAll('button.picker-choose')];
    const b = text ? rows.find((r) => r.textContent.startsWith(text)) : rows[0];
    if (!b) throw new Error('"' + label + '" offers no "' + text + '": ' + rows.slice(0, 6).map((r) => r.textContent).join(' | '));
    const name = b.textContent; b.click(); await H.sleep(700); return name;
  },
  setInput(el, v) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true }));
  },
  leaf: (text) => [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === text),
  libraryCard(name) { let c = H.leaf(name); for (let i = 0; i < 6 && c && !c.querySelector('button'); i++) c = c.parentElement; return c; },
  enabled: () => [...document.querySelectorAll('main label')].find((l) => l.textContent.trim() === 'Enabled')?.querySelector('input'),
};
return 'ok';
`;

interface StepResult {
  passed: boolean;
  saw: string[];
}

class Failure extends Error {}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

const WIN32 = join(repoRoot(), 'tools', 'verify', 'src', 'release-drive', 'win32.ps1');

function win32(args: string[]): unknown {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-File', WIN32, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  return JSON.parse(out.trim());
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitForFile(path: string, timeout = 20_000): Promise<void> {
  const until = Date.now() + timeout;
  while (!existsSync(path)) {
    if (Date.now() > until) throw new Failure(`${basename(path)} was not written in ${timeout / 1000} s`);
    await sleep(250);
  }
  await sleep(500);
}

/** Pages a PDF writes, read off its page objects; `undefined` when they sit in compressed object streams. */
function pdfPages(bytes: Buffer): number | undefined {
  const count = (bytes.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  return count || undefined;
}

/** The PDF's words through `pdftotext` when it is on the path, else `undefined`. */
function pdfText(path: string): string | undefined {
  try {
    return execFileSync('pdftotext', ['-enc', 'UTF-8', path, '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
}

const words = (text: string) => new Set((text.match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => word.toLowerCase()));

test('an installed release candidate passes the drive half of docs/RELEASE-CHECK.md', { skip: installedAppSkip, timeout: 20 * 60_000 }, async (t: Diagnostic) => {
  const exe = requireInstalledApp();
  const doc = readReleaseCheck();
  const stepNamed = (word: string): CheckStep => {
    const step = doc.steps.find((s) => s.title.toLowerCase().includes(word));
    assert.ok(step, `the written check has a step about "${word}"`);
    return step;
  };
  const results = new Map<number, StepResult>();
  const resultOf = (step: CheckStep) => {
    let result = results.get(step.number);
    if (!result) results.set(step.number, (result = { passed: true, saw: [] }));
    return result;
  };
  const saw = (step: CheckStep, line: string) => resultOf(step).saw.push(line);
  const check = (step: CheckStep, ok: boolean, line: string) => {
    resultOf(step).saw.push(ok ? line : `**FAILED:** ${line}`);
    if (!ok) {
      resultOf(step).passed = false;
      throw new Failure(`step ${step.number} (${step.title}): ${line}`);
    }
  };

  const run = mkdtempSync(join(tmpdir(), 'incudo-release-check-'));
  const library = join(run, 'library');
  const out = join(run, 'out');
  mkdirSync(library);
  mkdirSync(out);
  t.diagnostic(`run folder: ${run}`);

  const expectedVersion = (JSON.parse(readFileSync(join(repoRoot(), 'apps', 'desktop', 'src-tauri', 'tauri.conf.json'), 'utf8')) as { version: string }).version;
  const port = await freePort();
  const app: ChildProcess = spawn(exe, [], {
    env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(run, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
    stdio: 'ignore',
  });
  const pid = app.pid!;
  const appPage = (target: { type: string; url: string }) => target.type === 'page' && target.url.startsWith('http://tauri.localhost');
  let page: Page | undefined;
  let failure: unknown;
  let version = 'not read';
  let corpusLine = 'not read';

  const connect = async () => {
    page?.close();
    page = await Page.open(await waitForTarget(port, appPage));
    await page.run(PAGE_HELPERS);
  };
  const inPage = <T,>(body: string, timeout?: number) => page!.run<T>(body, timeout);
  /** Clicks a button that opens a native file dialog, then answers the dialog with `path`. */
  const throughDialog = async (opener: string, path: string, button = '&Save') => {
    await inPage(`setTimeout(() => H.btn(${JSON.stringify(opener)}).click(), 50); return true;`);
    return win32(['-Action', 'dialog', '-ProcessId', String(pid), '-FilePath', path, '-Button', button]) as { title: string };
  };

  try {
    // 2. First launch on a fresh profile.
    const first = stepNamed('first launch');
    await connect();
    const launcher = await inPage<string>(`return await H.until(() => /Choose a system/.test(document.body.innerText) && document.body.innerText, 30000, 'the launcher');`);
    check(first, launcher.includes('Dungeons & Dragons 5th Edition') && launcher.includes('Cairn'),
      'the window opens on "Choose a system", listing Dungeons & Dragons 5th Edition and Cairn');

    // 3. Choose a system and a library folder. The folder is written into the profile, where the folder dialog would
    // put it, before the system is chosen.
    const choose = stepNamed('choose a system');
    await inPage(`
      await new Promise((res, rej) => { const r = indexedDB.open('incudo', 1);
        r.onupgradeneeded = () => { const db = r.result; for (const s of ['kv', 'handles']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); };
        r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(${JSON.stringify(library)}, 'library/location'); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = rej; };
        r.onerror = rej; });
      setTimeout(() => location.reload(), 50); return true;`);
    await sleep(2500);
    await connect();
    await inPage(`await H.until(() => H.leaf('Dungeons & Dragons 5th Edition'), 30000, 'the launcher'); H.leaf('Dungeons & Dragons 5th Edition').click(); await H.until(() => H.btn('New character'), 15000, 'the Characters screen'); return true;`);
    const header = await inPage<string>(`return H.header();`);
    check(choose, header.includes('Dungeons & Dragons 5th Edition · no sources for this system'), `the header reads "${header.replace(/^INCUDO.*Settings /, '')}"`);
    const characters = await inPage<{ text: string; buttons: string[] }>(`return { text: H.main(), buttons: H.buttons().map((b) => b.textContent) };`);
    check(choose, characters.text.includes(library) && characters.buttons.includes('New character') && characters.buttons.includes('Import from Aurora…'),
      'Characters names the scratch folder and offers New character and Import from Aurora…');

    // The version is the first launch's to say, and Settings is only reachable inside a system.
    version = await inPage<string>(`await H.press('Settings'); return H.main().split('\\n').find((l) => /^Version /.test(l)) ?? 'none';`);
    check(first, version === `Version ${expectedVersion}`, `Settings reads "${version}" (tauri.conf.json: ${expectedVersion})`);

    // 4. Add the suggested source, and press New character while it loads.
    const source = stepNamed('suggested source');
    const loading = await inPage<{ seconds: number; samples: string[]; dialog: string; buttons: string[] }>(`
      const t0 = performance.now();
      await H.press('Sources');
      H.buttons().find((b) => b.textContent === 'Add').click(); await H.sleep(300);
      await H.press('Characters'); await H.press('New character');
      const samples = []; let browsed = false;
      for (let i = 0; i < 600; i++) {
        const d = H.dialog();
        if (d && /Start building/.test(d.innerText)) return { seconds: Math.round((performance.now() - t0) / 1000), samples, dialog: d.innerText, buttons: [...d.querySelectorAll('button')].map((b) => b.textContent) };
        if (i % 2 === 0) samples.push(H.main().split('\\n').slice(0, 3).join(' / '));
        if (!browsed && i === 3) { browsed = true; await H.press('Browse'); samples.push('Browse: ' + H.main().split('\\n').slice(0, 3).join(' / ')); await H.press('Build'); }
        await H.sleep(500);
      }
      throw new Error('the campaign options never opened: ' + H.main().slice(0, 300));`, 330_000);
    const counts = loading.samples.map((s) => /: (\d+) \/ (\d+)/.exec(s)).filter((m) => m).map((m) => Number(m![1]));
    check(source, loading.samples.every((s) => s.includes('Loading content')) && loading.samples.some((s) => s.startsWith('Browse: ')) && counts.length > 0 && counts[counts.length - 1]! >= counts[0]!,
      `Build and Browse showed "Loading content" for the whole load (${loading.seconds} s), ${loading.samples.length} looks, the file count going from ${counts[0]} to ${counts[counts.length - 1]}`);
    check(source, !/ID_[A-Z]/.test(loading.dialog) && loading.buttons.includes('Start building') && loading.buttons.includes('Cancel'),
      'the campaign options opened by themselves, every option named, with Start building and Cancel');
    const sources = await inPage<string>(`await H.press('Start building'); await H.press('Sources'); return H.main();`);
    const entries = /· ([\d,]+) entries from ([\d,]+) files/.exec(sources);
    const missing = Number(/Refers to (\d+) thing/.exec(sources)?.[1] ?? 0);
    const warnings = Number(/(\d+) warning\(s\)/.exec(sources)?.[1] ?? 0);
    const elements = Number(entries?.[1]?.replace(/,/g, '') ?? 0);
    const files = Number(entries?.[2]?.replace(/,/g, '') ?? 0);
    corpusLine = `${elements.toLocaleString('en')} entries from ${files} files, ${missing} thing(s) missing, ${warnings} warning(s)`;
    check(source,
      files >= RECORDED_BUDGET.expectFiles && elements >= RECORDED_BUDGET.expectElements &&
        missing <= RECORDED_BUDGET.maxUnresolved && warnings <= RECORDED_BUDGET.maxWarnings,
      `the source's line reads ${corpusLine} (budget: at least ${RECORDED_BUDGET.expectFiles} files and ` +
        `${RECORDED_BUDGET.expectElements.toLocaleString('en')} entries, at most ${RECORDED_BUDGET.maxUnresolved} missing and ${RECORDED_BUDGET.maxWarnings} warnings)`);

    // 5. Build the named character, every kind of decision answered once.
    const build = stepNamed('build');
    const built = await inPage<string[]>(`
      const said = [];
      await H.press('Build');
      let li = H.card('Ability Scores'); [...li.querySelectorAll('label')].find((l) => l.textContent.trim() === 'Enter manually').querySelector('input').click(); await H.sleep(500);
      const scores = [8, 14, 15, 15, 12, 10];
      for (let i = 0; i < 6; i++) { li = H.card('Ability Scores'); H.setInput(li.querySelectorAll('tbody input')[i], scores[i]); await H.sleep(300); }
      said.push('Ability Scores: ' + [...H.card('Ability Scores').querySelectorAll('td.total')].map((t) => t.textContent).join(', '));
      [...H.card('Ability Scores').querySelectorAll('button')].find((b) => b.textContent === 'Done').click(); await H.sleep(600);
      said.push(await H.pick('Race', 'Dwarf — Player’s Handbook'));
      said.push(await H.pick('Dwarven Subrace', 'Hill Dwarf'));
      said.push(await H.pick('Class', 'Wizard — Player’s Handbook'));
      said.push(await H.pick('Background', 'Sage — Player’s Handbook'));
      said.push(await H.pick('Dwarven Tool Proficiency'));
      for (const l of ['Language (Sage)', 'Language (Sage)', 'Personality Trait', 'Personality Trait', 'Ideal', 'Bond', 'Flaw']) await H.pick(l);
      said.push(await H.pick('Skill Proficiency (Wizard)', 'Investigation'));
      said.push(await H.pick('Skill Proficiency (Wizard)', 'Insight'));
      const tick = async (t) => { [...H.card('Starting equipment: Class').querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(t)).querySelector('input').click(); await H.sleep(300); };
      for (const t of ['Quarterstaff', 'Component Pouch', 'Scholar’s Pack', 'Light Crossbow']) await tick(t);
      [...H.card('Starting equipment: Class').querySelectorAll('button')].find((b) => b.textContent === 'Take').click(); await H.sleep(800);
      [...H.card('Starting equipment: Background').querySelectorAll('button')].find((b) => b.textContent === 'Take').click(); await H.sleep(800);
      said.push('starting equipment taken from Wizard and Sage');
      const tab = (name) => [...document.querySelectorAll('button.build-tab')].find((b) => b.textContent.startsWith(name));
      tab('Spells').click(); await H.sleep(800);
      for (const s of ['Fire Bolt', 'Mage Hand', 'Prestidigitation']) await H.pick('Cantrip (Wizard)', s + ' (Cantrip) — Player’s Handbook');
      for (const s of ['Find Familiar', 'Mage Armor', 'Magic Missile', 'Shield', 'Sleep', 'Detect Magic']) await H.pick('Spellbook (Wizard)', s + ' (Level 1) — Player’s Handbook');
      tab('Build').click(); await H.sleep(800);
      said.push(await H.pick('Find Familiar', 'Owl — Player’s Handbook'));
      for (const n of [2, 3]) { await H.press('Level up to ' + n); await H.sleep(500); }
      said.push(await H.pick('Arcane Tradition', 'School of Evocation'));
      for (const n of [2, 3]) {
        let c = H.card('Hit Points, level ' + n); [...c.querySelectorAll('button')].find((b) => /^Average/.test(b.textContent)).click(); await H.sleep(500);
        c = H.card('Hit Points, level ' + n); const done = c && [...c.querySelectorAll('button')].find((b) => b.textContent === 'Done'); if (done) { done.click(); await H.sleep(500); }
      }
      said.push('Hit Points, levels 2 and 3: Average');
      tab('Spells').click(); await H.sleep(800);
      for (const s of ['Burning Hands (Level 1)', 'Thunderwave (Level 1)', 'Misty Step (Level 2)', 'Scorching Ray (Level 2)']) await H.pick('Spellbook (Wizard)', s + ' — Player’s Handbook');
      const block = () => document.querySelector('.prepared-block');
      for (const s of ['Mage Armor', 'Magic Missile', 'Shield', 'Burning Hands', 'Misty Step']) {
        const b = [...block().querySelectorAll('button')].find((b) => b.textContent === 'Prepare a spell'); if (b) { b.click(); await H.sleep(500); }
        const r = [...block().querySelectorAll('button.picker-choose')].find((r) => r.textContent.startsWith(s));
        if (!r) throw new Error('cannot prepare ' + s); r.click(); await H.sleep(600);
      }
      said.push('Prepared: ' + block().querySelector('.prepared-count').textContent);
      const required = H.open().filter((o) => o.tag !== 'optional');
      tab('Build').click(); await H.sleep(800);
      required.push(...H.open().filter((o) => o.tag !== 'optional'));
      said.push('required decisions left: ' + (required.map((o) => o.label + ' [' + o.tag + ']').join(', ') || 'none'));
      const name = document.querySelector('.progress-bar input'); H.setInput(name, 'Release Check'); await H.sleep(500);
      return said;`, 180_000);
    for (const line of built) saw(build, line);
    check(build, built.includes('Prepared: 5 of 5 prepared'), 'the count reads "5 of 5 prepared"');
    check(build, built.includes('required decisions left: none'), 'Build lists no required decision');

    // 6. Save.
    const save = stepNamed('save');
    await inPage(`await H.press('Save to library'); return true;`);
    await waitForFile(join(library, 'release-check.incu'));
    const card = await inPage<string>(`await H.press('Characters'); await H.sleep(500); return H.libraryCard('Release Check')?.innerText.replace(/\\n+/g, ' / ') ?? 'no card';`);
    check(save, card.includes('Player Character · Level 3'), `release-check.incu written; its card reads "${card}"`);

    // 7. Export as text and as PDF.
    const exporting = stepNamed('export');
    const sheetBefore = await inPage<string>(`await H.press('Sheet'); await H.sleep(800); return H.main();`);
    const markdownPath = join(out, 'release-check.md');
    await throughDialog('Export sheet as text', markdownPath);
    await waitForFile(markdownPath);
    const markdown = readFileSync(markdownPath, 'utf8');
    const rows = exportedRows(markdown);
    for (const reading of doc.readings) {
      const value = rows.get(reading.label);
      check(exporting, value === reading.value, `${reading.label}: ${value ?? 'no such row'}${value === reading.value ? '' : ` (the check says ${reading.value})`}`);
    }
    const pdfPath = join(out, 'release-check.pdf');
    await inPage(`await H.press('Export sheet as PDF'); await H.until(() => H.dialog(), 5000, 'the PDF step'); return true;`);
    await throughDialog('Export…', pdfPath);
    await waitForFile(pdfPath, 60_000);
    const pdf = readFileSync(pdfPath);
    const pages = pdfPages(pdf);
    check(exporting, pdf.subarray(0, 5).toString('latin1') === '%PDF-' && (pages ?? 1) >= 1, `the PDF is ${Math.round(pdf.length / 1024)} KB, ${pages ?? 'an unread number of'} page(s)`);
    const text = pdfText(pdfPath);
    if (text === undefined) saw(exporting, 'words not compared: pdftotext is not on the path');
    else {
      const inPdf = words(text.replace(/-\n/g, ''));
      const lost = [...words(markdown)].filter((word) => !inPdf.has(word));
      check(exporting, lost.length === 0, `${words(markdown).size} distinct words in the text export, ${lost.length} missing from the PDF${lost.length ? `: ${lost.slice(0, 10).join(', ')}` : ''}`);
    }

    // 8. Print through its step. The page waits on the preview until it closes, so Print… is pressed after this returns.
    const printing = stepNamed('print');
    await inPage(`await H.press('Print sheet'); const p = [...H.dialog().querySelectorAll('button')].find((b) => /^Print/.test(b.textContent)); setTimeout(() => p.click(), 100); return true;`);
    const preview = await Page.open(await waitForTarget(port, (target) => target.url === 'edge://print/'));
    const seen = await preview.run<{ sheets: string; headers: boolean; cancelled: boolean }>(String.raw`
      const all = (root, acc = []) => { for (const e of root.querySelectorAll('*')) { acc.push(e); if (e.shadowRoot) all(e.shadowRoot, acc); } return acc; };
      const leaves = () => all(document).filter((e) => e.children.length === 0).map((e) => e.textContent.trim());
      const cancelButton = () => all(document).find((e) => e.tagName === 'FLUENT-BUTTON' && /Cancel/.test(e.textContent));
      let sheets = '';
      for (let i = 0; i < 150; i++) {
        sheets = leaves().find((t) => /^\d+ sheets? of paper$|^Total: \d+ sheets?/.test(t)) ?? '';
        if (/[1-9]/.test(sheets) && cancelButton()) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const headers = !!all(document).find((e) => e.id === 'header-footer-checkbox');
      const cancel = cancelButton(); cancel?.click();
      return { sheets, headers, cancelled: !!cancel };`, 60_000);
    preview.close();
    check(printing, /[1-9]/.test(seen.sheets), `WebView2's preview opened and counted its paper: "${seen.sheets || 'nothing'}"`);
    check(printing, !seen.headers, 'the preview offers no headers-and-footers option');
    check(printing, seen.cancelled, 'Cancel closed it');
    await sleep(1500);
    await connect();
    check(printing, await inPage<boolean>(`return !H.dialog();`), 'the app answers again after the preview closed');

    // 9. Reopen with every source off.
    const reopen = stepNamed('reopen');
    const sheetAfter = await inPage<string>(`
      await H.press('Sources'); H.enabled().click(); await H.sleep(1500);
      await H.press('Characters'); await H.sleep(500);
      [...H.libraryCard('Release Check').querySelectorAll('button')].find((b) => /^Open/.test(b.textContent)).click(); await H.sleep(1500);
      const d = H.dialog(); if (d) [...d.querySelectorAll('button')].find((b) => /Discard/.test(b.textContent))?.click(); await H.sleep(800);
      await H.press('Sheet'); await H.sleep(1200); return H.main();`);
    check(reopen, sheetAfter === sheetBefore, `the Sheet with the source off is ${sheetAfter === sheetBefore ? 'identical to' : 'different from'} the Sheet before (${sheetBefore.length.toLocaleString('en')} and ${sheetAfter.length.toLocaleString('en')} characters)`);

    // 10. Import a named sample: the 2014 Fighter 5 in plate and shield, found by what it is.
    const importing = stepNamed('import');
    const [sample] = samplesWhere((s) => s.edition === '2014' && s.split.length === 1 && s.split[0]!.class === 'Fighter' && s.split[0]!.levels === 5);
    assert.ok(sample, 'the samples hold a 2014 Fighter 5');
    await inPage(`
      await H.press('Sources'); H.enabled().click();
      await H.until(() => /entries from/.test(H.main()) && !/Loading/.test(H.main()), 120000, 'the source to load again');
      await H.press('Characters'); return true;`, 150_000);
    await throughDialog('Import from Aurora', samplePath(sample), '&Open');
    const imported = await inPage<{ said: string; card: string }>(`
      await H.until(() => /1 of 1 imported/.test(H.main()), 60000, 'the import');
      return { said: H.main().split('\\n').find((l) => /imported/.test(l)), card: H.libraryCard(${JSON.stringify(sample.id)})?.innerText.replace(/\\n+/g, ' / ') ?? 'no card' };`, 70_000);
    check(importing, imported.card.includes('Player Character · Level 5') && !imported.card.includes('Not in your sources'),
      `"${imported.said}"; its card reads "${imported.card}"`);
    await inPage(`
      [...H.libraryCard(${JSON.stringify(sample.id)}).querySelectorAll('button')].find((b) => /^Open/.test(b.textContent)).click(); await H.sleep(1500);
      const d = H.dialog(); if (d) [...d.querySelectorAll('button')].find((b) => /Discard/.test(b.textContent))?.click(); await H.sleep(800);
      await H.press('Sheet'); await H.sleep(800); return true;`);
    const samplePathOut = join(out, 'sample.md');
    await throughDialog('Export sheet as text', samplePathOut);
    await waitForFile(samplePathOut);
    const sampleRows = exportedRows(readFileSync(samplePathOut, 'utf8'));
    for (const [label, wanted] of [['Armor Class', sample.readout.ac], ['Hit Points', sample.readout.hp], ['Speed', sample.readout.speed]] as const) {
      const value = sampleRows.get(label);
      check(importing, Number.parseInt(value ?? '', 10) === wanted, `${sample.id}'s ${label}: ${value ?? 'no such row'} (its readout: ${wanted})`);
    }

    // 11. Browse.
    const browse = stepNamed('browse');
    const found = await inPage<string>(`
      await H.press('Browse');
      const q = document.querySelector('main input[type=search], main input[type=text]'); H.setInput(q, 'fireball'); await H.sleep(1000);
      return H.main().split('\\n').find((l) => /fireball/i.test(l)) ?? 'nothing';`);
    check(browse, found === 'Fireball', `the first result is named "${found}"`);

    // 12. The menus, read and clicked by window messages.
    const menus = stepNamed('menus');
    const native = win32(['-Action', 'menu', '-ProcessId', String(pid)]) as Array<{ label: string; items: Array<{ text: string; id: number; separator: boolean }> }>;
    const model = menuModel('other', absentCommands({ pdfAvailable: true }));
    const label = (text: string) => text.split('\t')[0]!.replace(/&&/g, '&');
    for (const menu of model) {
      const bar = native.find((m) => label(m.label) === menu.label);
      const want = menu.entries.flatMap((entry) => (entry.kind === 'command' ? [entry.label] : []));
      const have = (bar?.items ?? []).filter((item) => !item.separator).map((item) => label(item.text));
      check(menus, JSON.stringify(have) === JSON.stringify(want), `${menu.label}: ${have.length} items${JSON.stringify(have) === JSON.stringify(want) ? ', as MENUS lists them' : `: ${have.join(', ')} (MENUS: ${want.join(', ')})`}`);
    }
    const browseLabel = model.flatMap((menu) => menu.entries).find((entry) => entry.kind === 'command' && entry.id === 'go-browse');
    const browseItem = native.flatMap((menu) => menu.items).find((item) => browseLabel?.kind === 'command' && label(item.text) === browseLabel.label);
    await inPage(`await H.press('Characters'); return true;`);
    win32(['-Action', 'command', '-ProcessId', String(pid), '-ItemId', String(browseItem?.id ?? 0)]);
    await sleep(1000);
    const active = await inPage<string>(`return document.querySelector('button.on')?.textContent ?? 'none';`);
    check(menus, active.startsWith('Browse'), `View → ${browseLabel?.kind === 'command' ? browseLabel.label : 'Browse'} by a window message: the screen on is "${active}"`);

    // 13. Switching system.
    const switching = stepNamed('switching system');
    const cairn = await inPage<{ header: string; text: string }>(`
      document.querySelector('button.system-switch').click(); await H.sleep(800);
      const d = H.dialog(); if (d) [...d.querySelectorAll('button')].find((b) => /Discard/.test(b.textContent))?.click();
      await H.until(() => H.leaf('Cairn'), 10000, 'the launcher'); H.leaf('Cairn').click(); await H.sleep(1500);
      return { header: H.header(), text: H.main() };`);
    check(switching, cairn.header.includes('Cairn · no sources for this system'), 'the header reads "Cairn · no sources for this system"');
    check(switching, /2 Dungeons & Dragons 5th Edition character\(s\) in this folder belong to another system/.test(cairn.text),
      'Characters says the folder\'s 2 Dungeons & Dragons 5th Edition characters belong to another system');
  } catch (error) {
    failure = error;
  } finally {
    page?.close();
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // Already gone.
    }
  }

  // The report: every step of the written check, in its order.
  const report = [
    `# Release check, drive half`,
    '',
    `- Run: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, Windows ${release()}`,
    `- Build: ${basename(exe)}, Settings read "${version}"`,
    `- Source: ${corpusLine}`,
    `- Checked by: the drive (\`tools/verify/src/release-check.test.ts\`); the person's steps are left for the person`,
    '',
    '| Step | Who | Drive | What the drive saw |',
    '| --- | --- | --- | --- |',
    ...doc.steps.map((step) => {
      const result = results.get(step.number);
      const verdict = step.by === 'person only' ? 'the person\'s' : !result ? 'not reached' : result.passed ? 'passed' : 'failed';
      return `| ${step.number}. ${step.title} | ${step.by} | ${verdict} | ${(result?.saw ?? []).join('; ').replace(/\|/g, '\\|')} |`;
    }),
    '',
    failure ? `The drive stopped: ${failure instanceof Error ? failure.message : String(failure)}` : 'The drive reached the end.',
    '',
  ].join('\n');
  writeFileSync(join(run, 'report.md'), report);
  t.diagnostic(`report: ${join(run, 'report.md')}`);
  if (failure) throw failure;
  const unreached = doc.steps.filter((step) => step.by !== 'person only' && !results.has(step.number));
  assert.deepEqual(unreached.map((step) => step.title), [], 'every step the drive can check was checked');
});

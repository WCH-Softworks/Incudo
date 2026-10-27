/**
 * Settings: the handful of app-level choices that are not about a character or about content.
 *
 * Today that is one thing, the library folder (ADR 0027). It lives here rather than on the
 * library screen because choosing where your characters live is a **setup question, asked
 * once** — the first run puts it in front of you as a dialog, and after that it is a setting
 * you go and find, not a button sitting next to "New character" waiting to be misread as
 * something you are supposed to press.
 *
 * Nothing here knows a rule about the game, and nothing here knows it is running in Tauri;
 * `shell` arrives as a word from `src/platform.ts`, which is the only file allowed to ask.
 *
 * It also holds About Incudo, with the support links, because this is a screen that shows no
 * content: ADR 0010 keeps those links off any screen showing licensed material. Help > About Incudo
 * brings this pane up with that section in view.
 */

import { useEffect, useRef } from 'react';
import {
  ABOUT_SUMMARY,
  SOURCE_LINK,
  SUPPORT_LINKS,
  SUPPORT_TEXT,
  SYSTEM_ATTRIBUTIONS_HEADING,
  SYSTEM_ATTRIBUTIONS_TEXT,
  type AboutLink,
  type SystemAttribution,
} from '@incudo/ui';

export function SettingsPane({
  location,
  unavailableReason,
  entryCount,
  onChooseFolder,
  shell,
  version,
  attributions,
  showAbout,
  onAboutShown,
  onOpenLink,
}: {
  location: string | null;
  unavailableReason: string | undefined;
  entryCount: number;
  onChooseFolder: () => void;
  shell: 'tauri' | 'browser';
  version: string;
  /** Each shipped system's licence notice, worded by `systemAttributions`. */
  attributions: readonly SystemAttribution[];
  /** Help > About Incudo asked for the About section; scrolled into view once, then `onAboutShown`. */
  showAbout: boolean;
  onAboutShown: () => void;
  onOpenLink: (url: string) => void;
}): React.JSX.Element {
  const about = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!showAbout) return;
    about.current?.scrollIntoView({ block: 'start' });
    onAboutShown();
  }, [showAbout, onAboutShown]);

  const link = (target: AboutLink) => (
    <li key={target.url}>
      {target.label}:{' '}
      <a
        href={target.url}
        onClick={(event) => {
          // The window would follow the link itself and replace the app with the page.
          event.preventDefault();
          onOpenLink(target.url);
        }}
      >
        {target.text}
      </a>
    </li>
  );

  return (
    <main className="pane">
      <h2>Settings</h2>

      <h3>Character library</h3>
      {unavailableReason ? (
        <div className="problem warn">
          <strong>There is no character library in this browser.</strong>
          <p>{unavailableReason}</p>
          {/* ADR 0027: a library is a folder of real files, never browser storage. */}
          <p className="hint">
            Your characters are kept as ordinary files in a folder you choose, so you can copy,
            sync and back them up. This browser cannot give Incudo such a folder.
          </p>
        </div>
      ) : (
        <>
          <p className="lede">
            Where your characters live. Incudo lists every <code>.incu</code> in this folder, plus
            any folder inside it holding a <code>manifest.json</code>, and leaves everything else
            alone. It never renames your files.
          </p>
          <div className="setting">
            <div>
              <div className="setting-value">{location ?? 'No folder chosen yet.'}</div>
              {location && (
                <div className="card-meta">
                  {entryCount} character{entryCount === 1 ? '' : 's'}
                </div>
              )}
            </div>
            <button type="button" onClick={onChooseFolder}>
              {location ? 'Change folder…' : 'Choose folder…'}
            </button>
          </div>
          <p className="hint">
            Picking a different folder switches libraries. It moves nothing and copies nothing —
            your old folder is exactly where you left it.
            {shell === 'browser' &&
              ' In this browser build a reload may need one click here to reconnect, because a' +
                ' browser grants access to a folder per session unless you have said otherwise.'}
          </p>
        </>
      )}

      {/*
        The Tauri window fetches through its own command, which CORS does not apply to; the
        browser build uses window.fetch, so a host that sends no CORS headers refuses it.
      */}
      <h3>This build</h3>
      <p className="card-meta">
        {shell === 'tauri'
          ? 'The desktop app. It can load content from any site.'
          : 'The browser version. Some sites do not let a web page load their files, so a content source that works in the desktop app may fail here.'}
      </p>

      <section ref={about} className="about" aria-labelledby="about-heading">
        <h3 id="about-heading">About Incudo</h3>
        <p className="card-meta">Version {version}</p>
        <p>{ABOUT_SUMMARY}</p>
        <ul className="about-links">{link(SOURCE_LINK)}</ul>
        {attributions.length > 0 && (
          <>
            <h4>{SYSTEM_ATTRIBUTIONS_HEADING}</h4>
            <p>{SYSTEM_ATTRIBUTIONS_TEXT}</p>
            <dl className="about-attributions">
              {attributions.map((entry) => (
                <div key={entry.system}>
                  <dt>{entry.system}</dt>
                  <dd>{entry.text}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
        <h4>Support Incudo</h4>
        <p>{SUPPORT_TEXT}</p>
        <ul className="about-links">{SUPPORT_LINKS.map(link)}</ul>
      </section>
    </main>
  );
}

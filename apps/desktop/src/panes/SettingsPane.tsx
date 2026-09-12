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
 */

export function SettingsPane({
  location,
  unavailableReason,
  entryCount,
  onChooseFolder,
  shell,
}: {
  location: string | null;
  unavailableReason: string | undefined;
  entryCount: number;
  onChooseFolder: () => void;
  shell: 'tauri' | 'browser';
}): React.JSX.Element {
  return (
    <main className="pane">
      <h2>Settings</h2>

      <h3>Character library</h3>
      {unavailableReason ? (
        <div className="problem warn">
          <strong>There is no character library in this browser.</strong>
          <p>{unavailableReason}</p>
          <p className="hint">
            Incudo will not pretend to have a library it cannot back with real files — see
            <code> docs/adr/0027-a-library-is-a-folder.md</code>.
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

      <h3>This build</h3>
      <p className="card-meta">
        {shell === 'tauri'
          ? 'The desktop window. Content is fetched through Tauri, which CORS does not apply to.'
          : 'The browser dev server. Content is fetched with window.fetch, so CORS applies and some content hosts will refuse.'}
      </p>
    </main>
  );
}

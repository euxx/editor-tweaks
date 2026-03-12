'use strict';

// Prunes VS Code's Go-to-File (Cmd+P) editor history by removing stale entries
// whose paths no longer exist on disk.
//
// VS Code stores per-workspace editor history in the workspace's state.vscdb
// SQLite database under the key 'history.entries' (storage scope = workspace).
// The history is loaded into memory at startup and persisted via onWillSaveState.
//
// To remove stale entries from the live in-memory history without a public API,
// this feature uses two mechanisms depending on where the stale file lives:
//
//   Internal files (inside a workspace folder):
//   1. Temporarily add workspace-relative paths to files.exclude.
//   2. VS Code's HistoryService.resourceExcludeMatcher fires onExpressionChange,
//      which calls removeExcludedFromHistory() — pruning in-memory history.
//   3. onWillSaveState later calls saveState(), persisting the pruned list.
//   4. Restore files.exclude to its original value.
//
//   External files (outside all workspace folders):
//   Per-folder files.exclude patterns cannot reach these because VS Code's
//   ResourceGlobMatcher evaluates folder-scoped patterns only against resources
//   that are sub-paths of that folder.
//
//   First attempt: temporarily add the absolute URI paths to the *global*
//   files.exclude (ConfigurationTarget.Global). VS Code's ResourceGlobMatcher
//   evaluates the global expression against resource.path (the URI path
//   component), so an exact absolute path used as the pattern key is matched
//   literally by minimatch and should trigger removeExcludedFromHistory().
//   This is experimental — if VS Code's implementation changes the global
//   matching behaviour the attempt silently does nothing.
//
//   Fallback: rewrite history.entries directly in the SQLite DB during
//   extension deactivation. This takes effect on the next VS Code launch.
//   (VS Code saves its in-memory state before deactivating extensions, so the
//   DB write is the last write on shutdown.)
//
// Reading / writing history.entries from SQLite requires the sqlite3 CLI
// (available on macOS and most Linux systems). If unavailable the feature
// silently skips.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { fileURLToPath } = require('url');

// Pending DB cleanup for external stale paths — written in deactivate().
let _pendingDbCleanup = null; // { stateDbPath: string, externalStalePaths: Set<string> }

/**
 * Returns true when a path exists on disk.
 * Only treats ENOENT as non-existent; all other errors are treated as "exists".
 * @param {string} p
 * @returns {boolean}
 */
function pathExists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    return true;
  }
}

/**
 * Converts a file:// URI string to a filesystem path, or null for non-file URIs.
 * Handles percent-encoded characters, Windows drive-letter paths, and UNC paths
 * (file://server/share/path) via Node's built-in fileURLToPath.
 * @param {string} uriString
 * @returns {string|null}
 */
function fileUriToFsPath(uriString) {
  try {
    return fileURLToPath(uriString);
  } catch {
    return null;
  }
}

/**
 * Escapes glob special characters in a path segment so the segment is treated
 * as a literal string in VS Code's files.exclude pattern matching (minimatch).
 * @param {string} str
 * @returns {string}
 */
function escapeGlob(str) {
  return str.replace(/[[\]{}?*!@#\\]/g, '\\$&');
}

/**
 * Reads history.entries from the VS Code workspace storage SQLite database via
 * the sqlite3 CLI. Returns an array of filesystem paths, or null on failure.
 * @param {string} stateDbPath  Absolute path to the workspace state.vscdb file
 * @returns {string[]|null}
 */
function readWorkspaceHistoryPaths(stateDbPath) {
  const result = spawnSync('sqlite3', [stateDbPath, "SELECT value FROM ItemTable WHERE key='history.entries';"], {
    timeout: 5000,
    encoding: 'utf8',
  });

  if (result.status !== 0 || result.error) return null;

  const json = (result.stdout ?? '').trim();
  if (!json) return [];

  let entries;
  try {
    entries = JSON.parse(json);
  } catch {
    return null;
  }

  if (!Array.isArray(entries)) return null;

  const paths = [];
  for (const entry of entries) {
    if (!entry?.editor?.resource) continue;
    const fsPath = fileUriToFsPath(entry.editor.resource);
    if (fsPath) paths.push(fsPath);
  }
  return paths;
}

/**
 * Given stale absolute filesystem paths and workspace folder descriptors,
 * returns a Map from each folder to a list of workspace-relative glob patterns
 * for the stale files that live within that folder.
 *
 * Files that don't belong to any workspace folder are not included; they are
 * handled separately — first via applyGlobalExcludePrune(), then with a SQLite
 * fallback queued for extension deactivation.
 *
 * @param {string[]} stalePaths  Absolute filesystem paths that no longer exist
 * @param {Array<{uri: {fsPath: string}}>} workspaceFolders
 * @returns {Map<object, string[]>}  Map from workspaceFolder → pattern array
 */
function computeExcludePatterns(stalePaths, workspaceFolders) {
  const result = new Map();

  for (const stalePath of stalePaths) {
    for (const folder of workspaceFolders) {
      const folderPath = folder.uri.fsPath;
      const rel = path.relative(folderPath, stalePath);
      // rel must not start with '..' (outside the folder), must not be an
      // absolute path (which path.relative() returns on Windows cross-drive),
      // and must not be empty (which means stalePath === folderPath itself —
      // an empty pattern has undefined glob semantics in VS Code).
      if (!rel.startsWith('..') && !path.isAbsolute(rel) && rel !== '') {
        const pattern = rel.split(path.sep).map(escapeGlob).join('/');
        if (!result.has(folder)) result.set(folder, []);
        result.get(folder).push(pattern);
        break; // file belongs to this folder; don't check others
      }
    }
  }

  return result;
}

/**
 * Applies the files.exclude trick to prune stale entries from VS Code's
 * in-memory editor history, then restores the original exclude settings.
 *
 * Mechanism: HistoryService registers resourceExcludeMatcher.onExpressionChange(
 *   () => removeExcludedFromHistory()), which fires whenever files.exclude
 *   changes. Temporarily adding a path to a workspace folder's files.exclude
 *   causes VS Code to remove matching history entries from memory; the pruned
 *   state is later persisted via storageService.onWillSaveState → saveState().
 *
 * Only handles files that live inside a workspace folder (workspace-relative
 * patterns). External files cannot be matched this way because VS Code's
 * ResourceGlobMatcher only applies per-folder expressions to resources that are
 * sub-paths of that folder; external files fall back to the global expression,
 * which does not contain these patterns. External files are handled separately
 * via cleanExternalPathsFromDb() at deactivation time.
 *
 * @param {Map<object, string[]>} patternsByFolder  Output of computeExcludePatterns
 * @param {object} vscode  The vscode module (lazy-loaded)
 * @returns {Promise<number>}  Number of exclude patterns applied
 */
async function applyFilesExcludePrune(patternsByFolder, vscode) {
  if (patternsByFolder.size === 0) return 0;

  let totalPatterns = 0;
  const restoreOps = [];

  for (const [folder, patterns] of patternsByFolder) {
    if (patterns.length === 0) continue;

    const config = vscode.workspace.getConfiguration('files', folder.uri);
    const originalValue = config.inspect('exclude')?.workspaceFolderValue ?? {};

    // Track only patterns not already in the user's config so we don't delete
    // pre-existing entries during the restore step. Also save the original value
    // for any key that existed but was not already true (e.g. false) so the
    // restore step can return it to its original value.
    const newlyAdded = patterns.filter((p) => !(p in originalValue));
    const overridden = {};
    for (const p of patterns) {
      if (p in originalValue && originalValue[p] !== true) overridden[p] = originalValue[p];
    }

    // Nothing to do — all patterns already present and true.
    if (newlyAdded.length === 0 && Object.keys(overridden).length === 0) continue;

    const updated = Object.assign({}, originalValue);
    for (const p of patterns) {
      updated[p] = true;
    }

    try {
      await config.update('exclude', updated, vscode.ConfigurationTarget.WorkspaceFolder);
      // Count only patterns that actually changed the config (newly added or overriding a non-true value).
      totalPatterns += newlyAdded.length + Object.keys(overridden).length;
      restoreOps.push({ config, addedKeys: newlyAdded, overridden });
    } catch {
      // Read-only workspace or other config error — skip this folder
    }
  }

  if (restoreOps.length > 0) {
    try {
      // Allow VS Code time to process the config change, fire onExpressionChange,
      // and call removeExcludedFromHistory() on the in-memory history.
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      // Re-read the current value before restoring so we only remove the keys this
      // function added — any concurrent changes made during the 1000ms delay are kept.
      for (const { config, addedKeys, overridden } of restoreOps) {
        try {
          const current = config.inspect('exclude')?.workspaceFolderValue ?? {};
          const cleaned = Object.assign({}, current);
          // Only delete keys still set to true (our write). If the user concurrently
          // changed a key to another value during the 1000ms delay, leave it as-is.
          for (const key of addedKeys) {
            if (cleaned[key] === true) delete cleaned[key];
          }
          // Restore keys that existed with a non-true value (e.g. false) back to their
          // original value, but only if still set to true (same guard as addedKeys above).
          for (const [key, value] of Object.entries(overridden)) {
            if (cleaned[key] === true) cleaned[key] = value;
          }
          const restore = Object.keys(cleaned).length > 0 ? cleaned : undefined;
          await config.update('exclude', restore, vscode.ConfigurationTarget.WorkspaceFolder);
        } catch {
          // Ignore restore errors — worst case the user has extra exclude
          // patterns that can be manually removed from .vscode/settings.json
        }
      }
    }
  }

  return totalPatterns;
}

/**
 * Attempts to prune external stale paths (files outside every workspace folder)
 * from VS Code's in-memory editor history by temporarily adding their absolute
 * URI paths to the *global* files.exclude setting.
 *
 * VS Code's ResourceGlobMatcher evaluates the global expression against
 * resource.path (the URI path component). A pattern key equal to that path
 * is therefore matched literally by minimatch, triggering
 * removeExcludedFromHistory() via the onExpressionChange listener — the same
 * mechanism used for internal files by applyFilesExcludePrune().
 *
 * This is EXPERIMENTAL. If VS Code's global-scope matching behaviour changes,
 * the call silently does nothing harmful.
 *
 * @param {string[]} externalStalePaths  Absolute filesystem paths
 * @param {object} vscode  The vscode module
 * @returns {Promise<number>}  Number of patterns applied (0 on failure)
 */
async function applyGlobalExcludePrune(externalStalePaths, vscode) {
  if (externalStalePaths.length === 0) return 0;

  const config = vscode.workspace.getConfiguration('files');
  const currentValue = config.inspect('exclude')?.globalValue ?? {};

  // Track only pattern keys not already in the user's global config. Also save
  // the original value for any key that existed but was not already true (e.g.
  // false) so the restore step can return it to its original value.
  const allPatternKeys = externalStalePaths.map((p) => escapeGlob(vscode.Uri.file(p).path));
  const newlyAdded = allPatternKeys.filter((key) => !(key in currentValue));
  const overridden = {};
  for (const key of allPatternKeys) {
    if (key in currentValue && currentValue[key] !== true) overridden[key] = currentValue[key];
  }

  // Nothing to do — all patterns already present and true.
  if (newlyAdded.length === 0 && Object.keys(overridden).length === 0) return 0;

  const updated = Object.assign({}, currentValue);
  for (const key of allPatternKeys) {
    // Use the escaped URI path as the pattern key: escapeGlob ensures any glob
    // special characters in directory names (e.g. [2024]-report/) are treated
    // as literals, matching the same way as patterns in computeExcludePatterns.
    updated[key] = true;
  }

  try {
    await config.update('exclude', updated, vscode.ConfigurationTarget.Global);
  } catch {
    return 0;
  }

  try {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } finally {
    if (newlyAdded.length > 0 || Object.keys(overridden).length > 0) {
      // Re-read the current value before restoring so we only remove the keys this
      // function added — preserves concurrent changes and pre-existing user entries.
      // Restore overridden keys only if still set to true (same guard as newlyAdded).
      try {
        const current = config.inspect('exclude')?.globalValue ?? {};
        const cleaned = Object.assign({}, current);
        // Only delete keys still set to true (our write). If the user concurrently
        // changed a key to another value during the 1000ms delay, leave it as-is.
        for (const key of newlyAdded) {
          if (cleaned[key] === true) delete cleaned[key];
        }
        for (const [key, value] of Object.entries(overridden)) {
          if (cleaned[key] === true) cleaned[key] = value;
        }
        const restore = Object.keys(cleaned).length > 0 ? cleaned : undefined;
        await config.update('exclude', restore, vscode.ConfigurationTarget.Global);
      } catch {
        // Ignore restore errors — worst case the user has extra exclude
        // patterns that can be manually removed from VS Code user settings
      }
    }
  }

  return externalStalePaths.length;
}

/**
 * Writes a cleaned history.entries array back to state.vscdb using the sqlite3
 * CLI. Called only from deactivate() — after VS Code has already written its
 * final in-memory state — so the cleaned version persists into the next launch.
 * @param {string} stateDbPath
 * @param {Set<string>} staleExternalPaths  Absolute paths to remove
 * @returns {boolean}  true if the write succeeded
 */
function cleanExternalPathsFromDb(stateDbPath, staleExternalPaths) {
  // Re-read current DB entries so we clean the final persisted state.
  const readResult = spawnSync('sqlite3', [stateDbPath, "SELECT value FROM ItemTable WHERE key='history.entries';"], {
    timeout: 2000,
    encoding: 'utf8',
  });
  if (readResult.status !== 0 || readResult.error) return false;

  const json = (readResult.stdout ?? '').trim();
  if (!json) return false;

  let entries;
  try {
    entries = JSON.parse(json);
  } catch {
    return false;
  }
  if (!Array.isArray(entries)) return false;

  const cleaned = entries.filter((entry) => {
    const fsPath = entry?.editor?.resource ? fileUriToFsPath(entry.editor.resource) : null;
    return !fsPath || !staleExternalPaths.has(fsPath);
  });
  if (cleaned.length === entries.length) return true; // nothing to remove

  const cleanedJson = JSON.stringify(cleaned);
  // Escape single-quote characters for the SQLite literal.
  const escaped = cleanedJson.replace(/'/g, "''");
  const writeResult = spawnSync('sqlite3', [stateDbPath], {
    input: `UPDATE ItemTable SET value = '${escaped}' WHERE key = 'history.entries';\n`,
    timeout: 2000,
    encoding: 'utf8',
  });
  return writeResult.status === 0 && !writeResult.error;
}

/**
 * @param {import('vscode').ExtensionContext} context
 * @param {import('vscode').OutputChannel} out  Shared output channel from extension.js
 */
function activate(context, out) {
  const vscode = require('vscode');
  const log = (...args) => out.appendLine(args.join(' '));

  async function run() {
    out.clear();

    const config = vscode.workspace.getConfiguration('editorTweaks.pruneOpenHistory');
    if (!config.get('enable')) {
      log('  enable=false — skipping');
      return;
    }

    // Only works in a local workspace context
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      log('  no workspace folders — skipping');
      return;
    }

    if (!context.storageUri) {
      log('  context.storageUri is undefined — skipping');
      return;
    }

    // The extension's workspace storage lives at:
    //   {dataDir}/workspaceStorage/{hash}/{extensionId}/
    // VS Code's own workspace storage (state.vscdb) is one level up.
    const storageHashDir = path.dirname(context.storageUri.fsPath);
    const stateDbPath = path.join(storageHashDir, 'state.vscdb');
    log('  stateDbPath:', stateDbPath, '  exists:', fs.existsSync(stateDbPath));

    if (!fs.existsSync(stateDbPath)) return;

    const historyPaths = readWorkspaceHistoryPaths(stateDbPath);
    if (historyPaths === null) {
      log(
        '  readWorkspaceHistoryPaths returned null — sqlite3 CLI unavailable or error.',
        'Install sqlite3 to enable Go-to-File history pruning (recently-opened pruning is unaffected).',
      );
      return;
    }
    log('  historyPaths count:', historyPaths.length);

    const stalePaths = historyPaths.filter((p) => !pathExists(p));
    log('  stalePaths count:', stalePaths.length, stalePaths.length > 0 ? stalePaths.join('\n    ') : '');
    if (stalePaths.length === 0) {
      log('  nothing to prune');
      return;
    }

    const patternsByFolder = computeExcludePatterns(stalePaths, workspaceFolders);
    // External stale paths = stale paths that are not inside any workspace folder
    const externalStale = stalePaths.filter(
      (sp) =>
        !workspaceFolders.some((f) => {
          const r = path.relative(f.uri.fsPath, sp);
          return !r.startsWith('..') && !path.isAbsolute(r);
        }),
    );
    log(
      '  patternsByFolder:',
      [...patternsByFolder.entries()].map(([f, ps]) => `${f.uri.fsPath} → [${ps.join(', ')}]`).join('; '),
    );
    log('  externalStalePaths:', externalStale.length > 0 ? externalStale.join(', ') : '(none)');

    // Run both in parallel — they target different config scopes (WorkspaceFolder
    // vs Global), so there is no conflict and the combined delay is 1000ms instead of 2000ms.
    const [internalN, externalN] = await Promise.all([
      patternsByFolder.size > 0 ? applyFilesExcludePrune(patternsByFolder, vscode) : Promise.resolve(0),
      externalStale.length > 0 ? applyGlobalExcludePrune(externalStale, vscode) : Promise.resolve(0),
    ]);

    if (patternsByFolder.size > 0) {
      log('  files.exclude trick — applied', internalN, 'pattern(s)');
    } else {
      log('  no internal patterns to apply');
    }

    // External stale paths: also schedule the SQLite cleanup for deactivation as a
    // fallback — if the global files.exclude approach had no effect, the SQLite write
    // ensures cleanup on the next launch.
    if (externalStale.length > 0) {
      log('  global files.exclude trick (experimental) — applied', externalN, 'external pattern(s)');

      // Merge with any existing pending set so that multiple run() calls in the
      // same session don't silently discard paths from earlier invocations.
      if (_pendingDbCleanup && _pendingDbCleanup.stateDbPath === stateDbPath) {
        for (const p of externalStale) _pendingDbCleanup.externalStalePaths.add(p);
      } else {
        _pendingDbCleanup = { stateDbPath, externalStalePaths: new Set(externalStale) };
      }
      log('  ', externalStale.length, 'external stale path(s) also queued for SQLite cleanup on shutdown (fallback)');
    }
  }

  if (vscode.workspace.getConfiguration('editorTweaks.pruneOpenHistory').get('runAtStartup')) {
    // Log unexpected errors to the output channel to aid debugging;
    // expected failures (no sqlite3, no workspace, etc.) are handled inside run().
    run().catch((err) => log('[unexpected]', err?.stack ?? err?.message ?? err));
  }

  return run;
}

function deactivate() {
  if (!_pendingDbCleanup) return;
  const { stateDbPath, externalStalePaths } = _pendingDbCleanup;
  _pendingDbCleanup = null;
  // Best-effort: VS Code typically persists its in-memory state before calling
  // deactivate(), so this write targets the final persisted value. The order
  // is not guaranteed; if VS Code writes after us the cleaned entries will be
  // re-introduced and the prune will take effect on the following restart.
  cleanExternalPathsFromDb(stateDbPath, externalStalePaths);
}

module.exports = {
  activate,
  deactivate,
  fileUriToFsPath,
  escapeGlob,
  computeExcludePatterns,
  applyFilesExcludePrune,
  applyGlobalExcludePrune,
};

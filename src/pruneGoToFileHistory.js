'use strict';

// Prunes VS Code's Go-to-File (Cmd+P) editor history by removing stale entries
// whose paths no longer exist on disk.
//
// VS Code stores per-workspace editor history in the workspace's state.vscdb
// SQLite database under the key 'history.entries' (storage scope = workspace).
// The history is loaded into memory at startup and persisted via onWillSaveState.
//
// Mechanism: temporarily add each stale path's URI path component as a pattern
// key in the *global* files.exclude setting. VS Code's ResourceGlobMatcher
// evaluates the global expression against resource.path (the URI path component),
// so the key is matched literally by minimatch and triggers
// removeExcludedFromHistory() via the HistoryService.onExpressionChange listener.
// VS Code then persists the pruned list via onWillSaveState → saveState().
// After a 1000ms delay, the added patterns are removed from files.exclude.
//
// Stale entries are detected by reading history.entries from state.vscdb via the
// sqlite3 CLI (available by default on macOS and most Linux distributions).
// If sqlite3 is unavailable the feature silently skips.
//
// Note: VS Code automatically removes history entries for workspace-internal
// files when it detects their deletion while running. The global files.exclude
// trick handles the complementary cases: files deleted while VS Code was closed
// (both internal and external), and external files that VS Code may not watch.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { fileURLToPath } = require('url');

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
 * Prunes stale paths from VS Code's in-memory editor history by temporarily
 * adding their absolute URI paths to the *global* files.exclude setting.
 *
 * VS Code's ResourceGlobMatcher evaluates the global expression against
 * resource.path (the URI path component). A pattern key equal to that path
 * is therefore matched literally by minimatch, triggering
 * removeExcludedFromHistory() via the HistoryService.onExpressionChange listener.
 * After a 1000ms delay the added patterns are removed, restoring files.exclude.
 *
 * EXPERIMENTAL: If VS Code's global-scope matching behaviour changes,
 * the call silently does nothing harmful.
 *
 * Note: the global setting is shared across all open VS Code windows. The
 * 1-second change will trigger history cleanup in every window. For local
 * windows this is benign — patterns are absolute paths of files confirmed not
 * to exist on disk. However, if a Remote/SSH window is open whose resources
 * share the same URI path component as a local stale path, those remote history
 * entries could be incorrectly removed. This is an accepted trade-off of the
 * global-only approach.
 *
 * @param {string[]} stalePaths  Absolute filesystem paths that no longer exist
 * @param {object} vscode  The vscode module
 * @returns {Promise<number>}  Number of patterns newly applied (0 on no-op or failure)
 */
async function applyGlobalExcludePrune(stalePaths, vscode) {
  if (stalePaths.length === 0) return 0;

  const config = vscode.workspace.getConfiguration('files');
  const currentValue = config.inspect('exclude')?.globalValue ?? {};

  // Track only pattern keys not already in the user's global config. Also save
  // the original value for any key that existed but was not already true (e.g.
  // false) so the restore step can return it to its original value.
  const allPatternKeys = stalePaths.map((p) => escapeGlob(vscode.Uri.file(p).path));
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

  return newlyAdded.length + Object.keys(overridden).length;
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

    // Requires a workspace (state.vscdb lives at the workspace storage level).
    if (!vscode.workspace.workspaceFolders?.length) {
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

    const n = await applyGlobalExcludePrune(stalePaths, vscode);
    log('  global files.exclude (experimental) — applied', n, 'pattern(s)');
  }

  if (vscode.workspace.getConfiguration('editorTweaks.pruneOpenHistory').get('runAtStartup')) {
    // Log unexpected errors to the output channel to aid debugging;
    // expected failures (no sqlite3, no workspace, etc.) are handled inside run().
    run().catch((err) => log('[unexpected]', err?.stack ?? err?.message ?? err));
  }

  return run;
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  fileUriToFsPath,
  escapeGlob,
  applyGlobalExcludePrune,
};

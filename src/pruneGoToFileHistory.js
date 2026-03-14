'use strict';

// Prunes VS Code's Go-to-File (Cmd+P) editor history by removing stale entries
// whose paths no longer exist on disk.
//
// VS Code stores per-workspace editor history in the workspace's state.vscdb
// SQLite database under the key 'history.entries' (storage scope = workspace).
// The history is loaded into memory at startup and persisted via onWillSaveState.
//
// Stale paths are queued during activate() and written back to state.vscdb in
// deactivate(). VS Code saves its in-memory state before calling deactivate(),
// so the write targets the final persisted value; pruning takes effect on the
// next launch. This is best-effort — if VS Code writes state after deactivate()
// the stale entries will be re-introduced and pruned on the following restart.
//
// Reading / writing history.entries from SQLite requires the sqlite3 CLI
// (available by default on macOS and most Linux distributions). If unavailable
// the feature silently skips.

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { fileURLToPath } = require('url');

/** @typedef {{ editor?: { resource?: string } }} HistoryEntry */

// Stale paths accumulated across run() calls; written to state.vscdb in deactivate().
/** @type {{ stateDbPath: string, stalePaths: Set<string> } | null} */
let _pendingDbCleanup = null;

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
 * Reads and parses history.entries from the VS Code workspace storage SQLite
 * database via the sqlite3 CLI. Returns the raw entries array, an empty array
 * if the DB has no entries, or null on failure (sqlite3 error, parse failure,
 * or unexpected value type).
 * @param {string} stateDbPath
 * @param {number} [timeout]
 * @returns {HistoryEntry[]|null}
 */
function readHistoryEntriesFromDb(stateDbPath, timeout = 5000) {
  const result = childProcess.spawnSync(
    'sqlite3',
    [stateDbPath, "SELECT value FROM ItemTable WHERE key='history.entries';"],
    { timeout, encoding: 'utf8' },
  );
  if (result.status !== 0 || result.error) return null;
  const json = (result.stdout ?? '').trim();
  if (!json) return [];
  try {
    const entries = JSON.parse(json);
    return Array.isArray(entries) ? entries : null;
  } catch {
    return null;
  }
}

/**
 * Reads history.entries from the VS Code workspace storage SQLite database via
 * the sqlite3 CLI. Returns an array of filesystem paths, or null on failure.
 * @param {string} stateDbPath  Absolute path to the workspace state.vscdb file
 * @returns {string[]|null}
 */
function readWorkspaceHistoryPaths(stateDbPath) {
  const entries = readHistoryEntriesFromDb(stateDbPath);
  if (entries === null) return null;

  const paths = [];
  for (const entry of entries) {
    if (!entry?.editor?.resource) continue;
    const fsPath = fileUriToFsPath(entry.editor.resource);
    if (fsPath) paths.push(fsPath);
  }
  return paths;
}

/**
 * Writes a cleaned history.entries array back to state.vscdb using the sqlite3
 * CLI. Called only from deactivate() — after VS Code has already written its
 * final in-memory state — so the cleaned version persists into the next launch.
 * @param {string} stateDbPath
 * @param {Set<string>} stalePaths  Absolute paths to remove
 * @returns {boolean}  true if the write succeeded
 */
function cleanStalePathsFromDb(stateDbPath, stalePaths) {
  // Re-read current DB entries so we clean the final persisted state.
  const entries = readHistoryEntriesFromDb(stateDbPath, 2000);
  if (entries === null) return false;
  if (entries.length === 0) return true; // no entries in db — nothing to remove

  const cleaned = entries.filter((entry) => {
    const fsPath = entry?.editor?.resource ? fileUriToFsPath(entry.editor.resource) : null;
    return !fsPath || !stalePaths.has(fsPath);
  });
  if (cleaned.length === entries.length) return true; // nothing to remove

  const cleanedJson = JSON.stringify(cleaned);
  // Escape single-quote characters for the SQLite literal.
  const escaped = cleanedJson.replace(/'/g, "''");
  const writeResult = childProcess.spawnSync('sqlite3', [stateDbPath], {
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
    out.appendLine('─'.repeat(50));

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

    // Queue for SQLite cleanup at deactivation. Merge with any existing set so
    // multiple run() calls in the same session accumulate all stale paths.
    if (_pendingDbCleanup && _pendingDbCleanup.stateDbPath === stateDbPath) {
      for (const p of stalePaths) _pendingDbCleanup.stalePaths.add(p);
    } else {
      _pendingDbCleanup = { stateDbPath, stalePaths: new Set(stalePaths) };
    }
    log(' ', stalePaths.length, 'stale path(s) queued for SQLite cleanup on shutdown');
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
  const { stateDbPath, stalePaths } = _pendingDbCleanup;
  _pendingDbCleanup = null;
  // Re-validate at shutdown: only remove paths still absent — a file may have
  // been restored between startup (when the path was queued) and shutdown.
  const stillMissing = new Set([...stalePaths].filter((p) => !pathExists(p)));
  if (stillMissing.size === 0) return;
  // Best-effort: VS Code typically persists its in-memory state before calling
  // deactivate(), so this write targets the final persisted value. The order
  // is not guaranteed; if VS Code writes after us the cleaned entries will be
  // re-introduced and the prune will take effect on the following restart.
  cleanStalePathsFromDb(stateDbPath, stillMissing);
}

module.exports = {
  activate,
  deactivate,
  fileUriToFsPath,
  readWorkspaceHistoryPaths,
  cleanStalePathsFromDb,
};

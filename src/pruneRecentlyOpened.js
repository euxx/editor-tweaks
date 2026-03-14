'use strict';

// Prunes the VS Code "recently opened" list by removing entries whose paths no
// longer exist on disk, and optionally trimming entries beyond a configured limit.
//
// Uses the private _workbench.getRecentlyOpened command to read the list, and the
// public vscode.removeFromRecentlyOpened command to delete individual entries.
// If the private API is unavailable (e.g. a future VS Code version removed it),
// the feature silently does nothing.

const fs = require('fs');

/**
 * Returns true when a path exists on disk.
 * Unlike fs.existsSync — which also returns false on permission errors — this
 * function only treats ENOENT (file not found) as non-existent. All other errors
 * (EACCES, EPERM, disconnected network drives, etc.) are treated as "exists" so
 * that inaccessible-but-valid entries are not incorrectly pruned.
 * @param {string} p
 * @returns {boolean}
 */
function pathExists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    // Unknown error (permission denied, I/O error, etc.) — assume the path exists
    return true;
  }
}

/**
 * Returns the local file-system path for a recently-opened workspace/folder
 * entry, or null if the entry uses a non-local URI scheme (SSH, remote, virtual).
 * @param {{ folderUri?: import('vscode').Uri, workspace?: { configPath: import('vscode').Uri } }} entry
 * @returns {string|null}
 */
function workspacePath(entry) {
  const uri = entry.folderUri ?? entry.workspace?.configPath;
  if (!uri || uri.scheme !== 'file') return null;
  return uri.fsPath;
}

/**
 * Returns the local file-system path for a recently-opened file entry, or null
 * if the entry uses a non-local URI scheme.
 * @param {{ fileUri: import('vscode').Uri }} entry
 * @returns {string|null}
 */
function filePath(entry) {
  const uri = entry.fileUri;
  if (!uri || uri.scheme !== 'file') return null;
  return uri.fsPath;
}

/**
 * Computes which paths should be removed from the recently-opened list.
 *
 * For each category (workspaces, files) the function iterates entries in
 * most-recent-first order and:
 *   1. Skips non-file:// entries entirely (can't check or remove them).
 *   2. Marks an entry for removal when its path no longer exists on disk.
 *   3. After stale entries are filtered out, marks entries beyond maxItems for
 *      removal (oldest entries are removed first).
 *
 * @param {Array<{folderUri?: import('vscode').Uri, workspace?: {configPath: import('vscode').Uri}}>} workspaces
 * @param {Array<{fileUri: import('vscode').Uri}>} files
 * @param {number} maxItems  Maximum local entries to keep per category; -1 = no limit
 * @param {(p: string) => boolean} existsFn  Path existence check — injectable for tests
 *                                             (production code uses pathExists above)
 * @returns {string[]}  File-system paths to pass to vscode.removeFromRecentlyOpened
 */
function computeRemovals(workspaces, files, maxItems, existsFn) {
  const toRemove = [];

  /**
   * Processes one category of entries.
   * Assumes entries are ordered most-recent-first (as returned by the private
   * _workbench.getRecentlyOpened API). The maxItems limit keeps the first N
   * valid local entries and removes the rest (oldest-first).
   * @param {Array<any>} entries
   * @param {(e: any) => string|null} getPath
   */
  function processCategory(entries, getPath) {
    let kept = 0;
    for (const entry of entries) {
      const path = getPath(entry);
      if (path === null) {
        // Non-file:// entry (SSH, virtual, etc.) — leave it untouched
        continue;
      }
      if (!existsFn(path)) {
        // Stale: path no longer exists on disk
        toRemove.push(path);
        continue;
      }
      kept++;
      if (maxItems >= 0 && kept > maxItems) {
        // Exceeds the per-category limit (entries are most-recent-first, so
        // older valid entries are removed once the limit is reached)
        toRemove.push(path);
      }
    }
  }

  processCategory(workspaces, workspacePath);
  processCategory(files, filePath);

  return toRemove;
}

/**
 * @param {import('vscode').ExtensionContext} context
 * @param {import('vscode').OutputChannel} out  Shared output channel from extension.js
 */
function activate(_context, out) {
  // Lazy-load vscode so the pure helper functions remain testable without the extension host
  const vscode = require('vscode');

  async function run() {
    const config = vscode.workspace.getConfiguration('editorTweaks.pruneOpenHistory');
    if (!config.get('enable')) return;

    const maxItems = config.get('maxItems') ?? -1;

    let recentlyOpened;
    try {
      recentlyOpened = await vscode.commands.executeCommand('_workbench.getRecentlyOpened');
    } catch {
      // Private API unavailable (may be removed in a future VS Code version)
      out.appendLine('[pruneRecentlyOpened] skipped: private API unavailable');
      return;
    }

    const { workspaces = [], files = [] } = recentlyOpened ?? {};

    // Build a map from fsPath → URI string so we can pass the correct URI to
    // removeFromRecentlyOpened (it expects a URI string like "file:///path",
    // not a plain fsPath — on Windows fsPath and URI string differ).
    const pathToUri = new Map();
    for (const entry of workspaces) {
      const uri = entry.folderUri ?? entry.workspace?.configPath;
      if (uri?.scheme === 'file') pathToUri.set(uri.fsPath, uri.toString());
    }
    for (const entry of files) {
      const uri = entry.fileUri;
      if (uri?.scheme === 'file') pathToUri.set(uri.fsPath, uri.toString());
    }

    const toRemove = computeRemovals(workspaces, files, maxItems, pathExists);

    let removed = 0;
    let failed = 0;
    for (const fsPath of toRemove) {
      // Fall back to fsPath if the URI isn't found (shouldn't happen in practice)
      const uriString = pathToUri.get(fsPath) ?? fsPath;
      try {
        await vscode.commands.executeCommand('vscode.removeFromRecentlyOpened', uriString);
        removed++;
      } catch {
        // Ignore per-entry errors so a single failure doesn't abort the remaining removals
        failed++;
      }
    }
    if (toRemove.length > 0) {
      const failNote = failed > 0 ? ` (${failed} failed)` : '';
      out.appendLine(`[pruneRecentlyOpened] removed ${removed}/${toRemove.length} entries${failNote}`);
    }
  }

  // Run automatically on startup if enabled
  if (vscode.workspace.getConfiguration('editorTweaks.pruneOpenHistory').get('runAtStartup')) {
    // Log unexpected errors to aid debugging; expected failures are handled inside run().
    run().catch((err) => out.appendLine(`[unexpected] ${err?.stack ?? err?.message ?? String(err)}`));
  }

  return run;
}

function deactivate() {}

module.exports = { activate, deactivate, computeRemovals, workspacePath, filePath };

"use strict";

// Automatically saves file snapshots on every save, providing a safety net
// against accidental loss — particularly for files not yet committed to git.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

// Per-file state: { lastTimestamp: number, lastHash: string }
/** @type {Map<string, { lastTimestamp: number, lastHash: string }>} */
const fileState = new Map();

/**
 * Resolves the history root path, expanding ~ and $ENV_VAR / ${ENV_VAR}.
 * @param {string} historyPath
 * @returns {string}
 */
function resolveHistoryPath(historyPath) {
  let resolved = historyPath;
  if (resolved.startsWith("~")) {
    resolved = path.join(os.homedir(), resolved.slice(1));
  }
  resolved = resolved.replace(/\$\{?(\w+)\}?/g, (_, name) => process.env[name] || "");
  return resolved;
}

/**
 * Canonicalizes an absolute file path for use as a history subdirectory.
 * Strips drive letter colons on Windows (C:\Users → C\Users).
 * @param {string} filePath
 * @returns {string}
 */
function canonicalizePath(filePath) {
  // Only strip the colon from Windows drive letters, not arbitrary colons in POSIX paths
  return filePath.replace(/^([A-Za-z]):/, "$1");
}

/**
 * Generates a timestamp string with millisecond precision: YYYYMMDDTHHmmssSSS
 * @param {Date} [date]
 * @returns {string}
 */
function formatTimestamp(date) {
  const d = date || new Date();
  const pad2 = (n) => String(n).padStart(2, "0");
  const pad3 = (n) => String(n).padStart(3, "0");
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}${pad3(d.getMilliseconds())}`
  );
}

/**
 * Parses a snapshot filename back to a Date.
 * Expects format: YYYYMMDDTHHmmssSSS.ext or YYYYMMDDTHHmmssSSS
 * @param {string} filename
 * @returns {Date | null}
 */
function parseTimestamp(filename) {
  // Strip extension: take basename up to first dot after the timestamp
  const base = filename.replace(/\.[^/\\]*$/, "");
  const m = base.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})$/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]);
}

/**
 * Tests whether a file path matches any of the exclude patterns.
 * Patterns support ** for directory traversal and * for single-segment matching.
 * Paths are normalized to / separators before matching.
 * @param {string} filePath - absolute file path
 * @param {string[]} workspaceFolders - absolute paths of workspace folders
 * @param {string[]} patterns
 * @returns {boolean}
 */
function isExcluded(filePath, workspaceFolders, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;

  const normalized = filePath.replace(/\\/g, "/");

  // Try workspace-relative path; fall back to absolute path
  let candidate = normalized;
  for (const folder of workspaceFolders) {
    const normalizedFolder = folder.replace(/\\/g, "/").replace(/\/$/, "");
    if (normalized.startsWith(normalizedFolder + "/")) {
      candidate = normalized.slice(normalizedFolder.length + 1);
      break;
    }
  }

  for (const pattern of patterns) {
    if (typeof pattern !== "string") continue;
    if (globMatch(candidate, pattern)) return true;
    // Also try against the full normalized path for files outside workspace
    if (candidate !== normalized && globMatch(normalized, pattern)) return true;
  }
  return false;
}

/**
 * Simple glob matcher supporting * and **.
 * @param {string} str - the string to test
 * @param {string} pattern - glob pattern
 * @returns {boolean}
 */
function globMatch(str, pattern) {
  // Convert glob to regex
  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      // ** matches any number of path segments
      if (pattern[i + 2] === "/") {
        regex += "(?:.+/|)";
        i += 3;
      } else {
        regex += ".*";
        i += 2;
      }
    } else if (pattern[i] === "*") {
      regex += "[^/]*";
      i += 1;
    } else if (pattern[i] === "?") {
      regex += "[^/]";
      i += 1;
    } else {
      regex += pattern[i].replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return new RegExp(`^${regex}$`).test(str);
}

/**
 * Returns the history directory for a given source file.
 * @param {string} historyRoot - resolved history root path
 * @param {string} filePath - absolute source file path
 * @returns {string}
 */
function getHistoryDir(historyRoot, filePath) {
  return path.join(historyRoot, canonicalizePath(filePath));
}

/**
 * Writes a snapshot of the given buffer to the history directory.
 * Writes a snapshot and returns its hash; sets written=false when content matches lastHash.
 * @param {string} historyDir
 * @param {Buffer} buffer
 * @param {string} ext - file extension including dot, or empty string
 * @param {string | undefined} lastHash - last known hash for dedup
 * @returns {Promise<{ hash: string, written: boolean, snapshotPath: string }>}
 */
async function writeSnapshot(historyDir, buffer, ext, lastHash) {
  const hash = crypto.createHash("sha1").update(buffer).digest("hex");
  if (hash === lastHash) {
    return { hash, written: false, snapshotPath: "" };
  }

  await fs.promises.mkdir(historyDir, { recursive: true });
  const snapshotName = `${formatTimestamp()}${ext}`;
  const snapshotPath = path.join(historyDir, snapshotName);
  await fs.promises.writeFile(snapshotPath, buffer);
  return { hash, written: true, snapshotPath };
}

/**
 * Trims a history directory to maxVersions by deleting the oldest snapshots.
 * @param {string} historyDir
 * @param {number} maxVersions
 * @param {(msg: string) => void} [onError] - called with a single-line error message; defaults to console.warn
 */
async function trimHistory(historyDir, maxVersions, onError = (msg) => console.warn(msg)) {
  if (maxVersions <= 0) return;
  let entries;
  try {
    entries = await fs.promises.readdir(historyDir, { withFileTypes: true });
  } catch {
    return;
  }
  // Only count regular files (ignore subdirectories)
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  if (files.length <= maxVersions) return;

  // Sort ascending by name (timestamp-based names sort naturally)
  files.sort();
  const toDelete = files.slice(0, files.length - maxVersions);
  await Promise.all(
    toDelete.map((entry) =>
      fs.promises
        .unlink(path.join(historyDir, entry))
        .catch((err) => onError(`[fileHistory] trim delete failed: ${err.message}`)),
    ),
  );
}

/**
 * Runs expiry cleanup: deletes snapshots older than maxDays across all history.
 * Scans per-file directories under historyRoot.
 * @param {string} historyRoot
 * @param {number} maxDays
 * @param {(msg: string) => void} [onError] - called with a single-line error message; defaults to console.warn
 */
async function runExpiryCleanup(historyRoot, maxDays, onError = (msg) => console.warn(msg)) {
  if (maxDays <= 0) return;
  const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;

  async function scanDir(dir) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Process snapshot files in this directory (if any)
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const parsed = parseTimestamp(entry.name);
      if (parsed && parsed.getTime() < cutoff) {
        await fs.promises
          .unlink(path.join(dir, entry.name))
          .catch((err) => onError(`[fileHistory] expiry delete failed: ${err.message}`));
      }
    }

    // Recurse into subdirectories
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await scanDir(path.join(dir, entry.name));
      }
    }

    // Remove directory if now empty
    try {
      const remaining = await fs.promises.readdir(dir);
      if (remaining.length === 0) await fs.promises.rmdir(dir);
    } catch {
      // ignore
    }
  }

  try {
    await scanDir(historyRoot);
  } catch {
    // History root doesn't exist yet — nothing to clean
  }
}

/**
 * Returns sorted snapshot entries for a file (newest first).
 * @param {string} historyDir
 * @returns {Promise<Array<{ name: string, date: Date }>>}
 */
async function listSnapshots(historyDir) {
  let entries;
  try {
    entries = await fs.promises.readdir(historyDir);
  } catch {
    return [];
  }
  const snapshots = [];
  for (const name of entries) {
    const date = parseTimestamp(name);
    if (date) snapshots.push({ name, date });
  }
  snapshots.sort((a, b) => b.date.getTime() - a.date.getTime());
  return snapshots;
}

/**
 * Loads the SHA-1 hash and timestamp of the most recent snapshot from disk.
 * Used to restore state after VS Code restart.
 * @param {string} historyDir
 * @returns {Promise<{ hash: string, timestamp: number } | null>}
 */
async function loadLastSnapshotState(historyDir) {
  const latest = await listSnapshots(historyDir);
  if (latest.length === 0) return null;
  try {
    const buffer = await fs.promises.readFile(path.join(historyDir, latest[0].name));
    const hash = crypto.createHash("sha1").update(buffer).digest("hex");
    return { hash, timestamp: latest[0].date.getTime() };
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Gets the file extension including the dot, or empty string for extensionless files.
 * @param {string} filePath
 * @returns {string}
 */
function getExt(filePath) {
  const ext = path.extname(filePath);
  return ext; // already includes dot, or empty string
}

/**
 * Reads configuration for file history.
 * @param {typeof import('vscode')} vscode
 * @returns {{ enable: boolean, historyPath: string, minIntervalSeconds: number, maxVersionsPerFile: number, maxDays: number, maxFileSizeKB: number, excludePatterns: string[] }}
 */
function getConfig(vscode) {
  const config = vscode.workspace.getConfiguration("editorTweaks.fileHistory");
  return {
    enable: config.get("enable", true),
    historyPath: config.get("historyPath", "~/.file-history"),
    minIntervalSeconds: Math.max(1, config.get("minIntervalSeconds", 60)),
    maxVersionsPerFile: config.get("maxVersionsPerFile", 60),
    maxDays: config.get("maxDays", 30),
    maxFileSizeKB: config.get("maxFileSizeKB", 512),
    excludePatterns: config.get("excludePatterns", ["**/.git/**", "**/node_modules/**"]),
  };
}

/**
 * @param {import('vscode').ExtensionContext} context
 * @param {import('vscode').OutputChannel} [out] - shared output channel; falls back to console.warn
 */
function activate(context, out) {
  const vscode = require("vscode");
  const log = out ? (msg) => out.appendLine(msg) : (msg) => console.warn(msg);

  // Tracks files that have already been logged as "skipped due to size" so we
  // emit at most one log line per file per session, avoiding output-channel spam.
  /** @type {Set<string>} */
  const loggedLargeFiles = new Set();

  // Clear hash cache when historyPath changes so new directory gets a fresh baseline
  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("editorTweaks.fileHistory.historyPath")) {
      fileState.clear();
      loggedLargeFiles.clear();
    }
  });

  /**
   * Shared snapshot picker: validates editor, lists snapshots, shows QuickPick.
   * @param {typeof import('vscode')} vs
   * @param {string} placeHolder
   * @returns {Promise<{ editor: import('vscode').TextEditor, filePath: string, historyDir: string, selected: { label: string, snapshot: { name: string, date: Date } } } | null>}
   */
  async function pickSnapshot(vs, placeHolder) {
    const editor = vs.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") {
      vs.window.showInformationMessage("No active file.");
      return null;
    }

    const cfg = getConfig(vs);
    const historyRoot = resolveHistoryPath(cfg.historyPath);
    const filePath = editor.document.uri.fsPath;
    const historyDir = getHistoryDir(historyRoot, filePath);

    const snapshots = await listSnapshots(historyDir);
    if (snapshots.length === 0) {
      vs.window.showInformationMessage("No history found for this file.");
      return null;
    }

    const items = snapshots.map((s) => ({
      label: s.date.toLocaleString(),
      description: s.name,
      snapshot: s,
    }));

    const selected = await vs.window.showQuickPick(items, { placeHolder });
    if (!selected) return null;

    return { editor, filePath, historyDir, selected };
  }

  /**
   * Returns { lastHash, lastTimestamp } from memory or disk.
   * @param {string} filePath
   * @param {string} historyDir
   * @returns {Promise<{ lastHash: string | undefined, lastTimestamp: number }>}
   */
  async function ensureFileState(filePath, historyDir) {
    const state = fileState.get(filePath);
    let lastHash = state?.lastHash;
    let lastTimestamp = state?.lastTimestamp || 0;
    if (!lastHash) {
      const diskState = await loadLastSnapshotState(historyDir);
      if (diskState) {
        lastHash = diskState.hash;
        lastTimestamp = diskState.timestamp;
      }
    }
    return { lastHash, lastTimestamp };
  }

  // Save event listener
  const saveListener = vscode.workspace.onDidSaveTextDocument(async (document) => {
    const cfg = getConfig(vscode);
    if (!cfg.enable) return;
    if (document.uri.scheme !== "file") return;

    const filePath = document.uri.fsPath;
    const historyRoot = resolveHistoryPath(cfg.historyPath);

    // Exclude check
    const workspaceFolders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
    if (isExcluded(filePath, workspaceFolders, cfg.excludePatterns)) return;

    // Time gate
    const state = fileState.get(filePath);
    const now = Date.now();
    if (state && now - state.lastTimestamp < cfg.minIntervalSeconds * 1000) return;

    // Size check
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > cfg.maxFileSizeKB * 1024) {
        if (!loggedLargeFiles.has(filePath)) {
          loggedLargeFiles.add(filePath);
          const sizeKB = Math.round(stat.size / 1024);
          log(
            `[fileHistory] skipped large file: ${filePath} (${sizeKB}KB > ${cfg.maxFileSizeKB}KB limit)`,
          );
        }
        return;
      }
    } catch {
      return;
    }

    // Read file, hash, and write snapshot
    try {
      const buffer = await fs.promises.readFile(filePath);
      const historyDir = getHistoryDir(historyRoot, filePath);
      const ext = getExt(filePath);

      const { lastHash, lastTimestamp } = await ensureFileState(filePath, historyDir);

      // Re-check time gate with restored timestamp (may have loaded from disk)
      if (lastTimestamp && now - lastTimestamp < cfg.minIntervalSeconds * 1000) {
        fileState.set(filePath, { lastTimestamp, lastHash });
        return;
      }

      const result = await writeSnapshot(historyDir, buffer, ext, lastHash);

      // Only update timestamp when a snapshot is actually written;
      // hash-only match should not reset the time gate
      if (result.written) {
        fileState.set(filePath, { lastTimestamp: now, lastHash: result.hash });
        await trimHistory(historyDir, cfg.maxVersionsPerFile, log);
      } else {
        fileState.set(filePath, { lastTimestamp, lastHash: result.hash });
      }
    } catch (err) {
      log(`[fileHistory] snapshot failed for ${filePath}: ${err?.message || err}`);
    }
  });

  // Show history command
  const showCmd = vscode.commands.registerCommand("editorTweaks.fileHistory.show", async () => {
    const result = await pickSnapshot(vscode, "Select a version to compare");
    if (!result) return;

    const { historyDir, selected, filePath, editor } = result;
    const snapshotUri = vscode.Uri.file(path.join(historyDir, selected.snapshot.name));
    const currentUri = editor.document.uri;
    const title = `${path.basename(filePath)} (${selected.label}) ↔ Current`;
    await vscode.commands.executeCommand("vscode.diff", snapshotUri, currentUri, title);
  });

  // Restore command
  const restoreCmd = vscode.commands.registerCommand(
    "editorTweaks.fileHistory.restore",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme !== "file") {
        vscode.window.showInformationMessage("No active file to restore.");
        return;
      }

      if (editor.document.isDirty) {
        vscode.window.showWarningMessage(
          "Please save or discard your changes before restoring a historical version.",
        );
        return;
      }

      const result = await pickSnapshot(vscode, "Select a version to restore");
      if (!result) return;

      const { historyDir, selected, filePath } = result;
      const cfg = getConfig(vscode);

      const confirm = await vscode.window.showWarningMessage(
        `Restore ${path.basename(filePath)} to ${selected.label}?`,
        { modal: true },
        "Restore",
      );
      if (confirm !== "Restore") return;

      try {
        // Read the snapshot to restore BEFORE writing checkpoint (trim might delete it)
        const snapshotPath = path.join(historyDir, selected.snapshot.name);
        const snapshotBuffer = await fs.promises.readFile(snapshotPath);

        // Pre-restore checkpoint: bypass time gate, but respect hash dedup and size guard
        const checkpointStat = await fs.promises.stat(filePath);
        if (checkpointStat.size > cfg.maxFileSizeKB * 1024) {
          // File too large for checkpoint — warn user before proceeding
          const proceed = await vscode.window.showWarningMessage(
            "File exceeds size limit — pre-restore backup will be skipped.",
            { modal: true },
            "Continue",
          );
          if (proceed !== "Continue") return;
        } else {
          const currentBuffer = await fs.promises.readFile(filePath);
          const ext = getExt(filePath);

          const { lastHash } = await ensureFileState(filePath, historyDir);

          const checkpoint = await writeSnapshot(historyDir, currentBuffer, ext, lastHash);
          fileState.set(filePath, { lastTimestamp: Date.now(), lastHash: checkpoint.hash });
          if (checkpoint.written) {
            await trimHistory(historyDir, cfg.maxVersionsPerFile, log);
          }
        }

        // Restore the selected version. We deliberately write raw bytes via
        // fs.writeFile rather than going through vscode.workspace.applyEdit:
        // - Snapshots are byte-exact backups; decoding to text would lose bytes
        //   for non-UTF-8 files and may be re-normalised (EOL, BOM) on save.
        // - The command already guarded editor.document.isDirty === false above,
        //   and VS Code silently reloads a clean document when its file changes
        //   on disk, so no "file changed externally" dialog appears.
        await fs.promises.writeFile(filePath, snapshotBuffer);

        // Reset time gate so the first save after restore is not blocked,
        // but set hash of restored content for dedup
        const restoredHash = crypto.createHash("sha1").update(snapshotBuffer).digest("hex");
        fileState.set(filePath, { lastTimestamp: 0, lastHash: restoredHash });

        vscode.window.showInformationMessage(
          `Restored ${path.basename(filePath)} to ${selected.label}.`,
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to restore: ${err.message}`);
      }
    },
  );

  // Open history folder command
  const openFolderCmd = vscode.commands.registerCommand(
    "editorTweaks.fileHistory.openHistoryFolder",
    async () => {
      const cfg = getConfig(vscode);
      const historyRoot = resolveHistoryPath(cfg.historyPath);
      const folders = vscode.workspace.workspaceFolders || [];

      let targetDir;

      // (1) Active editor belongs to a workspace folder
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        const fileUri = activeEditor.document.uri;
        const wsFolder = vscode.workspace.getWorkspaceFolder(fileUri);
        if (wsFolder) {
          targetDir = path.join(historyRoot, canonicalizePath(wsFolder.uri.fsPath));
        }
      }

      // (2) Single workspace folder
      if (!targetDir && folders.length === 1) {
        targetDir = path.join(historyRoot, canonicalizePath(folders[0].uri.fsPath));
      }

      // (3) Multiple workspace folders — Quick Pick
      if (!targetDir && folders.length > 1) {
        const items = folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f }));
        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "Select a workspace folder",
        });
        if (!selected) return;
        targetDir = path.join(historyRoot, canonicalizePath(selected.folder.uri.fsPath));
      }

      // (4) No workspace folder but active file — open its history directory
      if (!targetDir && activeEditor && activeEditor.document.uri.scheme === "file") {
        targetDir = getHistoryDir(historyRoot, activeEditor.document.uri.fsPath);
      }

      // (5) No workspace folder, no active file — open history root
      if (!targetDir) {
        targetDir = historyRoot;
      }

      try {
        await fs.promises.access(targetDir);
        await vscode.env.openExternal(vscode.Uri.file(targetDir));
      } catch {
        vscode.window.showInformationMessage("No file history yet for this workspace.");
      }
    },
  );

  context.subscriptions.push(configListener, saveListener, showCmd, restoreCmd, openFolderCmd);

  // Expiry cleanup: run once, deferred
  const cfg = getConfig(vscode);
  if (cfg.enable && cfg.maxDays > 0) {
    const cleanupTimer = setTimeout(() => {
      const root = resolveHistoryPath(cfg.historyPath);
      runExpiryCleanup(root, cfg.maxDays, log).catch(() => {});
    }, 5000);
    context.subscriptions.push({ dispose: () => clearTimeout(cleanupTimer) });
  }
}

function deactivate() {
  // Disposables are owned by context.subscriptions and disposed automatically by VS Code.
  // Only module-level state needs to be cleared here.
  fileState.clear();
}

module.exports = {
  activate,
  deactivate,
  // Exported for testing
  resolveHistoryPath,
  canonicalizePath,
  formatTimestamp,
  parseTimestamp,
  isExcluded,
  globMatch,
  getHistoryDir,
  writeSnapshot,
  trimHistory,
  runExpiryCleanup,
  listSnapshots,
  loadLastSnapshotState,
  getExt,
};

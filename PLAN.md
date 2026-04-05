# Editor Tweaks — Development Plan

## Background & Motivation

The following VS Code extensions are being replaced by this single extension:

| Extension                               | Last Updated        | Install Count | Reason to Replace              |
| --------------------------------------- | ------------------- | ------------- | ------------------------------ |
| `britesnow.vscode-toggle-quotes`        | 2019 (5+ years ago) | ~347K         | No longer maintained           |
| `cliffordfajardo.highlight-line-vscode` | 2021 (3+ years ago) | ~unknown      | No longer maintained           |
| `redlin.remove-tabs-on-save`            | unknown             | ~9K           | Single-purpose, easy to absorb |
| `crendking.recently-opened-sweeper`     | unknown             | ~unknown      | Single-purpose, easy to absorb |

The extension also includes original features not replacing any existing extension:

| Feature          | Purpose                                                              |
| ---------------- | -------------------------------------------------------------------- |
| Git Auto Refresh | Periodically refreshes git status when VS Code is not focused        |
| File History     | Saves file snapshots on every save as a safety net against data loss |

**Goals:**

- Reduce total installed extensions by consolidating small, unmaintained utilities
- Maintain feature parity with the replaced extensions
- Add per-feature enable/disable configuration

---

## Scope (v1.0)

Features, implemented independently within one extension:

### 1. Toggle Quotes

Cycles the quote character surrounding the cursor: `"` → `'` → `` ` `` → `"` …

**Behavior:**

- Triggered by `Alt+'` (configurable via keybinding)
- Detects the quote character enclosing the cursor position
- Replaces opening and closing quote delimiters
- Handles escaped characters inside the string (e.g., `\"` → `'` unescapes)
- Works with multiple selections
- **Limitation:** template literal expressions (`${...}`) are not parsed; quotes inside `${...}` may be mis-escaped when toggling to/from backtick

**Config:**

- `editorTweaks.toggleQuotes.enable` (boolean, default: `true`)
- `editorTweaks.toggleQuotes.chars` (string[], default: `["\"", "'", "\`"]`)

### 2. Highlight Current Line

Applies a bottom border decoration to the current line.

**Behavior:**

- Active editor: full-brightness bottom border following the cursor
- Other visible editors: same border at 70% opacity, pinned to their last cursor position
- Updates only when cursor moves to a different line (skip redraw on column-only changes)
- Re-applies to all visible editors when configuration changes

**Config:**

- `editorTweaks.highlightLine.enable` (boolean, default: `true`)
- `editorTweaks.highlightLine.borderColor` (string, default: `"#65EAB9"`, empty = disabled)
- `editorTweaks.highlightLine.borderStyle` (string enum: `"solid"` | `"dashed"` | `"dotted"`, default: `"solid"`)
- `editorTweaks.highlightLine.borderWidth` (string CSS length, default: `"1px"`)

### 3. Remove Tabs on Save

Before writing a file to disk, replaces all `\t` characters with the appropriate number of spaces, based on the editor's `tabSize` setting.

**Behavior:**

- Intercepts `onWillSaveTextDocument` and injects `TextEdit` replacements
- Respects per-language `tabSize` configuration
- Skips files matching any exclusion pattern

**Config:**

- `editorTweaks.removeTabsOnSave.enable` (boolean, default: `true`)
- `editorTweaks.removeTabsOnSave.excludePatterns` (string[], default: `["makefile", "*.go"]`) — patterns to skip; each entry is a language ID, exact filename, or `*`-glob matched against the basename

### 4. Prune Recently Opened

Removes stale and excess entries from the VS Code recently-opened list.

**Background:**
Replaces [`crendking.recently-opened-sweeper`](https://marketplace.visualstudio.com/items?itemName=crendking.recently-opened-sweeper).

**Behavior:**

- Iterates all workspace/folder and file entries in the recently-opened list
- Removes any `file://` entry whose path no longer exists on disk
- Optionally trims entries beyond a configured count (workspaces and files counted separately)
- Non-`file://` entries (SSH, virtual workspaces) are always kept untouched
- Runs automatically on startup (configurable) and via a manual command

**VS Code APIs:**

- `_workbench.getRecentlyOpened` (private, undocumented) — only available way to read the list
- `vscode.removeFromRecentlyOpened` (public) — removes a single entry by path

**Improvements over original:**

- Single `maxItems` setting applies uniformly to both workspaces and files (original has one `keepCount` applied to each category independently, which is less predictable)
- Skips non-`file://` URIs for both workspaces and files (original may call `fsPath` on SSH/virtual file entries)
- Consistent `editorTweaks.*` settings namespace

**Config:**

- `editorTweaks.pruneOpenHistory.enable` (boolean, default: `true`)
- `editorTweaks.pruneOpenHistory.runAtStartup` (boolean, default: `true`)
- `editorTweaks.pruneOpenHistory.maxItems` (number, default: `-1`) — max entries to keep for each category (workspaces and files counted separately); `-1` = no limit

**Command:** `editorTweaks.pruneOpenHistory`

**Note:** Also prunes the Go-to-File (Cmd+P) editor history. Stale paths are detected via the workspace state database (`state.vscdb`) and removed on window close; pruned entries are gone on the next launch. Requires the system `sqlite3` CLI.

### 5. Git Auto Refresh

Periodically calls `git.refresh` so that the SCM Changes view stays up-to-date even when VS Code is not focused (VS Code only polls git status while it has focus).

**Behavior:**

- Uses `setTimeout` (not `setInterval`) to schedule refresh ticks; a slow `git.refresh` never causes concurrent calls
- Skips refresh when VS Code is focused (redundant — VS Code handles this itself)
- Skips when the built-in Git extension is not active, not enabled, or has zero repositories
- Restarts the timer whenever `editorTweaks.gitAutoRefresh.*` configuration changes
- Errors are silently swallowed to avoid spamming notifications every N seconds

**Config:**

- `editorTweaks.gitAutoRefresh.enable` (boolean, default: `true`)
- `editorTweaks.gitAutoRefresh.intervalSec` (integer, default: `10`, minimum: `1`) — how often (in seconds) to refresh git status

### 6. File History

Automatically saves file snapshots on every save, providing a safety net against accidental loss — particularly for files not yet committed to git (e.g., after `git reset --hard` or `git checkout`).

**Motivation:**

Git does not protect uncommitted or unstaged files. This feature provides a lightweight, transparent backup independent of version control state.

**Snapshot trigger:**

- Hooks into `onDidSaveTextDocument`
- Only processes documents with `uri.scheme === 'file'` (skips untitled, virtual, and remote documents)
- Guards with two checks before reading the file (in this order — cheapest first):
  1. **Time gate** (pure memory, no I/O): skip if the same file was snapshotted within `minIntervalSeconds` (configurable, default `60`, minimum `1`). This intentionally limits snapshot frequency even for real changes — the tradeoff is losing at most `minIntervalSeconds - 1` seconds of changes in a catastrophic scenario, in exchange for avoiding snapshot explosion during rapid editing.
  2. **Size check** (one `fs.stat` syscall, no string allocation): skip if the on-disk file size exceeds `maxFileSizeKB * 1024` bytes. This runs before any file read to avoid allocating large buffers for oversized files.
- After both guards pass, the on-disk file is read into a buffer (`fs.readFile`). A **content hash** (`sha1`) is computed from this buffer and compared against the last snapshot's hash for the same file; if identical, the write is skipped. Since the hash and the snapshot data come from the same buffer, there is no TOCTOU inconsistency.
- The snapshot is written from the same buffer via `fs.writeFile`.
- The per-file timestamp and hash are updated **after** the snapshot write succeeds, so a transient I/O failure does not block retries on the next save.

**Storage format:**

Snapshots are stored outside the workspace, keyed by the **file's absolute path** (not the workspace root). Each source file gets its own subdirectory under the history root, ensuring `readdir` for a single file is always O(versions) not O(all files in the same source directory).

```
~/.file-history/
  <absolute-file-path>/
    <ISO-timestamp><ext>
```

Where `<ext>` includes the dot (e.g., `.js`) or is empty for extensionless files (`Makefile`, `.env`, `Dockerfile`). Examples: `20260404T153000000.js`, `20260404T153000000` (for extensionless files).

On macOS/Linux the leading `/` is naturally absorbed by `path.join`. On Windows, the drive letter colon is stripped (e.g., `C:\Users\...` → `C\Users\...`) to produce a valid directory name.

Example: file at `/Users/l/projects/editor-tweaks/src/extension.js`

```
~/.file-history/
  Users/l/projects/editor-tweaks/src/extension.js/
    20260404T153000000.js
    20260404T160000000.js
```

Timestamps use local time in compact ISO format (`YYYYMMDDTHHmmssSSS`, millisecond precision to avoid collisions when the time gate is bypassed).

Storage root is configurable via `editorTweaks.fileHistory.historyPath`; supports `~` and env vars.

**Size guard:**

`maxFileSizeKB` (default `512`): checked before snapshot. Skip the file if source exceeds limit; protects against snapshotting binaries and generated files.

**Cleanup strategy:**

1. **Per-file trim (on every snapshot write):** After writing a new snapshot, immediately check the file's history directory. If it exceeds `maxVersionsPerFile`, delete the oldest snapshots to stay within the limit. Cheap single-directory `readdir` + `unlink`.

2. **Expiry cleanup (once on activation):** Runs once, a few seconds after extension activation. Deletes snapshots older than `maxDays`. Scans only per-file directories, no global size accounting needed.

**v1.1:** Add `maxTotalSizeMB` global capacity limit with chunked/yielded traversal and per-run time budget.

**UI:** Command Palette only — no tree view, no activity bar panel.

Commands:

- `editorTweaks.fileHistory.show` — Show version history for the current file via Quick Pick; each entry shows a timestamp label. Choosing a version opens it in a diff editor (historical ↔ current). Scans the file's history directory via `readdir` — bounded by `maxVersionsPerFile`, instant.
- `editorTweaks.fileHistory.restore` — Restore the current file to the selected historical version. Requires the document to be clean (no unsaved changes); if dirty, shows a warning asking the user to manually save or discard changes first. Before overwriting, automatically creates a snapshot of the current file content ("pre-restore checkpoint") — this checkpoint bypasses the `minIntervalSeconds` time gate but still skips if the content hash matches the latest snapshot (meaning an identical backup already exists). If the file exceeds the size limit, the checkpoint is skipped after user confirmation. Shows a confirmation prompt before proceeding.
- `editorTweaks.fileHistory.openHistoryFolder` — Open the history storage directory for the current workspace in the OS file manager. Workspace resolution: (1) if active editor belongs to a workspace folder, use it; (2) otherwise, if exactly one workspace folder exists, use it; (3) if multiple workspace folders, show Quick Pick; (4) if no workspace folder at all, open the `historyPath` root directory. If the resolved directory does not exist yet (no snapshots taken), shows an informational message.

**v1.1:** `editorTweaks.fileHistory.browse` — Browse history for all files in the current workspace (including deleted ones). Two-step Quick Pick: pick a file, then pick a version. Deleted files can be restored or inspected read-only. Scans `<historyPath>/<canonicalized-workspace-folder-path>/` for the workspace subtree (using the same path canonicalization as snapshot storage); results cached in memory.

**Config:**

- `editorTweaks.fileHistory.enable` (boolean, default: `true`)
- `editorTweaks.fileHistory.historyPath` (string, default: `"~/.file-history"`) — root storage path; supports `~` and `$ENV_VAR`
- `editorTweaks.fileHistory.minIntervalSeconds` (number, default: `60`, minimum: `1`) — minimum seconds between snapshots of the same file (applies even when content changes; set to `1` for near-continuous backup)
- `editorTweaks.fileHistory.maxVersionsPerFile` (number, default: `60`) — maximum snapshots to keep per file
- `editorTweaks.fileHistory.maxDays` (number, default: `30`) — delete snapshots older than this many days
- `editorTweaks.fileHistory.maxFileSizeKB` (number, default: `512`) — skip files larger than this size
- `editorTweaks.fileHistory.excludePatterns` (string[], default: `["**/.git/**", "**/node_modules/**"]`) — glob patterns matched against the workspace-relative path (or absolute path for files outside a workspace) using `minimatch` (or equivalent); supports `**` for directory traversal. Candidate paths are normalized to `/` separators before matching. The `**/` prefix ensures nested directories (e.g., monorepo `packages/foo/node_modules`) are also excluded. Note: only files saved via VS Code's editor trigger snapshots, so generated files (`.pyc`, `.DS_Store`, binaries) are inherently excluded. `.gitignore` is intentionally **not** used as an exclusion source — many gitignored files (`.env.local`, local configs) are exactly the kind of uncommitted work this feature is designed to protect

---

## Technical Design

### Project Structure

```
editor-tweaks/
├── src/
│   ├── extension.js               # Registers all features, handles activate/deactivate
│   ├── toggleQuotes.js            # Toggle Quotes implementation
│   ├── highlightLine.js           # Highlight Line implementation
│   ├── removeTabsOnSave.js        # Remove Tabs on Save implementation
│   ├── pruneRecentlyOpened.js     # Prune Open History — recently opened list
│   ├── pruneGoToFileHistory.js    # Prune Open History — Go-to-File (Cmd+P) history
│   ├── gitAutoRefresh.js          # Git Auto Refresh — periodic git.refresh when unfocused
│   └── fileHistory.js             # File History — snapshot on save, restore via Quick Pick
├── tests/
│   ├── toggleQuotes.test.js
│   ├── highlightLine.test.js
│   ├── removeTabsOnSave.test.js
│   ├── pruneRecentlyOpened.test.js
│   ├── pruneGoToFileHistory.test.js
│   ├── gitAutoRefresh.test.js
│   └── fileHistory.test.js
├── images/
│   └── icon.png
├── package.json
├── vitest.config.mjs
├── AGENTS.md
├── CHANGELOG.md
├── DEVELOPMENT.md
├── PLAN.md
├── RELEASE.md
└── README.md
```

### VS Code APIs Used

| Feature                              | APIs                                                                                                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toggle Quotes                        | `registerCommand`, `TextEditor.edit`, `TextDocument.getText`, `Selection`, `Range`                                                                                                                 |
| Highlight Line                       | `createTextEditorDecorationType`, `TextEditor.setDecorations`, `onDidChangeTextEditorSelection`, `onDidChangeActiveTextEditor`, `onDidChangeConfiguration`, `onDidCloseTextDocument`               |
| Remove Tabs on Save                  | `onWillSaveTextDocument`, `TextEdit.replace`, `workspace.getConfiguration`                                                                                                                         |
| Prune Open History (recently opened) | `registerCommand`, `_workbench.getRecentlyOpened` (private), `vscode.removeFromRecentlyOpened`                                                                                                     |
| Prune Open History (Go-to-File)      | `workspace.getConfiguration`, `spawnSync('sqlite3', ...)` (CLI, for `state.vscdb` read/write)                                                                                                      |
| Git Auto Refresh                     | `extensions.getExtension('vscode.git')`, `commands.executeCommand('git.refresh')`, `window.state.focused`, `onDidChangeConfiguration`, `setTimeout`                                                |
| File History                         | `onDidSaveTextDocument`, `registerCommand`, `window.showQuickPick`, `commands.executeCommand('vscode.diff', ...)`, `commands.executeCommand('revealFileInOS', ...)`, `fs.readFile`, `fs.writeFile` |

### Activation

```json
"activationEvents": ["onStartupFinished"]
```

All features are loaded once on startup. Each feature checks its `enable` configuration flag before registering listeners or commands.

---

## Implementation Order

1. **Project scaffold** — `package.json`, config files, `.husky`, linting
2. **Remove Tabs on Save** — simplest, pure document mutation
3. **Toggle Quotes** — string parser; add unit tests for quote boundary detection
4. **Highlight Line** — decoration management with event listeners
5. **Prune Recently Opened** — async command; private API; startup trigger
6. **Git Auto Refresh** — timer-based background task; config listener _(done)_
7. **File History** — snapshot on save; Quick Pick UI; cleanup on activation
8. **README + icon** — write user-facing docs, add icon
9. **Publish** — `vsce package` then `vsce publish`

---

## Publishing

- Publisher: `euxx`
- Extension ID: `euxx.editor-tweaks`
- Marketplace: https://marketplace.visualstudio.com/items?itemName=euxx.editor-tweaks

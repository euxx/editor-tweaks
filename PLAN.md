# Editor Tweaks — Development Plan

## Background & Motivation

The following three VS Code extensions are being replaced by this single extension:

| Extension | Last Updated | Install Count | Reason to Replace |
|-----------|-------------|---------------|-------------------|
| `britesnow.vscode-toggle-quotes` | 2019 (5+ years ago) | ~347K | No longer maintained |
| `cliffordfajardo.highlight-line-vscode` | 2021 (3+ years ago) | ~unknown | No longer maintained |
| `redlin.remove-tabs-on-save` | unknown | ~9K | Single-purpose, easy to absorb |

**Goals:**
- Reduce total installed extensions by consolidating small, unmaintained utilities
- Maintain feature parity with the replaced extensions
- Add per-feature enable/disable configuration

---

## Scope (v1.0)

Three features, implemented independently within one extension:

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
- Other visible editors: same border at 40% opacity, pinned to their last cursor position
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

---

## Technical Design

### Project Structure

```
editor-tweaks/
├── src/
│   ├── extension.js          # Registers all features, handles activate/deactivate
│   ├── toggleQuotes.js       # Toggle Quotes implementation
│   ├── highlightLine.js      # Highlight Line implementation
│   └── removeTabsOnSave.js   # Remove Tabs on Save implementation
├── tests/
│   ├── toggleQuotes.test.js  # Unit tests for quote cycling logic
│   └── removeTabsOnSave.test.js
├── images/
│   └── icon.png
├── package.json
├── eslint.config.mjs
├── vitest.config.mjs
├── .prettierrc
├── AGENTS.md
├── DEVELOPMENT.md
└── README.md
```

### VS Code APIs Used

| Feature | APIs |
|---------|------|
| Toggle Quotes | `registerCommand`, `TextEditor.edit`, `TextDocument.getText`, `Selection`, `Range` |
| Highlight Line | `createTextEditorDecorationType`, `TextEditor.setDecorations`, `onDidChangeTextEditorSelection`, `onDidChangeActiveTextEditor`, `onDidChangeConfiguration` |
| Remove Tabs on Save | `onWillSaveTextDocument`, `TextEdit.replace`, `workspace.getConfiguration` |

### Activation

```json
"activationEvents": ["onStartupFinished"]
```

All three features are loaded once on startup. Each feature checks its `enable` configuration flag before registering listeners or commands.

---

## Implementation Order

1. **Project scaffold** — `package.json`, config files, `.husky`, linting
2. **Remove Tabs on Save** — simplest, pure document mutation
3. **Toggle Quotes** — string parser; add unit tests for quote boundary detection
4. **Highlight Line** — decoration management with event listeners
5. **README + icon** — write user-facing docs, add icon
6. **Publish** — `vsce package` then `vsce publish`

---

## Planned Features (v1.x)

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
- `editorTweaks.pruneRecentlyOpened.enable` (boolean, default: `true`)
- `editorTweaks.pruneRecentlyOpened.runAtStartup` (boolean, default: `true`)
- `editorTweaks.pruneRecentlyOpened.maxItems` (number, default: `-1`) — max entries to keep for each category (workspaces and files counted separately); `-1` = no limit

**Command:** `editorTweaks.pruneRecentlyOpened`

**Risk:** `_workbench.getRecentlyOpened` is a private API. If VS Code removes or changes it, the feature will silently do nothing (the command will be registered but produce no effect).

---

## Publishing

- Publisher: `euxx`
- Extension ID: `euxx.editor-tweaks`
- Marketplace: https://marketplace.visualstudio.com/items?itemName=euxx.editor-tweaks

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

**Config:**
- `editorTweaks.toggleQuotes.enable` (boolean, default: `true`)
- `editorTweaks.toggleQuotes.chars` (string[], default: `["\"", "'", "\`"]`)

### 2. Highlight Active Line

Applies a background color decoration to the line the cursor is on.

**Behavior:**
- Updates on cursor move and on active editor change
- Clears decoration when editor loses focus
- Re-applies when configuration changes

**Config:**
- `editorTweaks.highlightLine.enable` (boolean, default: `true`)
- `editorTweaks.highlightLine.backgroundColor` (string, default: `rgba(255,255,255,0.07)`)
- `editorTweaks.highlightLine.borderColor` (string, default: `""` = disabled)

### 3. Remove Tabs on Save

Before writing a file to disk, replaces all `\t` characters with the appropriate number of spaces, based on the editor's `tabSize` setting.

**Behavior:**
- Intercepts `onWillSaveTextDocument` and injects `TextEdit` replacements
- Respects per-language `tabSize` configuration
- Can be scoped to specific language IDs

**Config:**
- `editorTweaks.removeTabsOnSave.enable` (boolean, default: `true`)
- `editorTweaks.removeTabsOnSave.languages` (string[], default: `[]` = all languages)

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

## Publishing

- Publisher: `euxx`
- Extension ID: `euxx.editor-tweaks`
- Marketplace: https://marketplace.visualstudio.com/items?itemName=euxx.editor-tweaks

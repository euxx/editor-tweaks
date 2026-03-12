# Editor Tweaks

A collection of small VS Code editor utilities packed into a single extension.

Built for personal use — one extension for the small editor utilities I use daily, rather than a growing list of single-purpose installs. Each feature is a focused improvement over the extension that originally inspired it.

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue?logo=visual-studio-code&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=euxx.editor-tweaks)

## Features

- **Highlight Current Line** — bottom border decoration on the active cursor line
- **Toggle Quotes** — cycle quote characters surrounding the cursor (`"` → `'` → `` ` `` → `"`)
- **Remove Tabs on Save** — replace tab characters with spaces using the editor's `tabSize` on save
- **Prune Recently Opened** — remove inaccessible paths from the recently opened list

### Highlight Current Line

> Original [Highlight Line](https://marketplace.visualstudio.com/items?itemName=cliffordfajardo.highlight-line-vscode)
>
> Improve:
>
> - Adds dimmed border (70% opacity) on inactive editors in split-screen, pinned to their last cursor position (original only highlights the active editor)

Applies a bottom border decoration to the active cursor line.

- Active editor: full-brightness border following the cursor
- Other visible editors: same border at 70% opacity, pinned to their last cursor position
- Fully configurable: border color, style (`solid` / `dashed` / `dotted`), and width

**Settings:**

| Setting                                  | Default   | Description                             |
| ---------------------------------------- | --------- | --------------------------------------- |
| `editorTweaks.highlightLine.enable`      | `true`    | Enable the feature                      |
| `editorTweaks.highlightLine.borderColor` | `#65EAB9` | CSS color value; leave empty to disable |
| `editorTweaks.highlightLine.borderStyle` | `solid`   | `solid` · `dashed` · `dotted`           |
| `editorTweaks.highlightLine.borderWidth` | `1px`     | CSS length value (e.g. `2px`, `0.5em`)  |

---

### Toggle Quotes

> Original [Toggle Quotes](https://marketplace.visualstudio.com/items?itemName=britesnow.vscode-toggle-quotes)
>
> Improve:
>
> - Fixes `\\` before closing quote being misidentified as an escape
> - Unescapes/re-escapes content when switching delimiters (original only swaps the quote chars)
> - Deduplicates multi-cursor edits on the same string (original applies the change twice, corrupting it)

Cycles the quote character surrounding the cursor: `"` → `'` → `` ` `` → `"` …

- Trigger: `Alt+'`
- Correctly handles `\\` before a closing quote
- Automatically unescapes/re-escapes delimiters when switching (e.g. `\"` → `"` when leaving `"`)
- Works with multiple cursors — each cursor cycles its own quoted string independently

**Settings:**

| Setting                            | Default             | Description                       |
| ---------------------------------- | ------------------- | --------------------------------- |
| `editorTweaks.toggleQuotes.enable` | `true`              | Enable the feature                |
| `editorTweaks.toggleQuotes.chars`  | `["\"", "'", "\`"]` | Quote characters to cycle through |

---

### Remove Tabs on Save

> Original [Remove Tabs on Save](https://marketplace.visualstudio.com/items?itemName=redlin.remove-tabs-on-save)
>
> Improve:
>
> - Uses actual column position for tab stop calculation (original used string index, giving wrong expansion mid-line)
> - Unifies exclusions into `excludePatterns` supporting language ID, exact filename, or `*`-glob (original only supported extension globs and a separate `ignoreMakefiles` flag)

Before writing a file to disk, replaces all tab characters with spaces using the editor's `tabSize` setting.

- Tab stops are computed by column position, not a flat replacement (e.g. a tab at column 2 with `tabSize: 4` expands to 2 spaces)
- Exclude files by language ID, exact filename, or `*`-glob (defaults exclude `makefile` and `*.go` which require tabs)

**Settings:**

| Setting                                         | Default                | Description                                                                          |
| ----------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| `editorTweaks.removeTabsOnSave.enable`          | `true`                 | Enable the feature                                                                   |
| `editorTweaks.removeTabsOnSave.excludePatterns` | `["makefile", "*.go"]` | Patterns to skip — language ID, exact filename, or `*`-glob matched against basename |

---

### Prune Recently Opened

> Original [Recently Opened Sweeper](https://marketplace.visualstudio.com/items?itemName=crendking.recently-opened-sweeper)
>
> Improve:
>
> - Skips non-`file://` entries for both workspaces and files — SSH/remote/virtual entries are never touched (original may attempt `fsPath` on them)
> - Single `maxItems` setting applied independently to each category: workspaces get `maxItems` slots and files get `maxItems` slots (original's `keepCount` is per-category but documented as a single shared limit)

Removes stale entries from the VS Code "recently opened" list — paths that no longer exist on disk — and optionally trims entries beyond a configured count.

- Runs automatically on startup (configurable)
- Also available as a manual command: `Editor Tweaks: Prune Recently Opened`
- Non-`file://` entries (SSH, remote, virtual workspaces) are always kept untouched
- `maxItems` is applied independently to each category: workspaces and files each get `maxItems` slots

**Settings:**

| Setting                                         | Default | Description                                             |
| ----------------------------------------------- | ------- | ------------------------------------------------------- |
| `editorTweaks.pruneRecentlyOpened.enable`       | `true`  | Enable the feature                                      |
| `editorTweaks.pruneRecentlyOpened.runAtStartup` | `true`  | Prune automatically on startup                          |
| `editorTweaks.pruneRecentlyOpened.maxItems`     | `-1`    | Max local entries to keep per category; `-1` = no limit |

## License

Under the [MIT](LICENSE) License.

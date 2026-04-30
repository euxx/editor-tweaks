# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.3.1] - 2026-04-30

### Fixed

- Highlight Line: highlight no longer stays on a stale line after switching back to an editor whose cursor moved while it was inactive
- Git Auto Refresh: log the first `git.refresh` failure to the Editor Tweaks output channel so a chronically misconfigured git is diagnosable (subsequent failures stay silent to avoid notification spam)
- File History: route per-file errors (trim, expiry cleanup) to the shared output channel instead of `console.warn`

## [0.3.0] - 2026-04-05

### Added

- File History: automatically snapshot files on save with content-hash deduplication and configurable time gating
  - Show command: list snapshots and open diff view against current file
  - Restore command: pick a snapshot to restore (creates pre-restore checkpoint)
  - Open History Folder command: reveal snapshot directory in Finder/Explorer
  - Configurable: history path, min interval, max versions per file, max days, max file size, exclude patterns

### Fixed

- Git Auto Refresh: skip `git.refresh` when no workspace folders are open, preventing "no available repositories" error in blank windows

## [0.2.2] - 2026-03-23

### Fixed

- Git Auto Refresh: prevent "Git: There are no available repositories matching the filter" error dialog when opening a blank VS Code window or a folder with no git repository. The refresh is now only attempted when the git extension is active, git is installed (`exports.enabled`), and at least one repository is open.

## [0.2.1] - 2026-03-18

### Fixed

- Git Auto Refresh: no longer calls `git.refresh` when the workspace has no git repository, preventing spurious log noise and error popups

## [0.2.0] - 2026-03-18

### Added

- Git Auto Refresh: periodically call `git.refresh` so the SCM Changes view stays current when VS Code is not focused

## [0.1.0] - 2026-03-13

- Highlight Current Line: bottom border decoration following the cursor across editors
- Toggle Quotes: cycle quote character surrounding cursor (`"` → `'` → `` ` `` → `"`)
- Remove Tabs on Save: replace tab characters with spaces using the editor's `tabSize`
- Prune Open History: remove inaccessible paths from the recently opened list (File → Open Recent)
- Prune Open History: remove stale entries from the Go-to-File (Cmd+P) editor history via `state.vscdb`; requires system `sqlite3` CLI; takes effect on the next launch

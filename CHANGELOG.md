# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.0] - 2026-03-13

- Highlight Current Line: bottom border decoration following the cursor across editors
- Toggle Quotes: cycle quote character surrounding cursor (`"` → `'` → `` ` `` → `"`)
- Remove Tabs on Save: replace tab characters with spaces using the editor's `tabSize`
- Prune Open History: remove inaccessible paths from the recently opened list (File → Open Recent)
- Prune Open History: remove stale entries from the Go-to-File (Cmd+P) editor history via `state.vscdb`; requires system `sqlite3` CLI; takes effect on the next launch

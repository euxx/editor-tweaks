"use strict";

// Replaces all tab characters with spaces before a file is saved.
// Uses the document's configured tabSize and supports pattern-based exclusions.

/**
 * Converts all tab characters in a string to spaces, expanding each tab to the
 * next tab stop based on its column position.
 * @param {string} text
 * @param {number} tabSize
 * @returns {string}
 */
function convertTabs(text, tabSize) {
  let result = "";
  let column = 0;
  for (const char of text) {
    if (char === "\t") {
      const spacesToTab = tabSize - (column % tabSize);
      result += " ".repeat(spacesToTab);
      column += spacesToTab;
    } else {
      result += char;
      column += char.length; // surrogate-pair code points have .length 2, matching VS Code's UTF-16 column model
    }
  }
  return result;
}

/**
 * Returns true when a document should be excluded from tab removal.
 * Each pattern may be:
 *   - A glob containing "*" (e.g. "*.go", "prefix_*.txt") — matched against the file's basename
 *   - Any other string — matched against document.languageId OR the exact filename basename
 *     (e.g. "makefile" matches languageId, "Makefile" matches basename)
 * @param {string} languageId - document.languageId
 * @param {string} fileName   - document.fileName (full path)
 * @param {string[] | null | undefined} patterns
 * @returns {boolean}
 */
function isExcluded(languageId, fileName, patterns) {
  if (!Array.isArray(patterns)) return false;
  const basename = fileName.replace(/.*[\\/]/, ""); // extract basename without path
  for (const pattern of patterns) {
    if (typeof pattern !== "string") continue;
    if (pattern.includes("*")) {
      // Reject patterns with more than 3 wildcards to prevent ReDoS via catastrophic backtracking.
      if ((pattern.match(/\*/g) || []).length > 3) continue;
      // Glob: convert * to a regex that matches any sequence except path separators.
      // Case-insensitive so "*.GO" and "*.go" both work.
      // Escape all regex metacharacters (including ?) before expanding *.
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`^${escaped.replace(/\*/g, "[^\\\\/]*")}$`, "i");
      if (regex.test(basename)) return true;
    } else {
      // Exact match against language ID or basename, case-insensitive.
      const lower = pattern.toLowerCase();
      if (languageId.toLowerCase() === lower || basename.toLowerCase() === lower) return true;
    }
  }
  return false;
}

/**
 * @param {import('vscode').ExtensionContext} context
 */
function activate(context) {
  // Lazy-load vscode so the pure helper functions remain testable without the extension host
  const vscode = require("vscode");
  const disposable = vscode.workspace.onWillSaveTextDocument((event) => {
    const config = vscode.workspace.getConfiguration("editorTweaks.removeTabsOnSave");

    if (!config.get("enable")) return;

    const excludePatterns = config.get("excludePatterns") ?? [];
    const { document } = event;

    // Skip documents matching any exclusion pattern
    if (isExcluded(document.languageId, document.fileName, excludePatterns)) return;

    // Prefer the language-specific tabSize, then the editor default.
    // editor.tabSize can resolve to 'auto', so fall back to 4 for any non-integer value.
    // The `> 0` guard is also required: tabSize of 0 would cause division-by-zero in convertTabs.
    const editorConfig = vscode.workspace.getConfiguration("editor", document.uri);
    const rawTabSize = editorConfig.get("tabSize", 4);
    const tabSize =
      Number.isInteger(rawTabSize) && /** @type {number} */ (rawTabSize) > 0
        ? /** @type {number} */ (rawTabSize)
        : 4;

    const edits = [];
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      if (line.text.includes("\t")) {
        edits.push(vscode.TextEdit.replace(line.range, convertTabs(line.text, tabSize)));
      }
    }

    if (edits.length > 0) {
      event.waitUntil(Promise.resolve(edits));
    }
  });

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate, convertTabs, isExcluded };

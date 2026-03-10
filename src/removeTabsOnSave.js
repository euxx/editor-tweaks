'use strict';

// Replaces all tab characters with spaces before a file is saved.
// Uses the document's configured tabSize and supports optional language filtering.

/**
 * Converts all tab characters in a string to spaces, expanding each tab to the
 * next tab stop based on its column position.
 * @param {string} text
 * @param {number} tabSize
 * @returns {string}
 */
function convertTabs(text, tabSize) {
  let result = '';
  let col = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\t') {
      const spaces = tabSize - (col % tabSize);
      result += ' '.repeat(spaces);
      col += spaces;
    } else {
      result += text[i];
      col++;
    }
  }
  return result;
}

/**
 * @param {import('vscode').ExtensionContext} context
 */
function activate(context) {
  // Lazy-load vscode so the pure convertTabs function remains testable without the extension host
  const vscode = require('vscode');
  const disposable = vscode.workspace.onWillSaveTextDocument((event) => {
    const config = vscode.workspace.getConfiguration('editorTweaks.removeTabsOnSave');

    if (!config.get('enable')) return;

    const languages = config.get('languages', []);
    const { document } = event;

    // When languages is non-empty, only process the specified language IDs
    if (Array.isArray(languages) && languages.length > 0 && !languages.includes(document.languageId)) return;

    // Prefer the language-specific tabSize, then the editor default.
    // editor.tabSize can resolve to 'auto', so fall back to 4 for any non-integer value.
    const editorConfig = vscode.workspace.getConfiguration('editor', document.uri);
    const rawTabSize = editorConfig.get('tabSize', 4);
    const tabSize =
      Number.isInteger(rawTabSize) && /** @type {number} */ (rawTabSize) > 0 ? /** @type {number} */ (rawTabSize) : 4;

    const edits = [];
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      if (line.text.includes('\t')) {
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

module.exports = { activate, deactivate, convertTabs };

'use strict';

// TODO: Implement Highlight Active Line feature
// Applies a background color decoration to the line the cursor is on.
// Reference: cliffordfajardo.highlight-line-vscode (last updated 2021, no longer maintained)

/** @type {import('vscode').TextEditorDecorationType | undefined} */
let decorationType;

/**
 * @param {import('vscode').ExtensionContext} _context
 */
function activate(_context) {
  // TODO: createTextEditorDecorationType, register onDidChangeTextEditorSelection listener
}

function deactivate() {
  if (decorationType) {
    decorationType.dispose();
    decorationType = undefined;
  }
}

module.exports = { activate, deactivate };

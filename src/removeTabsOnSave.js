'use strict';

// TODO: Implement Remove Tabs on Save feature
// Replaces all \t characters with spaces (using the file's tabSize setting) before saving.
// Reference: redlin.remove-tabs-on-save (single-purpose extension, absorbed here)

/**
 * @param {import('vscode').ExtensionContext} _context
 */
function activate(_context) {
  // TODO: register onWillSaveTextDocument listener
}

function deactivate() {}

module.exports = { activate, deactivate };

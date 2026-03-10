'use strict';

const { activate: activateToggleQuotes, deactivate: deactivateToggleQuotes } = require('./toggleQuotes');
const { activate: activateHighlightLine, deactivate: deactivateHighlightLine } = require('./highlightLine');
const { activate: activateRemoveTabsOnSave, deactivate: deactivateRemoveTabsOnSave } = require('./removeTabsOnSave');

/**
 * Called when the extension is activated (onStartupFinished).
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  activateToggleQuotes(context);
  activateHighlightLine(context);
  activateRemoveTabsOnSave(context);
}

/**
 * Called when the extension is deactivated.
 */
function deactivate() {
  deactivateToggleQuotes();
  deactivateHighlightLine();
  deactivateRemoveTabsOnSave();
}

module.exports = { activate, deactivate };

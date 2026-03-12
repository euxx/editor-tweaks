'use strict';

const vscode = require('vscode');
const { activate: activateToggleQuotes, deactivate: deactivateToggleQuotes } = require('./toggleQuotes');
const { activate: activateHighlightLine, deactivate: deactivateHighlightLine } = require('./highlightLine');
const { activate: activateRemoveTabsOnSave, deactivate: deactivateRemoveTabsOnSave } = require('./removeTabsOnSave');
const {
  activate: activatePruneRecentlyOpened,
  deactivate: deactivatePruneRecentlyOpened,
} = require('./pruneRecentlyOpened');
const {
  activate: activatePruneGoToFileHistory,
  deactivate: deactivatePruneGoToFileHistory,
} = require('./pruneGoToFileHistory');

/**
 * Called when the extension is activated (onStartupFinished).
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  activateToggleQuotes(context);
  activateHighlightLine(context);
  activateRemoveTabsOnSave(context);
  const runPruneRecentlyOpened = activatePruneRecentlyOpened(context);
  const runPruneGoToFileHistory = activatePruneGoToFileHistory(context);

  const cmd = vscode.commands.registerCommand('editorTweaks.pruneOpenHistory', () =>
    Promise.all([runPruneRecentlyOpened(), runPruneGoToFileHistory()]),
  );
  context.subscriptions.push(cmd);
}

/**
 * Called when the extension is deactivated.
 */
function deactivate() {
  deactivateToggleQuotes();
  deactivateHighlightLine();
  deactivateRemoveTabsOnSave();
  deactivatePruneRecentlyOpened();
  deactivatePruneGoToFileHistory();
}

module.exports = { activate, deactivate };

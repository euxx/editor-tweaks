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
  const out = vscode.window.createOutputChannel('Editor Tweaks: Prune History');
  context.subscriptions.push(out);
  const runPruneRecentlyOpened = activatePruneRecentlyOpened(context, out);
  const runPruneGoToFileHistory = activatePruneGoToFileHistory(context, out);

  const cmd = vscode.commands.registerCommand('editorTweaks.pruneOpenHistory', () =>
    Promise.allSettled([runPruneRecentlyOpened(), runPruneGoToFileHistory()]).then((results) => {
      for (const r of results) {
        if (r.status === 'rejected') {
          const err = r.reason;
          out.appendLine(`[unexpected] ${err?.stack ?? err?.message ?? String(err)}`);
        }
      }
    }),
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

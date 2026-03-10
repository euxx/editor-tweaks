'use strict';

// Highlights the active cursor line with a bottom border decoration.
// Recreates the decoration type when configuration changes.

/** @type {import('vscode').TextEditorDecorationType | undefined} */
let decorationType;

/**
 * Computes decoration options from a configuration object.
 * Returns null when decoration should be disabled (enable=false or borderColor is empty).
 * @param {{ get: (key: string, defaultValue?: unknown) => unknown }} config
 * @returns {{ isWholeLine: true, borderColor: string, borderStyle: string, borderWidth: string } | null}
 */
function getDecorationOptions(config) {
  if (!config.get('enable')) return null;

  const borderColor = /** @type {string} */ (config.get('borderColor', '#65EAB9'));
  if (!borderColor) return null;

  const borderStyle = /** @type {string} */ (config.get('borderStyle', 'solid'));
  const borderWidth = /** @type {string} */ (config.get('borderWidth', '1px'));

  return {
    isWholeLine: true,
    borderColor,
    borderStyle,
    // Only apply border to the bottom edge
    borderWidth: `0 0 ${borderWidth} 0`,
  };
}

/**
 * Creates a new decoration type from the current configuration.
 * Returns undefined when decoration is disabled.
 * @param {typeof import('vscode')} vscode
 * @returns {import('vscode').TextEditorDecorationType | undefined}
 */
function createDecorationType(vscode) {
  const config = vscode.workspace.getConfiguration('editorTweaks.highlightLine');
  const options = getDecorationOptions(config);
  return options ? vscode.window.createTextEditorDecorationType(options) : undefined;
}

/**
 * Applies the current line decoration to the given editor.
 * @param {import('vscode').TextEditor | undefined} editor
 */
function applyDecoration(editor) {
  if (!decorationType || !editor) return;

  const line = editor.selection.active.line;
  const range = editor.document.lineAt(line).range;
  editor.setDecorations(decorationType, [range]);
}

/**
 * @param {import('vscode').ExtensionContext} context
 */
function activate(context) {
  const vscode = require('vscode');

  decorationType = createDecorationType(vscode);
  applyDecoration(vscode.window.activeTextEditor);

  context.subscriptions.push(
    // Re-apply on cursor move — only for the active editor to avoid decorating background editors
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor === vscode.window.activeTextEditor) {
        applyDecoration(e.textEditor);
      }
    }),

    // Re-apply when switching to a different editor tab — clear other visible editors first
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (decorationType) {
        for (const e of vscode.window.visibleTextEditors) {
          e.setDecorations(decorationType, []);
        }
      }
      applyDecoration(editor);
    }),

    // Recreate decoration when settings change (handles enable toggle and color/style changes)
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('editorTweaks.highlightLine')) return;
      // Disposing removes the decoration from all editors automatically
      decorationType?.dispose();
      decorationType = createDecorationType(vscode);
      applyDecoration(vscode.window.activeTextEditor);
    }),
  );
}

function deactivate() {
  if (decorationType) {
    decorationType.dispose();
    decorationType = undefined;
  }
}

module.exports = { activate, deactivate, getDecorationOptions };

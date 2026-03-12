'use strict';

// Highlights the current line with a bottom border decoration.
// Non-active editors retain a dimmer highlight at their last cursor position.
// Recreates decoration types when configuration changes.

/** @type {import('vscode').TextEditorDecorationType | undefined} */
let activeDecorationType;
/** @type {import('vscode').TextEditorDecorationType | undefined} */
let inactiveDecorationType;

/** Tracks the last known cursor line for each document (by URI string). */
const lastLineByDoc = new Map();

/**
 * Converts a CSS hex color (#RGB or #RRGGBB) to rgba() with the given alpha.
 * Returns the original value unchanged for non-hex input (e.g. named colors, rgb()).
 * @param {string} color
 * @param {number} alpha — 0 to 1
 * @returns {string}
 */
function withAlpha(color, alpha) {
  if (!color.startsWith('#')) return color;
  const hex = color.slice(1);
  const expanded = hex.length === 3 ? hex.replace(/[0-9a-f]/gi, '$&$&') : hex;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return color;
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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
 * Creates both active and inactive decoration types from the current configuration.
 * Disposes any existing types first.
 * @param {typeof import('vscode')} vscode
 */
function createDecorationTypes(vscode) {
  if (activeDecorationType) {
    activeDecorationType.dispose();
    activeDecorationType = undefined;
  }
  if (inactiveDecorationType) {
    inactiveDecorationType.dispose();
    inactiveDecorationType = undefined;
  }

  const config = vscode.workspace.getConfiguration('editorTweaks.highlightLine');
  const options = getDecorationOptions(config);
  if (options) {
    activeDecorationType = vscode.window.createTextEditorDecorationType(options);
    // Inactive editors show the same border with the color at reduced opacity
    inactiveDecorationType = vscode.window.createTextEditorDecorationType({
      ...options,
      borderColor: withAlpha(options.borderColor, 0.7),
    });
  }
}

/**
 * Applies active decoration to the active editor and inactive decoration to all other
 * visible editors. Clears any stale decorations from editors that no longer qualify.
 * @param {typeof import('vscode')} vscode
 */
function applyAllDecorations(vscode) {
  const activeEditor = vscode.window.activeTextEditor;

  for (const editor of vscode.window.visibleTextEditors) {
    if (editor === activeEditor) {
      // Clear any leftover inactive decoration from this editor
      if (inactiveDecorationType) editor.setDecorations(inactiveDecorationType, []);
      if (!activeDecorationType) continue;
      const line = editor.selection.active.line;
      lastLineByDoc.set(editor.document.uri.toString(), line);
      editor.setDecorations(activeDecorationType, [editor.document.lineAt(line).range]);
    } else {
      // Clear any leftover active decoration from this editor
      if (activeDecorationType) editor.setDecorations(activeDecorationType, []);
      if (!inactiveDecorationType) continue;
      const savedLine = lastLineByDoc.get(editor.document.uri.toString());
      if (savedLine !== undefined && savedLine < editor.document.lineCount) {
        editor.setDecorations(inactiveDecorationType, [editor.document.lineAt(savedLine).range]);
      } else {
        editor.setDecorations(inactiveDecorationType, []);
      }
    }
  }
}

/**
 * @param {import('vscode').ExtensionContext} context
 */
function activate(context) {
  // Lazy-load vscode so the pure getDecorationOptions function remains testable without the extension host
  const vscode = require('vscode');

  createDecorationTypes(vscode);
  applyAllDecorations(vscode);

  context.subscriptions.push(
    // Update active editor decoration on cursor move; skip redraw when the line hasn't changed
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor !== vscode.window.activeTextEditor) return;
      if (!activeDecorationType) return;
      const line = e.textEditor.selection.active.line;
      if (line === lastLineByDoc.get(e.textEditor.document.uri.toString())) return;
      lastLineByDoc.set(e.textEditor.document.uri.toString(), line);
      e.textEditor.setDecorations(activeDecorationType, [e.textEditor.document.lineAt(line).range]);
    }),

    // Re-apply all decorations when the active tab changes
    vscode.window.onDidChangeActiveTextEditor(() => {
      applyAllDecorations(vscode);
    }),

    // Recreate decoration types when settings change (handles enable toggle and color/style changes)
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('editorTweaks.highlightLine')) return;
      createDecorationTypes(vscode);
      applyAllDecorations(vscode);
    }),

    // Clean up stale entries when a document is closed
    vscode.workspace.onDidCloseTextDocument((doc) => {
      lastLineByDoc.delete(doc.uri.toString());
    }),
  );
}

function deactivate() {
  if (activeDecorationType) {
    activeDecorationType.dispose();
    activeDecorationType = undefined;
  }
  if (inactiveDecorationType) {
    inactiveDecorationType.dispose();
    inactiveDecorationType = undefined;
  }
  lastLineByDoc.clear();
}

module.exports = { activate, deactivate, getDecorationOptions, withAlpha };

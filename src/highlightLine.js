"use strict";

// Highlights the current line with a bottom border decoration.
// Non-active editors retain a dimmer highlight at their last cursor position.
// Recreates decoration types when configuration changes.

/** @type {import('vscode').TextEditorDecorationType | undefined} */
let activeDecorationType;
/** @type {import('vscode').TextEditorDecorationType | undefined} */
let inactiveDecorationType;

// Per-editor last highlighted line, used to skip redundant redraws on intra-line
// cursor moves. WeakMap so closed editors are GC'd automatically. Module-scoped so
// applyAllDecorations() can keep it in sync when the active editor changes — without
// that sync, the cache can drift from the actually-decorated line if the cursor moved
// while the editor was inactive, causing later redraws to be incorrectly skipped.
/** @type {WeakMap<import('vscode').TextEditor, number>} */
let lastLineByEditor = new WeakMap();

/**
 * Converts a CSS hex color (#RGB, #RRGGBB, or #RRGGBBAA) to rgba() with the given alpha.
 * For #RRGGBBAA the embedded alpha is multiplied with the supplied alpha so that a
 * semi-transparent active color produces an even more transparent inactive color.
 * Returns the original value unchanged for non-hex input (e.g. named colors, rgb())
 * and also for malformed hex values (wrong digit count or non-hex characters like #xyz).
 * @param {string} color
 * @param {number} alpha — 0 to 1
 * @returns {string}
 */
function withAlpha(color, alpha) {
  if (!color.startsWith("#")) return color;
  const hex = color.slice(1);
  let rgb;
  let a = alpha;
  if (hex.length === 3) {
    rgb = hex.replace(/[0-9a-f]/gi, "$&$&");
  } else if (hex.length === 6) {
    rgb = hex;
  } else if (hex.length === 8) {
    rgb = hex.slice(0, 6);
    a = +((parseInt(hex.slice(6, 8), 16) / 255) * alpha).toFixed(3);
  } else {
    return color;
  }
  if (!/^[0-9a-f]{6}$/i.test(rgb)) return color;
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Computes decoration options from a configuration object.
 * Returns null when decoration should be disabled (enable=false or borderColor is empty).
 * @param {{ get: (key: string, defaultValue?: unknown) => unknown }} config
 * @returns {{ isWholeLine: true, borderColor: string, borderStyle: string, borderWidth: string } | null}
 */
function getDecorationOptions(config) {
  if (!config.get("enable")) return null;

  const borderColor = /** @type {string} */ (config.get("borderColor", "#65EAB9"));
  if (!borderColor) return null;

  const borderStyle = /** @type {string} */ (config.get("borderStyle", "solid"));
  const borderWidth = /** @type {string} */ (config.get("borderWidth", "1px"));

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
  activeDecorationType?.dispose();
  activeDecorationType = undefined;
  inactiveDecorationType?.dispose();
  inactiveDecorationType = undefined;

  const config = vscode.workspace.getConfiguration("editorTweaks.highlightLine");
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
 * visible editors. Each editor's own selection is used, so split views of the same
 * document highlight independently and survive reload without needing cached state.
 * @param {typeof import('vscode')} vscode
 */
function applyAllDecorations(vscode) {
  const activeEditor = vscode.window.activeTextEditor;

  for (const editor of vscode.window.visibleTextEditors) {
    const line = editor.selection.active.line;
    const range = editor.document.lineAt(line).range;
    if (editor === activeEditor) {
      // Clear any leftover inactive decoration from this editor
      if (inactiveDecorationType) editor.setDecorations(inactiveDecorationType, []);
      if (!activeDecorationType) continue;
      editor.setDecorations(activeDecorationType, [range]);
      // Keep the cache in sync: subsequent intra-line cursor moves rely on this entry
      // to know whether a redraw can be skipped. Without this update, the entry may be
      // stale (cursor moved while the editor was inactive) and later redraws will be
      // incorrectly short-circuited, leaving the highlight on the wrong line.
      lastLineByEditor.set(editor, line);
    } else {
      // Clear any leftover active decoration from this editor
      if (activeDecorationType) editor.setDecorations(activeDecorationType, []);
      if (!inactiveDecorationType) continue;
      editor.setDecorations(inactiveDecorationType, [range]);
    }
  }
}

/**
 * @param {import('vscode').ExtensionContext} context
 */
function activate(context) {
  // Lazy-load vscode so the pure getDecorationOptions function remains testable without the extension host
  const vscode = require("vscode");

  createDecorationTypes(vscode);
  applyAllDecorations(vscode);

  context.subscriptions.push(
    // Update active editor decoration on cursor move; skip redraw when the line hasn't changed
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor !== vscode.window.activeTextEditor) return;
      if (!activeDecorationType) return;
      const line = e.textEditor.selection.active.line;
      if (line === lastLineByEditor.get(e.textEditor)) return;
      lastLineByEditor.set(e.textEditor, line);
      e.textEditor.setDecorations(activeDecorationType, [e.textEditor.document.lineAt(line).range]);
    }),

    // Re-apply all decorations when the active tab changes
    vscode.window.onDidChangeActiveTextEditor(() => {
      applyAllDecorations(vscode);
    }),

    // Recreate decoration types when settings change (handles enable toggle and color/style changes)
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("editorTweaks.highlightLine")) return;
      createDecorationTypes(vscode);
      applyAllDecorations(vscode);
    }),
  );
}

function deactivate() {
  activeDecorationType?.dispose();
  activeDecorationType = undefined;
  inactiveDecorationType?.dispose();
  inactiveDecorationType = undefined;
  lastLineByEditor = new WeakMap();
}

module.exports = { activate, deactivate, getDecorationOptions, withAlpha, applyAllDecorations };

'use strict';

// Cycles the quote character surrounding the cursor: " -> ' -> ` -> "
// Handles multiple cursors, escape/unescape of delimiters, and configurable quote chars.

/**
 * Parses a line from left to right and returns the quoted range that contains
 * cursorCol, or null if the cursor is not inside (or on the boundary of) a quoted string.
 * @param {string} lineText
 * @param {number} cursorCol
 * @param {string[]} chars - The quote characters to recognise
 * @returns {{ openPos: number, closePos: number, quoteChar: string } | null}
 */
function findQuotedRange(lineText, cursorCol, chars) {
  let i = 0;
  while (i < lineText.length) {
    const ch = lineText[i];
    if (chars.includes(ch)) {
      const openPos = i;
      const quoteChar = ch;
      let j = i + 1;
      while (j < lineText.length) {
        if (lineText[j] === '\\') {
          j += 2; // skip escaped character
          continue;
        }
        if (lineText[j] === quoteChar) {
          const closePos = j;
          if (cursorCol >= openPos && cursorCol <= closePos) {
            return { openPos, closePos, quoteChar };
          }
          // Cursor is past this pair; advance outer loop past the closing quote
          i = closePos;
          break;
        }
        j++;
      }
      // If j reached end of line, the quote is unclosed — i++ in the outer loop
      // advances past the opening quote so scanning continues for other pairs.
    }
    i++;
  }
  return null;
}

/**
 * Returns the next quote character in the configured cycle.
 * @param {string} currentQuote
 * @param {string[]} chars
 * @returns {string}
 */
function cycleQuote(currentQuote, chars) {
  const idx = chars.indexOf(currentQuote);
  if (idx === -1) return chars[0];
  return chars[(idx + 1) % chars.length];
}

/**
 * Transforms the inner content of a quoted string when switching delimiters.
 * - Removes escaping of oldQuote  (e.g. \" → " when switching away from ")
 * - Adds escaping of newQuote     (e.g. ' → \' when switching to ')
 * All other escape sequences are preserved unchanged.
 * @param {string} content - Text between the opening and closing quotes (exclusive)
 * @param {string} oldQuote
 * @param {string} newQuote
 * @returns {string}
 */
function transformContent(content, oldQuote, newQuote) {
  if (oldQuote === newQuote) return content;
  let result = '';
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\\' && i + 1 < content.length) {
      if (content[i + 1] === oldQuote) {
        // Unescape the old delimiter
        result += oldQuote;
        i++;
      } else {
        // Preserve all other escape sequences as-is
        result += content[i] + content[i + 1];
        i++;
      }
    } else if (content[i] === newQuote) {
      // Escape the new delimiter
      result += `\\${newQuote}`;
    } else {
      result += content[i];
    }
  }
  return result;
}

/**
 * @param {import('vscode').ExtensionContext} context
 */
function activate(context) {
  // Lazy-load vscode so the pure helper functions remain testable without the extension host
  const vscode = require('vscode');
  const disposable = vscode.commands.registerCommand('editorTweaks.toggleQuotes', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const config = vscode.workspace.getConfiguration('editorTweaks.toggleQuotes');
    if (!config.get('enable')) return;

    const raw = config.get('chars', ['"', "'", '`']);
    // Only keep single-character strings to match how findQuotedRange scans character by character.
    // Deduplicate to avoid cycling through the same quote twice.
    const chars = [...new Set((Array.isArray(raw) ? raw : []).filter((c) => typeof c === 'string' && c.length === 1))];
    if (chars.length === 0) return;

    return editor.edit((editBuilder) => {
      // Collect all replacements first, deduplicate by range identity (same quoted string
      // can contain multiple cursors), then apply in reverse document order so an earlier
      // replacement on the same line does not shift the character offsets of later ones.
      const seen = new Set();
      const replacements = [];

      for (const selection of editor.selections) {
        const line = editor.document.lineAt(selection.active.line);
        const range = findQuotedRange(line.text, selection.active.character, chars);
        if (!range) continue;

        const { openPos, closePos, quoteChar } = range;
        const key = `${line.lineNumber}:${openPos}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const newQuote = cycleQuote(quoteChar, chars);
        const innerContent = line.text.slice(openPos + 1, closePos);
        const newText = newQuote + transformContent(innerContent, quoteChar, newQuote) + newQuote;
        replacements.push({
          vscRange: new vscode.Range(line.lineNumber, openPos, line.lineNumber, closePos + 1),
          newText,
        });
      }

      // Sort bottom-to-top, right-to-left so each edit uses original coordinates
      replacements.sort((a, b) => {
        const ld = b.vscRange.start.line - a.vscRange.start.line;
        return ld !== 0 ? ld : b.vscRange.start.character - a.vscRange.start.character;
      });

      for (const { vscRange, newText } of replacements) {
        editBuilder.replace(vscRange, newText);
      }
    });
  });

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate, findQuotedRange, cycleQuote, transformContent };

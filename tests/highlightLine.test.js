// vitest globals (describe, it, expect, vi) are injected via globals:true in vitest.config.mjs
const { getDecorationOptions, withAlpha } = require("../src/highlightLine.js");

/** Helper to build a minimal config mock */
function makeConfig(values) {
  return {
    get(key, defaultValue) {
      return key in values ? values[key] : defaultValue;
    },
  };
}

describe("getDecorationOptions", () => {
  it("returns null when enable is false", () => {
    const config = makeConfig({ enable: false, borderColor: "#65EAB9" });
    expect(getDecorationOptions(config)).toBeNull();
  });

  it("returns null when borderColor is empty", () => {
    const config = makeConfig({ enable: true, borderColor: "" });
    expect(getDecorationOptions(config)).toBeNull();
  });

  it("returns decoration options when enabled with a color", () => {
    const config = makeConfig({
      enable: true,
      borderColor: "#65EAB9",
      borderStyle: "solid",
      borderWidth: "1px",
    });
    const options = getDecorationOptions(config);
    expect(options).not.toBeNull();
    expect(options.isWholeLine).toBe(true);
    expect(options.borderColor).toBe("#65EAB9");
    expect(options.borderStyle).toBe("solid");
    expect(options.borderWidth).toBe("0 0 1px 0");
  });

  it("applies borderWidth only to the bottom edge", () => {
    const config = makeConfig({
      enable: true,
      borderColor: "#fff",
      borderStyle: "dashed",
      borderWidth: "2px",
    });
    const options = getDecorationOptions(config);
    expect(options.borderWidth).toBe("0 0 2px 0");
  });
});

describe("withAlpha", () => {
  it("converts #RRGGBB hex to rgba with the given alpha", () => {
    expect(withAlpha("#65EAB9", 0.4)).toBe("rgba(101, 234, 185, 0.4)");
  });

  it("converts #RGB shorthand by expanding it", () => {
    expect(withAlpha("#fff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
  });

  it("converts #RRGGBBAA by multiplying embedded alpha with the override", () => {
    // #65EAB9FF: A = 0xFF = 1.0, so 1.0 * 0.7 = 0.7
    expect(withAlpha("#65EAB9FF", 0.7)).toBe("rgba(101, 234, 185, 0.7)");
    // #65EAB9B3: A = 0xB3 = 179/255 ≈ 0.702, so 0.702 * 0.7 ≈ 0.491
    expect(withAlpha("#65EAB9B3", 0.7)).toBe("rgba(101, 234, 185, 0.491)");
  });

  it("passes through non-hex values unchanged", () => {
    expect(withAlpha("red", 0.4)).toBe("red");
    expect(withAlpha("rgba(0,0,0,1)", 0.4)).toBe("rgba(0,0,0,1)");
  });

  it("passes through invalid hex lengths unchanged", () => {
    expect(withAlpha("#ff", 0.4)).toBe("#ff");
    expect(withAlpha("#fffff", 0.4)).toBe("#fffff");
  });

  it("passes through hex strings containing non-hex characters unchanged", () => {
    // Exercises the !/^[0-9a-f]{6}$/i validation guard.
    // #xyz — 3-digit path: replace expands only valid hex chars; 'xyz' stay as-is,
    // resulting rgb is still 3 chars and fails the 6-char guard.
    expect(withAlpha("#xyz", 1)).toBe("#xyz");
    // #GG0000 — 6-digit path: 'GG' is not in [0-9a-f], guard fires.
    expect(withAlpha("#GG0000", 1)).toBe("#GG0000");
  });
});

// ---------------------------------------------------------------------------
// applyAllDecorations — cache sync after active editor changes
//
// Regression: applyAllDecorations() must update the per-editor "last highlighted
// line" cache for the active editor, otherwise the cache can drift from the
// actually-decorated line whenever the cursor moves while the editor is
// inactive. The next intra-line cursor move would then be incorrectly skipped
// by the early-return optimisation in onDidChangeTextEditorSelection,
// leaving the highlight on the wrong line.
// ---------------------------------------------------------------------------

describe("applyAllDecorations cache sync", () => {
  /** Builds a fake editor with a mutable selection and a stub setDecorations. */
  function makeEditor(line) {
    const editor = {
      selection: { active: { line } },
      document: { lineAt: (n) => ({ range: { _line: n } }) },
      setDecorations: vi.fn(),
    };
    return editor;
  }

  it("updates the cache for the active editor so a subsequent same-line move is not falsely skipped", () => {
    const editorA = makeEditor(5);
    const editorB = makeEditor(0);

    // Mutable vscode mock: tests rewrite activeTextEditor as the "active editor" changes.
    const activeRef = { current: editorA };
    const handlers = {};
    const vscodeMock = {
      window: {
        get activeTextEditor() {
          return activeRef.current;
        },
        get visibleTextEditors() {
          return [editorA, editorB];
        },
        createTextEditorDecorationType: () => ({ dispose: () => {} }),
        onDidChangeTextEditorSelection: (fn) => {
          handlers.selection = fn;
          return { dispose: () => {} };
        },
        onDidChangeActiveTextEditor: (fn) => {
          handlers.activeChange = fn;
          return { dispose: () => {} };
        },
      },
      workspace: {
        getConfiguration: () => ({
          get: (key, def) => {
            if (key === "enable") return true;
            if (key === "borderColor") return "#65EAB9";
            if (key === "borderStyle") return "solid";
            if (key === "borderWidth") return "1px";
            return def;
          },
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
      },
    };

    // Inject the mock into Node's require cache before loading the module under
    // test. vi.mock/vi.doMock do not intercept CommonJS require() reliably for
    // modules that are not actually installed (vscode is provided by the
    // extension host at runtime, not via npm), so we register it directly.
    const Module = require("module");
    const originalResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (request === "vscode") return "vscode";
      return originalResolve.call(this, request, ...rest);
    };
    require.cache.vscode = {
      id: "vscode",
      filename: "vscode",
      loaded: true,
      exports: vscodeMock,
    };

    try {
      // Force re-require so the module-level WeakMap and decoration types
      // are reinitialised against the freshly-injected mock.
      delete require.cache[require.resolve("../src/highlightLine.js")];
      const { activate, deactivate } = require("../src/highlightLine.js");
      activate({ subscriptions: [] });

      try {
        // After activate(), applyAllDecorations() ran once: editorA was active on
        // line 5, so the initial decoration call already happened and the cache
        // entry for editorA is line 5.
        expect(editorA.setDecorations).toHaveBeenCalled();
        editorA.setDecorations.mockClear();

        // Simulate: while editorA is inactive, its cursor moves to line 7
        // (e.g. user used "Reveal Definition" in another view that moved the cursor).
        activeRef.current = editorB;
        handlers.activeChange();
        editorA.selection.active.line = 7;

        // Switch back to editorA. applyAllDecorations() must (a) decorate line 7
        // and (b) update the cache to 7. With the bug, cache stays at 5.
        activeRef.current = editorA;
        handlers.activeChange();
        editorA.setDecorations.mockClear();

        // Now the user moves the cursor in editorA to line 5. With the cache
        // correctly synced to 7, this is a cache miss and a redraw must occur.
        // With the bug (cache still 5), the handler returns early and no
        // setDecorations call happens, leaving the highlight stuck on line 7.
        editorA.selection.active.line = 5;
        handlers.selection({ textEditor: editorA });

        expect(editorA.setDecorations).toHaveBeenCalled();
        const decoratedRange = editorA.setDecorations.mock.calls.at(-1)[1][0];
        expect(decoratedRange._line).toBe(5);
      } finally {
        deactivate();
      }
    } finally {
      Module._resolveFilename = originalResolve;
      delete require.cache.vscode;
      delete require.cache[require.resolve("../src/highlightLine.js")];
    }
  });
});

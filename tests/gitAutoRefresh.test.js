// vitest globals (describe, it, expect) are injected via globals:true in vitest.config.mjs
const { getRefreshInterval, shouldAttemptGitRefresh } = require("../src/gitAutoRefresh.js");

/** Helper to build a minimal config mock */
function makeConfig(values) {
  return {
    get(key, defaultValue) {
      return key in values ? values[key] : defaultValue;
    },
  };
}

describe("getRefreshInterval", () => {
  it("returns 0 when enable is false", () => {
    const config = makeConfig({ enable: false, intervalSec: 30 });
    expect(getRefreshInterval(config)).toBe(0);
  });

  it("returns the configured interval in milliseconds when enabled", () => {
    const config = makeConfig({ enable: true, intervalSec: 15 });
    expect(getRefreshInterval(config)).toBe(15000);
  });

  it("uses the default interval of 10000ms when intervalSec is not set", () => {
    const config = makeConfig({ enable: true });
    expect(getRefreshInterval(config)).toBe(10000);
  });

  it("returns 0 when intervalSec is 0", () => {
    const config = makeConfig({ enable: true, intervalSec: 0 });
    expect(getRefreshInterval(config)).toBe(0);
  });

  it("returns 0 when intervalSec is negative", () => {
    const config = makeConfig({ enable: true, intervalSec: -5 });
    expect(getRefreshInterval(config)).toBe(0);
  });

  it("returns the interval when enabled with minimum valid value", () => {
    const config = makeConfig({ enable: true, intervalSec: 1 });
    expect(getRefreshInterval(config)).toBe(1000);
  });
});

/** Helper to build a minimal vscode mock for shouldAttemptGitRefresh */
function makeVscode({
  isActive,
  exports: exportsValue,
  repositories,
  enabled = true,
  workspaceFolders = [{}],
} = {}) {
  return {
    extensions: {
      getExtension(id) {
        if (id !== "vscode.git") return undefined;
        if (isActive === undefined) return undefined;
        const exportsObj =
          exportsValue === null
            ? null
            : { enabled, getAPI: () => ({ repositories: repositories ?? [] }) };
        return { isActive, exports: exportsObj };
      },
    },
    workspace: { workspaceFolders },
  };
}

describe("shouldAttemptGitRefresh", () => {
  it("returns false when git extension is not installed", () => {
    expect(shouldAttemptGitRefresh(makeVscode())).toBe(false);
  });

  it("returns false when git extension is installed but not yet active", () => {
    expect(shouldAttemptGitRefresh(makeVscode({ isActive: false, repositories: [] }))).toBe(false);
  });

  it("returns false when extension is active but exports are not yet populated", () => {
    expect(shouldAttemptGitRefresh(makeVscode({ isActive: true, exports: null }))).toBe(false);
  });

  it("returns false when extension is active but git is disabled (not installed)", () => {
    expect(shouldAttemptGitRefresh(makeVscode({ isActive: true, enabled: false }))).toBe(false);
  });

  it("returns false when extension is active but no repositories", () => {
    expect(shouldAttemptGitRefresh(makeVscode({ isActive: true, repositories: [] }))).toBe(false);
  });

  it("returns false when no workspace folders are open", () => {
    expect(
      shouldAttemptGitRefresh(
        makeVscode({ isActive: true, repositories: [{}], workspaceFolders: [] }),
      ),
    ).toBe(false);
  });

  it("returns true when extension is active with at least one repository", () => {
    expect(shouldAttemptGitRefresh(makeVscode({ isActive: true, repositories: [{}] }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// activate() — first-failure logging
//
// Regression: when git.refresh throws (e.g. git extension misconfigured), the
// tick swallows the error to avoid every-N-seconds notifications. Without at
// least one log line the failure mode is indistinguishable from "working but
// silent". This test verifies the first failure is logged and subsequent ones
// are not.
// ---------------------------------------------------------------------------

describe("activate — first-failure logging", () => {
  it("logs the first git.refresh failure once and silences the rest", async () => {
    vi.useFakeTimers();

    const executeCommand = vi.fn(() => {
      throw new Error("git misconfigured");
    });

    const vscodeMock = {
      window: { state: { focused: false } },
      workspace: {
        getConfiguration: () => ({
          get: (key, def) => {
            if (key === "enable") return true;
            if (key === "intervalSec") return 1;
            return def;
          },
        }),
        workspaceFolders: [{}],
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
      },
      extensions: {
        getExtension: () => ({
          isActive: true,
          exports: { enabled: true, getAPI: () => ({ repositories: [{}] }) },
        }),
      },
      commands: { executeCommand },
    };

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

    const lines = [];
    const out = { appendLine: (msg) => lines.push(msg) };

    try {
      delete require.cache[require.resolve("../src/gitAutoRefresh.js")];
      const { activate, deactivate } = require("../src/gitAutoRefresh.js");
      activate({ subscriptions: [] }, out);

      // Advance the timer to fire the first tick, then await the failed promise.
      await vi.advanceTimersByTimeAsync(1000);
      // Fire two more ticks to confirm only the first one logs.
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      expect(executeCommand).toHaveBeenCalledTimes(3);
      const failureLines = lines.filter((l) => l.includes("git.refresh failed"));
      expect(failureLines).toHaveLength(1);
      expect(failureLines[0]).toContain("git misconfigured");

      deactivate();
    } finally {
      Module._resolveFilename = originalResolve;
      delete require.cache.vscode;
      delete require.cache[require.resolve("../src/gitAutoRefresh.js")];
      vi.useRealTimers();
    }
  });
});

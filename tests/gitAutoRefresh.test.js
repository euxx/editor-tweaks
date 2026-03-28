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
function makeVscode({ isActive, exports: exportsValue, repositories, enabled = true } = {}) {
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

  it("returns true when extension is active with at least one repository", () => {
    expect(shouldAttemptGitRefresh(makeVscode({ isActive: true, repositories: [{}] }))).toBe(true);
  });
});

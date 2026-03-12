// vitest globals (describe, it, expect, vi) are injected via globals:true in vitest.config.mjs
const { fileUriToFsPath, escapeGlob, applyGlobalExcludePrune } = require('../src/pruneGoToFileHistory.js');

// ---------------------------------------------------------------------------
// fileUriToFsPath
// ---------------------------------------------------------------------------

describe('fileUriToFsPath', () => {
  it('converts a basic file:// URI to a filesystem path', () => {
    expect(fileUriToFsPath('file:///Users/e/projects/foo/bar.py')).toBe('/Users/e/projects/foo/bar.py');
  });

  it('decodes percent-encoded characters (spaces)', () => {
    expect(fileUriToFsPath('file:///Users/e/My%20Documents/file.txt')).toBe('/Users/e/My Documents/file.txt');
  });

  it('decodes percent-encoded Unicode (Chinese filenames)', () => {
    const decoded = fileUriToFsPath('file:///Users/e/Downloads/%E6%96%87%E4%BB%B6.txt');
    expect(decoded).toBe('/Users/e/Downloads/文件.txt');
  });

  it('returns null for non-file:// URIs', () => {
    expect(fileUriToFsPath('vscode-remote:///host/path')).toBeNull();
    expect(fileUriToFsPath('https://example.com/file')).toBeNull();
  });

  it('returns null for invalid URI strings', () => {
    expect(fileUriToFsPath('not a uri')).toBeNull();
    expect(fileUriToFsPath('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// escapeGlob
// ---------------------------------------------------------------------------

describe('escapeGlob', () => {
  it('returns plain strings unchanged', () => {
    expect(escapeGlob('src/utils.py')).toBe('src/utils.py');
    expect(escapeGlob('normal-name')).toBe('normal-name');
  });

  it('escapes square brackets', () => {
    expect(escapeGlob('[2024]-report.pdf')).toBe('\\[2024\\]-report.pdf');
  });

  it('escapes curly braces', () => {
    expect(escapeGlob('{build}')).toBe('\\{build\\}');
  });

  it('escapes asterisk and question mark', () => {
    expect(escapeGlob('file*.txt')).toBe('file\\*.txt');
    expect(escapeGlob('file?.txt')).toBe('file\\?.txt');
  });

  it('escapes multiple special characters in one string', () => {
    expect(escapeGlob('[!abc*]')).toBe('\\[\\!abc\\*\\]');
  });
});

describe('applyGlobalExcludePrune — restore logic', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Build a stateful config mock whose inspect() always reflects the current state.
  function makeConfig(initial = {}) {
    let state = { ...initial };
    const config = {
      inspect: () => ({ globalValue: { ...state } }),
      update: vi.fn(async (_key, value) => {
        state = value ?? {};
      }),
      getState: () => state,
    };
    return config;
  }

  // vscode mock for global-scope tests; Uri.file is an identity (path === fsPath for simple paths).
  function makeVscode(config) {
    return {
      workspace: { getConfiguration: () => config },
      ConfigurationTarget: { Global: 1 },
      Uri: { file: (p) => ({ path: p }) },
    };
  }

  it('restores a pre-existing false entry to false after the delay', async () => {
    // escapeGlob('/Users/e/stale.py') === '/Users/e/stale.py' (no special chars)
    const config = makeConfig({ '/Users/e/stale.py': false });
    const vscode = makeVscode(config);

    const run = applyGlobalExcludePrune(['/Users/e/stale.py'], vscode);
    await vi.runAllTimersAsync();
    await run;

    expect(config.getState()).toEqual({ '/Users/e/stale.py': false });
  });

  it('removes a newly-added key after the delay, leaving config empty', async () => {
    const config = makeConfig({});
    const vscode = makeVscode(config);

    const run = applyGlobalExcludePrune(['/Users/e/stale.py'], vscode);
    await vi.runAllTimersAsync();
    await run;

    expect(config.getState()).toEqual({});
  });

  it('does not call config.update when all patterns are already true', async () => {
    const config = makeConfig({ '/Users/e/stale.py': true });
    const vscode = makeVscode(config);

    const run = applyGlobalExcludePrune(['/Users/e/stale.py'], vscode);
    await vi.runAllTimersAsync();
    await run;

    // Nothing to do — early return, no writes occur
    expect(config.update).toHaveBeenCalledTimes(0);
  });

  it('preserves concurrent changes made to the config during the delay', async () => {
    let inspectCallCount = 0;
    const config = {
      inspect: () => ({
        globalValue:
          inspectCallCount++ === 0
            ? {} // initial state
            : { '/Users/e/new.py': true, '/user-added.py': true }, // state during restore
      }),
      update: vi.fn(async () => {}),
    };
    const vscode = makeVscode(config);

    const run = applyGlobalExcludePrune(['/Users/e/new.py'], vscode);
    await vi.runAllTimersAsync();
    await run;

    const restoreArg = config.update.mock.calls[1][1];
    expect(restoreArg).toEqual({ '/user-added.py': true });
  });

  it('returns 0 and skips the delay when config.update throws', async () => {
    const config = {
      inspect: () => ({ globalValue: {} }),
      update: vi.fn(async () => {
        throw new Error('read-only');
      }),
    };
    const vscode = makeVscode(config);

    const result = await applyGlobalExcludePrune(['/Users/e/stale.py'], vscode);

    expect(result).toBe(0);
    // Only the initial (failed) write — no restore call
    expect(config.update).toHaveBeenCalledTimes(1);
  });

  it('returns the number of external paths on success', async () => {
    const config = makeConfig({});
    const vscode = makeVscode(config);

    const run = applyGlobalExcludePrune(['/a.py', '/b.py', '/c.py'], vscode);
    await vi.runAllTimersAsync();
    const result = await run;

    expect(result).toBe(3);
  });
});

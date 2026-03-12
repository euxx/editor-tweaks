// vitest globals (describe, it, expect, vi) are injected via globals:true in vitest.config.mjs
const {
  fileUriToFsPath,
  escapeGlob,
  computeExcludePatterns,
  applyFilesExcludePrune,
  applyGlobalExcludePrune,
} = require('../src/pruneGoToFileHistory.js');

const path = require('path');

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

// ---------------------------------------------------------------------------
// computeExcludePatterns
// ---------------------------------------------------------------------------

// Helper: build a fake workspace folder
function makeFolder(fsPath) {
  return { uri: { fsPath } };
}

describe('computeExcludePatterns — basic cases', () => {
  it('returns empty map when no stale paths', () => {
    const folders = [makeFolder('/projects/foo')];
    const result = computeExcludePatterns([], folders);
    expect(result.size).toBe(0);
  });

  it('returns empty map when stale paths are outside all workspace folders', () => {
    const folders = [makeFolder('/projects/foo')];
    const result = computeExcludePatterns(['/other/bar.py'], folders);
    expect(result.size).toBe(0);
  });

  it('computes a workspace-relative pattern for a file inside the folder', () => {
    const folder = makeFolder('/projects/foo');
    const result = computeExcludePatterns(['/projects/foo/src/bar.py'], [folder]);
    expect(result.get(folder)).toEqual(['src/bar.py']);
  });

  it('uses forward slashes in patterns regardless of OS path separator', () => {
    // Simulate a nested path
    const folder = makeFolder('/projects/foo');
    const stale = path.join('/projects/foo', 'a', 'b', 'c.txt');
    const result = computeExcludePatterns([stale], [folder]);
    expect(result.get(folder)).toEqual(['a/b/c.txt']);
  });

  it('assigns each stale file to the correct folder in a multi-root workspace', () => {
    const folderA = makeFolder('/projects/a');
    const folderB = makeFolder('/projects/b');
    const result = computeExcludePatterns(['/projects/a/utils.py', '/projects/b/index.js'], [folderA, folderB]);
    expect(result.get(folderA)).toEqual(['utils.py']);
    expect(result.get(folderB)).toEqual(['index.js']);
  });

  it('skips files that are outside all workspace folders', () => {
    const folder = makeFolder('/projects/foo');
    const result = computeExcludePatterns(['/projects/foo/good.py', '/other/bad.py'], [folder]);
    expect(result.get(folder)).toEqual(['good.py']);
    // /other/bad.py is absent — no entry for it
    expect(result.size).toBe(1);
  });
});

describe('computeExcludePatterns — special characters in filenames', () => {
  it('escapes square brackets in the filename', () => {
    const folder = makeFolder('/projects/foo');
    const result = computeExcludePatterns(['/projects/foo/[2024]-file.csv'], [folder]);
    expect(result.get(folder)).toEqual(['\\[2024\\]-file.csv']);
  });

  it('escapes glob wildcards in directory names', () => {
    const folder = makeFolder('/projects/foo');
    const stale = path.join('/projects/foo', 'dist*', 'bundle.js');
    const result = computeExcludePatterns([stale], [folder]);
    expect(result.get(folder)).toEqual(['dist\\*/bundle.js']);
  });
});

describe('computeExcludePatterns — edge cases', () => {
  it('handles no workspace folders', () => {
    const result = computeExcludePatterns(['/projects/foo/bar.py'], []);
    expect(result.size).toBe(0);
  });

  it('does not assign a folder path itself (exact workspace root) as a pattern', () => {
    const folder = makeFolder('/projects/foo');
    // path.relative('/projects/foo', '/projects/foo') === '' (empty string)
    // Empty patterns have undefined glob semantics — they are explicitly skipped.
    const result = computeExcludePatterns(['/projects/foo'], [folder]);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyFilesExcludePrune — restore logic
// ---------------------------------------------------------------------------

describe('applyFilesExcludePrune — restore logic', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Build a stateful config mock whose inspect() always reflects the current state.
  function makeConfig(initial = {}) {
    let state = { ...initial };
    const config = {
      inspect: () => ({ workspaceFolderValue: { ...state } }),
      update: vi.fn(async (_key, value) => {
        state = value ?? {};
      }),
      getState: () => state,
    };
    return config;
  }

  function makeVscode(config) {
    return {
      workspace: { getConfiguration: () => config },
      ConfigurationTarget: { WorkspaceFolder: 3 },
    };
  }

  it('restores a pre-existing false entry to false after the delay', async () => {
    const config = makeConfig({ 'src/old.py': false });
    const vscode = makeVscode(config);
    const folder = { uri: {} };

    const run = applyFilesExcludePrune(new Map([[folder, ['src/old.py']]]), vscode);
    await vi.runAllTimersAsync();
    await run;

    expect(config.getState()).toEqual({ 'src/old.py': false });
  });

  it('removes a newly-added key after the delay, leaving config empty', async () => {
    const config = makeConfig({});
    const vscode = makeVscode(config);
    const folder = { uri: {} };

    const run = applyFilesExcludePrune(new Map([[folder, ['new.py']]]), vscode);
    // Verify that the initial write set the pattern to true
    await Promise.resolve();
    await Promise.resolve();
    expect(config.getState()).toEqual({ 'new.py': true });

    await vi.runAllTimersAsync();
    await run;
    // After restore the key is deleted and the config is cleared (written as undefined)
    expect(config.getState()).toEqual({});
  });

  it('does not call config.update when all patterns are already true', async () => {
    const config = makeConfig({ 'src/old.py': true });
    const vscode = makeVscode(config);
    const folder = { uri: {} };

    const run = applyFilesExcludePrune(new Map([[folder, ['src/old.py']]]), vscode);
    await vi.runAllTimersAsync();
    await run;

    // Nothing to do — block is skipped entirely, no writes occur
    expect(config.update).toHaveBeenCalledTimes(0);
  });

  it('counts only effective pattern changes (skips already-true entries)', async () => {
    // 'a.py' already true → 0 change; 'b.py' false → 1 change; 'c.py' absent → 1 change
    const config = makeConfig({ 'a.py': true, 'b.py': false });
    const vscode = makeVscode(config);
    const folder = { uri: {} };

    const run = applyFilesExcludePrune(new Map([[folder, ['a.py', 'b.py', 'c.py']]]), vscode);
    await vi.runAllTimersAsync();
    const count = await run;

    expect(count).toBe(2);
  });

  it('preserves concurrent changes made to the config during the delay', async () => {
    // The second inspect() call (during restore) returns a state that includes a
    // concurrent user edit ('user-added.py') made during the 1000ms window.
    let inspectCallCount = 0;
    const folder = { uri: {} };
    const config = {
      inspect: () => ({
        workspaceFolderValue:
          inspectCallCount++ === 0
            ? {} // initial state: empty
            : { 'new.py': true, 'user-added.py': true }, // state during restore: concurrent edit present
      }),
      update: vi.fn(async () => {}),
    };
    const vscode = makeVscode(config);

    const run = applyFilesExcludePrune(new Map([[folder, ['new.py']]]), vscode);
    await vi.runAllTimersAsync();
    await run;

    // 'new.py' should be removed, 'user-added.py' should be kept
    const restoreArg = config.update.mock.calls[1][1];
    expect(restoreArg).toEqual({ 'user-added.py': true });
  });
});

// ---------------------------------------------------------------------------
// applyGlobalExcludePrune — restore logic
// ---------------------------------------------------------------------------

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

// vitest globals (describe, it, expect, vi) are injected via globals:true in vitest.config.mjs

const { fileUriToFsPath, readWorkspaceHistoryPaths, cleanStalePathsFromDb } = require('../src/pruneGoToFileHistory.js');
const childProcess = require('child_process');

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
// readWorkspaceHistoryPaths + cleanStalePathsFromDb (both use childProcess.spawnSync)
// ---------------------------------------------------------------------------

describe('spawnSync-based functions', () => {
  let spawnSyncSpy;

  beforeEach(() => {
    spawnSyncSpy = vi.spyOn(childProcess, 'spawnSync');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readWorkspaceHistoryPaths', () => {
    it('returns null when sqlite3 exits with non-zero status', () => {
      spawnSyncSpy.mockReturnValue({ status: 1, error: null, stdout: '' });
      expect(readWorkspaceHistoryPaths('/fake/state.vscdb')).toBeNull();
    });

    it('returns null when spawnSync returns an error (e.g. sqlite3 not found)', () => {
      spawnSyncSpy.mockReturnValue({ status: 0, error: new Error('ENOENT'), stdout: '' });
      expect(readWorkspaceHistoryPaths('/fake/state.vscdb')).toBeNull();
    });

    it('returns an empty array when the DB has no history.entries row', () => {
      spawnSyncSpy.mockReturnValue({ status: 0, error: null, stdout: '' });
      expect(readWorkspaceHistoryPaths('/fake/state.vscdb')).toEqual([]);
    });

    it('returns an empty array when sqlite3 emits only whitespace (e.g. a bare newline for empty tables)', () => {
      // sqlite3 outputs '\n' when a query returns no rows on some platforms.
      // The .trim() before the empty-check is load-bearing; this test verifies it.
      spawnSyncSpy.mockReturnValue({ status: 0, error: null, stdout: '\n' });
      expect(readWorkspaceHistoryPaths('/fake/state.vscdb')).toEqual([]);
    });

    it('returns filesystem paths from valid history entries', () => {
      const entries = [
        { editor: { resource: 'file:///Users/e/project/src/main.js' } },
        { editor: { resource: 'file:///Users/e/project/src/utils.js' } },
      ];
      spawnSyncSpy.mockReturnValue({ status: 0, error: null, stdout: JSON.stringify(entries) });
      expect(readWorkspaceHistoryPaths('/fake/state.vscdb')).toEqual([
        '/Users/e/project/src/main.js',
        '/Users/e/project/src/utils.js',
      ]);
    });

    it('skips entries without editor.resource', () => {
      const entries = [
        { editor: {} },
        { someOtherEntry: true },
        { editor: { resource: 'file:///Users/e/project/index.js' } },
      ];
      spawnSyncSpy.mockReturnValue({ status: 0, error: null, stdout: JSON.stringify(entries) });
      expect(readWorkspaceHistoryPaths('/fake/state.vscdb')).toEqual(['/Users/e/project/index.js']);
    });

    it('skips non-file:// URIs (remote, virtual)', () => {
      const entries = [
        { editor: { resource: 'vscode-remote://host/path/file.js' } },
        { editor: { resource: 'file:///Users/e/local.js' } },
      ];
      spawnSyncSpy.mockReturnValue({ status: 0, error: null, stdout: JSON.stringify(entries) });
      expect(readWorkspaceHistoryPaths('/fake/state.vscdb')).toEqual(['/Users/e/local.js']);
    });

    it('returns null for malformed JSON', () => {
      spawnSyncSpy.mockReturnValue({ status: 0, error: null, stdout: 'not valid json {' });
      expect(readWorkspaceHistoryPaths('/fake/state.vscdb')).toBeNull();
    });

    it('returns null when the JSON value is not an array', () => {
      spawnSyncSpy.mockReturnValue({ status: 0, error: null, stdout: '{"key":"value"}' });
      expect(readWorkspaceHistoryPaths('/fake/state.vscdb')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // cleanStalePathsFromDb
  // ---------------------------------------------------------------------------

  describe('cleanStalePathsFromDb', () => {
    it('returns false when the read query fails', () => {
      spawnSyncSpy.mockReturnValue({ status: 1, error: null, stdout: '' });
      expect(cleanStalePathsFromDb('/fake/state.vscdb', new Set(['/missing.js']))).toBe(false);
    });

    it('returns true when the DB has no history.entries row (empty result is no-op, not an error)', () => {
      spawnSyncSpy.mockReturnValue({ status: 0, error: null, stdout: '' });
      expect(cleanStalePathsFromDb('/fake/state.vscdb', new Set(['/missing.js']))).toBe(true);
      expect(spawnSyncSpy).toHaveBeenCalledTimes(1); // no write call needed
    });

    it('returns true and skips the write when no stale paths appear in the current entries', () => {
      const entries = [{ editor: { resource: 'file:///Users/e/existing.js' } }];
      spawnSyncSpy.mockReturnValue({ status: 0, error: null, stdout: JSON.stringify(entries) });
      const result = cleanStalePathsFromDb('/fake/state.vscdb', new Set(['/Users/e/other-missing.js']));
      expect(result).toBe(true);
      expect(spawnSyncSpy).toHaveBeenCalledTimes(1); // read only, no write since entries unchanged
    });

    it('removes only stale paths and returns true when the write succeeds', () => {
      const stale = { editor: { resource: 'file:///Users/e/stale.js' } };
      const keep = { editor: { resource: 'file:///Users/e/keep.js' } };
      spawnSyncSpy
        .mockReturnValueOnce({ status: 0, error: null, stdout: JSON.stringify([stale, keep]) })
        .mockReturnValueOnce({ status: 0, error: null, stdout: '' });

      const result = cleanStalePathsFromDb('/fake/state.vscdb', new Set(['/Users/e/stale.js']));
      expect(result).toBe(true);

      // The write SQL should retain only the kept entry
      const writeInput = spawnSyncSpy.mock.calls[1][2].input;
      expect(writeInput).toContain('keep.js');
      expect(writeInput).not.toContain('stale.js');
    });

    it('returns false when the write query fails', () => {
      const stale = { editor: { resource: 'file:///Users/e/stale.js' } };
      spawnSyncSpy
        .mockReturnValueOnce({ status: 0, error: null, stdout: JSON.stringify([stale]) })
        .mockReturnValueOnce({ status: 1, error: null, stdout: '' });
      expect(cleanStalePathsFromDb('/fake/state.vscdb', new Set(['/Users/e/stale.js']))).toBe(false);
    });

    it('issues a correctly formatted UPDATE statement', () => {
      const entry = { editor: { resource: 'file:///Users/e/stale.js' } };
      spawnSyncSpy
        .mockReturnValueOnce({ status: 0, error: null, stdout: JSON.stringify([entry]) })
        .mockReturnValueOnce({ status: 0, error: null, stdout: '' });

      cleanStalePathsFromDb('/fake/state.vscdb', new Set(['/Users/e/stale.js']));

      const writeInput = spawnSyncSpy.mock.calls[1][2].input;
      expect(writeInput).toMatch(/^UPDATE ItemTable SET value = '.*' WHERE key = 'history\.entries';\n$/s);
    });
  });
});

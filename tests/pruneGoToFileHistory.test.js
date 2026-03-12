// vitest globals (describe, it, expect, vi) are injected via globals:true in vitest.config.mjs
const { fileUriToFsPath } = require('../src/pruneGoToFileHistory.js');

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

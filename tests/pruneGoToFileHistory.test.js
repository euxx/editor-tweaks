// vitest globals (describe, it, expect) are injected via globals:true in vitest.config.mjs
const { fileUriToFsPath, escapeGlob, computeExcludePatterns } = require('../src/pruneGoToFileHistory.js');

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
